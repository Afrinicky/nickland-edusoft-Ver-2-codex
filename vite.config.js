import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { apiSurfaceAsModule } from './scripts/vite-api-surface.mjs';

export default defineConfig({
  // The installed window's own build. It reaches electron/api-surface.js the
  // same way the browser build does — src/renderer/src/main.jsx installs the
  // network transport, which returns immediately when the preload script has
  // already put `window.api` on the window, as it has here. One config
  // behaviour for one file, so the two builds cannot disagree about it.
  plugins: [apiSurfaceAsModule(), react()],
  base: './',
  root: 'src/renderer',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer/src'),
    },
  },
});
