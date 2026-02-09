import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Agent, AgentState, Point } from '../types/agent.js';
import { STATIONS, tileToWorld } from '../types/agent.js';
import type { PixelEvent } from '../types/events.js';

interface OfficeState {
  agents: Map<string, Agent>;
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  removeAgent: (id: string) => void;
  handleSnapshot: (agents: Agent[]) => void;
  handleEvent: (event: PixelEvent) => void;
}

function classifyTool(toolName: string): 'terminal' | 'research' | 'coding' {
  const tool = toolName.toLowerCase();
  if (tool.includes('bash') || tool.includes('terminal')) {
    return 'terminal';
  }
  if (tool.includes('search') || tool.includes('websearch')) {
    return 'research';
  }
  return 'coding';
}

function targetFor(agent: Agent, state: AgentState, tool?: string): Point {
  if (state === 'thinking') {
    return tileToWorld(STATIONS.whiteboard);
  }
  if (state === 'reading') {
    return tileToWorld(STATIONS.whiteboard);
  }
  if (state === 'terminal') {
    return tileToWorld(STATIONS.terminal);
  }
  if (state === 'leaving') {
    return tileToWorld(STATIONS.door);
  }
  if (state === 'entering' || state === 'coding' || state === 'idle') {
    if (agent.deskIndex !== null) {
      return tileToWorld(STATIONS.desks[agent.deskIndex]);
    }
  }

  if (tool) {
    const mode = classifyTool(tool);
    if (mode === 'terminal') {
      return tileToWorld(STATIONS.terminal);
    }
    if (mode === 'research') {
      return tileToWorld(STATIONS.whiteboard);
    }
  }

  return tileToWorld(STATIONS.whiteboard);
}

export const useOfficeStore = create<OfficeState>()(
  subscribeWithSelector((set, get) => ({
    agents: new Map<string, Agent>(),

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
          characterIndex: Math.floor(Math.random() * 8),
          state: 'entering',
          position: tileToWorld(STATIONS.door),
          targetPosition: tileToWorld(STATIONS.whiteboard),
          deskIndex: null,
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
      } else if (event.type === 'activity' && event.action === 'thinking') {
        patch.state = 'thinking';
        patch.targetPosition = tileToWorld(STATIONS.whiteboard);
      } else if (event.type === 'tool' && event.status === 'started') {
        const mode = classifyTool(event.tool);
        patch.state = mode === 'terminal' ? 'terminal' : mode === 'research' ? 'reading' : 'coding';
        patch.targetPosition = targetFor(existing, patch.state, event.tool);
      } else if (event.type === 'summary') {
        patch.state = 'idle';
        patch.targetPosition = targetFor(existing, 'idle');
      }

      state.updateAgent(existing.id, patch);
    },
  })),
);
