// node scripts/eject-check.mjs (npm run check:eject) — proves an ejected function runs on its own.
// 1. scripts/build.eject.ts (under vitest, with the app's own compile gate, gate executor and src/eject) ejects the
//    committed function of every session of every shipped recording into .tmp/eject-check/out/<label>/.
// 2. A FRESH project in the OS temp dir (outside this repo, so nothing resolves from its node_modules): its own
//    package.json with only vitest, fast-check and typescript at this repo's versions, `npm install`, a strict
//    tsconfig. Each eject folder is copied in and run with `npx vitest run <folder>`; `tsc --noEmit` is reported too.
// Needs network access to the npm registry (or a warm npm cache). Exits non-zero when any eject's tests fail.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.tmp', 'eject-check', 'out');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const t0 = Date.now();

console.log('building eject folders from public/recordings …');
execFileSync(npx, ['vitest', 'run', '--configLoader', 'runner', '--config', 'scripts/vitest.eject.config.ts'], { cwd: ROOT, stdio: 'inherit' });
const { versions, rows } = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));

const project = mkdtempSync(join(tmpdir(), 'undefined-eject-'));
let failed = 0;
try {
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify(
      { name: 'eject-check', private: true, type: 'module', devDependencies: { vitest: versions.vitest, 'fast-check': versions.fastCheck, typescript: versions.typescript } },
      null,
      2,
    ),
  );
  const tsconfig = {
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2022'], strict: true, skipLibCheck: true, noEmit: true, types: [] },
  };
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  console.log(`fresh project: ${project}\nnpm install vitest@${versions.vitest} fast-check@${versions.fastCheck} typescript@${versions.typescript} …`);
  execFileSync(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: project, stdio: 'inherit' });

  const table = [];
  for (const row of rows) {
    const dir = join(project, row.label);
    cpSync(join(OUT, row.label), dir, { recursive: true });
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ extends: '../tsconfig.json', include: ['*.ts'] }, null, 2));
    const report = join(project, `${row.label}.json`);
    const v = spawnSync(npx, ['vitest', 'run', `${row.label}/`, '--reporter=json', `--outputFile=${report}`], { cwd: project, encoding: 'utf8' });
    let passed = 0, failedTests = 0, todo = 0, total = 0;
    try {
      const r = JSON.parse(readFileSync(report, 'utf8'));
      passed = r.numPassedTests;
      failedTests = r.numFailedTests;
      todo = r.numTodoTests;
      total = r.numTotalTests;
    } catch {
      /* no report: counted as a failure below */
    }
    const tsc = spawnSync(npx, ['tsc', '--noEmit', '-p', join(row.label, 'tsconfig.json')], { cwd: project, encoding: 'utf8' });
    const tscErrors = (tsc.stdout.match(/error TS\d+/g) ?? []).length;
    const ran = row.unitTests + row.pinned + row.properties;
    // unit tests a decision replaced are skipped in the eject (as in the app): reported, never counted as passed
    const skipped = row.skipped ?? 0;
    const ok = tscErrors === 0 && v.status === 0 && failedTests === 0 && (ran === 0 ? todo === 1 : passed + skipped === total && passed === ran);
    if (!ok) {
      failed++;
      console.log(`\n${row.label}: vitest exit ${v.status}\n${(v.stdout + v.stderr).slice(-3000)}`);
    }
    if (tscErrors > 0) console.log(`\n${row.label}: tsc reported ${tscErrors} error(s)\n${tsc.stdout.slice(0, 2000)}`);
    table.push({
      eject: row.label,
      function: row.fn,
      'unit/pinned/props': `${row.unitTests}/${row.pinned}/${row.properties}`,
      vitest: ran === 0 ? `${todo} todo (no tests)` : `${passed}/${total} passed${row.skipped ? ` (${row.skipped} skipped: replaced by a decision)` : ''}`,
      tsc: tscErrors === 0 ? 'clean' : `${tscErrors} errors`,
      result: ok ? 'PASS' : 'FAIL',
    });
  }
  console.table(table);
  console.log(`${table.length - failed}/${table.length} ejects pass in a fresh project (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
} finally {
  if (process.env.KEEP_EJECT_PROJECT) console.log(`kept ${project}`);
  else rmSync(project, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
