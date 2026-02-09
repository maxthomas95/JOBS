import { ConnectionStatus } from './ConnectionStatus.js';
import { useOfficeStore } from '../state/useOfficeStore.js';

export function HUD() {
  const agents = useOfficeStore((state) => state.agents);
  const count = agents.size;
  const agentRows = Array.from(agents.values()).slice(0, 5);

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
            <div key={agent.id}>
              {agent.id.slice(0, 8)} - {agent.state}
            </div>
          ))}
        </div>
      ) : null}

      {count === 0 ? (
        <div className="empty-state">No active sessions - watching for Claude Code activity...</div>
      ) : null}
    </div>
  );
}
