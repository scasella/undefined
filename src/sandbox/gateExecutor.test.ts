import { afterEach, describe, expect, it } from 'vitest';
import type { GateResult } from '../types';
import { INTERRUPTED_NOTE } from './attribution';
import { executeGates, NEVER_CALLED_NOTE, NO_PROPERTIES_NOTE, NO_TESTS_NOTE, type ExecGateInput, type ExecHooks } from './gateExecutor';
import { evidenceFrom } from './gateRunner';

// ───────── real candidates (strict JS as the compile gate would emit it) ─────────

const MEDIAN = `function median(numbers) {
  if (numbers.length === 0) throw new RangeError('median of empty array');
  const s = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}`;

const MEDIAN_IN_PLACE = `function median(numbers) {
  if (numbers.length === 0) throw new RangeError('median of empty array');
  const s = numbers.sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}`;

const MEDIAN_LOWER = `function median(numbers) {
  if (numbers.length === 0) throw new RangeError('median of empty array');
  const s = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : s[m - 1];
}`;

const MEDIAN_RANDOM = `function median(numbers) {
  const s = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  if (s.length % 2 === 0 && Math.random() < 2) return (s[m - 1] + s[m]) / 2;
  return s[m];
}`;

const MEDIAN_SWALLOWS_FETCH = `function median(numbers) {
  try { fetch('https://example.com/log'); } catch (e) { /* hide it */ }
  const s = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}`;

// Impure only on long inputs: unit tests pass, the property phase trips it.
const MEDIAN_CLOCK_ON_LONG = `function median(numbers) {
  if (numbers.length === 0) throw new RangeError('median of empty array');
  if (numbers.length > 5) { try { Date.now(); } catch (e) {} }
  const s = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}`;

const MEDIAN_THROWS = `function median(numbers) { throw new Error('boom'); }`;
const MEDIAN_ZERO = `function median(numbers) { return 0; }`;

const TESTS = `
test('odd length', () => eq(median([3, 1, 2]), 2));
test('even length', () => eq(median([4, 1, 3, 2]), 2.5));
test('single', () => eq(median([7]), 7));
test('empty throws', () => throws(() => median([]), /empty/));
`;

const PROPERTIES = `
const reference = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
matchesReference('agrees with the sort-based reference', [fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1 })], reference);
property('result is within min and max', [fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1 })], (xs) => {
  const r = median(xs);
  return r >= Math.min(...xs) && r <= Math.max(...xs);
});
`;

const FIB_BIGINT = `function fibonacci(n) {
  let a = 0n, b = 1n;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}`;
const FIB_OFF_BY_ONE = `function fibonacci(n) {
  let a = 0n, b = 1n;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return n > 10 ? a + 1n : a;
}`;

function input(over: Partial<ExecGateInput> & Pick<ExecGateInput, 'js'>): ExecGateInput {
  return { name: 'median', testsJs: TESTS, propertiesJs: PROPERTIES, budgetMs: 1500, seed: 1938244123, ...over };
}

type Event = ['phase', string] | ['enter', string] | ['leave'] | ['gate', string];

function run(inp: ExecGateInput): { results: GateResult[]; events: Event[] } {
  const events: Event[] = [];
  const hooks: ExecHooks = {
    phase: (p) => events.push(['phase', p]),
    enter: (l) => events.push(['enter', l]),
    leave: () => events.push(['leave']),
    gate: (r) => events.push(['gate', r.gate]),
  };
  const results = executeGates(inp, hooks);
  return { results, events };
}

const statuses = (rs: GateResult[]): string[] => rs.map((r) => `${r.gate}:${r.status}`);
const strip = (rs: GateResult[]): unknown => rs.map(({ ms: _ms, ...r }) => r);

