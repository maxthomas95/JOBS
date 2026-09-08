import { useConnectionStore } from '../state/useConnectionStore.js';
export function ConnectionStatus() {
  const status = useConnectionStore((s) => s.status);
  return <span className="connection-status" data-state={status} role="status"><i className="status-dot" />{status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Disconnected'}</span>;
}
