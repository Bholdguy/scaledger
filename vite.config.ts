import { defineConfig } from 'vite';

/**
 * The functional dashboard is served at /app (not /) — the landing page owns / on the
 * deployed Express server. `base` makes every built asset URL (and dev-server request)
 * resolve under /app/ so the app works identically at its new mount point.
 */
export default defineConfig({
  base: '/app/',
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
  },
});
