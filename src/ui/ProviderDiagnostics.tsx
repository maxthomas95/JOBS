import { useEffect, useState } from 'react';
import { lastActivity } from './sessionPresentation.js';
import { useNow } from './useNow.js';
interface ProviderHealth {
  id: string; label: string; mode: 'unobserved' | 'hooks' | 'notify' | 'mixed';
  status: 'unobserved' | 'active' | 'stale'; lastEventAt: number | null;
  limitations: string[];
  capabilities: { lifecycle: boolean; tools: boolean; approvals: boolean; compaction: boolean; subagents: boolean; usage: boolean };
}
export function ProviderDiagnostics() {
  const [providers, setProviders] = useState<ProviderHealth[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const now = useNow();
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/providers', { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error('Provider diagnostics unavailable');
        const data = await response.json();
        if (!Array.isArray(data.providers)) throw new Error('Invalid diagnostics');
        setProviders(data.providers); setError(false);
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [attempt]);
  const modeLabels = { unobserved: 'No activity received', hooks: 'Lifecycle hooks', notify: 'Completion updates', mixed: 'Hooks and completion updates' };
  return <section className="settings-section provider-diagnostics"><h3>Connection and setup</h3>
    <p className="detail-caption">Start Claude Code in a watched project, or configure Codex hooks using the project's setup guide.</p>
    {error ? <p className="inline-empty">Provider diagnostics could not be loaded. <button className="text-button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></p> : !providers ? <p className="inline-empty" role="status">Loading provider health…</p> : providers.map((provider) => <div className="provider-health" key={provider.id}>
      <div className="section-heading"><h3>{provider.label}</h3><span className={provider.status === 'stale' ? 'attention-text' : 'muted'}>{provider.status === 'active' ? 'Receiving events' : provider.status === 'stale' ? 'No recent events' : 'Not observed yet'}</span></div>
      <p>{modeLabels[provider.mode]}{provider.lastEventAt ? ` · Last event ${lastActivity(provider.lastEventAt, now).toLowerCase()}` : ''}</p>
      {provider.mode !== 'unobserved' && <p className="detail-caption">{Object.entries(provider.capabilities).filter(([, available]) => available).map(([capability]) => ({ lifecycle: 'Session lifecycle', tools: 'Tools', approvals: 'Approvals', compaction: 'Compaction', subagents: 'Child agents', usage: 'Usage' })[capability]).join(', ') || 'Turn completion only'}</p>}
      {provider.limitations.length > 0 && <ul>{provider.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>}
    </div>)}
    <a href="https://github.com/maxthomas95/JOBS#readme" target="_blank" rel="noopener noreferrer">Open setup guide</a>
  </section>;
}
