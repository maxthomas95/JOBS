import { useState } from 'react';
import { useStatsStore } from '../state/useStatsStore.js';
import type { AgentState } from '../types/agent.js';
import { STATE_LABELS, STATE_COLORS } from './stateLabels.js';

const LEGEND_STATES: AgentState[] = [
  'coding', 'thinking', 'terminal', 'searching', 'delegating',
  'waiting', 'error', 'needsApproval', 'compacting', 'cooling',
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
          {LEGEND_STATES.map((state) => (
            <div key={state} className="legend-item">
              <span className="legend-dot" style={{ background: STATE_COLORS[state] }} />
              <span className="legend-label">{STATE_LABELS[state]}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
