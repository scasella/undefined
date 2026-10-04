import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { codexService } from './server/codexPlugin';

// base './' so `npm run build` output works from any path (GitHub Pages project sites).
// The Codex generation service is dev-server middleware only: it is absent from the
// static build, which therefore runs in replay mode.
export default defineConfig({
  base: './',
  plugins: [preact(), codexService()],
  worker: { format: 'es' },
  optimizeDeps: { include: ['typescript', 'fast-check'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
