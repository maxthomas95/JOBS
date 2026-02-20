import './App.css';
import { PixelOffice } from './engine/PixelOffice.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { HUD } from './ui/HUD.js';
import { AgentDetailPanel } from './ui/AgentDetailPanel.js';
import { StatsPanel } from './ui/StatsPanel.js';
import { useThemeStore } from './state/useThemeStore.js';

function getWsUrl(): string {
  let base: string;
  if (import.meta.env.DEV) {
    base = 'ws://localhost:8780/ws';
  } else {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    base = `${protocol}://${window.location.host}/ws`;
  }
  const token = document.querySelector<HTMLMetaElement>('meta[name="jobs-token"]')?.content;
  if (token) {
    return `${base}?token=${encodeURIComponent(token)}`;
  }
  return base;
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
    '--accent-color': theme.css.accentColor,
    '--font-mono': "'IBM Plex Mono', 'Fira Code', monospace",
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
