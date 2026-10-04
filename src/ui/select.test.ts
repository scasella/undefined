import { describe, expect, it } from 'vitest';
import type { GateResult } from '../types';
import { MEDIAN_SPEC, SCENARIOS } from './dev/fixtures';
import {
  attribution,
  chipText,
  codeAttempt,
  compileMarks,
  draftOf,
  failingGate,
  functionStatus,
  gateAttempt,
  functionStatusText,
  inputHistory,
  latestCommitted,
  newSpecPrefill,
  resolveAttempt,
  signatureOf,
  specPatch,
} from './select';

describe('attempt selection', () => {
  const gen = SCENARIOS['rejected-properties']().generation!;

  it('follows the latest attempt by default and after the generation changes', () => {
    expect(resolveAttempt(gen, null)?.attempt).toBe(2);
    expect(resolveAttempt(gen, { genId: 'other', attempt: 1 })?.attempt).toBe(2);
    expect(resolveAttempt(null, null)).toBeUndefined();
  });

  it('honours an explicit selection within the same generation', () => {
    expect(resolveAttempt(gen, { genId: gen.id, attempt: 1 })?.attempt).toBe(1);
    expect(resolveAttempt(gen, { genId: gen.id, attempt: 9 })?.attempt).toBe(2);
  });

  it('gate panel keeps the last verdict while the next candidate has no gates', () => {
    expect(gateAttempt(gen, null)?.attempt).toBe(1);
    expect(gateAttempt(gen, { genId: gen.id, attempt: 2 })?.attempt).toBe(2);
    const fresh = SCENARIOS.generating().generation!;
    expect(gateAttempt(fresh, null)?.attempt).toBe(1);
    expect(gateAttempt(null, null)).toBeUndefined();
  });

  it('code pane holds the previous candidate until the next one types its first characters', () => {
    const held = codeAttempt(gen, null);
    expect(held).toMatchObject({ holdover: true, attempt: { attempt: 1, status: 'rejected' } });
    // explicit selection of the empty latest attempt is honoured as-is
    expect(codeAttempt(gen, { genId: gen.id, attempt: 2 })).toMatchObject({ holdover: false, attempt: { attempt: 2 } });
    // typing with nothing shown yet still holds; the first characters switch over
    const typing = { ...gen, attempts: [gen.attempts[0], { ...gen.attempts[1], status: 'typing' as const }] };
    expect(codeAttempt(typing, null)?.holdover).toBe(true);
    const arrived = { ...gen, attempts: [gen.attempts[0], { ...gen.attempts[1], status: 'typing' as const, shown: 'co' }] };
    expect(codeAttempt(arrived, null)).toMatchObject({ holdover: false, attempt: { attempt: 2 } });
    // an aborted attempt is shown, not covered up
    const aborted = { ...gen, attempts: [gen.attempts[0], { ...gen.attempts[1], status: 'aborted' as const }] };
    expect(codeAttempt(aborted, null)).toMatchObject({ holdover: false, attempt: { attempt: 2 } });
    // the very first attempt has nothing to hold over
    expect(codeAttempt(SCENARIOS.generating().generation!, null)).toMatchObject({ holdover: false, attempt: { attempt: 1 } });
    expect(codeAttempt(null, null)).toBeUndefined();
  });

  it('builds retry-strip chip text from the rejecting gate and headline', () => {
    expect(chipText(gen.attempts[0])).toBe('#1 rejected by properties — median([1, 2]) returned 1, expected 1.5');
    expect(chipText(gen.attempts[1])).toBe('#2 generating…');
  });
});

describe('failingGate', () => {
  it('finds the first failing gate', () => {
    const gates: GateResult[] = SCENARIOS['budget-exhausted']().generation!.attempts[2].gates;
    expect(failingGate(gates)?.gate).toBe('invariants');
    expect(failingGate([])).toBeUndefined();
  });
});

describe('function status', () => {
  it('distinguishes certified, stale and absent artifacts', () => {
    const committed = SCENARIOS.committed().program.functions.median;
    expect(functionStatusText(functionStatus(committed))).toBe('certified r2');
    const stale = SCENARIOS['repo-stale']().program.functions.median;
    expect(functionStatusText(functionStatus(stale))).toBe('invalid: spec changed — regenerates on next call');
    const testsOnly = { ...committed, testsHash: 'x'.repeat(64) };
    expect(functionStatus(testsOnly)).toEqual({ kind: 'stale', what: 'tests' });
    const none = SCENARIOS.opening().program.functions.median;
    expect(functionStatusText(functionStatus(none))).toBe('no code yet — written on the first call');
  });

  it('finds the most recently committed function', () => {
    expect(latestCommitted(SCENARIOS.committed().program)?.spec.name).toBe('median');
    expect(latestCommitted(SCENARIOS.opening().program)).toBeUndefined();
  });
});

