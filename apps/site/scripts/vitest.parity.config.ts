import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
// Used by `npm run check:parity` (after `npm run build:cli`): scripts/cli.parity.ts spawns the BUILT CLI on every recorded
// candidate and compares with the browser measurement. Not in `npm test` (the CLI bundle is a build output).
// root: apps/site, so `-c apps/site/scripts/<this file>` also works from the repository root.
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: { name: 'parity-cli', environment: 'node', include: ['scripts/*.parity.ts'], setupFiles: ['src/gates/libs.ts'], testTimeout: 600_000, fileParallelism: false },
});
