import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { audioManager } from '../audio/AudioManager.js';

interface AudioState {
  enabled: boolean;
  volume: number;
  toggleEnabled: () => void;
  setVolume: (volume: number) => void;
}

// Restore persisted preferences
const STORAGE_KEY = 'jobs-audio';

function loadPersistedState(): { enabled: boolean; volume: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
        volume: typeof parsed.volume === 'number' ? parsed.volume : 50,
      };
    }
  } catch {}
  return { enabled: false, volume: 50 };
}

function persist(enabled: boolean, volume: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, volume }));
  } catch {}
}

const initial = loadPersistedState();

// Sync initial state to AudioManager
audioManager.enabled = initial.enabled;
audioManager.volume = initial.volume / 100;

// If audio was persisted as enabled, unlock AudioContext on first user interaction
// (browsers require a gesture before creating/resuming an AudioContext)
if (initial.enabled && typeof document !== 'undefined') {
  const unlockOnGesture = () => {
    audioManager.unlock();
    document.removeEventListener('click', unlockOnGesture);
    document.removeEventListener('keydown', unlockOnGesture);
  };
  document.addEventListener('click', unlockOnGesture, { once: true });
  document.addEventListener('keydown', unlockOnGesture, { once: true });
}

export const useAudioStore = create<AudioState>()(
  devtools(
    (set, get) => ({
      enabled: initial.enabled,
      volume: initial.volume,

      toggleEnabled: () => {
        const next = !get().enabled;
        // Unlock AudioContext on first enable (user gesture required)
        if (next) {
          audioManager.unlock();
        }
        audioManager.enabled = next;
        set({ enabled: next });
        persist(next, get().volume);
      },

      setVolume: (volume: number) => {
        const clamped = Math.max(0, Math.min(100, volume));
        audioManager.volume = clamped / 100;
        set({ volume: clamped });
        persist(get().enabled, clamped);
      },
    }),
    { name: 'audio' },
  ),
);
