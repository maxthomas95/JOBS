import { createHash, randomUUID } from 'node:crypto';
import type { PixelEvent, ActivityEvent } from '../src/types/events.js';

export const CODEX_EVENTS = new Set([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PermissionRequest', 'PreCompact', 'PostCompact', 'Stop', 'Interrupt',
  'SessionEnd', 'SubagentStart', 'SubagentStop',
]);
type Mode = 'hooks' | 'notify';
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 2000;

export interface CodexSessionSink {
  registerWebhookAgent(sourceId: string, opts: {
    sourceName?: string; sourceType?: string; provider?: string;
    integrationMode?: Mode; parentId?: string; state?: string;
  }): { id: string };
  handleEvent(event: PixelEvent): void;
}

interface Hook {
  event: string;
  session: string;
  turn?: string;
  child?: string;
  toolId?: string;
  tool: string;
  source?: string;
  timestamp: number;
  deliveryId?: string;
}
interface Session {
  lastSeen: number;
  lastTimestamp: number;
  closedAt: number | null;
  activeTurn?: string;
  closedTurns: Set<string>;
  deliveries: Set<string>;
  tools: Map<string, 'started' | 'completed'>;
  mode: Mode;
}

function identity(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

/** Only fixed categories leave this adapter; even custom MCP names can contain private data. */
export function codexToolCategory(value: unknown): string {
  if (typeof value !== 'string') return 'Tool';
  const name = value.replace(/^functions\./, '');
  if (['Bash', 'exec_command', 'shell', 'shell_command', 'write_stdin'].includes(name)) return 'Bash';
  if (['apply_patch', 'Edit', 'Write'].includes(name)) return 'Edit';
  if (['Read', 'read_file', 'view_image'].includes(name)) return 'Read';
  if (['Grep', 'Glob', 'search', 'list_files'].includes(name)) return 'Grep';
  if (['spawn_agent', 'Task', 'Agent'].includes(name)) return 'Task';
  if (['web', 'web.run', 'WebFetch', 'WebSearch'].includes(name)) return 'WebFetch';
  if (name === 'MCP' || name.startsWith('mcp__')) return 'MCP';
  return 'Tool';
}

function normalize(input: unknown, mode: Mode, now: number): Hook | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  const event = mode === 'notify' ? (data.type === 'agent-turn-complete' ? 'Stop' : '') : data.hook_event_name;
  const session = identity(mode === 'notify' ? data['thread-id'] : data.session_id);
  if (typeof event !== 'string' || !CODEX_EVENTS.has(event) || !session) return null;
  const turn = identity(mode === 'notify' ? data['turn-id'] : data.turn_id);
  const child = identity(data.agent_id);
  const toolId = identity(data.tool_use_id);
  // Turn-scoped hook events without a turn id cannot be ordered safely.
  if (mode === 'hooks' && !['SessionStart', 'SessionEnd'].includes(event) && !turn) return null;
  if (['SubagentStart', 'SubagentStop'].includes(event) && !child) return null;
  if (['PreToolUse', 'PostToolUse'].includes(event) && !toolId) return null;
  const timestamp = typeof data.sent_at === 'number' && Number.isFinite(data.sent_at) ? data.sent_at : now;
  if (timestamp < now - RETENTION_MS || timestamp > now + 60_000) return null;
  return {
    event, session, turn, child, toolId, timestamp,
    tool: codexToolCategory(data.tool_name),
    source: ['startup', 'resume', 'clear', 'compact'].includes(String(data.source)) ? String(data.source) : undefined,
    deliveryId: identity(data.event_id),
  };
}

function boundedAdd(set: Set<string>, value: string, max = 512): void {
  set.add(value);
  if (set.size > max) set.delete(set.values().next().value!);
}

