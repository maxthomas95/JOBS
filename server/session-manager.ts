import type { Agent, AgentState } from '../src/types/agent.js';
import type { PixelEvent } from '../src/types/events.js';
import { STATIONS, tileToWorld } from '../src/types/agent.js';
import { createActivityEvent, createSessionEvent } from './bridge/pixel-events.js';
import type { StatsStore } from './stats-store.js';

const AGENT_NAMES = [
  'Ada', 'Grace', 'Linus', 'Alan', 'Dijkstra',
  'Hopper', 'Knuth', 'Babbage', 'Turing', 'Lovelace',
  'Ritchie', 'Thompson', 'Woz', 'Carmack', 'Norvig',
  'Liskov', 'Hamilton', 'Hoare', 'Lamport', 'Cerf',
  'Berners-Lee', 'Torvalds', 'Pike', 'Stroustrup', 'Gosling',
];

/** Extract project name from Claude's session file path.
 *  Path format: ~/.claude/projects/{encoded-path}/{uuid}.jsonl
 *  The encoded-path is URL-encoded and contains the project directory.
 *  We decode it and return the last segment as the project name. */
function extractProjectName(filePath: string): string | null {
  // Normalize to forward slashes
  const normalized = filePath.replace(/\\/g, '/');
  // Match .claude/projects/{encoded-path}/{uuid}.jsonl
  const match = normalized.match(/\.claude\/projects\/([^/]+)\//);
  if (match) {
    try {
      const decoded = decodeURIComponent(match[1]);
      // decoded is an absolute path like /home/user/my-project or C:\repo\jobs
      const segments = decoded.replace(/\\/g, '/').split('/').filter(Boolean);
      return segments[segments.length - 1] || null;
    } catch {
      // Fallback if decoding fails
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
  if (tool.includes('task')) {
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

/** Tracks an agent that recently used the Task tool and may spawn a child */
interface PendingSpawn {
  parentId: string;
  timestamp: number;
  /** The Claude Code-assigned name for the spawned agent (e.g. "m2-builder") */
  childName: string | null;
}

export class SessionManager {
  private readonly agents = new Map<string, ServerAgent>();
  private readonly deskAssignments: Array<string | null>;
  private nextCharacterIndex = 0;
  private nextNameIndex = 0;
  private readonly assignedNames = new Set<string>();
  private readonly pendingSpawns: PendingSpawn[] = [];
  private readonly hookPendingChildren = new Map<string, { parentId: string; agentType: string }>();
  private readonly spawnWindowMs = 10000;
  private readonly staleIdleMs: number;
  private readonly staleEvictMs: number;
  private readonly enteringTimeoutMs = 30000;
  private readonly waitingThresholdMs = 8000;
  private readonly waitingEvictMs: number;
  private onSnapshotNeeded: (() => void) | null = null;
  private statsStore: StatsStore | null = null;

  constructor(staleIdleMs = Number(process.env.STALE_IDLE_MS ?? 60000), staleEvictMs = Number(process.env.STALE_EVICT_MS ?? 180000)) {
    this.deskAssignments = new Array<string | null>(Math.max(1, STATIONS.desks.length)).fill(null);
    this.staleIdleMs = staleIdleMs;
    this.staleEvictMs = staleEvictMs;
    this.waitingEvictMs = Number(process.env.WAITING_EVICT_MS ?? 60000);
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
      filePath,
    };

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

  handleHookEvent(hookEventName: string, payload: Record<string, unknown>): PixelEvent | null {
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
        this.hookPendingChildren.set(agentId, { parentId: sessionId, agentType });
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
      const event = createSessionEvent(sessionId, 'started', {
        agentId: sessionId,
        project,
        source: 'hook',
      });
      this.handleEvent(event);
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
    if (agent?.name) {
      this.assignedNames.delete(agent.name);
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

  private matchPendingSpawn(): PendingSpawn | null {
    const now = Date.now();
    // Remove stale entries
    while (this.pendingSpawns.length > 0 && now - this.pendingSpawns[0].timestamp > this.spawnWindowMs) {
      this.pendingSpawns.shift();
    }
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
    // All names exhausted — generate numbered name
    const fallback = `Agent-${this.nextNameIndex}`;
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


  private startGhostTimer(): void {
    setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [sessionId, agent] of this.agents.entries()) {
        const age = now - agent.lastEventAt;
        if (age > this.staleEvictMs && agent.state !== 'leaving') {
          agent.state = 'leaving';
          agent.targetPosition = tileToWorld(STATIONS.door);
          agent.stateChangedAt = now;
          changed = true;
          // Delay removal to allow leaving animation on client
          setTimeout(() => {
            this.removeSession(sessionId);
            if (this.onSnapshotNeeded) this.onSnapshotNeeded();
          }, 3000);
        } else if (agent.state === 'entering' && now - agent.stateChangedAt > this.enteringTimeoutMs) {
          // 'entering' is a transient state (~2s walk). If stuck longer than 30s,
          // the session was likely picked up on startup with no real activity.
          agent.state = 'leaving';
          agent.targetPosition = tileToWorld(STATIONS.door);
          agent.stateChangedAt = now;
          changed = true;
          setTimeout(() => {
            this.removeSession(sessionId);
            if (this.onSnapshotNeeded) this.onSnapshotNeeded();
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
            agent.state = 'leaving';
            agent.targetPosition = tileToWorld(STATIONS.door);
            agent.stateChangedAt = now;
            changed = true;
            setTimeout(() => {
              this.removeSession(sessionId);
              if (this.onSnapshotNeeded) this.onSnapshotNeeded();
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
