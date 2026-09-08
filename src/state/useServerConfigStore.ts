import { create } from 'zustand';

interface ServerConfig {
  wsPath: string;
  authenticationRequired: boolean;
  demoMode: boolean;
  configure: (config: { wsPath: string; authenticationRequired: boolean; demoMode: boolean }) => void;
}

export const useServerConfigStore = create<ServerConfig>((set) => ({
  wsPath: '/ws',
  authenticationRequired: false,
  demoMode: false,
  configure: (config) => set(config),
}));