/** Provider ordering lives here, outside the shared animation/state machine. */
export class CodexProvider {
  private sessions = new Map<string, Session>();
  private observedModes = new Set<Mode>();
  private acceptedEvents = 0;
  private ignoredEvents = 0;
  private lastEventAt: number | null = null;
  private lastEvent: string | null = null;
  private lastCheckAt: number | null = null;

  constructor(private sink: CodexSessionSink, private publish: (event: PixelEvent) => void = () => {}, private now = Date.now) {}

  check(): void { this.lastCheckAt = this.now(); }

  health() {
    const hooks = this.observedModes.has('hooks');
    const mode = this.observedModes.size > 1 ? 'mixed' : hooks ? 'hooks' : this.observedModes.has('notify') ? 'notify' : 'unobserved';
    return {
      id: 'codex', label: 'Codex', mode,
      status: this.lastEventAt === null ? 'unobserved' : this.now() - this.lastEventAt > 300_000 ? 'stale' : 'active',
      lastEventAt: this.lastEventAt, lastEvent: this.lastEvent, lastCheckAt: this.lastCheckAt,
      capabilities: { lifecycle: hooks, tools: hooks, approvals: hooks, compaction: hooks, subagents: hooks, usage: false },
      acceptedEvents: this.acceptedEvents, ignoredEvents: this.ignoredEvents,
      limitations: [
        'Observed delivery mode; installation and hook trust must be checked in Codex.',
        'No token usage or hosted search telemetry. Silence does not prove a disconnect.',
        ...(hooks ? ['Background delivery can be incomplete; ordering protection is retained for 24 hours (up to 2000 sessions).'] : ['Completion notifications do not report live tools or approvals.']),
      ],
    };
  }

