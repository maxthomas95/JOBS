import type { Agent, AgentState } from '../src/types/agent.js';
import type { PixelEvent } from '../src/types/events.js';
import { STATIONS, tileToWorld } from '../src/types/agent.js';

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
  private readonly deskAssignments: Array<string | null> = new Array<string | null>(10).fill(null);
  private nextCharacterIndex = 0;
  private nextNameIndex = 0;
  private readonly assignedNames = new Set<string>();
  private readonly pendingSpawns: PendingSpawn[] = [];
  private readonly spawnWindowMs = 10000;
  private readonly staleIdleMs: number;
  private readonly staleEvictMs: number;
  private readonly waitingThresholdMs = 8000;
  private onSnapshotNeeded: (() => void) | null = null;

  constructor(staleIdleMs = Number(process.env.STALE_IDLE_MS ?? 60000), staleEvictMs = Number(process.env.STALE_EVICT_MS ?? 180000)) {
    this.staleIdleMs = staleIdleMs;
    this.staleEvictMs = staleEvictMs;
    this.startGhostTimer();
    this.startWaitingDetector();
  }

  setSnapshotCallback(cb: () => void): void {
    this.onSnapshotNeeded = cb;
  }

  registerSession(sessionId: string, filePath: string): ServerAgent {
    const existing = this.agents.get(sessionId);
    if (existing) {
      existing.lastEventAt = Date.now();
      existing.filePath = filePath;
      return existing;
    }

    const deskIndex = this.reserveDesk(sessionId);
    const door = tileToWorld(STATIONS.door);
    const target = deskIndex === null ? door : tileToWorld(STATIONS.desks[deskIndex]);
    const name = this.assignName();

    // Check for pending parent spawn
    const pendingSpawn = this.matchPendingSpawn();

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
    // Clear waiting-for-human on any new event (agent is active again)
    if (agent.waitingForHuman) {
      agent.waitingForHuman = false;
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
        this.applyState(agent, 'entering', agent.deskIndex === null ? STATIONS.door : STATIONS.desks[agent.deskIndex], null);
      } else if (event.action === 'ended') {
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
        this.applyState(agent, 'coding', desk, 'Writing code...');
      } else if (event.action === 'waiting') {
        this.applyState(agent, 'waiting', STATIONS.coffee, 'Waiting...');
        agent.waitingForHuman = true;
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
        this.applyState(agent, 'delegating', desk, context);
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

  private reserveDesk(sessionId: string): number | null {
    for (let i = 0; i < this.deskAssignments.length; i += 1) {
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
      for (const agent of this.agents.values()) {
        if (agent.waitingForHuman) continue;
        if (agent.state === 'leaving' || agent.state === 'entering') continue;
        const elapsed = now - agent.lastEventAt;

        // When the last event was a text response and silence has lasted 8+ seconds,
        // the turn is over — Claude wrote its final text and is waiting for human input.
        // This avoids false positives because tool_use and thinking events set different lastEventType values.
        const isTextResponse = agent.lastEventType === 'activity.responding';
        if (isTextResponse && elapsed > this.waitingThresholdMs) {
          agent.waitingForHuman = true;
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
