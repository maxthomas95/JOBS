import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { DEFAULT_THEME, getThemeById, THEMES } from '../themes.js';
import type { Theme } from '../themes.js';

interface ThemeState {
  theme: Theme;
  setTheme: (id: string) => void;
  cycleTheme: () => void;
}

const STORAGE_KEY = 'jobs-theme';

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return getThemeById(saved);
  } catch {
    // ignore
  }
  return DEFAULT_THEME;
}

export const useThemeStore = create<ThemeState>()(
  subscribeWithSelector(
    devtools(
      (set, get) => ({
        theme: loadTheme(),

        setTheme: (id: string) => {
          const theme = getThemeById(id);
          localStorage.setItem(STORAGE_KEY, theme.id);
          set({ theme }, false, 'setTheme');
        },

        cycleTheme: () => {
          const currentIdx = THEMES.findIndex((t) => t.id === get().theme.id);
          const nextIdx = (currentIdx + 1) % THEMES.length;
          const theme = THEMES[nextIdx];
          localStorage.setItem(STORAGE_KEY, theme.id);
          set({ theme }, false, 'cycleTheme');
        },
      }),
      { name: 'ThemeStore' },
    ),
  ),
);
