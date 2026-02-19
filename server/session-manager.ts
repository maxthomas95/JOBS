import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import type { Agent, AgentState } from '../src/types/agent.js';
import type { MachineInfo, PixelEvent } from '../src/types/events.js';
import { STATIONS, tileToWorld } from '../src/types/agent.js';
import { createActivityEvent, createSessionEvent } from './bridge/pixel-events.js';
import { cleanToolNameCache } from './bridge/claude-adapter.js';
import type { StatsStore } from './stats-store.js';

const MACHINE_COLORS = ['#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8', '#4dd0e1', '#fff176', '#f06292'];

function machineColor(machineId: string): string {
  let hash = 0;
  for (let i = 0; i < machineId.length; i++) hash = ((hash << 5) - hash + machineId.charCodeAt(i)) | 0;
  return MACHINE_COLORS[Math.abs(hash) % MACHINE_COLORS.length];
}

/** Map webhook state strings to AgentState + station */
type StationName = 'door' | 'whiteboard' | 'terminal' | 'library' | 'coffee' | 'desk';
const WEBHOOK_STATE_MAP: Record<string, { state: AgentState; station: StationName }> = {
  running: { state: 'coding', station: 'desk' },
  testing: { state: 'terminal', station: 'terminal' },
  building: { state: 'terminal', station: 'terminal' },
  deploying: { state: 'delegating', station: 'desk' },
  analyzing: { state: 'searching', station: 'library' },
  waiting: { state: 'waiting', station: 'coffee' },
  reviewing: { state: 'reading', station: 'desk' },
  thinking: { state: 'thinking', station: 'whiteboard' },
  error: { state: 'error', station: 'desk' },
  success: { state: 'cooling', station: 'coffee' },
  idle: { state: 'idle', station: 'desk' },
};

const AGENT_NAMES = [
  'Ada', 'Grace', 'Linus', 'Alan', 'Dijkstra',
  'Hopper', 'Knuth', 'Babbage', 'Turing', 'Lovelace',
  'Ritchie', 'Thompson', 'Woz', 'Carmack', 'Norvig',
  'Liskov', 'Hamilton', 'Hoare', 'Lamport', 'Cerf',
  'Berners-Lee', 'Torvalds', 'Pike', 'Stroustrup', 'Gosling',
];

/** Extract project name from Claude's session file path.
 *  Path format: ~/.claude/projects/{encoded-path}/{uuid}.jsonl
 *  The encoded-path may be URL-encoded (older) or dash-encoded (current):
 *    URL: C%3A%5Crepo%5Cjobs  →  decoded C:\repo\jobs  →  "jobs"
 *    Dash: C--repo-jobs        →  resolve via filesystem  →  "jobs" */
function extractProjectName(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/\.claude\/projects\/([^/]+)/);
  if (match) {
    const segment = match[1];

    // 1. Try URL decoding (older Claude versions or other platforms)
    try {
      const decoded = decodeURIComponent(segment);
      if (decoded !== segment) {
        const segments = decoded.replace(/\\/g, '/').split('/').filter(Boolean);
        return segments[segments.length - 1] || null;
      }
    } catch {
      // Not URL-encoded — fall through
    }

    // 2. Claude's dash-encoding: path separators (: \ /) replaced with -
    //    Windows: C:\repo\jobs → C--repo-jobs
    //    Unix: /home/user/project → -home-user-project
    //    Try each dash (right-to-left) as the project-name boundary,
    //    reconstruct the parent path, and check if it exists on disk.
    const winDrive = segment.match(/^([A-Za-z])--(.+)$/);
    const rest = winDrive ? winDrive[2] : segment.startsWith('-') ? segment.slice(1) : null;
    const prefix = winDrive ? `${winDrive[1]}:/` : segment.startsWith('-') ? '/' : null;

    if (prefix && rest) {
      for (let i = rest.length - 1; i >= 0; i--) {
        if (rest[i] !== '-') continue;
        const parentPart = rest.slice(0, i).replace(/-/g, '/');
        try {
          if (existsSync(prefix + parentPart)) {
            return rest.slice(i + 1);
          }
        } catch { /* permission error — skip */ }
      }
      // No dash resolved — project is directly under drive/root
      return rest;
    }
  }
  // Fallback: use basename of the path minus extension
  const basename = normalized.split('/').pop();
  if (basename) {
    return basename.replace(/\.jsonl$/, '');
  }
  return null;
}

