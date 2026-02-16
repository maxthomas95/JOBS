import './App.css';
import { PixelOffice } from './engine/PixelOffice.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { HUD } from './ui/HUD.js';
import { AgentDetailPanel } from './ui/AgentDetailPanel.js';
import { StatsPanel } from './ui/StatsPanel.js';
import { useThemeStore } from './state/useThemeStore.js';

function getWsUrl(): string {
  if (import.meta.env.DEV) {
    return 'ws://localhost:8780/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws`;
}

export default function App() {
  useWebSocket(getWsUrl());
  const theme = useThemeStore((s) => s.theme);

  const themeVars = {
    '--app-bg': theme.css.appBg,
    '--pixi-bg': theme.css.pixiBg,
    '--canvas-border': theme.css.canvasBorder,
    '--panel-bg': theme.css.panelBg,
    '--panel-border': theme.css.panelBorder,
    '--text': theme.css.text,
    '--text-muted': theme.css.textMuted,
    '--panel-hover': theme.css.panelBgSolid + 'cc',
  } as React.CSSProperties;

  return (
    <div className="app-root" data-theme={theme.id} style={themeVars}>
      <PixelOffice />
      <HUD />
      <AgentDetailPanel />
      <StatsPanel />
    </div>
  );
}
