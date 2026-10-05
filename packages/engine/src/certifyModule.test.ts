/**
 * certify({ source, spec }) end to end with the REAL compiler and the REAL gate executor, in-process (no watchdog:
 * node/certifyFile.test.ts and apps/site/src/examples/parity.node.test.ts run the Node host with its watchdog).
 */
import { describe, expect, it } from 'vitest';
import type { GateResult } from './types';
import { executeGates } from './sandbox/gateExecutor';
import type { ExecGateInput } from './sandbox/gateRunner';
import { exitCodeFor, type GateHost } from './certify';
import { certify, type CertifyInput } from './certifyModule';

const inProcess: GateHost = {
  execGates: async (input: ExecGateInput, onGate?: (r: GateResult) => void) =>
    executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) }),
  now: () => Date.UTC(2026, 9, 5),
};
const fromStats = (s: string): boolean => s === './stats';
const run = (source: string, spec?: CertifyInput['spec'], extra: Partial<CertifyInput> = {}) =>
  certify({ source, sourceFile: 'stats.ts', host: inProcess, mutation: { timeBoxMs: 20_000 }, ...(spec ? { spec } : {}), ...extra });
const vitest = (text: string): CertifyInput['spec'] => ({ kind: 'vitest', text, file: 'stats.test.ts', isSourceModule: fromStats });

const MEDIAN = `/** Returns the median of a list of numbers. */
export function median(numbers: number[]): number {
  const s = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
`;
const MEDIAN_TESTS = `import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { median } from './stats';

describe('median', () => {
  it('odd', () => { expect(median([3, 1, 2])).toBe(2); });
  it('even', () => { expect(median([4, 1, 3, 2])).toBe(2.5); });
  it('between min and max', () => {
    fc.assert(fc.property(fc.array(fc.integer(), { minLength: 1 }), (xs) => {
      const m = median(xs);
      expect(m).toBeGreaterThanOrEqual(Math.min(...xs));
      expect(m).toBeLessThanOrEqual(Math.max(...xs));
    }));
  });
});
`;

