import { create } from 'zustand';

interface ConnectionState {
  status: 'connecting' | 'connected' | 'disconnected';
  setStatus: (status: ConnectionState['status']) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'connecting',
  setStatus: (status) => set({ status }),
}));
