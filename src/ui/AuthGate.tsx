import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useServerConfigStore } from '../state/useServerConfigStore.js';
import './AuthGate.css';

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'login' | 'error'>('loading');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const check = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/auth', { credentials: 'same-origin', signal });
      if (!response.ok) throw new Error('Cannot reach the office server.');
      const data = await response.json() as { required: boolean; authenticated: boolean; wsPath: string };
      if (typeof data.required !== 'boolean' || typeof data.authenticated !== 'boolean'
        || typeof data.wsPath !== 'string' || !data.wsPath.startsWith('/') || data.wsPath.startsWith('//')) {
        throw new Error('The office server returned an invalid response.');
      }
      useServerConfigStore.getState().configure({ wsPath: data.wsPath, authenticationRequired: data.required });
      setStatus(data.authenticated ? 'ready' : 'login');
      setMessage('');
    } catch (err) {
      if (signal?.aborted) return;
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Cannot reach the office server.');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    const expired = () => { setStatus('login'); setMessage('Your session ended. Sign in to reconnect.'); };
    window.addEventListener('jobs:authentication-required', expired);
    return () => {
      controller.abort();
      window.removeEventListener('jobs:authentication-required', expired);
    };
  }, [check]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      setToken('');
      if (!response.ok) {
        setMessage(response.status === 429 ? 'Too many attempts. Try again in a minute.'
          : response.status === 401 ? 'That access token did not match. Try again.' : 'Sign-in failed. Try again.');
        return;
      }
      await check();
    } catch {
      setMessage('Cannot reach the office server. Check the connection and retry.');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'ready') return children;
  return <main className="auth-page">
    <div className="auth-card">
      <div className="auth-wordmark">J.O.B.S.</div>
      <h1>{status === 'login' ? 'Welcome to your office' : status === 'loading' ? 'Connecting to your office' : 'Office unavailable'}</h1>
      {status === 'login' ? <>
        <p>Enter the access token configured for this office.</p>
        <form onSubmit={signIn}>
          <label htmlFor="access-token">Access token</label>
          <input id="access-token" type="password" autoComplete="current-password" value={token}
            onChange={event => setToken(event.target.value)} required disabled={submitting}
            aria-describedby={message ? 'auth-message' : undefined} />
          <button disabled={submitting}>{submitting ? 'Signing in…' : 'Open office'}</button>
        </form>
      </> : <p>{status === 'loading' ? 'Checking the connection…' : 'Start the J.O.B.S. server and try again.'}</p>}
      {message && <p id="auth-message" role="alert">{message}</p>}
      {status === 'error' && <button onClick={() => { setStatus('loading'); void check(); }}>Retry connection</button>}
    </div>
  </main>;
}
