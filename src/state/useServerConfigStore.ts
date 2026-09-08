import { create } from 'zustand';

interface ServerConfig {
  wsPath: string;
  authenticationRequired: boolean;
  configure: (config: { wsPath: string; authenticationRequired: boolean }) => void;
}

export const useServerConfigStore = create<ServerConfig>((set) => ({
  wsPath: '/ws',
  authenticationRequired: false,
  configure: (config) => set(config),
}));
