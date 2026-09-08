import { useState } from 'react';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { useEventStore } from '../state/useEventStore.js';
import type { PixelEvent } from '../types/events.js';
import { agentName, eventDescription } from './sessionPresentation.js';

export function ActivityFeed() {
  const events = useEventStore((s) => s.events);
  const agents = useOfficeStore((s) => s.agents);
  const selectedId = useOfficeStore((s) => s.selectedAgentId);
  const [pausedEvents, setPausedEvents] = useState<PixelEvent[] | null>(null);
  const [scope, setScope] = useState('all');
  const [expanded, setExpanded] = useState(false);
  const source = pausedEvents || events;
  const filtered = source.filter((event) => scope === 'all' || (scope === 'selected' && event.sessionId === selectedId)
    || (scope === 'attention' && (event.type === 'error' || (event.type === 'tool' && event.status === 'error') || (event.type === 'activity' && ['needsApproval', 'waiting'].includes(event.action)))));
  return <section className="activity-panel" id="activity" aria-labelledby="activity-heading" tabIndex={-1}>
    <div className="section-heading"><h2 id="activity-heading">Activity</h2><div className="activity-controls">
      <select aria-label="Activity filter" value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">All sessions</option><option value="selected" disabled={!selectedId}>Selected session</option><option value="attention">Needs attention</option></select>
      <button aria-pressed={!!pausedEvents} onClick={() => setPausedEvents(pausedEvents ? null : [...events])}>{pausedEvents ? 'Resume' : 'Pause'}</button>
    </div></div>
    <p className="activity-caption">{pausedEvents ? 'Display paused. Monitoring continues.' : 'Recent events, newest first. Times are local to this browser.'}</p>
    <ol className="event-list">
      {filtered.slice(0, expanded ? 50 : 7).map((event) => {
        const agent = agents.get(event.sessionId);
        return <li key={event.id} className="event-row"><time dateTime={new Date(event.timestamp).toISOString()}>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
          <div>{agent ? <button className="text-button" onClick={() => useOfficeStore.getState().selectAgent(agent.id)}>{agentName(agent)}</button> : <strong>Session {event.sessionId.slice(-8)}</strong>}<p>{eventDescription(event)}</p></div>
          <span className="event-project">{agent?.project}</span>
        </li>;
      })}
    </ol>
    {!filtered.length && <p className="inline-empty">{scope === 'selected' && !selectedId ? 'Select a session to view its activity.' : 'No events to show yet.'}</p>}
    {filtered.length > 7 && <button className="text-button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer events' : `Show ${filtered.length} recent events`}</button>}
  </section>;
}
