import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type { Agent, AgentState, Point } from '../types/agent.js';
import { STATIONS, tileToWorld } from '../types/agent.js';
import type { PixelEvent } from '../types/events.js';

interface OfficeState {
  agents: Map<string, Agent>;
  focusedAgentId: string | null;
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  removeAgent: (id: string) => void;
  handleSnapshot: (agents: Agent[]) => void;
  handleEvent: (event: PixelEvent) => void;
  focusAgent: (id: string | null) => void;
}

function classifyTool(toolName: string): AgentState {
  const tool = toolName.toLowerCase();
  if (tool.includes('bash') || tool.includes('terminal')) {
    return 'terminal';
  }
  if (tool.includes('search') || tool.includes('websearch') || tool.includes('grep') || tool.includes('glob')) {
    return 'searching';
  }
  if (tool === 'task' || tool.includes('subagent')) {
    return 'delegating';
  }
  if (tool.includes('plan') || tool.includes('enterplanmode')) {
    return 'thinking';
  }
  if (tool.includes('read')) {
    return 'reading';
  }
  if (tool.includes('write') || tool.includes('edit')) {
    return 'coding';
  }
  return 'coding';
}

function targetFor(agent: Agent, state: AgentState, _tool?: string): Point {
  if (state === 'thinking') {
    return tileToWorld(STATIONS.whiteboard);
  }
  if (state === 'reading') {
    return tileToWorld(STATIONS.whiteboard);
  }
  if (state === 'terminal') {
    return tileToWorld(STATIONS.terminal);
  }
  if (state === 'searching') {
    return tileToWorld(STATIONS.library);
  }
  if (state === 'cooling' || state === 'waiting') {
    return tileToWorld(STATIONS.coffee);
  }
  if (state === 'leaving') {
    return tileToWorld(STATIONS.door);
  }
  if (state === 'error') {
    return agent.position;
  }
  if (state === 'entering' || state === 'coding' || state === 'idle' || state === 'delegating') {
    if (agent.deskIndex !== null) {
      return tileToWorld(STATIONS.desks[agent.deskIndex]);
    }
  }

  return tileToWorld(STATIONS.whiteboard);
}

let focusTimer: ReturnType<typeof setTimeout> | null = null;

export const useOfficeStore = create<OfficeState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
    agents: new Map<string, Agent>(),
    focusedAgentId: null,

    addAgent: (agent) => {
      set((state) => {
        const next = new Map(state.agents);
        next.set(agent.id, agent);
        return { agents: next };
      });
    },

    updateAgent: (id, patch) => {
      set((state) => {
        const current = state.agents.get(id);
        if (!current) {
          return state;
        }
        const next = new Map(state.agents);
        next.set(id, { ...current, ...patch });
        return { agents: next };
      });
    },

    removeAgent: (id) => {
      set((state) => {
        if (!state.agents.has(id)) {
          return state;
        }
        const next = new Map(state.agents);
        next.delete(id);
        return { agents: next };
      });
    },

    handleSnapshot: (agents) => {
      const map = new Map<string, Agent>();
      for (const agent of agents) {
        map.set(agent.id, agent);
      }
      set({ agents: map });
    },

    handleEvent: (event) => {
      const state = get();
      const existing = state.agents.get(event.sessionId);

      if (!existing && event.type === 'session' && event.action === 'started') {
        const newAgent: Agent = {
          id: event.sessionId,
          sessionId: event.sessionId,
          characterIndex: event.characterIndex ?? Math.floor(Math.random() * 8),
          state: 'entering',
          position: tileToWorld(STATIONS.door),
          targetPosition: tileToWorld(STATIONS.whiteboard),
          deskIndex: event.deskIndex ?? null,
          lastEventAt: event.timestamp,
        };
        state.addAgent(newAgent);
        return;
      }

      if (!existing) {
        return;
      }

      const patch: Partial<Agent> = {
        lastEventAt: event.timestamp,
      };

      if (event.type === 'session') {
        if (event.action === 'started') {
          patch.state = 'entering';
          patch.targetPosition = targetFor(existing, 'entering');
        } else {
          patch.state = 'leaving';
          patch.targetPosition = tileToWorld(STATIONS.door);
          setTimeout(() => {
            get().removeAgent(existing.id);
          }, 2000);
        }
      } else if (event.type === 'activity') {
        if (event.action === 'thinking') {
          patch.state = 'thinking';
          patch.targetPosition = tileToWorld(STATIONS.whiteboard);
        } else if (event.action === 'responding') {
          patch.state = 'coding';
          patch.targetPosition = targetFor(existing, 'coding');
        } else if (event.action === 'waiting') {
          patch.state = 'waiting';
          patch.targetPosition = tileToWorld(STATIONS.coffee);
        }
      } else if (event.type === 'tool' && event.status === 'started') {
        const toolState = classifyTool(event.tool);
        patch.state = toolState;
        patch.targetPosition = targetFor(existing, toolState, event.tool);
      } else if (event.type === 'summary') {
        patch.state = 'cooling';
        patch.targetPosition = tileToWorld(STATIONS.coffee);
      } else if (event.type === 'agent' && event.action === 'error') {
        patch.state = 'error';
      } else if (event.type === 'error') {
        patch.state = 'error';
      }

      state.updateAgent(existing.id, patch);
    },

    focusAgent: (id) => {
      if (focusTimer) clearTimeout(focusTimer);
      set({ focusedAgentId: id });
      if (id) {
        focusTimer = setTimeout(() => {
          set({ focusedAgentId: null });
          focusTimer = null;
        }, 2000);
      }
    },
  })),
    { name: 'office' },
  ),
);