  ingest(input: unknown, mode: Mode = 'hooks'): { accepted: boolean; reason?: string } {
    const now = this.now();
    const hook = normalize(input, mode, now);
    if (!hook) return this.ignore('unsupported-or-invalid');
    for (const [key, state] of this.sessions) {
      if (now - state.lastSeen > RETENTION_MS) this.sessions.delete(key);
    }
    // The subagent hook's session_id identifies its parent; other child events use the child's session_id.
    const sessionId = hook.child && hook.event.startsWith('Subagent') ? hook.child : hook.session;
    let session = this.sessions.get(sessionId);
    if (session?.mode === 'hooks' && mode === 'notify') return this.ignore('hooks-take-precedence');
    if (!session) {
      session = { lastSeen: now, lastTimestamp: 0, closedAt: null, closedTurns: new Set(), deliveries: new Set(), tools: new Map(), mode };
      if (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
      this.sessions.set(sessionId, session);
    }
    const deliveryKey = hook.deliveryId ?? createHash('sha256').update(JSON.stringify([
      hook.event, hook.turn, hook.toolId, hook.child, hook.source,
      // Stable turn/tool identities deduplicate ordinary events; timestamps distinguish repeated compactions/session starts.
      !hook.turn || ['SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact', 'PermissionRequest'].includes(hook.event) ? hook.timestamp : null,
    ])).digest('hex');
    if (session.deliveries.has(deliveryKey)) return this.ignore('duplicate');
    boundedAdd(session.deliveries, deliveryKey);
    if (session.closedAt !== null) {
      const resume = hook.event === 'SessionStart' && hook.source === 'resume';
      const newTurn = hook.event === 'UserPromptSubmit' && hook.turn && !session.closedTurns.has(hook.turn);
      if ((!resume && !newTurn) || hook.timestamp <= session.closedAt) return this.ignore('session-closed');
      session.closedAt = null;
    }
    const childLifecycle = hook.event === 'SubagentStart' || hook.event === 'SubagentStop';
    if (!childLifecycle && hook.turn && session.closedTurns.has(hook.turn)) return this.ignore('turn-closed');
    if (hook.event === 'SessionStart' && session.lastTimestamp > 0 && hook.source !== 'resume') return this.ignore('session-already-observed');
    if (!childLifecycle && hook.turn && session.activeTurn && hook.turn !== session.activeTurn) {
      if ((hook.event !== 'UserPromptSubmit' && mode !== 'notify') || hook.timestamp < session.lastTimestamp) return this.ignore('older-or-unstarted-turn');
      boundedAdd(session.closedTurns, session.activeTurn, 256);
      session.tools.clear();
    }
    if (!childLifecycle && hook.turn) session.activeTurn = hook.turn;
    // A delayed tool start must not undo its completion, even if the sender's clock/order is imperfect.
    if (hook.toolId && hook.event === 'PreToolUse' && session.tools.has(hook.toolId)) return this.ignore('tool-already-observed');
    if (hook.toolId && hook.event === 'PostToolUse' && session.tools.get(hook.toolId) === 'completed') return this.ignore('tool-already-completed');
    const terminal = ['Stop', 'Interrupt', 'SessionEnd', 'SubagentStop'].includes(hook.event);
    // Terminal events always close their own turn, even if an async tool event arrived first.
    if (!terminal && hook.timestamp < session.lastTimestamp) return this.ignore('out-of-order');
    session.lastSeen = now;
    session.lastTimestamp = Math.max(session.lastTimestamp, hook.timestamp);
    session.mode = mode;
    this.observedModes.add(mode);
    this.acceptedEvents++;
    this.lastEventAt = now;
    this.lastEvent = mode === 'notify' ? 'agent-turn-complete' : hook.event;

    const agent = this.sink.registerWebhookAgent(`codex-${sessionId}`, {
      sourceName: `Codex ${sessionId.slice(-6)}`, sourceType: 'codex', provider: 'codex', integrationMode: mode,
      ...(childLifecycle ? { parentId: `wh:codex-${hook.session}` } : {}),
    });
    const base = { id: randomUUID(), sessionId: agent.id, agentId: agent.id, timestamp: Math.min(now, session.lastTimestamp) };
    const emit = (event: PixelEvent) => { this.sink.handleEvent(event); this.publish(event); };
    const activity = (action: ActivityEvent['action']) => emit({ ...base, id: randomUUID(), type: 'activity', action });
    if (['SessionStart', 'SubagentStart'].includes(hook.event)) {
      emit({ ...base, type: 'session', action: 'started', ...(hook.child ? { parentId: `wh:codex-${hook.session}` } : {}) });
    } else if (['SessionEnd', 'SubagentStop'].includes(hook.event)) {
      session.closedAt = session.lastTimestamp;
      if (session.activeTurn) boundedAdd(session.closedTurns, session.activeTurn, 256);
      emit({ ...base, type: 'session', action: 'ended' });
    } else if (['Stop', 'Interrupt'].includes(hook.event)) {
      if (hook.turn) boundedAdd(session.closedTurns, hook.turn, 256);
      session.tools.clear();
      activity('waiting');
    } else if (hook.event === 'UserPromptSubmit') activity('user_prompt');
    else if (hook.event === 'PermissionRequest') activity('needsApproval');
    else if (hook.event === 'PreCompact') activity('compacting');
    else if (hook.event === 'PostCompact') activity('thinking');
    else if (hook.toolId) {
      const status = hook.event === 'PreToolUse' ? 'started' : 'completed';
      session.tools.set(hook.toolId, status);
      if (session.tools.size > 2048) {
        const completed = [...session.tools].find(([, value]) => value === 'completed');
        session.tools.delete(completed?.[0] ?? session.tools.keys().next().value!);
      }
      // Tool IDs are opaque; hash before exposing them in public events.
      emit({ ...base, type: 'tool', tool: hook.tool, status, toolUseId: createHash('sha256').update(hook.toolId).digest('hex').slice(0, 24) });
      if (status === 'completed' && ![...session.tools.values()].includes('started')) activity('thinking');
    }
    return { accepted: true };
  }

  private ignore(reason: string) { this.ignoredEvents++; return { accepted: false, reason }; }
}
