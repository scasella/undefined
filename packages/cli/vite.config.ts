/**
 * Build for publish (docs/WORKSPACE-DESIGN.md §1.5): src/bin.ts → dist/cli.js, one ESM file for Node 20+, with the
 * engine and fast-check inlined. `typescript` stays external (a real dependency: the compile gate's lib .d.ts files
 * must come from the same install). `rolldown` stays external and undeclared: the engine only reaches for it when no
 * prebuilt harness is shipped, and dist/harness.js always is (scripts/build.mjs).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const fastCheck = (createRequire(import.meta.url)('fast-check/package.json') as { version: string }).version;

export default defineConfig({
  logLevel: 'warn',
  publicDir: false,
  define: {
    __UNDEFINED_CLI_VERSION__: JSON.stringify(pkg.version),
    __UNDEFINED_FAST_CHECK_VERSION__: JSON.stringify(fastCheck),
  },
  ssr: { noExternal: true, external: ['typescript', 'rolldown'], target: 'node' },
  build: {
    ssr: 'src/bin.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    copyPublicDir: false,
    rollupOptions: {
      external: ['typescript', 'rolldown', /^node:/],
      output: { entryFileNames: 'cli.js', format: 'es', banner: '#!/usr/bin/env node', codeSplitting: false },
    },
  },
});