describe('executeGates', () => {
  it('accepts a correct median through all three gates', () => {
    const { results, events } = run(input({ js: MEDIAN, callArgs: [[1, 2]] }));
    expect(statuses(results)).toEqual(['tests:pass', 'properties:pass', 'invariants:pass']);
    expect(results[0].summary).toBe('4/4 tests passed');
    expect(results[0].counts).toEqual({ passed: 4, total: 4 });
    expect(results[1].summary).toBe(
      '2/2 properties held (200 runs: "agrees with the sort-based reference" 100, "result is within min and max" 100)',
    );
    expect(results[2].summary).toMatch(/^pure ✓ bounded ✓ \(\d+ sampled calls replayed on frozen arguments\)$/);
    const replayed = Number(/\((\d+) sampled/.exec(results[2].summary)![1]);
    expect(replayed).toBeGreaterThan(1);
    expect(replayed).toBeLessThanOrEqual(26); // 25 samples + the triggering call
    expect(events.filter((e) => e[0] === 'gate').map((e) => e[1])).toEqual(['tests', 'properties', 'invariants']);
    expect(results.every((r) => r.headline === undefined)).toBe(true);
  });

  it('rejects an in-place sort in the Invariants replay (pure: mutated its argument)', () => {
    const { results } = run(input({ js: MEDIAN_IN_PLACE }));
    expect(statuses(results)).toEqual(['tests:pass', 'properties:pass', 'invariants:fail']);
    const inv = results[2];
    expect(inv.headline).toBe('Rejected: median([3, 1, 2]) mutated its argument (pure)');
    expect(inv.diagnostics[0]).toMatchObject({ kind: 'invariant', invariant: 'pure', message: 'mutated its argument', call: 'median([3, 1, 2])', phase: 'invariants' });
  });

  it('rejects lower-middle median in Properties with a shrunk counterexample from the reference', () => {
    const { results } = run(input({ js: MEDIAN_LOWER, testsJs: '' }));
    expect(statuses(results)).toEqual(['tests:skipped', 'properties:fail', 'invariants:skipped']);
    const props = results[1];
    expect(props.headline).toBe('Rejected: median([0, 1]) returned 0, expected 0.5');
    expect(props.summary).toBe('1/2 properties failed (101 runs: "agrees with the sort-based reference" 1, "result is within min and max" 100)');
    expect(props.counts).toEqual({ passed: 1, total: 2 });
    const d = props.diagnostics[0];
    expect(d).toMatchObject({
      kind: 'property',
      name: 'agrees with the sort-based reference',
      call: 'median([0, 1])',
      counterexample: '[[0, 1]]',
      actual: '0',
      expected: '0.5',
      seed: 1938244123,
    });
    if (d.kind === 'property') {
      expect(d.shrinks).toBeGreaterThan(0);
      expect(d.runs).toBeGreaterThan(0);
    }
    expect(results[2].note).toBe('not reached');
  });

  it('is deterministic: same seed, same verdict and counterexample', () => {
    const a = run(input({ js: MEDIAN_LOWER, testsJs: '' })).results;
    const b = run(input({ js: MEDIAN_LOWER, testsJs: '' })).results;
    expect(strip(a)).toEqual(strip(b));
  });

  it('reports a false boolean property with the call that was made', () => {
    const { results } = run(
      input({
        js: MEDIAN_LOWER,
        testsJs: '',
        propertiesJs: `property('mean of a pair', [fc.integer(), fc.integer()], (a, b) => median([a, b]) === (a + b) / 2);`,
      }),
    );
    expect(results[1].headline).toMatch(/^Rejected: property "mean of a pair" failed for median\(\[-?\d+, -?\d+\]\)$/);
    expect(results[1].diagnostics[0]).toMatchObject({ kind: 'property', name: 'mean of a pair' });
  });

  it('rejects Math.random via Invariants and marks the interrupted phases', () => {
    const { results } = run(input({ js: MEDIAN_RANDOM }));
    expect(statuses(results)).toEqual(['tests:skipped', 'properties:skipped', 'invariants:fail']);
    expect(results[0].note).toBe(INTERRUPTED_NOTE);
    expect(results[1].note).toBe(INTERRUPTED_NOTE);
    expect(results[2].headline).toBe("Rejected: candidate read global 'Math.random' (pure)");
    expect(results[2].diagnostics[0]).toMatchObject({ invariant: 'pure', call: 'median([4, 1, 3, 2])', phase: 'tests' });
  });

  it('catches fetch even when the candidate swallows the error', () => {
    const { results } = run(input({ js: MEDIAN_SWALLOWS_FETCH }));
    expect(statuses(results)).toEqual(['tests:skipped', 'properties:skipped', 'invariants:fail']);
    expect(results[2].headline).toBe("Rejected: candidate read global 'fetch' (pure)");
    expect(results[2].diagnostics[0]).toMatchObject({ call: 'median([3, 1, 2])' });
  });

  it('attributes to Invariants even when the user test catches the violation', () => {
    const { results } = run(input({ js: MEDIAN_RANDOM, testsJs: `test('swallow', () => { try { median([1, 2]); } catch (e) {} });` }));
    expect(statuses(results)).toEqual(['tests:skipped', 'properties:skipped', 'invariants:fail']);
  });

  it('keeps a completed Tests result when the violation happens during Properties', () => {
    const { results } = run(input({ js: MEDIAN_CLOCK_ON_LONG }));
    expect(statuses(results)).toEqual(['tests:pass', 'properties:skipped', 'invariants:fail']);
    expect(results[1].note).toBe(INTERRUPTED_NOTE);
    expect(results[2].headline).toBe("Rejected: candidate read global 'Date.now' (pure)");
    expect(results[2].diagnostics[0]).toMatchObject({ phase: 'properties' });
  });

  it('rejects a global write that escapes the mask', () => {
    const js = `function median(numbers) { (() => 0).constructor('return this')().__leakedByCandidate = 1; return numbers[0]; }`;
    try {
      const { results } = run(input({ js, testsJs: `test('t', () => eq(median([1]), 1));`, propertiesJs: '' }));
      expect(results[2].headline).toBe("Rejected: candidate wrote global '__leakedByCandidate' (pure)");
      expect(results[0].status).toBe('skipped');
    } finally {
      delete (globalThis as Record<string, unknown>).__leakedByCandidate;
    }
  });

  it('reports a throwing candidate', () => {
    const { results } = run(input({ js: MEDIAN_THROWS }));
    expect(statuses(results)).toEqual(['tests:fail', 'properties:skipped', 'invariants:skipped']);
    expect(results[0].headline).toBe('Rejected: median([3, 1, 2]) threw Error: boom');
    expect(results[0].diagnostics[0]).toMatchObject({ kind: 'test', name: 'odd length', call: 'median([3, 1, 2])', error: 'Error: boom' });
    expect(results[1].note).toBe('not reached');
  });

  it('reports a property whose candidate threw on the shrunk input', () => {
    const { results } = run(input({ js: MEDIAN_THROWS, testsJs: '' }));
    expect(results[1].headline).toMatch(/^Rejected: median\(\[-?\d+\]\) threw Error: boom, expected -?\d+(\.5)?$/);
  });

  it('reports unit test failures with expected and actual, running every test', () => {
    const { results } = run(input({ js: MEDIAN_ZERO }));
    expect(results[0].status).toBe('fail');
    expect(results[0].headline).toBe('Rejected: median([3, 1, 2]) returned 0, expected 2');
    expect(results[0].summary).toBe('0/4 tests passed');
    expect(results[0].diagnostics).toHaveLength(4);
    expect(results[0].diagnostics[0]).toMatchObject({ kind: 'test', name: 'odd length', expected: '2', actual: '0', call: 'median([3, 1, 2])' });
    expect(results[0].diagnostics[3]).toMatchObject({ name: 'empty throws', actual: 'no error', expected: 'an error matching /empty/' });
  });

  it('does not claim "returned" when the assertion is about something else', () => {
    const { results } = run(
      input({ js: MEDIAN_IN_PLACE, testsJs: `test('keeps input', () => { const xs = [3, 1, 2]; median(xs); eq(xs, [3, 1, 2]); });`, propertiesJs: '' }),
    );
    expect(results[0].headline).toBe('Rejected: test "keeps input" failed after median([3, 1, 2]): expected [3, 1, 2], got [1, 2, 3]');
    expect(results[0].diagnostics[0]).toMatchObject({ expected: '[3, 1, 2]', actual: '[1, 2, 3]' });
  });

  it('skips empty test and property gates with explanatory notes, still replaying the call', () => {
    const { results } = run(input({ js: MEDIAN, testsJs: '', propertiesJs: '  ', callArgs: [[5, 1]] }));
    expect(statuses(results)).toEqual(['tests:skipped', 'properties:skipped', 'invariants:pass']);
    expect(results[0].note).toBe(NO_TESTS_NOTE);
    expect(results[1].note).toBe(NO_PROPERTIES_NOTE);
    expect(results[2].summary).toBe('pure ✓ bounded ✓ (1 sampled call replayed on frozen arguments)');
  });

  it('treats a source that registers nothing as "no tests yet"', () => {
    const { results } = run(input({ js: MEDIAN, testsJs: 'const unused = 1;', propertiesJs: '// nothing' }));
    expect(results[0].note).toBe(NO_TESTS_NOTE);
    expect(results[1].note).toBe(NO_PROPERTIES_NOTE);
    expect(results[2].status).toBe('skipped');
    expect(results[2].note).toBe(NEVER_CALLED_NOTE);
  });

  it('reports errors in the user spec as spec errors, not candidate failures', () => {
    const thrown = run(input({ js: MEDIAN, testsJs: `test('a', () => {}); throw new Error('oops in spec');` })).results;
    expect(statuses(thrown)).toEqual(['tests:fail', 'properties:skipped', 'invariants:skipped']);
    expect(thrown[0].note).toBe('spec error');
    expect(thrown[0].headline).toBe('Spec error: oops in spec');

    const syntax = run(input({ js: MEDIAN, testsJs: `test('a', () => {` })).results;
    expect(syntax[0].note).toBe('spec error');
    expect(syntax[0].headline).toMatch(/^Spec error: /);

    const badArbs = run(input({ js: MEDIAN, propertiesJs: `property('p', fc.integer(), () => true);` })).results;
    expect(statuses(badArbs)).toEqual(['tests:pass', 'properties:fail', 'invariants:skipped']);
    expect(badArbs[1].note).toBe('spec error');
    expect(badArbs[1].headline).toMatch(/^Spec error: property\("p"\): arbitraries must be/);
  });

  it('compares bigint results correctly', () => {
    const tests = `test('fib 90', () => eq(fibonacci(90), 2880067194370816120n));
                   test('fib 0', () => eq(fibonacci(0), 0n));`;
    const props = `const ref = (n) => { let a = 0n, b = 1n; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a; };
                   matchesReference('reference', [fc.integer({ min: 0, max: 60 })], ref);`;
    const ok = run({ name: 'fibonacci', js: FIB_BIGINT, testsJs: tests, propertiesJs: props, budgetMs: 1500, seed: 7, callArgs: [90] }).results;
    expect(statuses(ok)).toEqual(['tests:pass', 'properties:pass', 'invariants:pass']);

    const bad = run({ name: 'fibonacci', js: FIB_OFF_BY_ONE, testsJs: tests, propertiesJs: props, budgetMs: 1500, seed: 7 }).results;
    expect(bad[0].headline).toBe('Rejected: fibonacci(90) returned 2880067194370816121n, expected 2880067194370816120n');

    const badProps = run({ name: 'fibonacci', js: FIB_OFF_BY_ONE, testsJs: '', propertiesJs: props, budgetMs: 1500, seed: 7 }).results;
    expect(badProps[1].headline).toBe('Rejected: fibonacci(11) returned 90n, expected 89n');
  });

  it('fires enter/leave around every candidate call, in balanced pairs, after the phase hook', () => {
    const { events } = run(input({ js: MEDIAN, callArgs: [[2, 1]] }));
    expect(events[0]).toEqual(['phase', 'tests']);
    let open: string | null = null;
    let calls = 0;
    for (const e of events) {
      if (e[0] === 'enter') {
        expect(open).toBeNull(); // no nesting: recursion calls the inner function, not the wrapper
        open = e[1];
        calls++;
      } else if (e[0] === 'leave') {
        expect(open).not.toBeNull();
        open = null;
      } else {
        expect(open).toBeNull(); // phase and gate events never land inside a call
      }
    }
    expect(calls).toBeGreaterThan(200);
    expect(events.filter((e) => e[0] === 'phase').map((e) => e[1])).toEqual(['tests', 'properties', 'invariants']);
    expect(events).toContainEqual(['enter', 'median([3, 1, 2])']);
    // The triggering call is replayed in the invariants phase.
    const invStart = events.findIndex((e) => e[0] === 'phase' && e[1] === 'invariants');
    expect(events.slice(invStart)).toContainEqual(['enter', 'median([2, 1])']);
  });

  it('leaves an enter without a leave only when a call never returns (what the watchdog sees)', () => {
    // A recursive candidate is a single outer call: one enter, one leave.
    const js = `function fibonacci(n) { return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2); }`;
    const { events } = run({ name: 'fibonacci', js, testsJs: `test('f', () => eq(fibonacci(20), 6765));`, propertiesJs: '', budgetMs: 1500, seed: 1 });
    const testCalls = events.slice(0, events.findIndex((e) => e[0] === 'gate'));
    expect(testCalls).toEqual([['phase', 'tests'], ['enter', 'fibonacci(20)'], ['leave']]);
  });

  it('detects non-determinism through state kept on the function object', () => {
    const js = `function counter(x) { counter.n = (counter.n || 0) + 1; return x + counter.n; }`;
    const { results } = run({ name: 'counter', js, testsJs: '', propertiesJs: '', budgetMs: 100, seed: 1, callArgs: [1] });
    expect(results[2].headline).toBe('Rejected: counter(1) returned different results for identical input (non-deterministic) (pure)');
    expect(results[2].diagnostics[0]).toMatchObject({ invariant: 'pure', detail: 'first 2, then 3' });
  });

  it('detects mutation of a Map argument, which freezing cannot prevent', () => {
    const js = `function tag(m) { m.set('seen', true); return m.size; }`;
    const { results } = run({ name: 'tag', js, testsJs: '', propertiesJs: '', budgetMs: 100, seed: 1, callArgs: [new Map([['a', 1]])] });
    expect(results[2].headline).toBe('Rejected: tag(Map(1) { "a" => 1 }) mutated its argument (pure)');
  });

  it('does not mistake an ordinary TypeError bug for argument mutation', () => {
    const js = `function broken(xs) { return xs.nope.length; }`;
    const { results } = run({ name: 'broken', js, testsJs: '', propertiesJs: '', budgetMs: 100, seed: 1, callArgs: [[1]] });
    expect(results[2].status).toBe('pass');
  });

  it('fails the Tests gate when the candidate cannot be loaded', () => {
    const { results } = run(input({ js: 'function other() {}' }));
    expect(statuses(results)).toEqual(['tests:fail', 'properties:skipped', 'invariants:skipped']);
    expect(results[0].headline).toMatch(/^Rejected: candidate failed to load: ReferenceError/);
  });
});

afterEach(() => {
  expect((globalThis as Record<string, unknown>).__leakedByCandidate).toBeUndefined();
});

describe('executeGates — review fixes', () => {
  const only = (name: string, js: string, over: Partial<ExecGateInput> = {}): GateResult[] =>
    run({ name, js, testsJs: '', propertiesJs: '', budgetMs: 1500, seed: 1, ...over }).results;

  it('rejects a candidate that replaces Object.is (Invariants, pure) and restores it', () => {
    const results = only('f', 'function f() { Object.is = () => true; return 0; }', { callArgs: [] });
    expect(statuses(results)).toEqual(['tests:skipped', 'properties:skipped', 'invariants:fail']);
    expect(results[2].headline).toBe('Rejected: candidate modified Object.is (pure)');
    expect(Object.is(1, 2)).toBe(false);
  });

  it('rejects a candidate that replaces Array.prototype.push, attributed from the Tests phase, and restores it', () => {
    const real = Array.prototype.push;
    const results = only('f', 'function f() { Array.prototype.push = function () { return 0; }; return 0; }', {
      testsJs: "test('t', () => eq(f(), 0));",
    });
    expect(statuses(results)).toEqual(['tests:skipped', 'properties:skipped', 'invariants:fail']);
    expect(results[0].note).toBe(INTERRUPTED_NOTE);
    expect(results[2].headline).toBe('Rejected: candidate modified Array.prototype.push (pure)');
    expect(Array.prototype.push).toBe(real);
    const xs: number[] = [];
    xs.push(1);
    expect(xs).toEqual([1]);
  });

  it('rejects a candidate that adds a property to a prototype, and removes it', () => {
    const results = only('f', 'function f(xs) { Array.prototype.sneaky = 1; return xs.length; }', { callArgs: [[1]] });
    expect(results[2].headline).toBe('Rejected: candidate added property sneaky to Array.prototype (pure)');
    expect('sneaky' in []).toBe(false);
  });

  it('does not call a candidate that returns a function non-deterministic', () => {
    const results = only('make', 'function make(x) { return { f: () => x, g: [function () { return x; }], n: x }; }', { callArgs: [1] });
    expect(statuses(results)).toEqual(['tests:skipped', 'properties:skipped', 'invariants:pass']);
    const plain = only('make', 'function make(x) { return () => x; }', { callArgs: [1] });
    expect(plain[2].status).toBe('pass');
  });

  it('skips Invariants (no vacuous pass) when the candidate was never called', () => {
    const results = only('f', 'function f(x) { return x; }');
    expect(results[2]).toMatchObject({ gate: 'invariants', status: 'skipped', note: NEVER_CALLED_NOTE });
    expect(NEVER_CALLED_NOTE).toBe('the candidate was never called, so purity and bounded runtime were not exercised');
    // Called, but with arguments that cannot be replayed: still a pass, honestly labelled.
    const called = only('apply', 'function apply(g, x) { return g(x); }', { testsJs: "test('t', () => eq(apply((x) => x, 1), 1));" });
    expect(called[2]).toMatchObject({ status: 'pass', summary: 'pure ✓ bounded ✓ (no sampled calls to replay)' });
  });

  it('says where actual and expected differ when show() renders them identically (test)', () => {
    const js = 'function range(n) { const a = []; for (let i = 0; i < n; i++) a.push(i); if (n >= 60) a[59] = 99; return a; }';
    const results = only('range', js, { testsJs: "test('sixty', () => eq(range(60), Array.from({ length: 60 }, (_, i) => i)));" });
    expect(results[0].status).toBe('fail');
    const d = results[0].diagnostics[0] as { actual: string; expected: string; message: string };
    expect(d.actual).toMatch(/ \(at \[59\]: 99\)$/);
    expect(d.expected).toMatch(/ \(at \[59\]: 59\)$/);
    expect(d.message).toContain('[59]: 99 vs 59');
    expect(results[0].headline).toContain('(at [59]: 99), expected');
  });

  it('says where they differ for long strings in a matchesReference property', () => {
    const js = 'function pad(n) { return "x".repeat(n) + (n > 250 ? "A" : "B"); }';
    const props = "matchesReference('ref', [fc.constant(260)], (n) => 'x'.repeat(n) + 'B');";
    const results = only('pad', js, { propertiesJs: props });
    expect(results[1].status).toBe('fail');
    const d = results[1].diagnostics[0] as { actual: string; expected: string };
    expect(d.actual).toContain('(at [260]: "…xxxxxxxxxxxxA")');
    expect(d.expected).toContain('(at [260]: "…xxxxxxxxxxxxB")');
  });
});

describe('executeGates — "the spec was silent" markers', () => {
  const MEDIAN_EMPTY_THROWS = `function median(numbers) {
  if (numbers.length === 0) throw new Error('empty list');
  const s = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}`;
  const MEDIAN_LOWER_NAN = `function median(numbers) {
  if (numbers.length === 0) return NaN;
  const s = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : s[m - 1];
}`;
  const REF = `const reference = (xs) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
`;
  const SILENT = `silentOn: 'what the median of nothing is', reasonable: 'Throwing is defensible; so is NaN.'`;
  const refProp = (opts: string): string =>
    `${REF}matchesReference('ref', [fc.array(fc.integer({ min: -1000, max: 1000 }))], reference${opts ? `, { ${opts} }` : ''});`;
  const props = (js: string, propertiesJs: string): GateResult[] =>
    run({ name: 'median', js, testsJs: '', propertiesJs, budgetMs: 1500, seed: 1938244123 }).results;

  it('copies silentOn/reasonable from a failing unit test onto its diagnostic, without touching the headline', () => {
    const tests = (meta: string): string => `test('even', () => eq(median([1, 2]), 1.5)${meta});\ntest('odd', () => eq(median([3, 1, 2]), 2));`;
    const marked = run(input({ js: MEDIAN_LOWER, testsJs: tests(`, { ${SILENT} }`) })).results[0];
    const plain = run(input({ js: MEDIAN_LOWER, testsJs: tests('') })).results[0];
    expect(marked.status).toBe('fail');
    expect(marked.diagnostics[0]).toMatchObject({ kind: 'test', name: 'even', silentOn: 'what the median of nothing is', reasonable: 'Throwing is defensible; so is NaN.' });
    expect(marked.headline).toBe(plain.headline);
    expect(marked.headline).toBe('Rejected: median([1, 2]) returned 1, expected 1.5');
    expect(plain.diagnostics[0]).not.toHaveProperty('silentOn');
    expect(plain.diagnostics[0]).not.toHaveProperty('reasonable');
  });

  it('marks a property failure when `when` holds at the shrunk counterexample; verdict and counterexample are unchanged', () => {
    const marked = props(MEDIAN_EMPTY_THROWS, refProp(`${SILENT}, when: (xs) => xs.length === 0`))[1];
    const plain = props(MEDIAN_EMPTY_THROWS, refProp(''))[1];
    expect(marked.headline).toBe('Rejected: median([]) threw Error: empty list, expected NaN');
    expect(marked.diagnostics[0]).toMatchObject({ kind: 'property', counterexample: '[[]]', silentOn: 'what the median of nothing is', reasonable: 'Throwing is defensible; so is NaN.' });
    // Same seed, same run: everything but the marker fields and the Decide facts is identical to the unmarked property.
    const { ms: _a, ...m } = marked;
    const { ms: _b, ...p } = plain;
    const { silentOn: _s, reasonable: _r, args, expectedOutcome, actualOutcome, ...markedDiag } = m.diagnostics[0] as Record<string, unknown>;
    expect({ ...m, diagnostics: [markedDiag] }).toEqual(p);
    // the Decide facts: the exact call (encoded), what the reference wanted (NaN, encoded) and what the candidate did
    expect({ args, expectedOutcome, actualOutcome }).toEqual({ args: [[]], expectedOutcome: { returns: { $t: 'number', v: 'NaN' } }, actualOutcome: { throws: true } });
    expect(plain.diagnostics[0]).not.toHaveProperty('args');
  });

  it('does not mark a property failure when `when` is false at the counterexample (a real mistake keeps no excuse)', () => {
    const r = props(MEDIAN_LOWER_NAN, refProp(`${SILENT}, when: (xs) => xs.length === 0`))[1];
    expect(r.status).toBe('fail');
    expect(r.diagnostics[0]).toMatchObject({ kind: 'property', call: 'median([0, 1])' });
    expect(r.diagnostics[0]).not.toHaveProperty('silentOn');
    expect(r.diagnostics[0]).not.toHaveProperty('reasonable');
  });

  it('treats a throwing `when` as false, and a non-true return as false', () => {
    const threw = props(MEDIAN_EMPTY_THROWS, refProp(`${SILENT}, when: (xs) => { throw new Error('oops'); }`))[1];
    expect(threw.headline).toBe('Rejected: median([]) threw Error: empty list, expected NaN');
    expect(threw.diagnostics[0]).not.toHaveProperty('silentOn');
    const truthy = props(MEDIAN_EMPTY_THROWS, refProp(`${SILENT}, when: (xs) => 1`))[1];
    expect(truthy.diagnostics[0]).not.toHaveProperty('silentOn');
  });

  it('a `when` that calls the candidate does not change the reported call', () => {
    const r = props(MEDIAN_EMPTY_THROWS, refProp(`${SILENT}, when: (xs) => { median([5]); return xs.length === 0; }`))[1];
    expect(r.diagnostics[0]).toMatchObject({ call: 'median([])', silentOn: 'what the median of nothing is' });
  });

  it('marks an unconditional boolean property that returns false', () => {
    const r = props(MEDIAN_ZERO, `property('positive', [fc.integer({ min: 1, max: 9 })], (n) => median([n]) === n, { silentOn: 'x' });`)[1];
    expect(r.headline).toBe('Rejected: property "positive" failed for median([1])');
    expect(r.diagnostics[0]).toMatchObject({ silentOn: 'x' });
    expect(r.diagnostics[0]).not.toHaveProperty('reasonable');
  });

  it('adds no marker fields on pass', () => {
    const results = run(input({ js: MEDIAN, testsJs: `test('odd', () => eq(median([3, 1, 2]), 2), { ${SILENT} });`, propertiesJs: '' })).results;
    expect(statuses(results)).toEqual(['tests:pass', 'properties:skipped', 'invariants:pass']);
    expect(JSON.stringify(results)).not.toContain('silentOn');
  });

  it('reports a malformed marker as a spec error, not a candidate failure', () => {
    const bad = run(input({ js: MEDIAN, testsJs: `test('t', () => {}, { when: () => true });` })).results[0];
    expect(bad).toMatchObject({ status: 'fail', note: 'spec error' });
    expect(bad.headline).toMatch(/^Spec error: test\("t"\): when only applies to properties/);
    const notString = props(MEDIAN, `property('p', [fc.nat()], () => true, { silentOn: 3 });`)[1];
    expect(notString.headline).toMatch(/silentOn must be a non-empty string/);
  });
});

// ───────────────────────── pins, phases, evidence ─────────────────────────

const ROWS = (): Array<{ customer: string; total: number }> => [
  { customer: 'Ada', total: 12 },
  { customer: 'Lin', total: 3 },
  { customer: 'Bo', total: 7 },
];
const TOTAL = `function total(rows) { let t = 0; for (const r of rows) t += r.total; return t; }`;
const TOTAL_WRONG = `function total(rows) { let t = 0; for (const r of rows) t += r.total; return t + 1; }`;
const TOTAL_SORTS_IN_PLACE = `function total(rows) { rows.sort((a, b) => a.total - b.total); let t = 0; for (const r of rows) t += r.total; return t; }`;
const TOTAL_ZEROES_ROWS = `function total(rows) { let t = 0; for (const r of rows) { t += r.total; r.total = 0; } return t; }`;
const TOTAL_THROWS = `function total(rows) { throw new RangeError('no rows'); }`;
const TOTAL_TESTS = `test('empty', () => eq(total([]), 0));\ntest('one', () => eq(total([{ customer: 'x', total: 2 }]), 2));`;

function totalInput(over: Partial<ExecGateInput> & Pick<ExecGateInput, 'js'>): ExecGateInput {
  return { name: 'total', testsJs: '', propertiesJs: '', budgetMs: 1500, seed: 7, ...over };
}

describe('executeGates: pinned results', () => {
  it('runs pins after the unit tests, counts them, and keeps the old summary when there are none', () => {
    const rows = ROWS();
    const { results } = run(totalInput({ js: TOTAL, testsJs: TOTAL_TESTS, pinned: [{ label: 'total(rows)', args: [rows], expected: 22 }] }));
    expect(statuses(results)).toEqual(['tests:pass', 'properties:skipped', 'invariants:pass']);
    expect(results[0]).toMatchObject({ summary: '2 unit tests + 1 pinned passed', counts: { passed: 3, total: 3 } });
    const plain = run(totalInput({ js: TOTAL, testsJs: TOTAL_TESTS })).results;
    expect(plain[0]!.summary).toBe('2/2 tests passed');
  });

  it('pins alone make the Tests gate run (not skipped)', () => {
    const { results } = run(totalInput({ js: TOTAL, pinned: [{ label: 'total(rows)', args: [ROWS()], expected: 22 }, { label: 'total([])', args: [[]], expected: 0 }] }));
    expect(results[0]).toMatchObject({ status: 'pass', summary: '2 pinned passed', counts: { passed: 2, total: 2 } });
    expect(results[0]!.note).toBeUndefined();
  });

  it('a failing pin is a standard test diagnostic named `pinned: <label>`, with call/expected/actual and a headline', () => {
    const { results } = run(totalInput({ js: TOTAL_WRONG, testsJs: TOTAL_TESTS.split('\n')[0], pinned: [{ label: 'total(rows)', args: [ROWS()], expected: 22 }] }));
    expect(statuses(results)).toEqual(['tests:fail', 'properties:skipped', 'invariants:skipped']);
    const t = results[0]!;
    expect(t.summary).toBe('0/2 tests passed (1 unit + 1 pinned)');
    expect(t.headline).toBe('Rejected: total([]) returned 1, expected 0'); // the unit test ran first
    expect(t.diagnostics[1]).toEqual({
      kind: 'test',
      name: 'pinned: total(rows)',
      call: 'total(rows)',
      expected: '22',
      actual: '23',
      message: 'expected 22, got 23',
    });
    const only = run(totalInput({ js: TOTAL_WRONG, pinned: [{ label: 'total(rows)', args: [ROWS()], expected: 22 }] })).results[0]!;
    expect(only.headline).toBe('Rejected: total(rows) returned 23, expected 22');
    expect(only.diagnostics[0]).not.toHaveProperty('silentOn');
  });

  it('a pin whose call throws reports the error and what was expected', () => {
    const { results } = run(totalInput({ js: TOTAL_THROWS, pinned: [{ label: 'total(rows)', args: [ROWS()], expected: 22 }] }));
    expect(results[0]!.headline).toBe('Rejected: total(rows) threw RangeError: no rows, expected 22');
    expect(results[0]!.diagnostics[0]).toMatchObject({ kind: 'test', name: 'pinned: total(rows)', call: 'total(rows)', expected: '22', error: 'RangeError: no rows' });
  });

  it('compares with eq() equality (NaN equals NaN, -0 differs from 0, deep objects)', () => {
    const id = 'function total(x) { return x; }';
    const pass = run(totalInput({ js: id, pinned: [{ label: 'a', args: [{ v: [NaN, 1n] }], expected: { v: [NaN, 1n] } }] })).results[0]!;
    expect(pass.status).toBe('pass');
    const fail = run(totalInput({ js: id, pinned: [{ label: 'b', args: [-0], expected: 0 }] })).results[0]!;
    expect(fail.status).toBe('fail');
  });

  it('a candidate cannot corrupt the dataset rows: pins run on deep clones and the frozen replay catches the mutation', () => {
    for (const js of [TOTAL_SORTS_IN_PLACE, TOTAL_ZEROES_ROWS]) {
      const rows = ROWS();
      const before = JSON.stringify(rows);
      const { results } = run(totalInput({ js, pinned: [{ label: 'total(rows)', args: [rows], expected: 22 }], callArgs: [rows] }));
      expect(JSON.stringify(rows)).toBe(before);
      expect(statuses(results)).toEqual(['tests:pass', 'properties:skipped', 'invariants:fail']);
      expect(results[2]!.diagnostics[0]).toMatchObject({ kind: 'invariant', invariant: 'pure', message: 'mutated its argument' });
    }
  });
});

describe('executeGates: phases', () => {
  it("phases ['tests', 'properties'] omits Invariants (no replay runs)", () => {
    const { results, events } = run(input({ js: MEDIAN_IN_PLACE, phases: ['tests', 'properties'] }));
    expect(statuses(results)).toEqual(['tests:pass', 'properties:pass']);
    expect(events.filter((e) => e[0] === 'phase').map((e) => e[1])).toEqual(['tests', 'properties']);
    expect(events.filter((e) => e[0] === 'gate').map((e) => e[1])).toEqual(['tests', 'properties']);
  });

  it('a failure in a requested phase still ends the run', () => {
    const { results } = run(input({ js: MEDIAN_LOWER, phases: ['tests', 'properties'] }));
    expect(statuses(results)).toEqual(['tests:fail', 'properties:skipped']);
    const props = run(input({ js: MEDIAN_LOWER, testsJs: '', phases: ['tests', 'properties'] })).results;
    expect(statuses(props)).toEqual(['tests:skipped', 'properties:fail']);
  });

  it('an invariant violation is still reported by Invariants when it was not requested (attribution rule)', () => {
    const { results } = run(input({ js: MEDIAN_RANDOM, phases: ['tests', 'properties'] }));
    expect(results.map((r) => r.gate)).toContain('invariants');
    const inv = results.find((r) => r.gate === 'invariants')!;
    expect(inv).toMatchObject({ status: 'fail', diagnostics: [{ kind: 'invariant', invariant: 'pure' }] });
    expect(results.every((r) => r.gate !== 'invariants' || r.status === 'fail')).toBe(true);
  });

  it("phases ['properties'] skips the unit tests and pins entirely", () => {
    const { results } = run(input({ js: MEDIAN, phases: ['properties'], pinned: [{ label: 'median([1])', args: [[1]], expected: 99 }] }));
    expect(statuses(results)).toEqual(['properties:pass']);
  });
});

describe('evidenceFrom (against real executor output)', () => {
  it('counts unit tests, properties with runs, and sampled calls of a passing run', () => {
    const { results } = run(input({ js: MEDIAN, callArgs: [[1, 2]] }));
    const ev = evidenceFrom(results);
    expect(ev.unitTests).toBe(4);
    expect(ev.pinnedTests).toBe(0);
    expect(ev.properties).toEqual([
      { name: 'agrees with the sort-based reference', runs: 100 },
      { name: 'result is within min and max', runs: 100 },
    ]);
    expect(ev.sampledCalls).toBe(Number(/\((\d+) sampled/.exec(results[2]!.summary)![1]));
    expect(ev.sampledCalls).toBeGreaterThan(1);
  });

  it('splits unit and pinned tests (pass, pins only, and fail)', () => {
    const pin = { label: 'total(rows)', args: [ROWS()], expected: 22 };
    expect(evidenceFrom(run(totalInput({ js: TOTAL, testsJs: TOTAL_TESTS, pinned: [pin] })).results)).toMatchObject({ unitTests: 2, pinnedTests: 1, properties: [] });
    expect(evidenceFrom(run(totalInput({ js: TOTAL, pinned: [pin, pin] })).results)).toMatchObject({ unitTests: 0, pinnedTests: 2 });
    expect(evidenceFrom(run(totalInput({ js: TOTAL_WRONG, testsJs: TOTAL_TESTS, pinned: [pin] })).results)).toMatchObject({ unitTests: 2, pinnedTests: 1, sampledCalls: 0 });
    const single = run(totalInput({ js: TOTAL, testsJs: TOTAL_TESTS.split('\n')[0] })).results;
    expect(single[0]!.summary).toBe('1/1 test passed');
    expect(evidenceFrom(single)).toMatchObject({ unitTests: 1, pinnedTests: 0 });
  });

  it('nothing ran: skipped gates, never-called candidate, interrupted phases', () => {
    expect(evidenceFrom(run(totalInput({ js: TOTAL })).results)).toEqual({ unitTests: 0, pinnedTests: 0, properties: [], sampledCalls: 0 });
    // impure on long inputs: tests completed, properties interrupted
    const { results } = run(input({ js: MEDIAN_CLOCK_ON_LONG }));
    expect(statuses(results)).toEqual(['tests:pass', 'properties:skipped', 'invariants:fail']);
    expect(evidenceFrom(results)).toEqual({ unitTests: 4, pinnedTests: 0, properties: [], sampledCalls: 0 });
  });

  it('property names with quotes, commas and the word "runs" parse exactly', () => {
    const props = `property('a "quoted", runs: 3', [fc.integer()], () => true, { numRuns: 7 });\nproperty('b', [fc.integer()], () => true);`;
    const { results } = run(totalInput({ js: TOTAL, propertiesJs: props }));
    expect(evidenceFrom(results).properties).toEqual([
      { name: 'a "quoted", runs: 3', runs: 7 },
      { name: 'b', runs: 100 },
    ]);
  });

  it('legacy summaries without the per-property breakdown yield no guessed names', () => {
    const legacy: GateResult[] = [
      { gate: 'tests', status: 'pass', ms: 1, summary: '5/5 tests passed', diagnostics: [], counts: { passed: 5, total: 5 } },
      { gate: 'properties', status: 'pass', ms: 1, summary: '2/2 properties held (200 runs)', diagnostics: [], counts: { passed: 2, total: 2 } },
      { gate: 'invariants', status: 'pass', ms: 1, summary: 'pure ✓ bounded ✓ (1 sampled call replayed on frozen arguments)', diagnostics: [] },
    ];
    expect(evidenceFrom(legacy)).toEqual({ unitTests: 5, pinnedTests: 0, properties: [], sampledCalls: 1 });
  });
});
