import { useConnectionStore } from '../state/useConnectionStore.js';

export function ConnectionStatus() {
  const status = useConnectionStore((state) => state.status);
  const isReconnecting = status === 'disconnected' || status === 'connecting';
  return (
    <div className="connection-status" data-state={status}>
      <span className="status-dot" />
      <span>{status}</span>
      {isReconnecting ? (
        <span className="reconnecting">RECONNECTING...</span>
      ) : null}
    </div>
  );
}
