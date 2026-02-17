import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type { Agent, AgentState, Point } from '../types/agent.js';
import { STATIONS, tileToWorld } from '../types/agent.js';
import type { MachineInfo, PixelEvent } from '../types/events.js';

export interface StateEntry {
  state: AgentState;
  timestamp: number;
}

interface OfficeState {
  agents: Map<string, Agent>;
  machines: Map<string, MachineInfo>;
  groupMode: 'project' | 'machine';
  focusedAgentId: string | null;
  focusedAgentIds: Set<string>;
  selectedAgentId: string | null;
  followedAgentId: string | null;
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
  handleSnapshot: (agents: Agent[], machines?: MachineInfo[]) => void;
  handleEvent: (event: PixelEvent) => void;
  setGroupMode: (mode: 'project' | 'machine') => void;
  focusAgent: (id: string | null) => void;
  focusTeam: (supervisorId: string) => void;
  selectAgent: (id: string | null) => void;
  followAgent: (id: string) => void;
  unfollowAgent: () => void;
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
    if (agent.deskIndex !== null) {
      return tileToWorld(STATIONS.desks[agent.deskIndex]);
    }
    return tileToWorld(STATIONS.library);
  }
  if (state === 'terminal') {
    return tileToWorld(STATIONS.terminal);
  }
  if (state === 'searching') {
    return tileToWorld(STATIONS.library);
  }
  if (state === 'cooling' || state === 'waiting' || state === 'needsApproval') {
    return tileToWorld(STATIONS.coffee);
  }
  if (state === 'compacting') {
    return tileToWorld(STATIONS.library);
  }
  if (state === 'leaving') {
    return tileToWorld(STATIONS.door);
  }
  if (state === 'error') {
    return agent.position;
  }
  if (state === 'delegating') {
    return tileToWorld(STATIONS.desks[STATIONS.desks.length - 1]);
  }
  if (state === 'entering' || state === 'coding' || state === 'idle') {
    if (agent.deskIndex !== null) {
      return tileToWorld(STATIONS.desks[agent.deskIndex]);
    }
  }

  return tileToWorld(STATIONS.whiteboard);
}

export function groupByMachine(agents: Agent[]): Map<string, Agent[]> {
  const groups = new Map<string, Agent[]>();
  for (const agent of agents) {
    const key = agent.machineId || 'local';
    const list = groups.get(key) ?? [];
    list.push(agent);
    groups.set(key, list);
  }
  return groups;
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
    machines: new Map<string, MachineInfo>(),
    groupMode: 'project' as const,
    focusedAgentId: null,
    focusedAgentIds: new Set<string>(),
    selectedAgentId: null,
    followedAgentId: null,
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
        // Auto-unfollow if the removed agent was being followed
        const patch: Partial<OfficeState> = { agents: next };
        if (state.followedAgentId === id) {
          patch.followedAgentId = null;
        }
        return patch;
      });
    },

    handleSnapshot: (agents, machines) => {
      const state = get();
      const prevAgents = state.agents;
      const map = new Map<string, Agent>();
      const nextHistory = new Map(state.agentHistory);
      for (const agent of agents) {
        // Recalculate targetPosition using client-side STATIONS
        // (server stations may differ from the active map renderer)
        const recalcTarget = targetFor(agent, agent.state);
        map.set(agent.id, { ...agent, targetPosition: recalcTarget });
        const prev = prevAgents.get(agent.id);
        // Record state change in history when snapshot introduces a new state
        if (prev && agent.state !== prev.state) {
          const history = nextHistory.get(agent.id) ?? [];
          history.push({ state: agent.state, timestamp: Date.now() });
          nextHistory.set(agent.id, history);
        }
        // Notify if agent just became waiting-for-human
        if (agent.waitingForHuman && state.notificationsEnabled) {
          if (!prev?.waitingForHuman) {
            const label = agent.name || agent.id.slice(0, 8);
            const projectSuffix = agent.project ? ` (${agent.project})` : '';
            sendBrowserNotification(`${label}${projectSuffix} is waiting for your input`);
          }
        }
      }
      const patch: Partial<OfficeState> = { agents: map, agentHistory: nextHistory };
      if (machines) {
        const machineMap = new Map<string, MachineInfo>();
        for (const m of machines) {
          machineMap.set(m.id, m);
        }
        patch.machines = machineMap;
      }
      set(patch);
    },

    handleEvent: (event) => {
      const state = get();
      const existing = state.agents.get(event.sessionId);

      if (!existing && event.type === 'session' && event.action === 'started') {
        const parentId = event.parentId ?? null;
        const newAgent: Agent = {
          id: event.sessionId,
          sessionId: event.sessionId,
          characterIndex: event.characterIndex ?? Math.floor(Math.random() * 8),
          state: 'entering',
          position: tileToWorld(STATIONS.door),
          targetPosition: event.deskIndex != null
            ? tileToWorld(STATIONS.desks[event.deskIndex])
            : tileToWorld(STATIONS.door),
          deskIndex: event.deskIndex ?? null,
          lastEventAt: event.timestamp,
          stateChangedAt: event.timestamp,
          activityText: null,
          name: event.name ?? null,
          roleName: event.roleName ?? null,
          project: event.project ?? null,
          waitingForHuman: false,
          parentId,
          childIds: [],
          provider: 'claude',
          machineId: null,
          machineName: null,
          sourceType: null,
          sourceName: null,
          sourceUrl: null,
        };
        state.addAgent(newAgent);
        // Link child to parent's childIds
        if (parentId) {
          const parent = state.agents.get(parentId);
          if (parent && !parent.childIds.includes(event.sessionId)) {
            state.updateAgent(parentId, {
              childIds: [...parent.childIds, event.sessionId],
            });
          }
        }
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
          // Human sent a message — transition to thinking immediately
          patch.state = 'thinking';
          patch.targetPosition = tileToWorld(STATIONS.whiteboard);
          patch.activityText = 'Processing...';
        } else if (event.action === 'needsApproval') {
          patch.state = 'needsApproval';
          patch.targetPosition = targetFor(existing, 'needsApproval');
          patch.activityText = 'Needs approval';
        } else if (event.action === 'compacting') {
          patch.state = 'compacting';
          patch.targetPosition = targetFor(existing, 'compacting');
          patch.activityText = 'Compacting memory...';
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

    setGroupMode: (mode) => {
      set({ groupMode: mode });
    },

    focusAgent: (id) => {
      if (focusTimer) clearTimeout(focusTimer);
      set({ focusedAgentId: id, focusedAgentIds: new Set<string>() });
      if (id) {
        focusTimer = setTimeout(() => {
          set({ focusedAgentId: null });
          focusTimer = null;
        }, 2000);
      }
    },

    focusTeam: (supervisorId) => {
      if (focusTimer) clearTimeout(focusTimer);
      const state = get();
      const supervisor = state.agents.get(supervisorId);
      const activeChildIds = supervisor
        ? supervisor.childIds.filter((cid) => state.agents.has(cid))
        : [];
      const ids = new Set([supervisorId, ...activeChildIds]);
      set({ focusedAgentId: supervisorId, focusedAgentIds: ids });
      focusTimer = setTimeout(() => {
        set({ focusedAgentId: null, focusedAgentIds: new Set<string>() });
        focusTimer = null;
      }, 2000);
    },

    selectAgent: (id) => {
      set({ selectedAgentId: id });
    },

    followAgent: (id) => {
      set({ followedAgentId: id });
    },

    unfollowAgent: () => {
      set({ followedAgentId: null });
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
