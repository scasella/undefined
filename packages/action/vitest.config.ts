import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'action', environment: 'node', include: ['src/**/*.test.ts', 'test/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 },
});
