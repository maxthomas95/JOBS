import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type { Agent, AgentState, Point } from '../types/agent.js';
import { STATIONS, tileToWorld } from '../types/agent.js';
import type { PixelEvent } from '../types/events.js';

export interface StateEntry {
  state: AgentState;
  timestamp: number;
}

interface OfficeState {
  agents: Map<string, Agent>;
  focusedAgentId: string | null;
  selectedAgentId: string | null;
  notificationsEnabled: boolean;
  agentHistory: Map<string, StateEntry[]>;
  agentToolCounts: Map<string, Map<string, number>>;
  /** Total milliseconds spent per tool per agent */
  agentToolTime: Map<string, Map<string, number>>;
  /** In-flight tool start timestamps keyed by toolUseId */
  pendingToolStarts: Map<string, number>;
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  removeAgent: (id: string) => void;
  handleSnapshot: (agents: Agent[]) => void;
  handleEvent: (event: PixelEvent) => void;
  focusAgent: (id: string | null) => void;
  selectAgent: (id: string | null) => void;
  toggleNotifications: () => void;
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
let notificationPermissionRequested = false;

function sendBrowserNotification(body: string) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    new Notification('J.O.B.S.', { body, icon: '/favicon.ico' });
  } else if (Notification.permission !== 'denied' && !notificationPermissionRequested) {
    notificationPermissionRequested = true;
    Notification.requestPermission();
  }
}

export const useOfficeStore = create<OfficeState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
    agents: new Map<string, Agent>(),
    focusedAgentId: null,
    selectedAgentId: null,
    notificationsEnabled: false,
    agentHistory: new Map<string, StateEntry[]>(),
    agentToolCounts: new Map<string, Map<string, number>>(),
    agentToolTime: new Map<string, Map<string, number>>(),
    pendingToolStarts: new Map<string, number>(),

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
      const state = get();
      const prevAgents = state.agents;
      const map = new Map<string, Agent>();
      for (const agent of agents) {
        map.set(agent.id, agent);
        // Notify if agent just became waiting-for-human
        if (agent.waitingForHuman && state.notificationsEnabled) {
          const prev = prevAgents.get(agent.id);
          if (!prev?.waitingForHuman) {
            const label = agent.name || agent.id.slice(0, 8);
            const projectSuffix = agent.project ? ` (${agent.project})` : '';
            sendBrowserNotification(`${label}${projectSuffix} is waiting for your input`);
          }
        }
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
          stateChangedAt: event.timestamp,
          activityText: null,
          name: event.name ?? null,
          roleName: event.roleName ?? null,
          project: event.project ?? null,
          waitingForHuman: false,
          parentId: null,
          childIds: [],
        };
        state.addAgent(newAgent);
        // Initialize history for new agent
        const nextHistory = new Map(state.agentHistory);
        nextHistory.set(event.sessionId, [{ state: 'entering', timestamp: event.timestamp }]);
        set({ agentHistory: nextHistory });
        return;
      }

      if (!existing) {
        return;
      }

      const patch: Partial<Agent> = {
        lastEventAt: event.timestamp,
        waitingForHuman: false,
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
          patch.activityText = 'Thinking...';
        } else if (event.action === 'responding') {
          patch.state = 'coding';
          patch.targetPosition = targetFor(existing, 'coding');
          patch.activityText = 'Writing code...';
        } else if (event.action === 'waiting') {
          patch.state = 'waiting';
          patch.targetPosition = tileToWorld(STATIONS.coffee);
          patch.activityText = 'Waiting...';
        } else if (event.action === 'user_prompt') {
          // user_prompt fires during normal tool approvals, don't flag as waiting
          patch.activityText = null;
        }
      } else if (event.type === 'tool' && event.status === 'started') {
        const toolState = classifyTool(event.tool);
        patch.state = toolState;
        patch.targetPosition = targetFor(existing, toolState, event.tool);
        patch.activityText = event.context ?? event.tool;
      } else if (event.type === 'summary') {
        patch.state = 'cooling';
        patch.targetPosition = tileToWorld(STATIONS.coffee);
        patch.activityText = 'Taking a break';
      } else if (event.type === 'agent' && event.action === 'error') {
        patch.state = 'error';
      } else if (event.type === 'error') {
        patch.state = 'error';
      }

      if (patch.state && patch.state !== existing.state) {
        patch.stateChangedAt = Date.now();
        // Track state history
        const history = state.agentHistory.get(existing.id) ?? [];
        history.push({ state: patch.state, timestamp: Date.now() });
        const nextHistory = new Map(state.agentHistory);
        nextHistory.set(existing.id, history);
        set({ agentHistory: nextHistory });
      }

      // Track tool counts and time
      if (event.type === 'tool') {
        if (event.status === 'started') {
          const counts = state.agentToolCounts.get(existing.id) ?? new Map<string, number>();
          counts.set(event.tool, (counts.get(event.tool) ?? 0) + 1);
          const nextCounts = new Map(state.agentToolCounts);
          nextCounts.set(existing.id, counts);

          // Record start time for duration tracking
          const nextPending = new Map(state.pendingToolStarts);
          const key = event.toolUseId ?? `${existing.id}:${event.tool}:${event.timestamp}`;
          nextPending.set(key, event.timestamp);
          set({ agentToolCounts: nextCounts, pendingToolStarts: nextPending });
        } else if (event.status === 'completed' || event.status === 'error') {
          // Compute elapsed time from matching start
          const key = event.toolUseId ?? '';
          const startTime = state.pendingToolStarts.get(key);
          if (startTime) {
            const elapsed = event.timestamp - startTime;
            const times = state.agentToolTime.get(existing.id) ?? new Map<string, number>();
            times.set(event.tool, (times.get(event.tool) ?? 0) + elapsed);
            const nextTimes = new Map(state.agentToolTime);
            nextTimes.set(existing.id, times);
            const nextPending = new Map(state.pendingToolStarts);
            nextPending.delete(key);
            set({ agentToolTime: nextTimes, pendingToolStarts: nextPending });
          }
        }
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

    selectAgent: (id) => {
      set({ selectedAgentId: id });
    },

    toggleNotifications: () => {
      const next = !get().notificationsEnabled;
      if (next && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        Notification.requestPermission();
      }
      set({ notificationsEnabled: next });
    },
  })),
    { name: 'office' },
  ),
);
