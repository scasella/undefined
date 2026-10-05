/**
 * The committed bundle: it matches its sources (harness and worker byte for byte; `npm run check:action-dist` rebuilds
 * and diffs the rest), it carries no machine-specific paths, and it runs from a copy with no node_modules anywhere
 * above it, the way an Action runs from its checkout.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleHarness } from '@scasella/undefined-engine/node';
import { MARKER } from '../src/comment';
import { makeRepo } from './helpers';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(pkg, 'dist');
const cleanup: Array<() => void> = [];
afterAll(() => cleanup.forEach((f) => f()));

describe('dist/', () => {
  it('harness.js is the engine harness bundle and worker.mjs the engine worker, byte for byte', async () => {
    // region comments name modules relative to the bundler's working directory (the build runs from packages/action)
    const code = (s: string): string => s.replace(/^\/\/#(?:end)?region.*$/gm, '');
    expect(code(readFileSync(join(dist, 'harness.js'), 'utf8'))).toBe(code(await bundleHarness()));
    expect(readFileSync(join(dist, 'worker.mjs'), 'utf8')).toBe(readFileSync(join(pkg, '..', 'engine', 'src', 'node', 'worker.mjs'), 'utf8'));
    expect(JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8'))).toMatchObject({ type: 'module' });
  });

  it('carries no absolute paths from the machine that built it', () => {
    for (const f of ['index.js', 'harness.js']) {
      const text = readFileSync(join(dist, f), 'utf8');
      expect(text.includes(join(pkg, '..', '..'))).toBe(false); // the repository root
      expect(text.includes(tmpdir())).toBe(false);
      expect(/(?<![\w.])\/Users\/|\/home\/runner\//.test(text)).toBe(false);
    }
  });

  it('runs from a copy with no node_modules: a dry run certifies a function and prints the comment', () => {
    const where = mkdtempSync(join(tmpdir(), 'undefined-action-dist-'));
    cleanup.push(() => rmSync(where, { recursive: true, force: true }));
    cpSync(dist, join(where, 'dist'), { recursive: true });
    const repo = makeRepo();
    cleanup.push(() => repo.remove());
    repo.write({ 'src/sum.ts': 'export function noop(): void {\n}\n' });
    repo.commit('base');
    repo.write({
      'src/sum.ts': 'export function sum(xs: number[]): number {\n  let t = 0;\n  for (const x of xs) t += x;\n  return t;\n}\n',
      'src/sum.test.ts': "import { it, expect } from 'vitest';\nimport { sum } from './sum';\nit('adds', () => { expect(sum([1, 2, 3])).toBe(6); });\nit('empty', () => { expect(sum([])).toBe(0); });\n",
    });
    repo.commit('pr');
    const out = execFileSync(process.execPath, [join(where, 'dist', 'index.js')], {
      cwd: repo.dir,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', UNDEFINED_DRY_RUN: '1', UNDEFINED_BASE: 'main~1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out.startsWith(MARKER)).toBe(true);
    expect(out).toContain('| `sum` `src/sum.ts:1` | accepted | Compiled. 2 unit tests.');
    expect(out).toMatch(/Tests killed \d+ of \d+ mutants/);
  });
});
