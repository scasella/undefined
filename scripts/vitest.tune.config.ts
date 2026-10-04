import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['scripts/*.tune.ts'], testTimeout: 900_000 } });
