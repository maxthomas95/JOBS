import { useState, useEffect } from 'react';
import { useOfficeStore } from '../state/useOfficeStore.js';
import type { AgentState } from '../types/agent.js';

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

const STATE_COLORS: Record<AgentState, string> = {
  entering: '#81c784',
  coding: '#42a5f5',
  reading: '#42a5f5',
  thinking: '#7c4dff',
  terminal: '#2ee65e',
  searching: '#ffa726',
  cooling: '#90a4ae',
  delegating: '#ce93d8',
  error: '#ff4444',
  waiting: '#ffeb3b',
  idle: '#666',
  leaving: '#999',
};

const CHARACTER_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#e57373',
  '#ba68c8', '#4dd0e1', '#fff176', '#f06292',
];

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function AgentDetailPanel() {
  const selectedAgentId = useOfficeStore((s) => s.selectedAgentId);
  const agents = useOfficeStore((s) => s.agents);
  const agentHistory = useOfficeStore((s) => s.agentHistory);
  const agentToolCounts = useOfficeStore((s) => s.agentToolCounts);
  const agentToolTime = useOfficeStore((s) => s.agentToolTime);
  const selectAgent = useOfficeStore((s) => s.selectAgent);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!selectedAgentId) return null;

  const agent = agents.get(selectedAgentId);
  if (!agent) {
    return null;
  }

  const history = agentHistory.get(selectedAgentId) ?? [];
  const toolCounts = agentToolCounts.get(selectedAgentId) ?? new Map<string, number>();
  const toolTimes = agentToolTime.get(selectedAgentId) ?? new Map<string, number>();
  const sessionStart = history.length > 0 ? history[0].timestamp : agent.lastEventAt;
  const duration = now - sessionStart;

  // Sort tools by total time descending (fall back to count)
  const sortedTools = Array.from(toolCounts.entries()).sort((a, b) => {
    const timeA = toolTimes.get(a[0]) ?? 0;
    const timeB = toolTimes.get(b[0]) ?? 0;
    return timeB - timeA || b[1] - a[1];
  });

  // Build timeline segments with duration for tooltip
  const timelineSegments: Array<{ state: AgentState; fraction: number; durationMs: number }> = [];
  const stateTotals = new Map<AgentState, number>();
  if (history.length > 0 && duration > 0) {
    for (let i = 0; i < history.length; i++) {
      const start = history[i].timestamp;
      const end = i + 1 < history.length ? history[i + 1].timestamp : now;
      const segDuration = end - start;
      const frac = segDuration / duration;
      if (frac > 0.005) {
        timelineSegments.push({ state: history[i].state, fraction: frac, durationMs: segDuration });
      }
      stateTotals.set(history[i].state, (stateTotals.get(history[i].state) ?? 0) + segDuration);
    }
  }
  // Sort states by time descending, skip trivial ones (<1s)
  const sortedStates = Array.from(stateTotals.entries())
    .filter(([, ms]) => ms >= 1000)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span
          className="detail-dot"
          style={{ background: CHARACTER_COLORS[agent.characterIndex % 8] }}
        />
        <span className="detail-name">{agent.name || agent.id.slice(0, 8)}</span>
        {agent.childIds.length > 0 ? (
          <span className="detail-team-lead">Team Lead</span>
        ) : null}
        <button className="detail-close" onClick={() => selectAgent(null)}>X</button>
      </div>

      {agent.roleName ? (
        <div className="detail-row">
          <span className="detail-label">Role</span>
          <span className="detail-value detail-mono">{agent.roleName}</span>
        </div>
      ) : null}

      {agent.project ? (
        <div className="detail-row">
          <span className="detail-label">Project</span>
          <span className="detail-value">{agent.project}</span>
        </div>
      ) : null}

      <div className="detail-row">
        <span className="detail-label">Status</span>
        <span className="detail-value" style={{ color: STATE_COLORS[agent.state] }}>
          {STATE_LABELS[agent.state]}
        </span>
      </div>

      {agent.activityText ? (
        <div className="detail-row">
          <span className="detail-label">Activity</span>
          <span className="detail-value detail-mono">{agent.activityText}</span>
        </div>
      ) : null}

      <div className="detail-row">
        <span className="detail-label">Duration</span>
        <span className="detail-value">{formatDuration(duration)}</span>
      </div>

      {agent.parentId ? (
        <div className="detail-row">
          <span className="detail-label">Parent</span>
          <span
            className="detail-value detail-link"
            onClick={() => selectAgent(agent.parentId)}
          >
            {agents.get(agent.parentId)?.name || agent.parentId.slice(0, 8)}
          </span>
        </div>
      ) : null}

      {agent.parentId ? (() => {
        const parent = agents.get(agent.parentId);
        if (!parent) return null;
        const siblings = parent.childIds.filter((cid) => cid !== agent.id);
        if (siblings.length === 0) return null;
        return (
          <div className="detail-section">
            <div className="detail-label">Siblings</div>
            <div className="detail-children">
              {siblings.map((sibId) => {
                const sib = agents.get(sibId);
                return (
                  <span
                    key={sibId}
                    className={`detail-sibling-tag${sib ? '' : ' detail-child-gone'}`}
                    onClick={() => sib && selectAgent(sibId)}
                  >
                    {sib?.name || sibId.slice(0, 6)}
                    {sib ? ` [${STATE_LABELS[sib.state]}]` : ''}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })() : null}

      {agent.childIds.length > 0 ? (() => {
        const activeCount = agent.childIds.filter((id) => agents.has(id)).length;
        const completedCount = agent.childIds.length - activeCount;
        return (
          <div className="detail-section">
            <div className="detail-label">Sub-agents: {activeCount} active{completedCount > 0 ? `, ${completedCount} completed` : ''}</div>
            <div className="detail-children">
              {agent.childIds.map((childId) => {
                const child = agents.get(childId);
                return (
                  <span
                    key={childId}
                    className={`detail-child-tag${child ? '' : ' detail-child-gone'}`}
                    onClick={() => child && selectAgent(childId)}
                    title={child ? STATE_LABELS[child.state] : 'departed'}
                  >
                    {child?.name || childId.slice(0, 6)}
                    {child ? ` [${STATE_LABELS[child.state]}]` : ''}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })() : null}

      {timelineSegments.length > 0 ? (
        <div className="detail-section">
          <div className="detail-label">Timeline</div>
          <div className="detail-timeline">
            {timelineSegments.map((seg, i) => (
              <div
                key={i}
                className="timeline-segment"
                style={{
                  flex: seg.fraction,
                  background: STATE_COLORS[seg.state],
                }}
                title={`${STATE_LABELS[seg.state]} - ${formatDuration(seg.durationMs)}`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {sortedStates.length > 0 ? (
        <div className="detail-section">
          <div className="detail-label">Time by state</div>
          <div className="detail-tools">
            {sortedStates.map(([state, ms]) => {
              const pct = duration > 0 ? Math.round((ms / duration) * 100) : 0;
              return (
                <div key={state} className="tool-row">
                  <span className="state-label-name">
                    <span className="state-dot" style={{ background: STATE_COLORS[state] }} />
                    {STATE_LABELS[state]}
                  </span>
                  <span className="tool-stats">
                    <span className="tool-time">{formatDuration(ms)}</span>
                    <span className="tool-sep">/</span>
                    <span className="tool-count">{pct}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {sortedTools.length > 0 ? (
        <div className="detail-section">
          <div className="detail-label">Tools (calls / time)</div>
          <div className="detail-tools">
            {sortedTools.map(([tool, count]) => {
              const totalMs = toolTimes.get(tool) ?? 0;
              return (
                <div key={tool} className="tool-row">
                  <span className="tool-name">{tool}</span>
                  <span className="tool-stats">
                    <span className="tool-count">{count}x</span>
                    <span className="tool-sep">/</span>
                    <span className="tool-time">{totalMs > 0 ? formatDuration(totalMs) : '--'}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="detail-row detail-meta">
        <span className="detail-label">Session</span>
        <span className="detail-value detail-mono">{agent.sessionId.slice(0, 12)}</span>
      </div>
    </div>
  );
}
