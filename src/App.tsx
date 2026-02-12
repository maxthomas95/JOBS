import './App.css';
import { PixelOffice } from './engine/PixelOffice.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { HUD } from './ui/HUD.js';
import { AgentDetailPanel } from './ui/AgentDetailPanel.js';

function getWsUrl(): string {
  if (import.meta.env.DEV) {
    return 'ws://localhost:8780/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws`;
}

export default function App() {
  useWebSocket(getWsUrl());

  return (
    <div className="app-root">
      <PixelOffice />
      <HUD />
      <AgentDetailPanel />
    </div>
  );
}
