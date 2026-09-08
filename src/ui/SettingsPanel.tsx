import { useEffect, useRef, useState } from 'react';
import { THEMES } from '../themes.js';
import { useThemeStore } from '../state/useThemeStore.js';
import { useAudioStore } from '../state/useAudioStore.js';
import { useDayNightStore } from '../state/useDayNightStore.js';
import { useOfficeStore } from '../state/useOfficeStore.js';
import { useMotionStore } from '../state/useMotionStore.js';
import { useServerConfigStore } from '../state/useServerConfigStore.js';
import { ProviderDiagnostics } from './ProviderDiagnostics.js';

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const audio = useAudioStore();
  const dayNight = useDayNightStore();
  const motion = useMotionStore();
  const notificationsEnabled = useOfficeStore((s) => s.notificationsEnabled);
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'unavailable' : Notification.permission);
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState('');
  const authenticationRequired = useServerConfigStore((s) => s.authenticationRequired);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, [open]);
  async function toggleNotifications() {
    if (typeof Notification === 'undefined') return;
    if (notificationsEnabled) { useOfficeStore.getState().toggleNotifications(); return; }
    setRequesting(true);
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') useOfficeStore.getState().toggleNotifications();
    } catch { setNotice('The browser could not enable notifications. Check this site’s permissions.'); }
    finally { setRequesting(false); }
  }
  async function signOut() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(7500) });
      if (!response.ok) throw new Error('Sign out failed');
      window.dispatchEvent(new Event('jobs:authentication-required'));
    } catch { setNotice('Could not sign out. Check the connection and try again.'); }
  }
  return <dialog className="settings-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="settings-heading">
    <div className="section-heading"><h2 id="settings-heading">Settings</h2><button className="icon-button" aria-label="Close settings" onClick={onClose}>×</button></div>
    <p className="muted">Make the office comfortable to keep open.</p>
    <section className="settings-section"><h3>Appearance</h3>
      <label className="setting-row" htmlFor="theme-choice"><span>Theme</span><select id="theme-choice" value={theme.id} onChange={(event) => setTheme(event.target.value)}>{THEMES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="setting-row" htmlFor="daynight-choice"><span>Day and night cycle<small>Office lighting follows the time of day.</small></span><input id="daynight-choice" type="checkbox" checked={dayNight.enabled} onChange={dayNight.toggleEnabled} /></label>
      <label className="setting-row" htmlFor="motion-choice"><span>Motion</span><select id="motion-choice" value={motion.preference} onChange={(event) => motion.setPreference(event.target.value as 'system' | 'reduced')}><option value="system">Use system preference</option><option value="reduced">Reduce motion</option></select></label>
    </section>
    <section className="settings-section"><h3>Sound and notifications</h3>
      <label className="setting-row" htmlFor="sound-choice"><span>Office sounds</span><input id="sound-choice" type="checkbox" checked={audio.enabled} onChange={audio.toggleEnabled} /></label>
      <label className="setting-row" htmlFor="volume-choice"><span>Volume <small>{audio.volume}%</small></span><input id="volume-choice" type="range" min="0" max="100" value={audio.volume} disabled={!audio.enabled} onChange={(event) => audio.setVolume(Number(event.target.value))} /></label>
      <div className="setting-row"><span>Input notifications<small>Alerts when a session needs you.</small></span><button disabled={requesting || notificationPermission === 'unavailable' || notificationPermission === 'denied'} aria-pressed={notificationsEnabled && notificationPermission === 'granted'} onClick={() => void toggleNotifications()}>{requesting ? 'Requesting…' : notificationsEnabled && notificationPermission === 'granted' ? 'Enabled' : 'Enable'}</button></div>
      {notificationPermission === 'denied' && <p className="inline-empty">Notifications are blocked. Allow them in this site's browser permissions to enable alerts.</p>}
      {notificationPermission === 'unavailable' && <p className="inline-empty">This browser does not support notifications here.</p>}
    </section>
    {open && <ProviderDiagnostics />}
    {authenticationRequired && <div className="settings-section"><button onClick={() => void signOut()}>Sign out</button></div>}
    {notice && <p className="inline-empty" role="status">{notice}</p>}
    <div className="settings-footer"><span className="muted">Changes apply immediately.</span><button onClick={onClose}>Done</button></div>
  </dialog>;
}
