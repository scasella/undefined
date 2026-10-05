// Run the CLI from its TypeScript source (no build): `node packages/cli/scripts/dev.mjs certify <file> …`.
// Uses Vite's module runner to load src/run.ts and the engine's TypeScript source; the gate harness is bundled on
// first use. For development only: the published CLI is dist/cli.js (scripts/build.mjs).
import { createServer, createServerModuleRunner } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
let code = 3;
try {
  const { main } = await runner.import('/src/run.ts');
  code = await main(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    cwd: process.cwd(),
    progress: process.stderr.isTTY === true,
  });
} finally {
  await runner.close();
  await server.close();
}
process.exitCode = code;
