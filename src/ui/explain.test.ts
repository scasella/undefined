import { describe, expect, it } from 'vitest';
import type { Diagnostic, FunctionSpec, GateResult } from '../types';
import { buildPrompt } from '../shared/prompt';
import { modelSawSummary, promptFeatures, whoDecided } from './explain';

const fail = (gate: GateResult['gate'], diagnostics: Diagnostic[], extra: Partial<GateResult> = {}): GateResult => ({
  gate,
  status: 'fail',
  ms: 1,
  summary: '',
  diagnostics,
  ...extra,
});

const prop = (over: Partial<Extract<Diagnostic, { kind: 'property' }>> = {}): Diagnostic => ({
  kind: 'property',
  name: 'agrees with the reference',
  call: 'median([1, 2])',
  counterexample: '[[1, 2]]',
  expected: '1.5',
  actual: '1',
  shrinks: 3,
  runs: 4,
  seed: 42,
  ...over,
});

const test = (over: Partial<Extract<Diagnostic, { kind: 'test' }>> = {}): Diagnostic => ({
  kind: 'test',
  name: 'keeps accents',
  message: 'expected values to be deeply equal',
  call: 'slugify("Crème")',
  expected: '"creme"',
  actual: '"cr-me"',
  ...over,
});

describe('whoDecided', () => {
  it('silentOn with the check author\'s note: the spec was silent, your tests decided, and why the choice was fair', () => {
    const lines = whoDecided(
      fail('tests', [test({ silentOn: 'what happens to accented letters', reasonable: 'Dropping non-ASCII letters is a common slug convention.' })]),
      1,
    );
    expect(lines).toEqual([
      "The spec didn't say what happens to accented letters. Your tests did.",
      'Dropping non-ASCII letters is a common slug convention.',
    ]);
  });

  it('silentOn without a note: the fairness line names the candidate', () => {
    expect(whoDecided(fail('properties', [prop({ silentOn: 'how to average the two middle values' })]), 1)).toEqual([
      "The spec didn't say how to average the two middle values. Your tests did.",
      'Candidate #1 made a defensible choice the spec never ruled out.',
    ]);
    // a blank note falls back to the fairness line too
    expect(whoDecided(fail('tests', [test({ silentOn: 'x', reasonable: '  ' })]), 3)[1]).toBe(
      'Candidate #3 made a defensible choice the spec never ruled out.',
    );
  });

  it('compile', () => {
    const d: Diagnostic = { kind: 'compile', code: 2322, message: 'm', category: 'error', line: 1, col: 1, endLine: 1, endCol: 2, snippet: 's' };
    expect(whoDecided(fail('compile', [d]), 1)).toEqual(["The model's code didn't compile. The compiler decided."]);
    expect(whoDecided(fail('compile', []), 1)).toEqual(["The model's code didn't compile. The compiler decided."]);
  });

  it('bounded: the limit from the diagnostic, with the elapsed time when known', () => {
    const d = (over: object): Diagnostic => ({ kind: 'invariant', invariant: 'bounded', message: 'm', call: 'fibonacci(90)', ...over });
    expect(whoDecided(fail('invariants', [d({ budgetMs: 1500 })]), 1)).toEqual([
      'The spec set a limit: 1500 ms per call. The candidate took longer.',
    ]);
    expect(whoDecided(fail('invariants', [d({ budgetMs: 1500, elapsedMs: 1503.4 })]), 1)).toEqual([
      'The spec set a limit: 1500 ms per call. The candidate took longer (stopped at 1503 ms).',
    ]);
    expect(whoDecided(fail('invariants', [d({})]), 1)).toEqual(['The spec set a time limit per call. The candidate took longer.']);
  });

  it('pure', () => {
    const d: Diagnostic = { kind: 'invariant', invariant: 'pure', message: "candidate read global 'Math.random'" };
    expect(whoDecided(fail('invariants', [d]), 2)).toEqual(["The model was told to be side-effect free. The candidate wasn't."]);
  });

  it('a test or property without silentOn is neutral', () => {
    expect(whoDecided(fail('tests', [test()]), 1)).toEqual(['A check you wrote failed, with the evidence above.']);
    expect(whoDecided(fail('properties', [prop()]), 1)).toEqual(['A check you wrote failed, with the evidence above.']);
    expect(whoDecided(fail('properties', []), 1)).toEqual(['A check you wrote failed, with the evidence above.']);
    expect(whoDecided(fail('invariants', []), 1)).toEqual(['A purity or time-limit check failed, with the evidence above.']);
  });

  it('failures that are not the candidate\'s fault never blame it', () => {
    const specError = fail('tests', [test({ name: '(spec error)', message: 'Unexpected token' })], { note: 'spec error' });
    expect(whoDecided(specError, 1)[0]).toMatch(/^Your spec's checks did not load, so this is not a verdict on the candidate/);
    const runner = fail('tests', [test({ name: '(gate runner)', message: 'worker crashed' })]);
    expect(whoDecided(runner, 1)[0]).toMatch(/^The gate runner failed before it could judge the candidate/);
  });

  it('never uses jargon', () => {
    const all = [
      whoDecided(fail('properties', [prop({ silentOn: 'x' })]), 1),
      whoDecided(fail('properties', [prop()]), 1),
      whoDecided(fail('invariants', [{ kind: 'invariant', invariant: 'pure', message: 'm' }]), 1),
    ].flat().join(' ');
    expect(all).not.toMatch(/property-based|invariant/i);
  });
});

const SPEC: FunctionSpec = {
  name: 'median',
  params: [{ name: 'numbers', type: 'number[]' }],
  returns: 'number',
  doc: 'The median.',
  tests: `test("odd", () => eq(median([3, 1, 2]), 2));
// test("commented out", () => {});
test('even', () => eq(median([4, 1, 3, 2]), 2.5));`,
  properties: `matchesReference("agrees with the reference", [fc.array(fc.integer(), { minLength: 1 })], (xs) => xs[0]);`,
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'example',
};

const NOT_SENT = 'Not sent: the bodies of the tests and properties, or the reference implementation.';

describe('modelSawSummary', () => {
  it('first attempt: signature, doc, the counted names and the time budget', () => {
    const prompt = buildPrompt({ spec: SPEC, history: [] });
    expect(modelSawSummary(SPEC, prompt)).toEqual({
      sent: 'Sent: the signature, your doc, the names of 2 tests and 1 property, the time budget.',
      notSent: NOT_SENT,
    });
  });

  it('a retry adds the previous attempt and its diagnostics', () => {
    const prompt = buildPrompt({
      spec: SPEC,
      history: [{ attempt: 1, body: 'return 0;', gates: [fail('tests', [test()])], headline: 'Rejected: x' }],
    });
    expect(modelSawSummary(SPEC, prompt).sent).toBe(
      'Sent: the signature, your doc, the names of 2 tests and 1 property, the time budget, the previous attempt and its diagnostics.',
    );
  });

  it('counts come from the current spec (singular/plural) and say so plainly when there are none', () => {
    const prompt = buildPrompt({ spec: SPEC, history: [] });
    const one = { tests: 'test("a", () => {});', properties: 'property("p", [fc.nat()], () => true);\nproperty("q", [fc.nat()], () => true);' };
    expect(modelSawSummary(one, prompt).sent).toContain('the names of 1 test and 2 properties,');
    expect(modelSawSummary({ tests: '', properties: '' }, prompt).sent).toContain('the names of your tests and properties (there are none yet)');
    expect(modelSawSummary(undefined, prompt).sent).toContain('(there are none yet)');
  });

  it('a call-inferred spec: argument types, never values; a runtime-fault retry says so', () => {
    const callSpec: FunctionSpec = { ...SPEC, tests: '', properties: '', origin: 'call' };
    const prompt = buildPrompt({
      spec: callSpec,
      callArgTypes: ['number'],
      history: [],
      runtimeFault: { call: 'f(1)', errorName: 'TypeError', message: 'x', previousBody: 'return 1;' },
    });
    expect(modelSawSummary(callSpec, prompt).sent).toBe(
      "Sent: the signature, your doc, the names of your tests and properties (there are none yet), the types (not the values) of your call's arguments, the time budget, the error a previous version hit at runtime.",
    );
  });

  it('an older recorded prompt without the budget line does not claim the budget was sent', () => {
    const old = buildPrompt({ spec: SPEC, history: [] }).replace(/^- Each call must return within \d+ ms\.\n/m, '');
    expect(promptFeatures(old).budget).toBe(false);
    expect(modelSawSummary(SPEC, old).sent).toBe('Sent: the signature, your doc, the names of 2 tests and 1 property.');
  });
});
