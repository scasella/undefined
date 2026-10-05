import { defineConfig } from 'vitest/config';
// Used by scripts/eject-check.mjs: builds the eject folders of the shipped recordings with the app's own code.
export default defineConfig({ test: { environment: 'node', include: ['scripts/*.eject.ts'], testTimeout: 120_000 } });
