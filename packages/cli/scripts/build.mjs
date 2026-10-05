// Build the publishable CLI into packages/cli/dist (docs/WORKSPACE-DESIGN.md §1.5, §4.6). No new build dependency:
// Vite 8 (already in the workspace) bundles the CLI, and the gate harness is produced by the engine's own
// bundleHarness() — the exact bundle the engine makes on demand — loaded through Vite's module runner.
//
//   dist/cli.js      the bin (ESM, Node 20+), engine + fast-check inlined, `typescript` external
//   dist/worker.mjs  the gate worker entry (engine node/worker.mjs, copied verbatim; only `node:` imports)
//   dist/harness.js  the in-realm gate harness (one IIFE: gate code + fast-check), evaluated inside a node:vm realm
import { chmod, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build, createServer, createServerModuleRunner } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = new URL('../dist/', import.meta.url);

await build({ root, configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)) });

// the engine is a workspace package (private, bundled): its worker entry is copied from the workspace
await copyFile(new URL('../../engine/src/node/worker.mjs', import.meta.url), new URL('worker.mjs', dist));

const server = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
try {
  const { bundleHarness } = await runner.import('@scasella/undefined-engine/node/harnessSource');
  await writeFile(new URL('harness.js', dist), await bundleHarness());
} finally {
  await runner.close();
  await server.close();
}

const cli = new URL('cli.js', dist);
const text = await readFile(cli, 'utf8');
if (!text.startsWith('#!/usr/bin/env node')) throw new Error('dist/cli.js has no shebang');
if (!text.includes('worker.mjs')) throw new Error('dist/cli.js does not refer to worker.mjs');
await chmod(cli, 0o755);
process.stdout.write('built dist/cli.js, dist/worker.mjs, dist/harness.js\n');
