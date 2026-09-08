import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { PixelOffice } from './engine/PixelOffice.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { HUD } from './ui/HUD.js';
import { AgentDetailPanel } from './ui/AgentDetailPanel.js';
import { StatsPanel } from './ui/StatsPanel.js';
import { ActivityFeed } from './ui/ActivityFeed.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { ConnectionStatus } from './ui/ConnectionStatus.js';
import { useThemeStore } from './state/useThemeStore.js';
import { useOfficeStore } from './state/useOfficeStore.js';
import { useConnectionStore } from './state/useConnectionStore.js';
import { useMotionStore } from './state/useMotionStore.js';
import { useServerConfigStore } from './state/useServerConfigStore.js';
import { agentName, needsAttention } from './ui/sessionPresentation.js';

export default function App() {
  const wsPath = useServerConfigStore((s) => s.wsPath);
  const demoMode = useServerConfigStore((s) => s.demoMode);
  const wsUrl = new URL(wsPath, window.location.href);
  wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  useWebSocket(wsUrl.href);
  const theme = useThemeStore((s) => s.theme);
  const motion = useMotionStore((s) => s.preference);
  const agents = useOfficeStore((s) => s.agents);
  const selectedId = useOfficeStore((s) => s.selectedAgentId);
  const followedId = useOfficeStore((s) => s.followedAgentId);
  const connection = useConnectionStore((s) => s.status);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [kiosk, setKiosk] = useState(false);
  const lastSessionTrigger = useRef<HTMLElement | null>(null);
  const followedAgent = followedId ? agents.get(followedId) : undefined;
  const attentionCount = [...agents.values()].filter(needsAttention).length;
  const closeSelection = useCallback(() => {
    useOfficeStore.getState().selectAgent(null);
    if (lastSessionTrigger.current?.isConnected) lastSessionTrigger.current.focus();
    else document.getElementById('session-search')?.focus();
  }, []);
  useEffect(() => {
    const captureSelection = (event: Event) => {
      const target = event.target as HTMLElement;
      const trigger = target.closest<HTMLElement>('[data-session-id], .text-button');
      if (trigger) lastSessionTrigger.current = trigger;
    };
    document.addEventListener('click', captureSelection, true);
    return () => document.removeEventListener('click', captureSelection, true);
  }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || settingsOpen) return;
      if (kiosk) setKiosk(false);
      else if (followedId) useOfficeStore.getState().unfollowAgent();
      else if (selectedId) closeSelection();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [settingsOpen, kiosk, followedId, selectedId, closeSelection]);
  const themeVars = {
    '--app-bg': theme.css.appBg, '--pixi-bg': theme.css.pixiBg,
    '--canvas-border': theme.css.canvasBorder, '--panel-bg': theme.css.panelBg,
    '--panel-solid': theme.css.panelBgSolid, '--panel-border': theme.css.panelBorder,
    '--text': theme.css.text, '--text-muted': theme.css.textMuted,
    '--accent-color': theme.css.accentColor,
  } as React.CSSProperties;
  return <div className={`app-root${kiosk ? ' kiosk-mode' : ''}`} data-theme={theme.id} data-motion={motion} style={themeVars}>
    <a className="skip-link" href="#office">Skip to office</a>
    <header className="app-header"><a href="#office" className="brand" aria-label="J.O.B.S. office">J.O.B.S.<span>Agent office</span></a>
      <nav className="desktop-nav" aria-label="Workspace"><a href="#office">Office</a><a href="#activity">Activity</a></nav>
      <div className="header-actions">{demoMode && <span className="demo-badge">Demo data</span>}<ConnectionStatus /><button onClick={() => setSettingsOpen(true)}>Settings</button></div>
    </header>
    <nav className="mobile-nav" aria-label="Page sections"><a href="#sessions">Sessions</a><a href="#office">Office</a><a href="#session-inspector">Details</a><a href="#activity">Activity</a></nav>
    {connection !== 'connected' && <div className="connection-banner" role="status"><strong>{connection === 'connecting' ? 'Connecting to the office…' : 'Connection interrupted'}</strong><span>{connection === 'connecting' ? 'Waiting for the monitoring server.' : 'Displayed activity may be out of date. Reconnecting automatically.'}</span></div>}
    <div className="workspace-layout"><HUD onSetup={() => setSettingsOpen(true)} />
      <main className="workspace" id="office" tabIndex={-1}>
        <div className="workspace-heading"><div><h1>Your agents, at a glance</h1><p>{agents.size ? `${agents.size} sessions in the office${attentionCount ? ` · ${attentionCount} need attention` : ''}` : 'A little space for the work happening in your terminals.'}</p></div><button className="kiosk-button" aria-pressed={kiosk} onClick={() => setKiosk(!kiosk)}>{kiosk ? 'Exit kiosk' : 'Kiosk view'}</button></div>
        <section className="office-frame" aria-label="Pixel office">
          <div className="office-toolbar"><span className="office-title">The office floor</span><span>{followedAgent ? `Following ${agentName(followedAgent)}` : 'Select a mascot to inspect'}</span>{followedAgent && <button onClick={() => useOfficeStore.getState().unfollowAgent()}>Stop following</button>}</div>
          <PixelOffice />
          <div className="office-caption"><span>{agents.size ? 'Activity is also available in the session roster.' : connection === 'connected' ? 'Listening for session activity. Configure providers in Settings.' : 'The office reconnects when the server is available.'}</span><span>4:3 office</span></div>
        </section>
        <StatsPanel /><ActivityFeed />
      </main><AgentDetailPanel onClose={closeSelection} />
    </div>
    <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </div>;
}
