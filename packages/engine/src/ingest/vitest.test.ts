import { beforeAll, describe, expect, it } from 'vitest';
import { transpileUserCode, warmUp } from '../gates/compile';
import { EXPECT_SHIM } from './expectShim';
import { ingestVitest } from './vitest';

beforeAll(() => warmUp());

const fromSource = (s: string): boolean => s === './stats' || s === './stats.ts';
const ingest = (text: string, fns: string[] = ['median', 'mean']) => ingestVitest(text, 'stats.test.ts', fns, fromSource);
const caseLines = (src: string): string => src.slice(EXPECT_SHIM.length).trim();
const messages = async (text: string): Promise<string[]> => (await ingest(text)).issues.map((i) => `${i.line ?? '-'}: ${i.message}`);

describe('ingestVitest: rewriting into the Test API', () => {
  it('flattens describe, keeps helpers, and attributes each test to the function it calls', async () => {
    const r = await ingest(`import { describe, it, expect } from 'vitest';
import { median, mean } from './stats';

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

describe('median', () => {
  it('odd length', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  describe('even', () => {
    it('averages the middle two', () => expect(median(sorted([4, 1]))).toEqual(2.5));
  });
});

it('mean of one', () => { expect(mean([5])).toBe(5); });
it.skip('later', () => { expect(median([])).toBeNaN(); });
`);
    expect(r.issues).toEqual([]);
    expect(Object.keys(r.byFunction).sort()).toEqual(['mean', 'median']);
    const m = r.byFunction.median!;
    expect(m.tests.startsWith(EXPECT_SHIM)).toBe(true);
    expect(caseLines(m.tests)).toBe(
      `const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

test("median > odd length", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

test("median > even > averages the middle two", () => expect(median(sorted([4, 1]))).toEqual(2.5));`,
    );
    expect(m.properties).toBe('');
    expect(m.skipped).toEqual(['later']);
    expect(caseLines(r.byFunction.mean!.tests)).toContain('test("mean of one", () => { expect(mean([5])).toBe(5); });');
    // the generated source is valid Test API code
    expect(transpileUserCode(m.tests).error).toBeUndefined();
  });

  it('turns fc.assert(fc.property(...)) and test.prop into properties; numRuns is kept, n asserts become "#n"', async () => {
    const r = await ingest(`import { it } from 'vitest';
import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { median } from './stats';

it('bounded', () => {
  fc.assert(fc.property(fc.array(fc.integer(), { minLength: 1 }), (xs) => median(xs) <= Math.max(...xs)), { numRuns: 50 });
});
it('two', () => {
  fc.assert(fc.property(fc.integer(), (n) => median([n]) === n));
  fc.assert(fc.property(fc.integer(), (n) => median([n, n]) === n));
});
test.prop([fc.integer()])('single', (n) => median([n]) === n);
`);
    expect(r.issues).toEqual([]);
    expect(caseLines(r.byFunction.median!.properties)).toBe(
      [
        'property("bounded", [fc.array(fc.integer(), { minLength: 1 })], (xs) => median(xs) <= Math.max(...xs), { numRuns: 50 });',
        'property("two #1", [fc.integer()], (n) => median([n]) === n);',
        'property("two #2", [fc.integer()], (n) => median([n, n]) === n);',
        'property("single", [fc.integer()], (n) => median([n]) === n);',
      ].join('\n\n'),
    );
    expect(r.byFunction.median!.tests).toBe('');
  });

  it('turns @silentOn / @reasonable JSDoc tags on a test into the gate marker', async () => {
    const r = await ingest(`import { it, expect } from 'vitest';
import { median } from './stats';
/**
 * @silentOn what the median of nothing is
 * @reasonable Throwing on an empty list is also defensible.
 */
it('empty', () => { expect(median([])).toBeNaN(); });
`);
    expect(caseLines(r.byFunction.median!.tests)).toBe(
      'test("empty", () => { expect(median([])).toBeNaN(); }, { silentOn: "what the median of nothing is", reasonable: "Throwing on an empty list is also defensible." });',
    );
  });

  it('maps an aliased import and a renamed fast-check', async () => {
    const r = await ingest(`import { it, expect } from 'vitest';
import * as f from 'fast-check';
import { median as m } from './stats';
it('a', () => { expect(m([1])).toBe(1); });
`);
    const src = r.byFunction.median!.tests;
    expect(src).toContain('const f = fc;');
    expect(src).toContain('const m = median;');
  });
});

