/**
 * Entry of the bundled Action (dist/index.js). Certifies code, never generates it; the only network access is the
 * GitHub API call that creates or updates the one comment (src/github.ts).
 */
import { run } from './main';
import { actionHost, certifiedBy } from './host';

const code = await run(process.env, {
  fetch: globalThis.fetch,
  out: (line) => process.stdout.write(`${line}\n`),
  log: (line) => process.stderr.write(`${line}\n`),
  createHost: actionHost,
  certifiedBy,
});
process.exitCode = code;
