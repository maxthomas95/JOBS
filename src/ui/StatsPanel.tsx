import { useState } from 'react';
import { useStatsStore } from '../state/useStatsStore.js';
import type { AgentState } from '../types/agent.js';

const STATE_LABELS: Record<string, string> = {
  coding: 'Coding',
  thinking: 'Thinking',
  terminal: 'Terminal',
  searching: 'Searching',
  delegating: 'Delegating',
  waiting: 'Waiting',
  error: 'Error',
  needsApproval: 'Needs Approval',
  compacting: 'Compacting',
  cooling: 'Coffee Break',
};

const LEGEND_ITEMS: Array<{ state: AgentState; color: string }> = [
  { state: 'coding', color: '#42a5f5' },
  { state: 'thinking', color: '#7c4dff' },
  { state: 'terminal', color: '#2ee65e' },
  { state: 'searching', color: '#ffa726' },
  { state: 'delegating', color: '#ce93d8' },
  { state: 'waiting', color: '#ffeb3b' },
  { state: 'error', color: '#ff4444' },
  { state: 'needsApproval', color: '#ff9800' },
  { state: 'compacting', color: '#ab47bc' },
  { state: 'cooling', color: '#90a4ae' },
];

export function StatsPanel() {
  const stats = useStatsStore((s) => s.stats);
  const [collapsed, setCollapsed] = useState(true);
  const [showLegend, setShowLegend] = useState(false);

  return (
    <div className="stats-panel-area">
      <button
        className="stats-toggle"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? 'STATS' : 'HIDE STATS'}
      </button>

      {!collapsed && stats ? (
        <div className="stats-panel">
          <div className="stats-row">
            <span className="stats-label">Today</span>
            <span className="stats-value">{stats.sessionsToday} sessions</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Total</span>
            <span className="stats-value">{stats.totalSessions} sessions</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Hours</span>
            <span className="stats-value">{stats.totalHours}h</span>
          </div>

          {stats.topTools.length > 0 ? (
            <div className="stats-tools-section">
              <div className="stats-tools-header">Top Tools</div>
              {stats.topTools.map((t) => {
                const maxCount = stats.topTools[0].count;
                const pct = maxCount > 0 ? (t.count / maxCount) * 100 : 0;
                return (
                  <div key={t.tool} className="stats-tool-row">
                    <span className="stats-tool-name">{t.tool}</span>
                    <div className="stats-tool-bar-bg">
                      <div
                        className="stats-tool-bar-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="stats-tool-count">{t.count}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {!collapsed && !stats ? (
        <div className="stats-panel">
          <div className="stats-row">
            <span className="stats-label">No data yet</span>
          </div>
        </div>
      ) : null}

      <button
        className="legend-toggle"
        onClick={() => setShowLegend((v) => !v)}
      >
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
  );
}
