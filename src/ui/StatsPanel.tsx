import { useStatsStore } from '../state/useStatsStore.js';
import { STATE_LABELS, STATE_COLORS } from './stateLabels.js';
export function StatsPanel() {
  const stats = useStatsStore((s) => s.stats);
  return <div className="office-reference">
    <details><summary>Office legend</summary><div className="color-legend">{Object.entries(STATE_LABELS).map(([state, label]) => <span key={state}><i className="state-dot" style={{ background: STATE_COLORS[state as keyof typeof STATE_COLORS] }} />{label}</span>)}</div></details>
    <details><summary>Workspace statistics</summary>{stats ? <div className="workspace-stats"><dl><div><dt>Today (UTC)</dt><dd>{stats.sessionsToday} sessions</dd></div><div><dt>Retained sessions</dt><dd>{stats.totalSessions} sessions</dd></div><div><dt>Observed session time</dt><dd>{stats.totalHours} hours</dd></div></dl><p className="detail-caption">Sessions and hours cover the last 30 recorded days. Tool counts are cumulative.</p>{stats.topTools.length > 0 && <><h3>Most used tools</h3><dl>{stats.topTools.map((tool) => <div key={tool.tool}><dt className="mono">{tool.tool}</dt><dd>{tool.count}</dd></div>)}</dl></>}</div> : <p className="inline-empty">Statistics will appear after the server sends its first snapshot.</p>}</details>
  </div>;
}
