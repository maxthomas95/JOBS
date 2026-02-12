import { useState, useEffect, useCallback } from 'react';
import { ConnectionStatus } from './ConnectionStatus.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { useEventStore } from '../state/useEventStore.js';
import type { Agent, AgentState } from '../types/agent.js';
import type { PixelEvent } from '../types/events.js';

const STATE_LABELS: Record<AgentState, string> = {
  entering: 'Arriving',
  coding: 'Coding',
  reading: 'Reading',
  thinking: 'Thinking',
  terminal: 'Terminal',
  searching: 'Searching',
  cooling: 'Coffee Break',
  delegating: 'Delegating',
  error: 'Error',
  waiting: 'Waiting',
  idle: 'Idle',
  leaving: 'Leaving',
};

const LEGEND_ITEMS: Array<{ state: AgentState; color: string }> = [
  { state: 'coding', color: '#42a5f5' },
  { state: 'thinking', color: '#7c4dff' },
  { state: 'terminal', color: '#2ee65e' },
  { state: 'searching', color: '#ffa726' },
  { state: 'delegating', color: '#ce93d8' },
  { state: 'waiting', color: '#ffeb3b' },
  { state: 'error', color: '#ff4444' },
  { state: 'cooling', color: '#90a4ae' },
];

function formatUptime(startMs: number, nowMs: number): string {
  const secs = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

const CHARACTER_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#e57373',
  '#ba68c8', '#4dd0e1', '#fff176', '#f06292',
];

/** Resolve a session ID to its display name, falling back to short ID */
function agentLabel(agents: Map<string, Agent>, sessionId: string): string {
  const agent = agents.get(sessionId);
  return agent?.name || sessionId.slice(0, 6);
}