interface ServerAgent extends Agent {
  filePath?: string;
  lastEventType?: string;
  /** Timestamp when the agent entered waitingForHuman — used for dedicated eviction */
  waitingSince?: number;
  /** Whether this agent's waiting state was set deterministically via hooks (skip heuristic detector) */
  hookActive?: boolean;
}

type ToolClassification = 'terminal' | 'searching' | 'reading' | 'coding' | 'delegating' | 'thinking';

function classifyTool(toolName: string): ToolClassification {
  const tool = toolName.toLowerCase();
  if (tool.includes('bash') || tool.includes('terminal')) {
    return 'terminal';
  }
  if (tool.includes('search') || tool.includes('websearch') || tool.includes('grep') || tool.includes('glob')) {
    return 'searching';
  }
  if (tool.includes('read')) {
    return 'reading';
  }
  if (tool === 'task') {
    return 'delegating';
  }
  if (tool.includes('plan') || tool.includes('enterplanmode')) {
    return 'thinking';
  }
  if (tool.includes('write') || tool.includes('edit')) {
    return 'coding';
  }
  return 'coding';
}

/** Remembered identity of an evicted agent, for resurrection if the same session resumes */
interface ArchivedAgent {
  name: string;
  characterIndex: number;
  deskIndex: number | null;
  parentId: string | null;
  childIds: string[];
  project: string | null;
  filePath?: string;
  roleName: string | null;
  provider: string;
  machineId: string | null;
  machineName: string | null;
  archivedAt: number;
}

/** Tracks an agent that recently used the Task tool and may spawn a child */
interface PendingSpawn {
  parentId: string;
  timestamp: number;
  /** The Claude Code-assigned name for the spawned agent (e.g. "m2-builder") */
  childName: string | null;
}

export class SessionManager {
  private readonly agents = new Map<string, ServerAgent>();
  private readonly archivedAgents = new Map<string, ArchivedAgent>();
  private readonly archiveTtlMs = 2 * 60 * 60 * 1000; // 2 hours
  private readonly deskAssignments: Array<string | null>;
  private nextCharacterIndex = 0;
  private nextNameIndex = 0;
  private readonly assignedNames = new Set<string>();
  private readonly pendingSpawns: PendingSpawn[] = [];
  private readonly hookPendingChildren = new Map<string, { parentId: string; agentType: string; timestamp: number }>();
  private readonly spawnWindowMs = 10000;
  private readonly staleIdleMs: number;
  private readonly staleEvictMs: number;
  private readonly enteringTimeoutMs = 30000;
  private readonly waitingThresholdMs = 8000;
  private readonly waitingEvictMs: number;
  private onSnapshotNeeded: (() => void) | null = null;
  private statsStore: StatsStore | null = null;
  private readonly machines = new Map<string, MachineInfo>();
  private readonly localMachineId: string;
  private readonly localMachineName: string;

  constructor(
    staleIdleMs = Number(process.env.STALE_IDLE_MS ?? 60000),
    staleEvictMs = Number(process.env.STALE_EVICT_MS ?? 180000),
    localMachineId?: string,
    localMachineName?: string,
  ) {
    this.deskAssignments = new Array<string | null>(Math.max(1, STATIONS.desks.length)).fill(null);
    this.staleIdleMs = staleIdleMs;
    this.staleEvictMs = staleEvictMs;
    this.waitingEvictMs = Number(process.env.WAITING_EVICT_MS ?? 60000);
    this.localMachineId = localMachineId ?? hostname();
    this.localMachineName = localMachineName ?? this.localMachineId;
    // Register local machine
    this.machines.set(this.localMachineId, {
      id: this.localMachineId,
      name: this.localMachineName,
      color: machineColor(this.localMachineId),
      activeCount: 0,
    });
    this.startGhostTimer();
    this.startWaitingDetector();
  }

  setSnapshotCallback(cb: () => void): void {
    this.onSnapshotNeeded = cb;
  }

  setStatsStore(store: StatsStore): void {
    this.statsStore = store;
  }

  registerSession(sessionId: string, filePath: string): ServerAgent {
    const existing = this.agents.get(sessionId);
    if (existing) {
      existing.lastEventAt = Date.now();
      existing.filePath = filePath;
      return existing;
    }

    // Check archive — restore identity if same session is resuming
    const archived = this.archivedAgents.get(sessionId);
    if (archived) {
      this.archivedAgents.delete(sessionId);
      return this.restoreFromArchive(sessionId, filePath, archived);
    }

    const door = tileToWorld(STATIONS.door);
    const name = this.assignName();

    // Check for deterministic hook-based parent linking first
    const fileBasename = filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.jsonl$/, '') ?? '';
    const hookChild = this.hookPendingChildren.get(fileBasename) ?? this.hookPendingChildren.get(sessionId);
    if (hookChild) {
      this.hookPendingChildren.delete(fileBasename);
      this.hookPendingChildren.delete(sessionId);
    }

