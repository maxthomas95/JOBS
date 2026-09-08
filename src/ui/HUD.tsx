import { useState } from 'react';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { useConnectionStore } from '../state/useConnectionStore.js';
import type { Agent } from '../types/agent.js';
import { STATE_COLORS } from './stateLabels.js';
import { agentName, integrationLabel, lastActivity, needsAttention, providerName, statusLabel } from './sessionPresentation.js';
import { ProviderAvatar } from './ProviderAvatar.js';
import { useNow } from './useNow.js';

export function HUD({ onSetup }: { onSetup: () => void }) {
  const agents = useOfficeStore((s) => s.agents);
  const selectedId = useOfficeStore((s) => s.selectedAgentId);
  const groupMode = useOfficeStore((s) => s.groupMode);
  const setGroupMode = useOfficeStore((s) => s.setGroupMode);
  const machines = useOfficeStore((s) => s.machines);
  const status = useConnectionStore((s) => s.status);
  const now = useNow();
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const list = [...agents.values()];
  const attentionCount = list.filter(needsAttention).length;
  const filtered = list.filter((agent) => {
    const matchesQuery = `${agentName(agent)} ${agent.project || ''} ${agent.machineName || ''} ${agent.sessionId}`.toLowerCase().includes(query.toLowerCase().trim());
    const active = !['idle', 'cooling', 'waiting', 'leaving'].includes(agent.state);
    return matchesQuery && (provider === 'all' || agent.provider === provider)
      && (!attentionOnly || needsAttention(agent))
      && (stateFilter === 'all' || (stateFilter === 'active' && active) || (stateFilter === 'idle' && !active) || (stateFilter === 'error' && agent.state === 'error'));
  }).sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || agentName(a).localeCompare(agentName(b)) || a.id.localeCompare(b.id));
  const groups = new Map<string, Agent[]>();
  for (const agent of filtered) {
    const group = groupMode === 'machine' ? agent.machineName || 'Local machine' : agent.project || 'Other sessions';
    groups.set(group, [...(groups.get(group) || []), agent]);
  }
  function select(agent: Agent) {
    const store = useOfficeStore.getState();
    store.selectAgent(agent.id);
    if (agent.childIds.some((id) => agents.has(id))) store.focusTeam(agent.id);
    else store.focusAgent(agent.id);
  }
  return <aside className="session-rail" id="sessions" aria-labelledby="sessions-heading" tabIndex={-1}>
    <div className="section-heading"><h2 id="sessions-heading">Sessions</h2><span className="muted">{agents.size}</span></div>
    <label className="sr-only" htmlFor="session-search">Search sessions</label>
    <input id="session-search" type="search" placeholder="Search sessions or projects" value={query} onChange={(event) => setQuery(event.target.value)} />
    <button className="attention-filter" aria-pressed={attentionOnly} onClick={() => setAttentionOnly(!attentionOnly)}><span>Needs attention</span><strong>{attentionCount}</strong></button>
    <div className="roster-filters">
      <label><span className="sr-only">Provider</span><select aria-label="Provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
        <option value="all">All providers</option><option value="claude">Claude</option><option value="codex">Codex</option><option value="webhook">Webhooks</option>
      </select></label>
      <label><span className="sr-only">Status</span><select aria-label="Status" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
        <option value="all">All statuses</option><option value="active">Active</option><option value="idle">At rest</option><option value="error">Errors</option>
      </select></label>
    </div>
    {machines.size > 1 && <label className="group-choice">Group by <select value={groupMode} onChange={(event) => setGroupMode(event.target.value as 'project' | 'machine')}><option value="project">Project</option><option value="machine">Machine</option></select></label>}
    <div className="session-list">
      {[...groups].map(([group, members]) => <section className="session-group" key={group}>
        <button className="group-heading" aria-expanded={!collapsed.has(group)} onClick={() => setCollapsed((previous) => {
          const next = new Set(previous); if (next.has(group)) next.delete(group); else next.add(group); return next;
        })}><span>{collapsed.has(group) ? '›' : '⌄'} {group}</span><span>{members.length}</span></button>
        {!collapsed.has(group) && members.map((agent) => <button key={agent.id} data-session-id={agent.id} className="session-row" aria-pressed={selectedId === agent.id} aria-controls="session-inspector" onClick={() => select(agent)}>
          <ProviderAvatar agent={agent} /><span className="session-copy">
            <span className="session-name">{agentName(agent)}</span>
            <span className="session-provider">{providerName(agent)}<span>{integrationLabel(agent)}</span></span>
            <span className="session-status"><span className="state-dot" style={{ background: STATE_COLORS[agent.state] }} /><span className={needsAttention(agent) ? 'attention-text' : ''}>{statusLabel(agent)}</span></span>
            {agent.activityText && <span className="session-context">{agent.activityText}</span>}
            <span className="session-time">Last activity {lastActivity(agent.lastEventAt, now).toLowerCase()}</span>
            {agent.parentId && <span className="session-relationship">Child of {agents.has(agent.parentId) ? agentName(agents.get(agent.parentId)!) : 'ended session'}</span>}
            {agent.childIds.length > 0 && <span className="session-relationship">Team lead · {agent.childIds.filter((id) => agents.has(id)).length} active children</span>}
          </span>
        </button>)}
      </section>)}
      {!filtered.length && <div className="roster-empty">
        <h3>{list.length ? 'No matching sessions' : status === 'connected' ? 'The office is ready' : 'Waiting for connection'}</h3>
        <p>{list.length ? 'Try another search or clear your filters.' : status === 'connected' ? 'Start a monitored Claude or Codex session to see it here.' : 'Sessions appear when the monitoring server connects.'}</p>
        {list.length ? <button onClick={() => { setQuery(''); setProvider('all'); setStateFilter('all'); setAttentionOnly(false); }}>Clear filters</button> : <button onClick={onSetup}>Connection & setup</button>}
      </div>}
    </div>
    <p className="rail-note">{filtered.length} of {agents.size} sessions shown. Select a session to inspect its activity.</p>
  </aside>;
}