describe('ingestVitest: loud refusals (exit 3, never a rejection)', () => {
  it('refuses hooks, mocks, snapshots, async, unsupported matchers and seeds, with lines', async () => {
    expect(
      await messages(`import { it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { median } from './stats';
import { readFileSync } from 'node:fs';
it('snap', () => { expect(median([1])).toMatchSnapshot(); });
it('async', async () => { expect(median([1])).toBe(1); });
it('seeded', () => { fc.assert(fc.property(fc.integer(), (n) => median([n]) === n), { seed: 42 }); });
it.only('only', () => { expect(median([1])).toBe(1); });
it('mixed', () => { const x = 1; fc.assert(fc.property(fc.integer(), (n) => median([n]) === n + x)); });
it('resolves', () => { expect(median([1])).resolves.toBe(1); });
`),
    ).toEqual([
      "1: vi from 'vitest' is not supported (only describe, it, test, expect)",
      "1: beforeEach from 'vitest' is not supported (only describe, it, test, expect)",
      "4: import from 'node:fs' is not supported: test files may import vitest, fast-check, @fast-check/vitest and the source file",
      '5: matcher toMatchSnapshot is not supported (supported: toBe, toEqual, toStrictEqual, toThrow, toThrowError, toBeCloseTo, toBeNaN, toBeNull, toBeUndefined, toBeDefined, toBeTruthy, toBeFalsy, toBeGreaterThan, toBeGreaterThanOrEqual, toBeLessThan, toBeLessThanOrEqual, toHaveLength, toContain, toContainEqual, toMatch)',
      '10: expect(...).resolves is not supported: the gates run synchronous checks',
      '6: it("async") is async: the gates run synchronous checks',
      '7: fc.assert parameter seed is not supported: the gate owns the seed and the run (numRuns only)',
      '8: it.only is not supported (each, only, concurrent, fails, runIf, skipIf…)',
      '9: it("mixed") mixes fc.assert with other statements; put each fc.assert in its own it',
    ]);
  });

  it('refuses a test that refers to two functions of the source file', async () => {
    expect(
      await messages(`import { it, expect } from 'vitest';
import { median, mean } from './stats';
it('agree', () => { expect(median([2])).toBe(mean([2])); });
`),
    ).toEqual(['3: "agree" refers to mean and median; the gates check one function at a time (split the test)']);
  });

  it('refuses hooks, vi.* and fc.check used without an import, and statements inside describe', async () => {
    expect(
      await messages(`import { median } from './stats';
beforeEach(() => {});
describe('d', () => { const x = 1; it('a', () => { expect(median([x])).toBe(1); }); });
vi.useFakeTimers();
it('c', () => { fc.check(fc.property(fc.integer(), (n) => median([n]) === n)); });
`),
    ).toEqual([
      '2: beforeEach is not supported: every check must stand on its own',
      '4: vi.useFakeTimers(…) is not supported: the gates run without mocks, timers or spies',
      '5: fc.check is not supported: the gates own the seed and run synchronous properties',
      '2: this statement is not supported in a test file the gates read (only imports, helper declarations and describe/it/test)',
      '3: only describe/it/test calls are supported inside describe; move helpers to the top level of the file',
      '4: this statement is not supported in a test file the gates read (only imports, helper declarations and describe/it/test)',
    ]);
  });
});
