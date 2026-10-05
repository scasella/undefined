/**
 * `undefined-certify` entry point (bundled to dist/cli.js). Certifies code; never generates it. No network access.
 * NOT a secure sandbox: the certified code runs in a Node worker_thread with a watchdog (see README.md).
 */
import { main } from './run';

const code = await main(process.argv.slice(2), {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  cwd: process.cwd(),
  progress: process.stderr.isTTY === true,
}).catch((e: unknown) => {
  process.stderr.write(`undefined-certify: could not run: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  return 3 as const;
});
// Let stdout drain (a pipe may be slow) before exiting with the verdict.
process.exitCode = code;