    // Fall back to time-window heuristic if no hook-based link
    const pendingSpawn = hookChild
      ? { parentId: hookChild.parentId, timestamp: Date.now(), childName: hookChild.agentType }
      : this.matchPendingSpawn();

    // Reserve desk — prefer adjacent to parent if this is a sub-agent
    const parentAgent = pendingSpawn?.parentId ? this.agents.get(pendingSpawn.parentId) : null;
    const deskIndex = this.reserveDesk(sessionId, parentAgent?.deskIndex ?? null);
    const target = deskIndex === null ? door : tileToWorld(STATIONS.desks[deskIndex]);

    const agent: ServerAgent = {
      id: sessionId,
      sessionId,
      characterIndex: this.nextCharacterIndex % 8,
      state: 'entering',
      position: door,
      targetPosition: target,
      deskIndex,
      lastEventAt: Date.now(),
      stateChangedAt: Date.now(),
      activityText: null,
      name,
      roleName: pendingSpawn?.childName ?? null,
      project: extractProjectName(filePath),
      waitingForHuman: false,
      parentId: pendingSpawn?.parentId ?? null,
      childIds: [],
      provider: 'claude',
      machineId: this.localMachineId,
      machineName: this.localMachineName,
      sourceType: null,
      sourceName: null,
      sourceUrl: null,
      filePath,
    };

    // Update local machine active count
    this.updateMachineCount(this.localMachineId, 1);

    // Link parent to child
    const parentId = pendingSpawn?.parentId ?? null;
    if (parentId) {
      const parent = this.agents.get(parentId);
      if (parent) {
        parent.childIds = [...parent.childIds, sessionId];
      }
    }

