import { defineConfig } from 'vitest/config';

// One `npm test` for the whole workspace. Each project keeps its own config: the site's test block lives in
// apps/site/vite.config.ts (it needs the site's plugins), the engine's, the CLI's and the Action's in their
// packages' vitest.config.ts.
export default defineConfig({
  test: { projects: ['apps/site', 'packages/engine', 'packages/cli', 'packages/action'] },
});
