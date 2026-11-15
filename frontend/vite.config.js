import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite';
import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:5030',
    changeOrigin: true,
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim();
  if (apiBaseUrl && !/^https:\/\/[^\s]+\/api\/?$/.test(apiBaseUrl)) {
    throw new Error('VITE_API_BASE_URL must be an HTTPS URL ending in /api.');
  }
  return ({
  plugins: [react()],
  base: mode === 'desktop' ? './' : '/',
  define: {
    __API_BASE_URL__: JSON.stringify(
      mode === 'desktop' ? 'http://127.0.0.1:5031/api' : (apiBaseUrl || '/api'),
    ),
  },
  build: {
    outDir: mode === 'web' ? 'dist-web' : 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
    proxy: apiProxy,
  },
  });
});
