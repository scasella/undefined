/** certifyFile on real files: discovery next to the source, vitest ingestion, the Node host with its watchdog. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { certifyFile, discoverSpec, refersTo, specCandidates } from './certifyFile';
import { createNodeGateHost, type NodeGateHost } from './host';

let dir: string;
let host: NodeGateHost;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'undefined-certify-'));
  host = await createNodeGateHost();
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('discovery', () => {
  it('looks for <name>.undefined.json, then vitest files next to the source and in __tests__, first match wins', () => {
    expect(specCandidates('/p/src/stats.ts')).toEqual([
      '/p/src/stats.undefined.json',
      '/p/src/stats.test.ts',
      '/p/src/stats.spec.ts',
      '/p/src/__tests__/stats.test.ts',
      '/p/src/__tests__/stats.spec.ts',
    ]);
    expect(discoverSpec('/p/src/stats.ts', (p) => p.endsWith('.spec.ts') || p.includes('__tests__'))).toBe('/p/src/stats.spec.ts');
    expect(discoverSpec('/p/src/stats.ts', () => false)).toBeNull();
  });

  it('resolves the test file\'s import of the source with or without an extension', () => {
    expect(refersTo('/p/src/__tests__/stats.test.ts', '../stats', '/p/src/stats.ts')).toBe(true);
    expect(refersTo('/p/src/stats.test.ts', './stats.js', '/p/src/stats.ts')).toBe(true);
    expect(refersTo('/p/src/stats.test.ts', './other', '/p/src/stats.ts')).toBe(false);
    expect(refersTo('/p/src/stats.test.ts', 'stats', '/p/src/stats.ts')).toBe(false);
  });
});

describe('certifyFile', () => {
  it('certifies a file against the vitest file it discovers, under the real watchdog', async () => {
    await mkdir(join(dir, '__tests__'), { recursive: true });
    await writeFile(
      join(dir, 'fib.ts'),
      `/** The nth Fibonacci number, exactly. */\nexport function fib(n: number): bigint {\n  let a = 0n, b = 1n;\n  for (let i = 0; i < n; i++) [a, b] = [b, a + b];\n  return a;\n}\n\nexport function slowFib(n: number): number {\n  return n < 2 ? n : slowFib(n - 1) + slowFib(n - 2);\n}\n`,
    );
    await writeFile(
      join(dir, '__tests__', 'fib.test.ts'),
      `import { it, expect } from 'vitest';\nimport { fib, slowFib } from '../fib';\nit('small', () => { expect(fib(10)).toBe(55n); });\nit('big', () => { expect(fib(90)).toBe(2880067194370816120n); });\nit('slow', () => { expect(slowFib(40)).toBe(102334155); });\n`,
    );
    const r = await certifyFile({ file: join(dir, 'fib.ts'), host, mutation: false, defaultBudgetMs: 300 });
    expect(r.specFile).toBe(join(dir, '__tests__', 'fib.test.ts'));
    expect(r.issues).toEqual([]);
    expect(r.functions.map((f) => [f.name, f.verdict, f.rejectedBy ?? '', f.headline ?? ''])).toEqual([
      ['fib', 'accepted', '', ''],
      ['slowFib', 'rejected', 'invariants', 'Rejected: slowFib(40) did not return within 300 ms (bounded)'],
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.certifiedBy).toMatchObject({ node: process.versions.node, v8: process.versions.v8 });
  });
});
