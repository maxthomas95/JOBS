import { create } from 'zustand';

type MotionPreference = 'system' | 'reduced';
const systemMotion = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)');
function readMotion(): MotionPreference {
  try { return localStorage.getItem('jobs-motion') === 'reduced' ? 'reduced' : 'system'; } catch { return 'system'; }
}
export const useMotionStore = create<{ preference: MotionPreference; setPreference: (value: MotionPreference) => void }>((set) => ({
  preference: readMotion(),
  setPreference: (preference) => {
    try { localStorage.setItem('jobs-motion', preference); } catch { /* Preferences remain available in memory. */ }
    set({ preference });
  },
}));
export function prefersReducedMotion(): boolean {
  return useMotionStore.getState().preference === 'reduced' || (systemMotion?.matches ?? false);
}
