import { useEffect, useRef } from 'react';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { STATE_LABELS, STATE_COLORS } from './stateLabels.js';
import { agentName, elapsed, hasToolActivity, integrationLabel, lastActivity, needsAttention, providerName, statusLabel } from './sessionPresentation.js';
import type { MonitoredAgent } from './sessionPresentation.js';
import { ProviderAvatar } from './ProviderAvatar.js';
import { useNow } from './useNow.js';

export function AgentDetailPanel({ onClose }: { onClose: () => void }) {
  const selectedId = useOfficeStore((s) => s.selectedAgentId);
  const agents = useOfficeStore((s) => s.agents);
  const histories = useOfficeStore((s) => s.agentHistory);
  const allToolCounts = useOfficeStore((s) => s.agentToolCounts);
  const allToolTimes = useOfficeStore((s) => s.agentToolTime);
  const followedId = useOfficeStore((s) => s.followedAgentId);
  const now = useNow();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const agent: MonitoredAgent | undefined = selectedId ? agents.get(selectedId) : undefined;
  useEffect(() => {
    if (!selectedId) return;
    titleRef.current?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 760px)').matches) titleRef.current?.scrollIntoView({ block: 'start' });
  }, [selectedId]);
  if (!agent) return <aside id="session-inspector" className="inspector inspector-empty" aria-label="Session details" tabIndex={-1}>
    <div className="empty-inspector-mark" aria-hidden="true">⌖</div><h2>A closer look</h2><p>Select a session in the roster or office to see its state, recent activity, and team.</p><p className="muted">Keyboard: Tab to a session, then Enter to inspect. Escape closes the selection.</p>
  </aside>;
  const history = histories.get(agent.id) || [];
  const toolCounts = allToolCounts.get(agent.id) || new Map<string, number>();
  const toolTimes = allToolTimes.get(agent.id) || new Map<string, number>();
  const sortedTools = [...toolCounts].sort((a, b) => (toolTimes.get(b[0]) || 0) - (toolTimes.get(a[0]) || 0) || b[1] - a[1]);
  const parent = agent.parentId ? agents.get(agent.parentId) : undefined;
  const children = agent.childIds.map((id) => agents.get(id)).filter((child) => !!child);
  const siblings = parent ? parent.childIds.filter((id) => id !== agent.id).map((id) => agents.get(id)).filter((sibling) => !!sibling) : [];
  let sourceUrl: string | null = null;
  try { if (agent.sourceUrl && ['https:', 'http:'].includes(new URL(agent.sourceUrl).protocol)) sourceUrl = agent.sourceUrl; } catch { /* Invalid external links are omitted. */ }
  const selectRelative = (id: string) => { useOfficeStore.getState().selectAgent(id); useOfficeStore.getState().focusAgent(id); };
  return <aside id="session-inspector" className="inspector" aria-labelledby="inspector-title" tabIndex={-1}>
    <div className="inspector-header"><ProviderAvatar agent={agent} /><div><h2 id="inspector-title" tabIndex={-1} ref={titleRef}>{agentName(agent)}</h2><p>{providerName(agent)} · {agent.project || 'No project'}</p></div><button className="icon-button" onClick={onClose} aria-label="Close session details">×</button></div>
    <span className="status-label"><span className="state-dot" style={{ background: STATE_COLORS[agent.state] }} />{statusLabel(agent)}</span>
    {needsAttention(agent) && <div className="attention-notice"><h3>{agent.state === 'error' ? 'An error needs review' : agent.state === 'needsApproval' ? 'Approval requested' : 'Ready for your input'}</h3><p>{agent.state === 'error' ? 'Open the source session to review the error.' : 'Continue in the original agent session. This office monitors activity.'}</p></div>}
    {agent.activityText && <p className="current-activity">{agent.activityText}</p>}
    <dl className="session-facts">
      <div><dt>Integration</dt><dd>{integrationLabel(agent)}</dd></div>
      <div><dt>Last activity</dt><dd><time dateTime={new Date(agent.lastEventAt).toISOString()} title={new Date(agent.lastEventAt).toLocaleString()}>{lastActivity(agent.lastEventAt, now)}</time></dd></div>
      <div><dt>Session duration</dt><dd>{agent.startedAt ? elapsed(now - agent.startedAt) : 'Not available'}</dd></div>
      <div><dt>Time in state</dt><dd>{elapsed(now - agent.stateChangedAt)}</dd></div>
      {agent.model && <div><dt>Model</dt><dd>{agent.model}</dd></div>}
      {agent.machineName && <div><dt>Machine</dt><dd>{agent.machineName}</dd></div>}
      {agent.roleName && <div><dt>Role</dt><dd>{agent.roleName}</dd></div>}
      <div><dt>Session</dt><dd className="mono session-id" title={agent.sessionId}>{agent.sessionId}</dd></div>
      {sourceUrl && <div><dt>Source</dt><dd><a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open {agent.sourceName || 'source'}</a></dd></div>}
    </dl>
    <button className="follow-button" aria-pressed={followedId === agent.id} onClick={() => followedId === agent.id ? useOfficeStore.getState().unfollowAgent() : useOfficeStore.getState().followAgent(agent.id)}>{followedId === agent.id ? 'Stop following' : 'Follow in office'}</button>
    {(parent || children.length > 0 || siblings.length > 0) && <section className="detail-section"><h3>Team</h3>{parent && <p className="relationship-row">Lead <button className="text-button" onClick={() => selectRelative(parent.id)}>{agentName(parent)}</button></p>}
      {children.map((child) => <p className="relationship-row" key={child.id}>Child <button className="text-button" onClick={() => selectRelative(child.id)}>{agentName(child)}</button></p>)}
      {siblings.map((sibling) => <p className="relationship-row" key={sibling.id}>Teammate <button className="text-button" onClick={() => selectRelative(sibling.id)}>{agentName(sibling)}</button></p>)}
    </section>}
    {hasToolActivity(agent) ? <section className="detail-section"><h3>Observed tools</h3><p className="detail-caption">Counts and timing since this browser connected.</p>
      {sortedTools.length ? <dl className="tool-list">{sortedTools.slice(0, 8).map(([tool, count]) => <div key={tool}><dt className="mono">{tool}</dt><dd>{count} calls{toolTimes.has(tool) ? ` · ${elapsed(toolTimes.get(tool)!)}` : ''}</dd></div>)}</dl> : <p className="inline-empty">No tool calls observed yet.</p>}
    </section> : <p className="capability-note">{integrationLabel(agent) === 'Completion updates' ? 'This session reports turn completions. Live tools, approvals, and tool timing are unavailable in this mode.' : 'External updates describe source status. Tool metrics are unavailable.'}</p>}
    <section className="detail-section"><h3>Recent states</h3><p className="detail-caption">Observed in this browser.</p><ol className="state-timeline">{history.slice(-6).reverse().map((entry, index) => <li key={`${entry.timestamp}-${index}`}><span className="state-dot" style={{ background: STATE_COLORS[entry.state] }} /><div>{STATE_LABELS[entry.state]}<time dateTime={new Date(entry.timestamp).toISOString()}>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div></li>)}</ol>{!history.length && <p className="inline-empty">History starts with the next update.</p>}</section>
  </aside>;
}
