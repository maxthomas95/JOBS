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
    return `[${shortId}] ${event.tool}`;
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

export function HUD() {
  const agents = useOfficeStore((state) => state.agents);
  const focusAgent = useOfficeStore((state) => state.focusAgent);
  const events = useEventStore((state) => state.events);
  const count = agents.size;
  const agentRows = Array.from(agents.values()).slice(0, 10);
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
        <ConnectionStatus />
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
              <span className="agent-uptime">{formatUptime(agent.lastEventAt, now)}</span>
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
