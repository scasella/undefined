import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
// Used by scripts/eject-check.mjs: builds the eject folders of the shipped recordings with the app's own code.
// root: apps/site, so `-c apps/site/scripts/<this file>` also works from the repository root.
export default defineConfig({ root: fileURLToPath(new URL('..', import.meta.url)), test: { environment: 'node', include: ['scripts/*.eject.ts'], setupFiles: ['src/gates/libs.ts'], testTimeout: 120_000 } });
