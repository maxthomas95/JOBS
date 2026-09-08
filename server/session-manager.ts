import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import type { Agent, AgentState, IntegrationMode } from '../src/types/agent.js';
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
    //    We verify the full path (parent + project dir) exists, not just the parent,
    //    to avoid ambiguity when an intermediate directory also exists
    //    (e.g. C:\repo\roy exists but the project is C:\repo\roy-final).
    const winDrive = segment.match(/^([A-Za-z])--(.+)$/);
    const rest = winDrive ? winDrive[2] : segment.startsWith('-') ? segment.slice(1) : null;
    const prefix = winDrive ? `${winDrive[1]}:/` : segment.startsWith('-') ? '/' : null;

    if (prefix && rest) {
      for (let i = rest.length - 1; i >= 0; i--) {
        if (rest[i] !== '-') continue;
        const parentPart = rest.slice(0, i).replace(/-/g, '/');
        const projectName = rest.slice(i + 1);
        try {
          if (existsSync(prefix + parentPart + '/' + projectName)) {
            return projectName;
          }
        } catch { /* permission error — skip */ }
      }
      // The encoded string may contain every parent directory (including a user
      // name). An unavailable mount is not evidence that it is one basename.
      return null;
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
  integrationMode?: IntegrationMode;
  model?: string;
  sourceType: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
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
  private readonly removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly intervals: ReturnType<typeof setInterval>[] = [];
  private readonly seenEvents = new Set<string>();

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

  registerSession(sessionId: string, filePath: string, pathParentId?: string): ServerAgent {
    const existing = this.agents.get(sessionId);
    if (existing) {
      this.resumeAgent(existing);
      existing.lastEventAt = Date.now();
      this.statsStore?.recordSessionActivity(existing.id, existing.lastEventAt);
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

    // Parent linking priority chain:
    // 1. Deterministic hook-based linking (SubagentStart hook)
    // 2. File-path-derived parent (subagent JSONL path contains parent UUID)
    // 3. Time-window heuristic (Task tool used within last 10s)

    // 1. Check for deterministic hook-based parent linking
    const fileBasename = filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.jsonl$/, '') ?? '';
    const hookChild = this.hookPendingChildren.get(fileBasename) ?? this.hookPendingChildren.get(sessionId);
    if (hookChild) {
      this.hookPendingChildren.delete(fileBasename);
      this.hookPendingChildren.delete(sessionId);
    }

    let resolvedParentId: string | null = null;
    let resolvedChildName: string | null = null;

    if (hookChild) {
      // Hook-based: most reliable
      resolvedParentId = hookChild.parentId;
      resolvedChildName = hookChild.agentType;
    } else if (pathParentId && this.agents.has(pathParentId)) {
      // File-path-derived: deterministic, parent UUID is in the subagent JSONL path
      resolvedParentId = pathParentId;
      // Consume matching pending spawn for the child name (if any)
      const spawnIdx = this.pendingSpawns.findIndex(s => s.parentId === pathParentId);
      if (spawnIdx !== -1) {
        resolvedChildName = this.pendingSpawns[spawnIdx].childName;
        this.pendingSpawns.splice(spawnIdx, 1);
      }
      // eslint-disable-next-line no-console
      console.log(`[session-manager] linked subagent ${sessionId.slice(0, 12)}… to parent ${pathParentId.slice(0, 12)}… via file path`);
    } else {
      // Fall back to time-window heuristic
      const pendingSpawn = this.matchPendingSpawn();
      if (pendingSpawn) {
        resolvedParentId = pendingSpawn.parentId;
        resolvedChildName = pendingSpawn.childName;
      }
    }

    // Reserve desk — prefer adjacent to parent if this is a sub-agent
    const parentAgent = resolvedParentId ? this.agents.get(resolvedParentId) : null;
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
      startedAt: Date.now(),
      integrationMode: 'transcript',
      stateChangedAt: Date.now(),
      activityText: null,
      name,
      roleName: resolvedChildName,
      project: extractProjectName(filePath),
      waitingForHuman: false,
      parentId: resolvedParentId,
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
    if (resolvedParentId) {
      const parent = this.agents.get(resolvedParentId);
      if (parent) {
        parent.childIds = [...parent.childIds, sessionId];
      }
    }

    this.nextCharacterIndex += 1;
    this.agents.set(sessionId, agent);
    this.statsStore?.recordSessionStart(sessionId, name, agent.project, agent.startedAt);
    this.linkChildren(agent);
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

    if (this.seenEvents.has(event.id)) return;
    this.seenEvents.add(event.id);
    if (this.seenEvents.size > 4000) this.seenEvents.delete(this.seenEvents.values().next().value!);

    if (!(event.type === 'session' && event.action === 'ended')) this.resumeAgent(agent);

    agent.lastEventAt = Math.max(agent.lastEventAt, event.timestamp || Date.now());
    this.statsStore?.recordSessionActivity(agent.id, agent.lastEventAt);

    // When hooks have deterministically set waiting state, ignore stale JSONL events
    // from the same turn. Only user_prompt (new human message) or session events can wake up.
    if (agent.hookActive && agent.state === 'waiting' && agent.waitingForHuman) {
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
        event.startedAt = agent.startedAt;
        event.provider = agent.provider;
        event.integrationMode = agent.integrationMode;
        event.model = agent.model;
        // Broadcast snapshot so all clients get parent's updated childIds
        if (agent.parentId && this.onSnapshotNeeded) {
          this.onSnapshotNeeded();
        }
      } else if (event.action === 'ended') {
        // True session end — clear any archive so it won't resurrect
        const wasArchived = this.archivedAgents.get(sessionId);
        if (wasArchived) {
          this.archivedAgents.delete(sessionId);
          this.cancelRemoval(sessionId);
        }
        this.scheduleRemoval(agent, false, 2000);
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
      } else if (event.action === 'needsApproval') {
        this.applyState(agent, 'needsApproval', STATIONS.coffee, 'Needs approval');
        agent.waitingForHuman = true;
        agent.waitingSince = Date.now();
      } else if (event.action === 'compacting') {
        this.applyState(agent, 'compacting', STATIONS.library, 'Compacting memory...');
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
        this.resumeAgent(agent);
        agent.waitingForHuman = true;
        agent.waitingSince = Date.now();
        agent.hookActive = true;
        agent.integrationMode = 'hooks';
        agent.lastEventAt = Date.now();
        this.statsStore?.recordSessionActivity(agent.id, agent.lastEventAt);
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
          agent.integrationMode = 'hooks';
          agent.waitingForHuman = true;
          agent.waitingSince = Date.now();
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
    this.cancelRemoval(sessionId);
    this.statsStore?.recordSessionEnd(sessionId, {});
    const agent = this.agents.get(sessionId);
    if (agent) {
      if (agent.name && !agent.sourceName) {
        this.assignedNames.delete(agent.name);
      }
      if (agent.machineId) {
        this.updateMachineCount(agent.machineId, -1);
      }
    }
    this.releaseDesk(sessionId);
    this.agents.delete(sessionId);
    this.unlinkChild(sessionId);
  }

  /** Remove an agent after stale eviction — name stays reserved via the archive */
  private evictSession(sessionId: string): void {
    this.cancelRemoval(sessionId);
    const agent = this.agents.get(sessionId);
    if (agent) {
      // Don't release the name — it's held by the archive entry
      if (agent.machineId) {
        this.updateMachineCount(agent.machineId, -1);
      }
    }
    this.releaseDesk(sessionId);
    this.agents.delete(sessionId);
    this.unlinkChild(sessionId);
  }

  getSnapshot(): Agent[] {
    return Array.from(this.agents.values()).map((agent) => ({
      id: agent.id,
      sessionId: agent.sessionId,
      characterIndex: agent.characterIndex,
      state: agent.state,
      position: { x: agent.position.x, y: agent.position.y },
      targetPosition: agent.targetPosition ? { x: agent.targetPosition.x, y: agent.targetPosition.y } : null,
      deskIndex: agent.deskIndex,
      lastEventAt: agent.lastEventAt,
      startedAt: agent.startedAt,
      stateChangedAt: agent.stateChangedAt,
      activityText: agent.activityText,
      name: agent.name,
      roleName: agent.roleName,
      project: agent.project,
      waitingForHuman: agent.waitingForHuman,
      parentId: agent.parentId,
      childIds: [...agent.childIds],
      provider: agent.provider,
      integrationMode: agent.integrationMode,
      model: agent.model,
      machineId: agent.machineId,
      machineName: agent.machineName,
      sourceType: agent.sourceType,
      sourceName: agent.sourceName,
      sourceUrl: agent.sourceUrl,
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
    provider?: string;
    integrationMode?: IntegrationMode;
    model?: string;
    parentId?: string;
    startedAt?: number;
  }): ServerAgent {
    const agentId = `wh:${sourceId}`;
    let existing = this.agents.get(agentId);
    const archived = this.archivedAgents.get(agentId);
    if (!existing && archived) {
      this.archivedAgents.delete(agentId);
      existing = this.restoreFromArchive(agentId, '', archived);
    }
    if (existing) {
      this.resumeAgent(existing);
      existing.lastEventAt = Date.now();
      this.statsStore?.recordSessionActivity(existing.id, existing.lastEventAt);
      if (opts.project !== undefined) existing.project = opts.project;
      if (opts.activity !== undefined) existing.activityText = opts.activity;
      if (opts.url !== undefined) existing.sourceUrl = opts.url;
      if (opts.integrationMode) existing.integrationMode = opts.integrationMode;
      if (opts.model) existing.model = opts.model;
      if (opts.parentId && opts.parentId !== agentId) existing.parentId = opts.parentId;
      if (opts.state) this.applyWebhookState(existing, opts.state);
      this.linkChildren(existing);
      return existing;
    }

    const door = tileToWorld(STATIONS.door);
    const name = opts.sourceName ?? this.assignName();
    const deskIndex = this.reserveDesk(agentId, null);
    const target = deskIndex === null ? door : tileToWorld(STATIONS.desks[deskIndex]);

    const mId = opts.machine ?? this.localMachineId;
    this.ensureMachine(mId);

    const provider = opts.provider ?? (opts.sourceType === 'codex' ? 'codex' : 'webhook');

    const agent: ServerAgent = {
      id: agentId,
      sessionId: agentId,
      characterIndex: this.nextCharacterIndex % 8,
      state: 'entering',
      position: door,
      targetPosition: target,
      deskIndex,
      lastEventAt: Date.now(),
      startedAt: opts.startedAt ?? Date.now(),
      integrationMode: opts.integrationMode ?? (provider === 'codex' ? 'notify' : 'webhook'),
      model: opts.model,
      stateChangedAt: Date.now(),
      activityText: opts.activity ?? null,
      name,
      roleName: null,
      project: opts.project ?? null,
      waitingForHuman: false,
      parentId: opts.parentId === agentId ? null : opts.parentId ?? null,
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
    this.statsStore?.recordSessionStart(agentId, name, agent.project, agent.startedAt);
    this.linkChildren(agent);

    // Apply initial state if provided
    if (opts.state) {
      this.applyWebhookState(agent, opts.state);
    }

    return agent;
  }

  updateWebhookAgent(agentId: string, state: string | null, activity: string | null, url: string | null): ServerAgent | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    this.resumeAgent(agent);
    agent.lastEventAt = Date.now();
    this.statsStore?.recordSessionActivity(agent.id, agent.lastEventAt);
    if (activity !== null) agent.activityText = activity;
    if (url !== null) agent.sourceUrl = url;
    if (state !== null) this.applyWebhookState(agent, state);

    return agent;
  }

  removeWebhookAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    this.scheduleRemoval(agent, false, 2000);

    return true;
  }

  touchWebhookAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.lastEventAt = Date.now();
    this.statsStore?.recordSessionActivity(agent.id, agent.lastEventAt);
    return true;
  }

  private applyWebhookState(agent: ServerAgent, webhookState: string): void {
    agent.waitingForHuman = webhookState === 'waiting';
    agent.waitingSince = agent.waitingForHuman ? Date.now() : undefined;
    const mapping = WEBHOOK_STATE_MAP[webhookState];
    if (!mapping) {
      // eslint-disable-next-line no-console
      console.warn(`[webhook] Unknown state "${webhookState}" for ${agent.id} — defaulting to "coding" at desk`);
      const desk = agent.deskIndex === null ? STATIONS.whiteboard : STATIONS.desks[agent.deskIndex];
      this.applyState(agent, 'coding', desk, agent.activityText);
      return;
    }

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
    if (agent.state !== state) agent.stateChangedAt = Date.now();
    agent.state = state;
    agent.targetPosition = tileToWorld(target);
    agent.activityText = activityText;
  }

  private cancelRemoval(sessionId: string): void {
    const timer = this.removalTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.removalTimers.delete(sessionId);
  }

  private resumeAgent(agent: ServerAgent): void {
    this.cancelRemoval(agent.id);
    if (agent.state !== 'leaving') return;
    this.archivedAgents.delete(agent.id);
    agent.startedAt = Date.now();
    agent.waitingForHuman = false;
    agent.waitingSince = undefined;
    this.applyState(agent, 'entering', agent.deskIndex === null ? STATIONS.door : STATIONS.desks[agent.deskIndex], null);
    this.statsStore?.recordSessionStart(agent.id, agent.name ?? '', agent.project, agent.startedAt);
  }

  private scheduleRemoval(agent: ServerAgent, archive: boolean, delayMs: number): void {
    if (this.removalTimers.has(agent.id)) return;
    if (archive) this.archiveAgent(agent.id, agent);
    this.statsStore?.recordSessionEnd(agent.id, {}, archive ? agent.lastEventAt : Date.now());
    agent.waitingForHuman = false;
    agent.waitingSince = undefined;
    this.applyState(agent, 'leaving', STATIONS.door, null);
    // Keep the desk reserved through the leaving animation; a resumed session
    // cannot share a desk that has already been reassigned to somebody else.
    const timer = setTimeout(() => {
      if (this.removalTimers.get(agent.id) !== timer || this.agents.get(agent.id) !== agent || agent.state !== 'leaving') return;
      this.removalTimers.delete(agent.id);
      if (archive) this.evictSession(agent.id);
      else this.removeSession(agent.id);
      this.onSnapshotNeeded?.();
    }, delayMs);
    timer.unref();
    this.removalTimers.set(agent.id, timer);
  }

  private linkChildren(agent: ServerAgent): void {
    if (agent.parentId) {
      const parent = this.agents.get(agent.parentId);
      if (parent && !parent.childIds.includes(agent.id)) parent.childIds.push(agent.id);
    }
    for (const child of this.agents.values()) {
      if (child.parentId === agent.id && !agent.childIds.includes(child.id)) agent.childIds.push(child.id);
    }
  }

  private unlinkChild(sessionId: string): void {
    for (const agent of this.agents.values()) agent.childIds = agent.childIds.filter(id => id !== sessionId);
  }

  dispose(): void {
    for (const timer of this.intervals) clearInterval(timer);
    for (const timer of this.removalTimers.values()) clearTimeout(timer);
    this.removalTimers.clear();
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
      integrationMode: agent.integrationMode,
      model: agent.model,
      sourceType: agent.sourceType,
      sourceName: agent.sourceName,
      sourceUrl: agent.sourceUrl,
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
      startedAt: Date.now(),
      integrationMode: archived.integrationMode,
      model: archived.model,
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
      sourceType: archived.sourceType,
      sourceName: archived.sourceName,
      sourceUrl: archived.sourceUrl,
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
    this.statsStore?.recordSessionStart(sessionId, agent.name ?? '', agent.project, agent.startedAt);
    // eslint-disable-next-line no-console
    console.log(`[session-manager] restored archived agent ${sessionId} as "${archived.name}"`);
    return agent;
  }

  private startGhostTimer(): void {
    this.intervals.push(setInterval(() => this.sweepStaleSessions(), 10000).unref());
  }

  private sweepStaleSessions(): void {
    const now = Date.now();
    let changed = false;

    // Clean up expired archive entries
    for (const [sid, arch] of this.archivedAgents.entries()) {
      if (now - arch.archivedAt > this.archiveTtlMs) {
        this.archivedAgents.delete(sid);
        // Release the held name now that the archive has expired
        if (arch.name && !arch.sourceName) {
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

    for (const agent of this.agents.values()) {
      const age = now - agent.lastEventAt;
      if (age > this.staleEvictMs && agent.state !== 'leaving') {
        this.scheduleRemoval(agent, true, 3000);
        changed = true;
      } else if (agent.state === 'entering' && now - agent.stateChangedAt > this.enteringTimeoutMs) {
        this.scheduleRemoval(agent, true, 3000);
        changed = true;
      } else if (age > this.staleIdleMs && !agent.waitingForHuman && agent.integrationMode !== 'hooks' && agent.state !== 'idle' && agent.state !== 'leaving') {
        agent.state = 'idle';
        agent.stateChangedAt = now;
        changed = true;
      }
    }
    if (changed && this.onSnapshotNeeded) {
      this.onSnapshotNeeded();
    }
  }

  private startWaitingDetector(): void {
    this.intervals.push(setInterval(() => this.detectWaiting(), 3000).unref());
  }

  private detectWaiting(): void {
    const now = Date.now();
    let changed = false;
    for (const agent of this.agents.values()) {
      if (agent.state === 'leaving' || agent.state === 'entering') continue;

      // Evict agents that have been waiting too long (dedicated waiting timeout)
      if (agent.waitingForHuman && agent.waitingSince) {
        const waitingAge = now - agent.waitingSince;
        if (waitingAge > this.waitingEvictMs) {
          this.scheduleRemoval(agent, true, 3000);
          changed = true;
        }
        continue;
      }

      const elapsed = now - agent.lastEventAt;

      // Skip heuristic detection if hooks are managing this agent's waiting state
      if (agent.hookActive || agent.integrationMode === 'hooks') {
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
  }
}
