import { defineConfig } from 'vitest/config';

// The CLI's tests run in-process (src/run.ts main()) against the engine's TypeScript source; the gate harness is
// bundled on first use per test file, so the first certification in each file gets a generous timeout.
export default defineConfig({
  test: { name: 'cli', environment: 'node', include: ['test/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 },
});
