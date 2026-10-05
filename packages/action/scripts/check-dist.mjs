// Is the committed dist/ what the sources build to? Rebuild into a temporary directory and compare file by file (the
// set of files and their bytes). In CI the working tree is the commit, so this is the "dist is up to date" check.
// Fix a failure with `npm run build:action` and commit packages/action/dist.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const committed = join(pkgDir, 'dist');
const fresh = mkdtempSync(join(tmpdir(), 'undefined-action-dist-'));
try {
  execFileSync(process.execPath, [join(pkgDir, 'scripts', 'build.mjs'), '--out', fresh], { stdio: 'inherit' });
  const list = (d) => {
    try {
      return readdirSync(d).sort();
    } catch {
      return [];
    }
  };
  const a = list(committed);
  const b = list(fresh);
  const problems = [];
  for (const f of new Set([...a, ...b])) {
    if (!a.includes(f)) problems.push(`${f}: missing from packages/action/dist`);
    else if (!b.includes(f)) problems.push(`${f}: in packages/action/dist but not built from the sources`);
    else if (!readFileSync(join(committed, f)).equals(readFileSync(join(fresh, f)))) problems.push(`${f}: differs from a fresh build`);
  }
  if (problems.length > 0) {
    console.error(`packages/action/dist is out of date:\n  ${problems.join('\n  ')}\nRun \`npm run build:action\` and commit packages/action/dist.`);
    process.exitCode = 1;
  } else {
    console.log(`packages/action/dist matches a fresh build (${a.length} files).`);
  }
} finally {
  rmSync(fresh, { recursive: true, force: true });
}