    this.nextCharacterIndex += 1;
    this.agents.set(sessionId, agent);
    this.statsStore?.recordSessionStart(sessionId, name, agent.project);
    return agent;
  }

  handleEvent(event: PixelEvent): void {
    const sessionId = event.sessionId;
    let agent = this.agents.get(sessionId);
    if (!agent && event.type === 'session' && event.action === 'started') {
      agent = this.registerSession(sessionId, event.project ?? sessionId);
    }
    if (!agent) {
      return;
    }

    agent.lastEventAt = event.timestamp || Date.now();

    // When hooks have deterministically set waiting state, ignore stale JSONL events
    // from the same turn. Only user_prompt (new human message) or session events can wake up.
    if (agent.hookActive && agent.waitingForHuman) {
      if (event.type === 'activity' && event.action === 'user_prompt') {
        // New human message — wake up and proceed
        agent.waitingForHuman = false;
        agent.waitingSince = undefined;
      } else if (event.type === 'session') {
        // Session lifecycle — proceed
        agent.waitingForHuman = false;
        agent.waitingSince = undefined;
      } else {
        // Stale JSONL event from the same turn — ignore
        return;
      }
    } else if (agent.waitingForHuman) {
      // Non-hook agent: clear waiting on any new event
      agent.waitingForHuman = false;
      agent.waitingSince = undefined;
    }

    const desk = agent.deskIndex === null ? STATIONS.whiteboard : STATIONS.desks[agent.deskIndex];

    if (event.type === 'session') {
      agent.lastEventType = `session.${event.action}`;
      if (event.action === 'started') {
        // Enrich session event with agent metadata for client-side instant accuracy
        event.characterIndex = agent.characterIndex;
        event.deskIndex = agent.deskIndex;
        event.name = agent.name ?? undefined;
        event.roleName = agent.roleName ?? undefined;
        event.project = agent.project ?? undefined;
        event.parentId = agent.parentId ?? undefined;
        this.applyState(agent, 'entering', agent.deskIndex === null ? STATIONS.door : STATIONS.desks[agent.deskIndex], null);
        // Broadcast snapshot so all clients get parent's updated childIds
        if (agent.parentId && this.onSnapshotNeeded) {
          this.onSnapshotNeeded();
        }
      } else if (event.action === 'ended') {
        // True session end — clear any archive so it won't resurrect
        const wasArchived = this.archivedAgents.get(sessionId);
        if (wasArchived) {
          this.archivedAgents.delete(sessionId);
          // Name was held by archive — release it now
          if (wasArchived.name) {
            this.assignedNames.delete(wasArchived.name);
          }
        }
        this.statsStore?.recordSessionEnd(sessionId, {});
        this.applyState(agent, 'leaving', STATIONS.door, null);
        this.releaseDesk(sessionId);
        setTimeout(() => {
          if (agent.name) {
            this.assignedNames.delete(agent.name);
          }
          this.agents.delete(sessionId);
        }, 2000);
      }
      return;
    }

    if (event.type === 'activity') {
      agent.lastEventType = `activity.${event.action}`;
      if (event.action === 'thinking') {
        this.applyState(agent, 'thinking', STATIONS.whiteboard, 'Thinking...');
      } else if (event.action === 'responding') {
        this.applyState(agent, 'coding', desk, 'Responding...');
      } else if (event.action === 'waiting') {
        this.applyState(agent, 'waiting', STATIONS.coffee, 'Waiting...');
        agent.waitingForHuman = true;
        agent.waitingSince = Date.now();
      } else if (event.action === 'user_prompt') {
        // Human sent a message — Claude will start processing immediately.
        // Transition to thinking since the JSONL won't write the thinking
        // block until thinking finishes (could be 10-30s of no events).
        this.applyState(agent, 'thinking', STATIONS.whiteboard, 'Processing...');
      }
      return;
    }

    if (event.type === 'tool') {
      agent.lastEventType = `tool.${event.tool}`;
    }

    if (event.type === 'tool' && event.status === 'started') {
      this.statsStore?.recordToolUse(event.tool);
      const context = event.context ?? null;
      const mode = classifyTool(event.tool);
      // Record potential child spawn with the agent name from context
      if (mode === 'delegating') {
        this.pendingSpawns.push({ parentId: sessionId, timestamp: Date.now(), childName: context });
      }
      if (mode === 'terminal') {
        this.applyState(agent, 'terminal', STATIONS.terminal, context);
      } else if (mode === 'searching') {
        this.applyState(agent, 'searching', STATIONS.library, context);
      } else if (mode === 'reading') {
        this.applyState(agent, 'reading', desk, context);
      } else if (mode === 'delegating') {
        const supervisorDesk = STATIONS.desks[STATIONS.desks.length - 1];
        this.applyState(agent, 'delegating', supervisorDesk, context);
      } else if (mode === 'thinking') {
        this.applyState(agent, 'thinking', STATIONS.whiteboard, context);
      } else {
        this.applyState(agent, 'coding', desk, context);
      }
      return;
    }

    if (event.type === 'error') {
      agent.lastEventType = 'error';
      agent.state = 'error';
      agent.stateChangedAt = Date.now();
      // Don't change targetPosition on error — stay at current location
      return;
    }

    if (event.type === 'summary') {
      agent.lastEventType = 'summary';
      this.applyState(agent, 'cooling', STATIONS.coffee, 'Taking a break');
    }
  }

  handleHookEvent(hookEventName: string, payload: Record<string, unknown>, machineInfo?: { machineId?: string; machineName?: string }): PixelEvent | null {
    const sessionId = payload.session_id as string;

    if (hookEventName === 'Stop') {
      const agent = this.agents.get(sessionId);
      if (agent) {
        agent.waitingForHuman = true;
        agent.waitingSince = Date.now();
        agent.hookActive = true;
        this.applyState(agent, 'waiting', STATIONS.coffee, 'Waiting...');
        return createActivityEvent(sessionId, sessionId, Date.now(), 'waiting');
      }
      return null;
    }

    if (hookEventName === 'SubagentStart') {
      const agentId = payload.agent_id as string | undefined;
      const agentType = (payload.agent_type as string) ?? 'subagent';
      if (agentId) {
        this.hookPendingChildren.set(agentId, { parentId: sessionId, agentType, timestamp: Date.now() });
      }
      return null;
    }

    if (hookEventName === 'SubagentStop') {
      const agentId = payload.agent_id as string | undefined;
      if (agentId && this.agents.has(agentId)) {
        const event = createSessionEvent(agentId, 'ended', { agentId, project: this.agents.get(agentId)?.project ?? undefined });
        this.handleEvent(event);
        return event;
      }
      // eslint-disable-next-line no-console
      if (agentId) console.log(`[hooks] SubagentStop: agent_id ${agentId.slice(0, 12)}… not found in active agents`);
      return null;
    }

    if (hookEventName === 'Notification') {
      const toolName = payload.tool_name as string | undefined;
      if (toolName === 'permission_prompt') {
        const agent = this.agents.get(sessionId);
        if (agent) {
          agent.hookActive = true;
          this.applyState(agent, 'needsApproval' as AgentState, STATIONS.coffee, 'Needs approval');
          return createActivityEvent(sessionId, sessionId, Date.now(), 'needsApproval' as 'waiting');
        }
      }
      return null;
    }

    if (hookEventName === 'PreCompact') {
      const agent = this.agents.get(sessionId);
      if (agent) {
        this.applyState(agent, 'compacting' as AgentState, STATIONS.library, 'Compacting memory...');
        return createActivityEvent(sessionId, sessionId, Date.now(), 'compacting' as 'waiting');
      }
      return null;
    }

    if (hookEventName === 'SessionStart') {
      // Prefer cwd (human-readable dir name, already basename'd by hook-receiver)
      // over project (often undefined from hooks, causing UUID fallback)
      const project = (payload.cwd as string) || (payload.project as string) || undefined;
      // If agent already registered (by watcher), update project from hook's cwd
      // since hooks provide the authoritative human-readable project name
      const existing = this.agents.get(sessionId);
      if (existing && project) {
        existing.project = project;
      }
      const event = createSessionEvent(sessionId, 'started', {
        agentId: sessionId,
        project,
        source: 'hook',
      });
      this.handleEvent(event);
      // Apply machine info from hook payload if present
      if (machineInfo?.machineId) {
        const agent = this.agents.get(sessionId);
        if (agent) {
          const mId = machineInfo.machineId;
          this.ensureMachine(mId);
          // Move count from local to new machine
          this.updateMachineCount(agent.machineId ?? this.localMachineId, -1);
          agent.machineId = mId;
          agent.machineName = machineInfo.machineName ?? mId;
          this.updateMachineCount(mId, 1);
        }
      }
      return event;
    }

    if (hookEventName === 'SessionEnd') {
      const event = createSessionEvent(sessionId, 'ended', {
        agentId: sessionId,
        project: this.agents.get(sessionId)?.project ?? undefined,
      });
      this.handleEvent(event);
      return event;
    }

    if (hookEventName === 'TeammateIdle' || hookEventName === 'TaskCompleted') {
      // Update supervisor's activityText with team status
      const agent = this.agents.get(sessionId);
      if (agent) {
        const text = hookEventName === 'TeammateIdle'
          ? `Teammate idle: ${(payload.teammate_name as string) ?? 'agent'}`
          : `Task completed: ${(payload.task_name as string) ?? 'task'}`;
        agent.activityText = text;
        agent.lastEventAt = Date.now();
      }
      return null;
    }

    return null;
  }

  hasSession(sessionId: string): boolean {
    return this.agents.has(sessionId);
  }

  removeSession(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (agent) {
      if (agent.name) {
        this.assignedNames.delete(agent.name);
      }
      if (agent.machineId) {
        this.updateMachineCount(agent.machineId, -1);
      }
    }
    this.releaseDesk(sessionId);
    this.agents.delete(sessionId);
  }

  /** Remove an agent after stale eviction — name stays reserved via the archive */
  private evictSession(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (agent) {
      // Don't release the name — it's held by the archive entry
      if (agent.machineId) {
        this.updateMachineCount(agent.machineId, -1);
      }
    }
    this.releaseDesk(sessionId);
    this.agents.delete(sessionId);
  }

  getSnapshot(): Agent[] {
    return Array.from(this.agents.values()).map((agent) => ({
      ...agent,
      position: { ...agent.position },
      targetPosition: agent.targetPosition ? { ...agent.targetPosition } : null,
    }));
  }

  getMachines(): MachineInfo[] {
    return Array.from(this.machines.values());
  }

  registerWebhookAgent(sourceId: string, opts: {
    sourceName?: string;
    sourceType?: string;
    project?: string;
    machine?: string;
    state?: string;
    activity?: string;
    url?: string;
  }): ServerAgent {
    const agentId = `wh:${sourceId}`;
    const existing = this.agents.get(agentId);
    if (existing) {
      existing.lastEventAt = Date.now();
      return existing;
    }

    const door = tileToWorld(STATIONS.door);
    const name = opts.sourceName ?? this.assignName();
    const deskIndex = this.reserveDesk(agentId, null);
    const target = deskIndex === null ? door : tileToWorld(STATIONS.desks[deskIndex]);

    const mId = opts.machine ?? this.localMachineId;
    this.ensureMachine(mId);

    const provider = opts.sourceType === 'codex' ? 'codex' : 'webhook';

    const agent: ServerAgent = {
      id: agentId,
      sessionId: agentId,
      characterIndex: this.nextCharacterIndex % 8,
      state: 'entering',
      position: door,
      targetPosition: target,
      deskIndex,
      lastEventAt: Date.now(),
      stateChangedAt: Date.now(),
      activityText: opts.activity ?? null,
      name,
      roleName: null,
      project: opts.project ?? null,
      waitingForHuman: false,
      parentId: null,
      childIds: [],
      provider,
      machineId: mId,
      machineName: this.machines.get(mId)?.name ?? mId,
      sourceType: opts.sourceType ?? null,
      sourceName: opts.sourceName ?? null,
      sourceUrl: opts.url ?? null,
    };

    this.nextCharacterIndex += 1;
    this.agents.set(agentId, agent);
    this.updateMachineCount(mId, 1);
    this.statsStore?.recordSessionStart(agentId, name, agent.project);

    // Apply initial state if provided
    if (opts.state) {
      this.applyWebhookState(agent, opts.state);
    }

    return agent;
  }

  updateWebhookAgent(agentId: string, state: string | null, activity: string | null, url: string | null): ServerAgent | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    agent.lastEventAt = Date.now();
    if (activity !== null) agent.activityText = activity;
    if (url !== null) agent.sourceUrl = url;
    if (state !== null) this.applyWebhookState(agent, state);

    return agent;
  }

  removeWebhookAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    this.applyState(agent, 'leaving', STATIONS.door, null);
    this.releaseDesk(agentId);
    this.statsStore?.recordSessionEnd(agentId, {});

    setTimeout(() => {
      const a = this.agents.get(agentId);
      if (a) {
        if (a.name && !a.sourceName) {
          // Only release pool name if it came from the pool (not from sourceName)
          this.assignedNames.delete(a.name);
        }
        if (a.machineId) {
          this.updateMachineCount(a.machineId, -1);
        }
        this.agents.delete(agentId);
        if (this.onSnapshotNeeded) this.onSnapshotNeeded();
      }
    }, 2000);

    return true;
  }

  touchWebhookAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.lastEventAt = Date.now();
    return true;
  }

  private applyWebhookState(agent: ServerAgent, webhookState: string): void {
    const mapping = WEBHOOK_STATE_MAP[webhookState];
    if (!mapping) return;

    const desk = agent.deskIndex === null ? STATIONS.whiteboard : STATIONS.desks[agent.deskIndex];
    const station = mapping.station === 'desk' ? desk : STATIONS[mapping.station as keyof typeof STATIONS] as { x: number; y: number };

    if (mapping.state === 'error') {
      // Don't change position on error — just set state
      agent.state = 'error';
      agent.stateChangedAt = Date.now();
    } else {
      this.applyState(agent, mapping.state, station, agent.activityText);
    }
  }

  private ensureMachine(machineId: string): void {
    if (!this.machines.has(machineId)) {
      this.machines.set(machineId, {
        id: machineId,
        name: machineId,
        color: machineColor(machineId),
        activeCount: 0,
      });
    }
  }

  private updateMachineCount(machineId: string, delta: number): void {
    this.ensureMachine(machineId);
    const m = this.machines.get(machineId)!;
    m.activeCount = Math.max(0, m.activeCount + delta);
  }

  private matchPendingSpawn(): PendingSpawn | null {
    const now = Date.now();
    // Remove all stale entries (not just from front)
    const fresh = this.pendingSpawns.filter(s => now - s.timestamp < this.spawnWindowMs);
    this.pendingSpawns.length = 0;
    this.pendingSpawns.push(...fresh);
    // Match the oldest pending spawn
    if (this.pendingSpawns.length > 0) {
      return this.pendingSpawns.shift()!;
    }
    return null;
  }

  private assignName(): string {
    // Try sequential first
    for (let i = 0; i < AGENT_NAMES.length; i++) {
      const idx = (this.nextNameIndex + i) % AGENT_NAMES.length;
      const candidate = AGENT_NAMES[idx];
      if (!this.assignedNames.has(candidate)) {
        this.assignedNames.add(candidate);
        this.nextNameIndex = (idx + 1) % AGENT_NAMES.length;
        return candidate;
      }
    }
    // All names exhausted — generate numbered name with collision avoidance
    let fallback = `Agent-${this.nextNameIndex}`;
    let suffix = 0;
    while (this.assignedNames.has(fallback)) {
      suffix++;
      fallback = `Agent-${this.nextNameIndex}-${suffix}`;
    }
    this.nextNameIndex += 1;
    this.assignedNames.add(fallback);
    return fallback;
  }

  private applyState(agent: ServerAgent, state: AgentState, target: { x: number; y: number }, activityText: string | null): void {
    agent.state = state;
    agent.targetPosition = tileToWorld(target);
    agent.stateChangedAt = Date.now();
    agent.activityText = activityText;
  }

  private reserveDesk(sessionId: string, parentDeskIndex: number | null): number | null {
    // Last desk is reserved as the supervisor desk — never assigned to regular agents
    const supervisorDeskIndex = STATIONS.desks.length - 1;

    // If this is a sub-agent, prefer the nearest available desk to the parent.
    if (
      parentDeskIndex !== null &&
      parentDeskIndex >= 0 &&
      parentDeskIndex < STATIONS.desks.length
    ) {
      const parentDesk = STATIONS.desks[parentDeskIndex];
      let bestIndex: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let i = 0; i < this.deskAssignments.length; i += 1) {
        if (i === supervisorDeskIndex) continue;
        if (this.deskAssignments[i] !== null) continue;
        const candidateDesk = STATIONS.desks[i];
        if (!candidateDesk) continue;
        const distance = Math.abs(candidateDesk.x - parentDesk.x) + Math.abs(candidateDesk.y - parentDesk.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }

      if (bestIndex !== null) {
        this.deskAssignments[bestIndex] = sessionId;
        return bestIndex;
      }
    }

    // Fallback: first available desk (skip supervisor desk).
    for (let i = 0; i < this.deskAssignments.length; i += 1) {
      if (i === supervisorDeskIndex) continue;
      if (this.deskAssignments[i] === null) {
        this.deskAssignments[i] = sessionId;
        return i;
      }
    }
    return null;
  }

  private releaseDesk(sessionId: string): void {
    for (let i = 0; i < this.deskAssignments.length; i += 1) {
      if (this.deskAssignments[i] === sessionId) {
        this.deskAssignments[i] = null;
      }
    }
  }

  /** Save an evicted agent's identity so it can be restored if the session resumes */
  private archiveAgent(sessionId: string, agent: ServerAgent): void {
    this.archivedAgents.set(sessionId, {
      name: agent.name ?? '',
      characterIndex: agent.characterIndex,
      deskIndex: agent.deskIndex,
      parentId: agent.parentId,
      childIds: [...agent.childIds],
      project: agent.project,
      filePath: agent.filePath,
      roleName: agent.roleName,
      provider: agent.provider,
      machineId: agent.machineId,
      machineName: agent.machineName,
      archivedAt: Date.now(),
    });
    // Keep the name reserved so nobody else takes it
    // (assignedNames.delete is NOT called here — only on true session end)
  }

  /** Restore an archived agent with its original identity */
  private restoreFromArchive(sessionId: string, filePath: string, archived: ArchivedAgent): ServerAgent {
    const door = tileToWorld(STATIONS.door);

    // Try to reclaim the same desk, fall back to normal assignment
    let deskIndex: number | null = null;
    if (archived.deskIndex !== null && this.deskAssignments[archived.deskIndex] === null) {
      this.deskAssignments[archived.deskIndex] = sessionId;
      deskIndex = archived.deskIndex;
    } else {
      deskIndex = this.reserveDesk(sessionId, null);
    }

    const target = deskIndex === null ? door : tileToWorld(STATIONS.desks[deskIndex]);

    // Filter childIds to only still-active agents
    const childIds = archived.childIds.filter((cid) => this.agents.has(cid));

    const agent: ServerAgent = {
      id: sessionId,
      sessionId,
      characterIndex: archived.characterIndex,
      state: 'entering',
      position: door,
      targetPosition: target,
      deskIndex,
      lastEventAt: Date.now(),
      stateChangedAt: Date.now(),
      activityText: null,
      name: archived.name,
      roleName: archived.roleName,
      project: archived.project ?? extractProjectName(filePath),
      waitingForHuman: false,
      parentId: archived.parentId,
      childIds,
      provider: archived.provider,
      machineId: archived.machineId ?? this.localMachineId,
      machineName: archived.machineName ?? this.localMachineName,
      sourceType: null,
      sourceName: null,
      sourceUrl: null,
      filePath,
    };

    this.updateMachineCount(agent.machineId ?? this.localMachineId, 1);

    // Re-link parent to child
    if (archived.parentId) {
      const parent = this.agents.get(archived.parentId);
      if (parent && !parent.childIds.includes(sessionId)) {
        parent.childIds = [...parent.childIds, sessionId];
      }
    }

    // Don't increment nextCharacterIndex — reusing archived value
    this.agents.set(sessionId, agent);
    // Don't call statsStore.recordSessionStart — the old stats record is still open
    // eslint-disable-next-line no-console
    console.log(`[session-manager] restored archived agent ${sessionId} as "${archived.name}"`);
    return agent;
  }

  private startGhostTimer(): void {
    setInterval(() => {
      const now = Date.now();
      let changed = false;

      // Clean up expired archive entries
      for (const [sid, arch] of this.archivedAgents.entries()) {
        if (now - arch.archivedAt > this.archiveTtlMs) {
          this.archivedAgents.delete(sid);
          // Release the held name now that the archive has expired
          if (arch.name) {
            this.assignedNames.delete(arch.name);
          }
        }
      }

      // Clean up stale hookPendingChildren entries (older than spawnWindowMs)
      for (const [key, entry] of this.hookPendingChildren.entries()) {
        if (now - entry.timestamp > this.spawnWindowMs) {
          this.hookPendingChildren.delete(key);
        }
      }

      // Clean up stale tool name cache entries
      cleanToolNameCache();

      for (const [sessionId, agent] of this.agents.entries()) {
        const age = now - agent.lastEventAt;
        if (age > this.staleEvictMs && agent.state !== 'leaving') {
          // Archive before eviction so the agent can be restored
          this.archiveAgent(sessionId, agent);
          agent.state = 'leaving';
          agent.targetPosition = tileToWorld(STATIONS.door);
          agent.stateChangedAt = now;
          changed = true;
          // Delay removal to allow leaving animation on client
          setTimeout(() => {
            const current = this.agents.get(sessionId);
            if (current && current.state === 'leaving') {
              this.evictSession(sessionId);
              if (this.onSnapshotNeeded) this.onSnapshotNeeded();
            }
          }, 3000);
        } else if (agent.state === 'entering' && now - agent.stateChangedAt > this.enteringTimeoutMs) {
          // 'entering' is a transient state (~2s walk). If stuck longer than 30s,
          // the session was likely picked up on startup with no real activity.
          agent.state = 'leaving';
          agent.targetPosition = tileToWorld(STATIONS.door);
          agent.stateChangedAt = now;
          changed = true;
          setTimeout(() => {
            const current = this.agents.get(sessionId);
            if (current && current.state === 'leaving') {
              this.evictSession(sessionId);
              if (this.onSnapshotNeeded) this.onSnapshotNeeded();
            }
          }, 3000);
        } else if (age > this.staleIdleMs && agent.state !== 'idle' && agent.state !== 'leaving') {
          agent.state = 'idle';
          agent.stateChangedAt = now;
          changed = true;
        }
      }
      if (changed && this.onSnapshotNeeded) {
        this.onSnapshotNeeded();
      }
    }, 10000).unref();
  }

  private startWaitingDetector(): void {
    setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [sessionId, agent] of this.agents.entries()) {
        if (agent.state === 'leaving' || agent.state === 'entering') continue;

        // Evict agents that have been waiting too long (dedicated waiting timeout)
        if (agent.waitingForHuman && agent.waitingSince) {
          const waitingAge = now - agent.waitingSince;
          if (waitingAge > this.waitingEvictMs) {
            // Archive before eviction so the agent can be restored
            this.archiveAgent(sessionId, agent);
            agent.state = 'leaving';
            agent.targetPosition = tileToWorld(STATIONS.door);
            agent.stateChangedAt = now;
            changed = true;
            setTimeout(() => {
              const current = this.agents.get(sessionId);
              if (current && current.state === 'leaving') {
                this.evictSession(sessionId);
                if (this.onSnapshotNeeded) this.onSnapshotNeeded();
              }
            }, 3000);
          }
          continue;
        }

        const elapsed = now - agent.lastEventAt;

        // Skip heuristic detection if hooks are managing this agent's waiting state
        if (agent.hookActive) {
          continue;
        }

        // When the last event was a text response and silence has lasted 8+ seconds,
        // the turn is over — Claude wrote its final text and is waiting for human input.
        // This avoids false positives because tool_use and thinking events set different lastEventType values.
        const isTextResponse = agent.lastEventType === 'activity.responding';
        if (isTextResponse && elapsed > this.waitingThresholdMs) {
          // Sub-agents go idle between team turns — don't treat silence as "done".
          // They'll leave properly via session.ended or the normal stale eviction path.
          if (agent.parentId) {
            continue;
          }
          agent.waitingForHuman = true;
          agent.waitingSince = now;
          this.applyState(agent, 'waiting', STATIONS.coffee, 'Waiting...');
          changed = true;
        }
      }
      if (changed && this.onSnapshotNeeded) {
        this.onSnapshotNeeded();
      }
    }, 3000).unref();
  }
}
