// Check the BUILT CLI (dist/cli.js + worker.mjs + harness.js) as a subprocess, the way `npx` runs it:
//   - each example project exits with its code (passing 0, rejected 1, spec-gap 2) and a missing file exits 3;
//   - its --json document equals the snapshot the in-process tests (from source) committed in test/__snapshots__,
//     with timestamps, durations and versions replaced the same way (test/helpers.ts stable()).
// So the bundle, the prebuilt harness and the copied worker certify exactly like the TypeScript source.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
for (const f of ['cli.js', 'worker.mjs', 'harness.js']) {
  if (!existsSync(fileURLToPath(new URL(`../dist/${f}`, import.meta.url)))) {
    console.error(`dist/${f} is missing: run npm run build:cli first`);
    process.exit(1);
  }
}

const VOLATILE = new Set(['ms', 'at', 'ejectedAt', 'committedAt']);
const VERSIONS = new Set(['version', 'node', 'v8', 'icu', 'typescript', 'fastCheck']);
function stable(doc, parent = '') {
  if (Array.isArray(doc)) return doc.map((x) => stable(x, parent));
  if (doc && typeof doc === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(doc)) {
      if (VOLATILE.has(k) && (typeof v === 'number' || typeof v === 'string')) out[k] = `<${k}>`;
      else if ((parent === 'tool' || parent === 'certifiedBy') && VERSIONS.has(k)) out[k] = `<${k}>`;
      else out[k] = stable(v, k);
    }
    return out;
  }
  return doc;
}

let failed = 0;
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: {}, timeout: 120_000 });

for (const [example, file, code] of [
  ['passing', 'src/clamp.ts', 0],
  ['rejected', 'src/leap.ts', 1],
  ['spec-gap', 'src/stats.ts', 2],
]) {
  const cwd = fileURLToPath(new URL(`../examples/${example}/`, import.meta.url));
  const human = run(['certify', file], cwd);
  const json = run(['certify', file, '--json'], cwd);
  const snapshot = readFileSync(new URL(`../test/__snapshots__/${example}.json`, import.meta.url), 'utf8');
  let same = false;
  try {
    same = `${JSON.stringify(stable(JSON.parse(json.stdout)), null, 2)}\n` === snapshot;
  } catch {
    same = false;
  }
  const ok = human.status === code && json.status === code && same;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${example}: exit ${human.status}/${json.status} (want ${code}), --json ${same ? 'matches' : 'DIFFERS from'} the source snapshot`);
  if (!ok) console.log(human.stdout, human.stderr, json.stderr);
}

const missing = run(['certify', 'missing.ts'], fileURLToPath(new URL('../examples/', import.meta.url)));
const okMissing = missing.status === 3;
if (!okMissing) failed++;
console.log(`${okMissing ? 'PASS' : 'FAIL'}  missing file: exit ${missing.status} (want 3)`);

const help = run(['--help'], process.cwd());
const okHelp = help.status === 0 && help.stdout.includes('NOT a secure sandbox');
if (!okHelp) failed++;
console.log(`${okHelp ? 'PASS' : 'FAIL'}  --help: exit ${help.status}`);

process.exit(failed === 0 ? 0 : 1);
