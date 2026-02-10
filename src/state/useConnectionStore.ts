import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface ConnectionState {
  status: 'connecting' | 'connected' | 'disconnected';
  setStatus: (status: ConnectionState['status']) => void;
}

export const useConnectionStore = create<ConnectionState>()(
  devtools(
    (set) => ({
      status: 'connecting',
      setStatus: (status) => set({ status }),
    }),
    { name: 'connection' },
  ),
);