describe('certify: a vitest test file as the spec', () => {
  it('accepts a correct function: evidence line, mutation buckets and provenance in the eject format', async () => {
    const r = await run(MEDIAN, vitest(MEDIAN_TESTS));
    expect(r.issues).toEqual([]);
    expect(r.exitCode).toBe(0);
    const f = r.functions[0]!;
    expect(f.verdict).toBe('accepted');
    expect(f.gates.map((g) => `${g.gate}:${g.status}`)).toEqual(['compile:pass', 'tests:pass', 'properties:pass', 'invariants:pass']);
    expect(f.evidenceLine).toMatch(/^Compiled\. 2 unit tests\. 1 property, 100 runs\. \d+ calls replayed for purity\. Tests killed \d+ of \d+ mutants/);
    expect(f.mutation!.total).toBeGreaterThan(0);
    expect(f.mutation!.killed + f.mutation!.killedByBound + f.mutation!.survived).toBe(f.mutation!.total);
    expect(f.provenance).toMatchObject({ format: 'undefined-eject', version: 1, function: 'median', model: null, codexVersion: null, specHash: f.specHash, evidenceLine: f.evidenceLine });
    expect((f.provenance!.candidates as Array<{ source: string; verdict: string }>)[0]).toMatchObject({ source: 'external', verdict: 'accepted' });
  });

  it('rejects a wrong function with the site-style headline (exit 1)', async () => {
    const wrong = MEDIAN.replace('(s[mid - 1]! + s[mid]!) / 2', 's[mid]!');
    const r = await run(wrong, vitest(MEDIAN_TESTS));
    expect(r.exitCode).toBe(1);
    expect(r.functions[0]).toMatchObject({ verdict: 'rejected', rejectedBy: 'tests', headline: 'Rejected: median([4, 1, 3, 2]) returned 3, expected 2.5' });
  });

  it('a relational matcher failure says what was expected, without claiming a returned value', async () => {
    const r = await run(MEDIAN.replace('return s.length', 'return 1000 + s.length'), vitest(MEDIAN_TESTS.replace(/it\('odd'.*\n/, '').replace(/it\('even'.*\n/, '')));
    expect(r.functions[0]!.rejectedBy).toBe('properties');
    expect(r.functions[0]!.headline).toMatch(/^Rejected: property "median > between min and max" failed after median\(\[.*\]\): expected \S+ to be (less|greater) than or equal to -?\d+$/);
    expect(r.functions[0]!.gapQuestions).toEqual([]);
  });

  it('a check marked @silentOn that fails only on the silent case is a spec gap (exit 2) with the question', async () => {
    const tests = `import { it, expect } from 'vitest';
import { median } from './stats';
it('odd', () => { expect(median([3, 1, 2])).toBe(2); });
/** @silentOn what the median of nothing is @reasonable Throwing on an empty list is also defensible. */
it('empty', () => { expect(median([])).toBe(0); });
`;
    const r = await run(MEDIAN, vitest(tests));
    expect(r.exitCode).toBe(2);
    const f = r.functions[0]!;
    expect(f.verdict).toBe('gaps');
    expect(f.headline).toBe('Rejected: median([]) returned NaN, expected 0');
    expect(f.gapQuestions).toHaveLength(1);
    expect(f.gapQuestions[0]).toMatchObject({ call: 'median([])', silentOn: 'what the median of nothing is', expectedShown: '0', actualShown: 'NaN', reasonable: 'Throwing on an empty list is also defensible.' });
  });

  it('an unsupported construct is "could not run" (exit 3), and nothing is certified on a partial spec', async () => {
    const r = await run(MEDIAN, vitest(`import { it, expect, beforeEach } from 'vitest';\nimport { median } from './stats';\nit('a', () => { expect(median([1])).toMatchInlineSnapshot(); });\n`));
    expect(r.exitCode).toBe(3);
    expect(r.issues.map((i) => i.line)).toEqual([1, 3]);
    expect(r.functions.map((f) => [f.verdict, f.reason])).toEqual([['could-not-run', 'stats.test.ts has constructs the gates cannot run (see the issues)']]);
  });
});

describe('certify: an undefined-spec file and the source rules', () => {
  const spec = (functions: unknown, extra: Record<string, unknown> = {}): CertifyInput['spec'] => ({
    kind: 'undefined-spec',
    text: JSON.stringify({ format: 'undefined-spec', version: 1, functions, ...extra }),
    file: 'stats.undefined.json',
  });

  it('runs the site Test API source and hands the first call to Invariants', async () => {
    const r = await run(MEDIAN, spec({ median: { tests: "test('odd', () => { eq(median([3, 1, 2]), 2); });", calls: [[[5, 1, 3]]] } }));
    expect(r.exitCode).toBe(0);
    expect(r.functions[0]!.evidenceLine).toMatch(/^Compiled\. 1 unit test\. No properties\. 2 calls replayed for purity\./);
  });

  it('a function with no checks is accepted as unchecked: only Compile (and Invariants on a call) ran', async () => {
    const r = await run('export function inc(n: number): number { return n + 1; }\n');
    expect(r.exitCode).toBe(0);
    expect(r.functions[0]).toMatchObject({ verdict: 'accepted', unchecked: true });
    expect(r.functions[0]!.gates.map((g) => `${g.gate}:${g.status}`)).toEqual(['compile:pass', 'tests:skipped', 'properties:skipped', 'invariants:skipped']);
    expect(r.functions[0]!.evidenceLine).toContain('No tests yet: nothing could kill a mutant');
  });

  it('a compile error is a rejection by Compile', async () => {
    const r = await run('export function inc(n: number): string { return n + 1; }\n');
    expect(r.functions[0]).toMatchObject({ verdict: 'rejected', rejectedBy: 'compile' });
    expect(r.exitCode).toBe(1);
  });

  it('a spec whose tests do not load is "could not run", never a rejection of the code', async () => {
    const r = await run(MEDIAN, spec({ median: { tests: 'test("x", () => { eq(median([1]), 1) ' } }));
    expect(r.functions[0]).toMatchObject({ verdict: 'could-not-run' });
    expect(r.exitCode).toBe(3);
  });

  it('a pin on a dataset that is not in the file is "could not run" (a spec is never silently weakened)', async () => {
    const pin = { id: 'p', label: 'median(rows)', args: [{ kind: 'dataset', name: 'rows', hash: 'b'.repeat(64) }], expected: 1, pinnedAt: 1 };
    const r = await run(MEDIAN, spec({ median: { pins: [pin] } }));
    expect(r.functions[0]!.verdict).toBe('could-not-run');
    expect(r.functions[0]!.reason).toContain(`needs dataset ${'b'.repeat(64)}`);
  });

  it('a spec entry for a function the file does not export is an issue (typos must not drop a spec)', async () => {
    const r = await run(MEDIAN, spec({ medain: { tests: '' } }));
    expect(r.issues.map((i) => i.message)).toEqual(['functions.medain: the source file exports no function medain the gates can certify']);
    expect(r.exitCode).toBe(3);
  });

  it('certifies same-file callees first and links them; a caller of a rejected callee is not run', async () => {
    const source = `export function inc(n: number): number { return n + 1; }
export function addTwo(n: number): number { return inc(inc(n)); }
`;
    const ok = await run(source, spec({ inc: { tests: "test('i', () => { eq(inc(1), 2); });" }, addTwo: { tests: "test('a', () => { eq(addTwo(1), 3); });" } }));
    expect(ok.functions.map((f) => [f.name, f.verdict, f.calls])).toEqual([
      ['inc', 'accepted', []],
      ['addTwo', 'accepted', ['inc']],
    ]);
    expect(ok.functions[1]!.evidenceLine).toContain('Checked together with inc, which it calls; only its own code was mutated.');
    const bad = await run(source.replace('n + 1', 'n + 2'), spec({ inc: { tests: "test('i', () => { eq(inc(1), 2); });" } }), { functions: ['addTwo'] });
    expect(bad.functions.map((f) => [f.name, f.verdict, f.reason ?? ''])).toEqual([
      ['inc', 'rejected', ''],
      ['addTwo', 'could-not-run', 'calls inc, which was not certified'],
    ]);
    expect(bad.exitCode).toBe(1);
  });
});

describe('exitCodeFor', () => {
  it('ranks rejected > could not run > gaps > accepted', () => {
    expect(exitCodeFor(['accepted', 'gaps', 'could-not-run', 'rejected'])).toBe(1);
    expect(exitCodeFor(['accepted', 'gaps', 'could-not-run'])).toBe(3);
    expect(exitCodeFor(['accepted', 'gaps'])).toBe(2);
    expect(exitCodeFor(['accepted'])).toBe(0);
    expect(exitCodeFor(['accepted'], true)).toBe(3);
    expect(exitCodeFor([])).toBe(3);
  });
});
