import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The dock talks to the control plane through `/cp` in development (no CORS needed);
// for a deployed dock set VITE_CONTROL_PLANE_URL and add the dock origin to
// CONTROL_PLANE_ALLOWED_ORIGINS on the control plane.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env': {}, global: 'globalThis' },
  resolve: { alias: { '@control-plane': path.resolve(__dirname, '../control-plane/src') } },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(__dirname, '..')] },
    proxy: { '/cp': { target: process.env.CONTROL_PLANE_URL ?? 'http://127.0.0.1:8787', changeOrigin: true, rewrite: (p) => p.replace(/^\/cp/, '') } },
  },
  preview: {
    port: 4173,
    proxy: { '/cp': { target: process.env.CONTROL_PLANE_URL ?? 'http://127.0.0.1:8787', changeOrigin: true, rewrite: (p) => p.replace(/^\/cp/, '') } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 4000 },
});