function formatFeedItem(event: PixelEvent, agents: Map<string, Agent>): string {
  const label = agentLabel(agents, event.sessionId);
  if (event.type === 'tool') {
    const ctx = event.context ? ` ${event.context}` : '';
    return `[${label}] ${event.tool}${ctx}`;
  }
  if (event.type === 'activity') {
    return `[${label}] ${event.action}`;
  }
  if (event.type === 'session') {
    return `[${label}] session.${event.action}`;
  }
  if (event.type === 'agent') {
    return `[${label}] agent.${event.action}`;
  }
  return `[${label}] ${event.type}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

/** Check if agent is a supervisor with active children */
function isSupervisor(agent: Agent, agentMap: Map<string, Agent>): boolean {
  return agent.childIds.filter((id) => agentMap.has(id)).length > 0;
}

/** Group agents by project, nesting teams: supervisors first with children below, then standalone */
function groupByProject(agents: Agent[], agentMap: Map<string, Agent>): Map<string, Agent[]> {
  const groups = new Map<string, Agent[]>();
  for (const agent of agents) {
    const key = agent.project || 'Unknown';
    const list = groups.get(key);
    if (list) {
      list.push(agent);
    } else {
      groups.set(key, [agent]);
    }
  }
  // Reorder: [supervisor1, ...children1, supervisor2, ...children2, ...standalone]
  for (const [key, list] of groups.entries()) {
    const supervisors: Agent[] = [];
    const childrenByParent = new Map<string, Agent[]>();
    const standalone: Agent[] = [];

    for (const agent of list) {
      if (isSupervisor(agent, agentMap)) {
        supervisors.push(agent);
      } else if (agent.parentId && agentMap.has(agent.parentId)) {
        // Active child — will be nested under parent
        const siblings = childrenByParent.get(agent.parentId) ?? [];
        siblings.push(agent);
        childrenByParent.set(agent.parentId, siblings);
      } else {
        standalone.push(agent);
      }
    }

    // Sort within sub-groups: waiting-for-human first
    const waitingFirst = (a: Agent, b: Agent) =>
      a.waitingForHuman === b.waitingForHuman ? 0 : a.waitingForHuman ? -1 : 1;
    supervisors.sort(waitingFirst);
    standalone.sort(waitingFirst);

    const ordered: Agent[] = [];
    for (const sup of supervisors) {
      ordered.push(sup);
      const children = childrenByParent.get(sup.id) ?? [];
      children.sort(waitingFirst);
      ordered.push(...children);
    }
    ordered.push(...standalone);
    groups.set(key, ordered);
  }
  return groups;
}

export function HUD() {
  const agents = useOfficeStore((state) => state.agents);
  const focusAgent = useOfficeStore((state) => state.focusAgent);
  const focusTeam = useOfficeStore((state) => state.focusTeam);
  const selectAgent = useOfficeStore((state) => state.selectAgent);
  const notificationsEnabled = useOfficeStore((state) => state.notificationsEnabled);
  const toggleNotifications = useOfficeStore((state) => state.toggleNotifications);
  const events = useEventStore((state) => state.events);
  const count = agents.size;
  const allAgents = Array.from(agents.values()).slice(0, 10);
  const projectGroups = groupByProject(allAgents, agents);
  const multipleProjects = projectGroups.size > 1;
  const recentEvents = events.slice(0, 5);

  const [now, setNow] = useState(Date.now());
  const [showLegend, setShowLegend] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const toggleProject = useCallback((project: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) {
        next.delete(project);
      } else {
        next.add(project);
      }
      return next;
    });
  }, []);

  const renderAgentRow = (agent: Agent) => {
    const isChild = !!agent.parentId;
    const parentName = isChild ? (agents.get(agent.parentId!)?.name || agent.parentId!.slice(0, 6)) : null;
    const activeChildren = agent.childIds.filter((id) => agents.has(id)).length;
    const supervisor = isSupervisor(agent, agents);
    const rowClasses = `agent-row${isChild ? ' agent-child' : ''}${supervisor ? ' supervisor' : ''}`;

    const handleClick = () => {
      if (supervisor) {
        focusTeam(agent.id);
      } else {
        focusAgent(agent.id);
      }
      selectAgent(agent.id);
    };

    return (
      <div key={agent.id} className={rowClasses} onClick={handleClick}>
        <span
          className="agent-dot"
          style={{ background: CHARACTER_COLORS[agent.characterIndex % 8] }}
        />
        <span className="agent-name">{agent.name || agent.id.slice(0, 8)}</span>
        {supervisor ? (
          <span className="supervisor-badge">LEAD</span>
        ) : null}
        {isChild ? (
          <span className="agent-parent-tag">{parentName}</span>
        ) : null}
        <span className="agent-state">{STATE_LABELS[agent.state]}</span>
        {agent.activityText ? (
          <span className="agent-activity">{truncate(agent.activityText, 20)}</span>
        ) : null}
        {supervisor ? (
          <span className="team-progress">{activeChildren}/{agent.childIds.length} active</span>
        ) : null}
        {agent.waitingForHuman ? (
          <span className="waiting-badge">NEEDS INPUT</span>
        ) : null}
        <span className="agent-uptime">{formatUptime(agent.lastEventAt, now)}</span>
      </div>
    );
  };

  return (
    <div className="hud-overlay">
      <header className="hud-header">
        <h1>J.O.B.S. ONLINE</h1>
        <div className="hud-header-right">
          <button
            className="notification-toggle"
            onClick={toggleNotifications}
            title={notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
          >
            {notificationsEnabled ? 'NOTIF ON' : 'NOTIF OFF'}
          </button>
          <ConnectionStatus />
        </div>
      </header>

      <div className="agent-count">Active sessions: {count}</div>

      {allAgents.length > 0 ? (
        <div className="agent-list">
          {Array.from(projectGroups.entries()).map(([project, groupAgents]) => (
            <div key={project} className="project-group">
              {multipleProjects ? (
                <div
                  className="project-header"
                  onClick={() => toggleProject(project)}
                >
                  <span className="project-toggle">{collapsedProjects.has(project) ? '+' : '-'}</span>
                  <span className="project-name">{project}</span>
                  <span className="project-count">{groupAgents.length}</span>
                </div>
              ) : null}
              {!collapsedProjects.has(project) ? groupAgents.map(renderAgentRow) : null}
            </div>
          ))}
        </div>
      ) : null}

      {count === 0 ? (
        <div className="empty-state">No active sessions - watching for Claude Code activity...</div>
      ) : null}

      {recentEvents.length > 0 ? (
        <div className="activity-feed">
          {recentEvents.map((ev) => (
            <div key={ev.id} className="feed-item">
              {formatFeedItem(ev, agents)}
            </div>
          ))}
        </div>
      ) : null}

      <div className="hud-legend-area">
        <button className="legend-toggle" onClick={() => setShowLegend((v) => !v)}>
          {showLegend ? 'HIDE LEGEND' : 'LEGEND'}
        </button>

        {showLegend ? (
          <div className="color-legend">
            {LEGEND_ITEMS.map((item) => (
              <div key={item.state} className="legend-item">
                <span className="legend-dot" style={{ background: item.color }} />
                <span className="legend-label">{STATE_LABELS[item.state]}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
