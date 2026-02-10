import type { Agent, AgentState } from '../src/types/agent.js';
import type { PixelEvent } from '../src/types/events.js';
import { STATIONS, tileToWorld } from '../src/types/agent.js';

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

export class SessionManager {
  private readonly agents = new Map<string, ServerAgent>();
  private readonly deskAssignments: Array<string | null> = new Array<string | null>(10).fill(null);
  private nextCharacterIndex = 0;
  private readonly staleIdleMs: number;
  private readonly staleEvictMs: number;
  private readonly waitingThresholdMs = 60000;
  private onSnapshotNeeded: (() => void) | null = null;

  constructor(staleIdleMs = Number(process.env.STALE_IDLE_MS ?? 300000), staleEvictMs = Number(process.env.STALE_EVICT_MS ?? 900000)) {
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
      project: filePath.split(/[\\/]/).pop() ?? null,
      waitingForHuman: false,
      filePath,
    };

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
    // Clear waiting-for-human on any new event
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
        this.applyState(agent, 'entering', agent.deskIndex === null ? STATIONS.door : STATIONS.desks[agent.deskIndex], null);
      } else if (event.action === 'ended') {
        this.applyState(agent, 'leaving', STATIONS.door, null);
        this.releaseDesk(sessionId);
        setTimeout(() => {
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
      } else if (event.action === 'user_prompt') {
        // user_prompt: don't change state/location, just clear activityText
        agent.activityText = null;
      }
      return;
    }

    if (event.type === 'tool' && event.status === 'started') {
      agent.lastEventType = `tool.${event.tool}`;
      const context = event.context ?? null;
      const mode = classifyTool(event.tool);
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
      for (const [sessionId, agent] of this.agents.entries()) {
        const age = now - agent.lastEventAt;
        if (age > this.staleEvictMs) {
          agent.state = 'leaving';
          agent.targetPosition = tileToWorld(STATIONS.door);
          this.removeSession(sessionId);
        } else if (age > this.staleIdleMs) {
          agent.state = 'idle';
        }
      }
    }, 30000).unref();
  }

  private startWaitingDetector(): void {
    setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const agent of this.agents.values()) {
        const isWaitingEvent = agent.lastEventType === 'activity.waiting';
        const elapsed = now - agent.lastEventAt;
        if (isWaitingEvent && elapsed > this.waitingThresholdMs && !agent.waitingForHuman) {
          agent.waitingForHuman = true;
          changed = true;
        }
      }
      if (changed && this.onSnapshotNeeded) {
        this.onSnapshotNeeded();
      }
    }, 5000).unref();
  }
}
