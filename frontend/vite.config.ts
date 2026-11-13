import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../backend/src/shared'),
    },
  },
  build: {
    // Build into the backend's public folder so Express can serve it
    outDir: '../backend/public',
    emptyOutDir: true,
  },
  server: {
    port: 3001,
    strictPort: true,
    host: true, // bind to 0.0.0.0 so LAN devices can reach the dev server
    proxy: {
      '/api': 'http://127.0.0.1:3002',
      '/media': 'http://127.0.0.1:3002',
      '/socket.io': { target: 'http://127.0.0.1:3002', ws: true },
    },
  },
});
