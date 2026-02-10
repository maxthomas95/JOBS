import { useState, useEffect } from 'react';
import { ConnectionStatus } from './ConnectionStatus.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { useEventStore } from '../state/useEventStore.js';
import type { AgentState } from '../types/agent.js';
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

function formatFeedItem(event: PixelEvent): string {
  const shortId = event.sessionId.slice(0, 6);
  if (event.type === 'tool') {
    const ctx = event.context ? ` ${event.context}` : '';
    return `[${shortId}] ${event.tool}${ctx}`;
  }
  if (event.type === 'activity') {
    return `[${shortId}] ${event.action}`;
  }
  if (event.type === 'session') {
    return `[${shortId}] session.${event.action}`;
  }
  if (event.type === 'agent') {
    return `[${shortId}] agent.${event.action}`;
  }
  return `[${shortId}] ${event.type}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

export function HUD() {
  const agents = useOfficeStore((state) => state.agents);
  const focusAgent = useOfficeStore((state) => state.focusAgent);
  const notificationsEnabled = useOfficeStore((state) => state.notificationsEnabled);
  const toggleNotifications = useOfficeStore((state) => state.toggleNotifications);
  const events = useEventStore((state) => state.events);
  const count = agents.size;
  const agentRows = Array.from(agents.values())
    .sort((a, b) => (a.waitingForHuman === b.waitingForHuman ? 0 : a.waitingForHuman ? -1 : 1))
    .slice(0, 10);
  const recentEvents = events.slice(0, 5);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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

      {agentRows.length > 0 ? (
        <div className="agent-list">
          {agentRows.map((agent) => (
            <div key={agent.id} className="agent-row" onClick={() => focusAgent(agent.id)}>
              <span
                className="agent-dot"
                style={{ background: CHARACTER_COLORS[agent.characterIndex % 8] }}
              />
              <span className="agent-id">{agent.id.slice(0, 8)}</span>
              <span className="agent-state">{STATE_LABELS[agent.state]}</span>
              {agent.activityText ? (
                <span className="agent-activity">{truncate(agent.activityText, 20)}</span>
              ) : null}
              {agent.waitingForHuman ? (
                <span className="waiting-badge">NEEDS INPUT</span>
              ) : null}
              <span className="agent-uptime">{formatUptime(agent.lastEventAt, now)}</span>
              {agent.project ? (
                <span className="agent-project">{agent.project}</span>
              ) : null}
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
              {formatFeedItem(ev)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
