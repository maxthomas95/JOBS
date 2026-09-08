import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const backend = `http://127.0.0.1:${env.PORT || '8780'}`;
  const wsPath = env.WS_PATH || '/ws';
  return {
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: backend, ws: wsPath.startsWith('/api') },
      [wsPath]: { target: backend, ws: true },
    },
  },
  };
});
