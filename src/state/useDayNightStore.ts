import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';

interface DayNightState {
  enabled: boolean;
  toggleEnabled: () => void;
}

const STORAGE_KEY = 'jobs-daynight';

function loadPersistedState(): { enabled: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      };
    }
  } catch { /* ignore localStorage errors */ }
  return { enabled: true };
}

function persist(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled }));
  } catch { /* ignore localStorage errors */ }
}

const initial = loadPersistedState();

export const useDayNightStore = create<DayNightState>()(
  subscribeWithSelector(devtools(
    (set, get) => ({
      enabled: initial.enabled,

      toggleEnabled: () => {
        const next = !get().enabled;
        set({ enabled: next });
        persist(next);
      },
    }),
    { name: 'daynight' },
  )),
);
