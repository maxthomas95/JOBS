import type { Agent, AgentState } from '../src/types/agent.js';
import type { PixelEvent } from '../src/types/events.js';
import { STATIONS, tileToWorld } from '../src/types/agent.js';

interface ServerAgent extends Agent {
  filePath?: string;
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

  constructor(staleIdleMs = Number(process.env.STALE_IDLE_MS ?? 300000), staleEvictMs = Number(process.env.STALE_EVICT_MS ?? 900000)) {
    this.staleIdleMs = staleIdleMs;
    this.staleEvictMs = staleEvictMs;
    this.startGhostTimer();
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
    const desk = agent.deskIndex === null ? STATIONS.whiteboard : STATIONS.desks[agent.deskIndex];

    if (event.type === 'session') {
      if (event.action === 'started') {
        // Enrich session event with agent metadata for client-side instant accuracy
        event.characterIndex = agent.characterIndex;
        event.deskIndex = agent.deskIndex;
        this.applyState(agent, 'entering', agent.deskIndex === null ? STATIONS.door : STATIONS.desks[agent.deskIndex]);
      } else if (event.action === 'ended') {
        this.applyState(agent, 'leaving', STATIONS.door);
        this.releaseDesk(sessionId);
        setTimeout(() => {
          this.agents.delete(sessionId);
        }, 2000);
      }
      return;
    }

    if (event.type === 'activity') {
      if (event.action === 'thinking') {
        this.applyState(agent, 'thinking', STATIONS.whiteboard);
      } else if (event.action === 'responding') {
        this.applyState(agent, 'coding', desk);
      } else if (event.action === 'waiting') {
        this.applyState(agent, 'waiting', STATIONS.coffee);
      }
      return;
    }

    if (event.type === 'tool' && event.status === 'started') {
      const mode = classifyTool(event.tool);
      if (mode === 'terminal') {
        this.applyState(agent, 'terminal', STATIONS.terminal);
      } else if (mode === 'searching') {
        this.applyState(agent, 'searching', STATIONS.library);
      } else if (mode === 'reading') {
        this.applyState(agent, 'reading', desk);
      } else if (mode === 'delegating') {
        this.applyState(agent, 'delegating', desk);
      } else if (mode === 'thinking') {
        this.applyState(agent, 'thinking', STATIONS.whiteboard);
      } else {
        this.applyState(agent, 'coding', desk);
      }
      return;
    }

    if (event.type === 'error') {
      agent.state = 'error';
      // Don't change targetPosition on error — stay at current location
      return;
    }

    if (event.type === 'summary') {
      this.applyState(agent, 'cooling', STATIONS.coffee);
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

  private applyState(agent: ServerAgent, state: AgentState, target: { x: number; y: number }): void {
    agent.state = state;
    agent.targetPosition = tileToWorld(target);
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
}
