import { useConnectionStore } from '../state/useConnectionStore.js';

export function ConnectionStatus() {
  const status = useConnectionStore((state) => state.status);
  return (
    <div className="connection-status" data-state={status}>
      <span className="status-dot" />
      <span>{status}</span>
    </div>
  );
}
