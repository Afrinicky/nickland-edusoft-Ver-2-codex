// Nickland Edusoft — building the office application for a browser.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Same source as the installed application. Same components, same routes, same
// screens — src/renderer, exactly as vite.config.js builds it for Electron.
// This produces the copy a browser loads, served by the school's own computer
// at /desk (see electron/server/webapp.js) or hosted.
//
// Nothing here forks the application. If it ever needs to, that is the signal
// that something has been done the wrong way round.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { apiSurfaceAsModule } from './scripts/vite-api-surface.mjs';

export default defineConfig({
  plugins: [apiSurfaceAsModule(), react()],

  // Served from /desk on the school's computer. A relative base would break
  // the moment a client-side route has a second segment (/desk/students/7),
  // because the browser would look for the bundle under /desk/students/.
  base: process.env.EDUSOFT_DESK_BASE || '/desk/',

  root: 'src/renderer',
  build: {
    outDir: '../../dist-desk',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/desk.html'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer/src'),
    },
  },
});
