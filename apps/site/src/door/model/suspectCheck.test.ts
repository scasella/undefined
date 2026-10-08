import { describe, expect, it } from 'vitest';
import type { FunctionSpec, GenerationView } from '@scasella/undefined-engine/types';
import { listTestNames } from '@scasella/undefined-engine/shared/specInfo';
import { RECORDED_DRAFT, recordedSpec } from './recordedDraft';
import { draftedBlocks, requirementLine, suspectCheck, withoutCheck, withRequirement } from './suspectCheck';

const BASE: FunctionSpec = { name: 'revenueByCountry', params: [{ name: 'rows', type: 'Row[]' }], returns: null, doc: 'Answer this question about the table: What is our revenue by country?', tests: '', properties: '', budgetMs: 1000, maxAttempts: 3, origin: 'user' };
const SPEC = recordedSpec(RECORDED_DRAFT!, BASE)!;
const exampleNames = listTestNames(SPEC.tests);
const ruleNames = listTestNames(SPEC.properties);

type Attempt = GenerationView['attempts'][number];
const rejectedBy = (gate: 'tests' | 'properties' | 'compile', name: string, actual = '[]', kind: 'test' | 'property' = gate === 'properties' ? 'property' : 'test'): Attempt =>
  ({
    attempt: 0,
    status: 'rejected',
    shown: '',
    gates: [
      { gate: 'compile', status: gate === 'compile' ? 'fail' : 'pass', ms: 1, summary: '', diagnostics: gate === 'compile' ? [{ kind: 'compile', message: 'x' }] : [] },
      ...(gate === 'compile' ? [] : [{ gate, status: 'fail', ms: 1, summary: '', diagnostics: [{ kind, name, message: 'm', call: 'f(rows)', expected: '[1]', actual, counterexample: '[]', shrinks: 0, runs: 1, seed: 1 }] }]),
    ],
  }) as unknown as Attempt;
const gen = (attempts: Attempt[]): GenerationView => ({ id: 'g', fn: 'revenueByCountry', signature: '', call: '', phase: 'failed', attempt: attempts.length, maxAttempts: 3, progress: [], attempts, ungated: false, mode: 'live' }) as GenerationView;

describe('a drafted section splits back into its checks', () => {
  it('every drafted check of the recorded draft is one block, and removing one leaves the others byte for byte', () => {
    for (const [key, names] of [['tests', exampleNames], ['properties', ruleNames]] as const) {
      const blocks = draftedBlocks(SPEC[key])!;
      expect(blocks.map((b) => b.name)).toEqual(names);
      for (const b of blocks) expect(b.plain).not.toBe('');
      for (const n of names) {
        const out = withoutCheck(SPEC, { name: n, kind: key === 'tests' ? 'example' : 'rule' })!;
        expect(listTestNames(out[key])).toEqual(names.filter((x) => x !== n));
        for (const other of blocks.filter((b) => b.name !== n)) expect(out[key]).toContain(other.text.trimEnd());
        expect(out[key === 'tests' ? 'properties' : 'tests']).toBe(SPEC[key === 'tests' ? 'properties' : 'tests']);
      }
    }
  });
  it('a hand-written section is not a drafted one', () => {
    expect(draftedBlocks('test("a", () => {});')).toBeNull();
    expect(withoutCheck({ ...SPEC, tests: 'test("a", () => {});' }, { name: 'a', kind: 'example' })).toBeNull();
  });
});

describe('this check may be wrong', () => {
  const ex = exampleNames[0]!;
  const rule = ruleNames[0]!;
  it('every draft thrown out by the same drafted example, all giving the same answer: the check is the suspect', () => {
    const s = suspectCheck(gen([rejectedBy('tests', ex, '[{"country":"US"}]'), rejectedBy('tests', ex, '[{"country":"US"}]'), rejectedBy('tests', ex, '[{"country":"US"}]')]), SPEC)!;
    expect(s).toMatchObject({ name: ex, kind: 'example', reading: 'check', drafts: 3, call: 'f(rows)', expected: '[1]' });
    expect(s.gave).toEqual(['[{"country":"US"}]', '[{"country":"US"}]', '[{"country":"US"}]']);
    expect(s.plain).toBe(draftedBlocks(SPEC.tests)!.find((b) => b.name === ex)!.plain);
  });
  it('drafts that disagree with each other, or a house rule: the agreement may not say what the check requires', () => {
    expect(suspectCheck(gen([rejectedBy('tests', ex, '1'), rejectedBy('tests', ex, '2')]), SPEC)!.reading).toBe('agreement');
    const r = suspectCheck(gen([rejectedBy('properties', rule), rejectedBy('properties', rule)]), SPEC)!;
    expect(r).toMatchObject({ kind: 'rule', reading: 'agreement', gave: [], call: null });
  });
  it('no suspect: one draft only, different checks, a draft that did not compile, or a check nobody drafted', () => {
    expect(suspectCheck(gen([rejectedBy('tests', ex)]), SPEC)).toBeNull();
    expect(suspectCheck(gen([rejectedBy('tests', ex), rejectedBy('tests', exampleNames[1]!)]), SPEC)).toBeNull();
    expect(suspectCheck(gen([rejectedBy('tests', ex), rejectedBy('compile', '')]), SPEC)).toBeNull();
    expect(suspectCheck(gen([rejectedBy('tests', 'hand written'), rejectedBy('tests', 'hand written')]), { ...SPEC, tests: 'test("hand written", () => {});' })).toBeNull();
    expect(suspectCheck(null, SPEC)).toBeNull();
  });
  it('keeping the check writes what it requires into the agreement, once', () => {
    const once = withRequirement(SPEC, { plain: 'Counts paid rows only.' });
    expect(once.doc.endsWith(requirementLine('Counts paid rows only.'))).toBe(true);
    expect(withRequirement(once, { plain: 'Counts paid rows only.' })).toBe(once);
    expect(once.tests).toBe(SPEC.tests);
  });
});

describe('the thrown-out card’s words for a suspect check', async () => {
  const { suspectView, SUSPECT_DEMO } = await import('../start/RunStates');
  const base = { name: 'n', kind: 'example' as const, plain: 'Counts paid rows only.', source: 'test()', drafts: 3, call: 'f(rows)', expected: '2', gave: ['3', '3', '3'] };
  it('the check is the suspect: drop first, the evidence says every draft gave the same answer', () => {
    const v = suspectView({ ...base, reading: 'check' }, 'live');
    expect(v.head).toBe('This check may be wrong');
    expect(v.intro).toBe('All 3 drafts failed the same check, one the AI drafted for you: “Counts paid rows only.”');
    expect(v.evidence).toBe('f(rows): the check expects 2; every draft gave 3.');
    expect(v.actions.map((a) => a.id)).toEqual(['drop', 'keep']);
    expect(v.demo).toBeNull();
  });
  it('the agreement is the suspect: write it in first; the demo says what it cannot do instead of offering it', () => {
    const v = suspectView({ ...base, reading: 'agreement', gave: ['1', '2', '3'] }, 'replay');
    expect(v.head).toBe('Your agreement may not say what this check requires');
    expect(v.evidence).toBe('f(rows): the check expects 2; the drafts gave 1 · 2 · 3.');
    expect(v.actions.map((a) => a.id)).toEqual(['keep', 'drop']);
    expect(v.demo).toBe(SUSPECT_DEMO);
    expect(`${v.head} ${v.why}`).not.toMatch(/proof|proven|spec|gate|property/i);
  });
});