describe('signatureOf', () => {
  it('uses declared return, else the inferred one, else none', () => {
    expect(signatureOf(MEDIAN_SPEC)).toBe('function median(numbers: number[]): number');
    const untyped = { ...MEDIAN_SPEC, returns: null };
    expect(signatureOf(untyped, 'number')).toBe('function median(numbers: number[]): number');
    expect(signatureOf(untyped)).toBe('function median(numbers: number[])');
  });
});

describe('specPatch', () => {
  it('contains only changed fields', () => {
    const d = draftOf(MEDIAN_SPEC);
    expect(specPatch(MEDIAN_SPEC, d)).toEqual({});
    expect(specPatch(MEDIAN_SPEC, { ...d, tests: '', budgetMs: 500 })).toEqual({ tests: '', budgetMs: 500 });
  });
});

describe('attribution', () => {
  it('names gate, seed and shrink steps for properties', () => {
    const d = SCENARIOS['rejected-properties']().generation!.attempts[0].gates[2].diagnostics[0];
    expect(attribution(d, 'properties')).toBe(
      'by gate: properties · property "agrees with the sort-based reference" · seed 1938244123 · shrunk in 14 steps · 3 runs',
    );
  });
  it('names the invariant and phase', () => {
    const d = SCENARIOS['invariant-timeout']().generation!.attempts[0].gates[3].diagnostics[0];
    expect(attribution(d, 'invariants')).toBe('by gate: invariants · invariant: bounded · during tests');
  });
});

describe('compileMarks', () => {
  it('maps compile diagnostics to body lines only when compile failed', () => {
    const a = SCENARIOS['compile-rejected']().generation!.attempts[0];
    const marks = compileMarks(a.gates);
    expect([...marks.keys()]).toEqual([3]);
    expect(compileMarks(SCENARIOS.committed().generation!.attempts[1].gates).size).toBe(0);
  });
});

describe('inputHistory', () => {
  it('lists inputs in order', () => {
    expect(inputHistory(SCENARIOS.cached().repl)).toEqual(['median([3, 1, 4, 2])', 'median([3, 1, 4, 2])', 'xs = [10, 2, 38, 23]', 'median(xs)']);
  });
});

describe('declines in the selectors', () => {
  it('chipText says "declined — <message>" for a declined candidate', () => {
    const g = SCENARIOS['declined-pure']().generation!;
    expect(chipText(g.attempts[0]!)).toBe(`#1 declined — ${g.declined!.message}`);
    const spec = SCENARIOS['declined-spec']().generation!;
    expect(chipText(spec.attempts[0]!)).toMatch(/^#1 declined — What should clean do/);
    // an attempt aborted for another reason (no candidate) is unchanged
    expect(chipText({ attempt: 2, status: 'aborted', shown: '', gates: [] })).toBe('#2 aborted');
  });

  it('newSpecPrefill: parameters from the failed generation, the model question as the doc placeholder', () => {
    const gen = SCENARIOS['declined-spec']().generation!;
    expect(newSpecPrefill(gen, 'clean')).toEqual({ params: 'arg0: string', docPlaceholder: gen.declined!.message });
    expect(newSpecPrefill(gen, 'median')).toBeNull();
    expect(newSpecPrefill(null, 'clean')).toBeNull();
    // cannot-be-pure: parameters only (there is no question to ask)
    expect(newSpecPrefill(SCENARIOS['declined-pure']().generation!, 'now')).toEqual({ params: '' });
    // nested parentheses in parameter types (function arguments) survive
    const compose = {
      ...gen,
      fn: 'compose',
      signature: 'function compose(arg0: (...args: any[]) => any, arg1: { f: (x: number) => number })',
      declined: undefined,
    };
    expect(newSpecPrefill(compose, 'compose')).toEqual({ params: 'arg0: (...args: any[]) => any, arg1: { f: (x: number) => number }' });
  });
});
