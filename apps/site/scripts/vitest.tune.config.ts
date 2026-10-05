import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
// root: apps/site, so `-c apps/site/scripts/<this file>` also works from the repository root.
export default defineConfig({ root: fileURLToPath(new URL('..', import.meta.url)), test: { environment: 'node', include: ['scripts/*.tune.ts'], setupFiles: ['src/gates/libs.ts'], testTimeout: 900_000 } });
