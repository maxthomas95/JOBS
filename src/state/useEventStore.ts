import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { PixelEvent } from '../types/events.js';

interface EventState {
  events: PixelEvent[];
  addEvent: (event: PixelEvent) => void;
}

export const useEventStore = create<EventState>()(
  devtools(
    (set) => ({
      events: [],
      addEvent: (event) => {
        set((state) => {
          const next = [event, ...state.events].slice(0, 50);
          return { events: next };
        });
      },
    }),
    { name: 'events' },
  ),
);
