import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { StatsSummary } from '../types/events.js';

interface StatsState {
  stats: StatsSummary | null;
  updateStats: (stats: StatsSummary) => void;
}

export const useStatsStore = create<StatsState>()(
  devtools(
    (set) => ({
      stats: null,
      updateStats: (stats) => set({ stats }),
    }),
    { name: 'stats-store' },
  ),
);
