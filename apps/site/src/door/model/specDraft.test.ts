import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import type { FunctionSpec } from '@scasella/undefined-engine/types';
import { buildDraftPrompt, draftToSpec, keptCount, parseDraft, syntaxProblem, type Transpiler } from './specDraft';

const FN = 'howManyOrdersWereRefunded';
const example = (name: string, body = `eq(${FN}([]), 0);`) => `test(${JSON.stringify(name)}, () => {\n  ${body}\n});`;
const rule = (name: string) => `property(${JSON.stringify(name)}, [fc.array(fc.record({ status: fc.constantFrom('paid', 'refunded') }))], (t) => {\n  return ${FN}(t) <= t.length;\n}, { numRuns: 200 });`;
const draft = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    questions: [],
    contract: 'Returns the number of rows whose status is exactly "refunded".',
    returns: 'number',
    examples: [{ name: 'an empty table has none', plain: 'An empty table gives 0.', assumption: '', source: example('an empty table has none') }],
    rules: [{ name: 'never more than the rows', plain: 'Never more than the number of rows.', assumption: 'Partial refunds do not count.', source: rule('never more than the rows') }],
    shows: 'It counts refunded rows on these tables.',
    limits: 'Only made-up tables were tried.',
    ...over,
  });

describe('the draft prompt', () => {
  const base = { question: 'How many orders were refunded?', fn: FN, param: 'rows', typeName: 'Row', typeDecl: 'type Row = { id: number; status: string };', rowCount: 332, settled: [] };
  it('asks for the contract, not the function, in the Test API, and says it must ask when unsure', () => {
    const p = buildDraftPrompt(base);
    expect(p).toContain('You are drafting the CONTRACT');
    expect(p).toContain(`${FN}(rows: Row[])`);
    expect(p).toContain('NOT vitest');
    expect(p).toMatch(/ASK: return up to 3 questions/);
    expect(p).toContain('(The user chose not to share sample rows');
  });
  it('carries what the user settled, sample rows when shared, and stops asking after the last round', () => {
    const p = buildDraftPrompt({ ...base, sampleText: '[{"id":1}]', settled: [{ ask: 'Do partial refunds count?', answer: 'No' }], noMoreQuestions: true });
    expect(p).toContain('- Do partial refunds count? → No');
    expect(p).toContain('[{"id":1}]');
    expect(p).toContain('Do NOT ask anything more');
    expect(p).not.toMatch(/ASK: return up to/);
  });
});

describe('reading the draft', () => {
  it('reads a usable draft, also inside a markdown fence', () => {
    for (const body of [draft(), '```json\n' + draft() + '\n```']) {
      const r = parseDraft(body, FN);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.draft.examples.map((e) => e.name)).toEqual(['an empty table has none']);
      expect(r.draft.rules[0]!.assumption).toBe('Partial refunds do not count.');
    }
  });
  it('questions come back alone: nothing is drafted until they are answered', () => {
    const r = parseDraft(draft({ questions: [{ ask: 'Do partial refunds count?', why: 'It changes the count.', options: ['Yes', 'No', ''] }] }), FN);
    expect(r.ok && r.draft.questions).toEqual([{ id: 'q1', ask: 'Do partial refunds count?', why: 'It changes the count.', options: ['Yes', 'No'] }]);
    expect(r.ok && r.draft.examples).toEqual([]);
  });
  it('refuses checks that would stop the run or test nothing', () => {
    const bad = (over: Record<string, unknown>) => {
      const r = parseDraft(draft(over), FN);
      return r.ok ? null : r.error;
    };
    expect(bad({ examples: [{ name: 'x', plain: '', assumption: '', source: example('a') + '\n' + example('b') }] })).toMatch(/exactly one check/);
    expect(bad({ examples: [{ name: 'x', plain: '', assumption: '', source: rule('a') }] })).toMatch(/must be a test/);
    expect(bad({ examples: [{ name: 'x', plain: '', assumption: '', source: example('a', 'eq(1, 1);') }] })).toMatch(/never calls/);
    expect(bad({ rules: [{ name: 'x', plain: '', assumption: '', source: rule('an empty table has none') }] })).toMatch(/both called/);
    expect(bad({ contract: '' })).toMatch(/no contract/);
    expect(bad({ examples: [] })).toMatch(/no examples/);
    expect(parseDraft('not json', FN).ok).toBe(false);
  });
  it('finds a syntax error before it can stop the run', () => {
    const r = parseDraft(draft({ examples: [{ name: 'x', plain: '', assumption: '', source: `test("x", () => { eq(${FN}([]), 0 });` }] }), FN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(syntaxProblem(r.draft, ts as unknown as Transpiler)).toMatch(/check "x" has a syntax error/);
    const good = parseDraft(draft(), FN);
    expect(good.ok && syntaxProblem(good.draft, ts as unknown as Transpiler)).toBeNull();
  });
});

describe('the approved spec', () => {
  const base: FunctionSpec = { name: FN, params: [{ name: 'rows', type: 'Row[]' }], returns: null, doc: 'x', tests: '', properties: '', budgetMs: 1000, maxAttempts: 3, origin: 'user' };
  it('writes the contract and every settled point into doc (the answering model never sees check bodies) and keeps only the kept checks', () => {
    const r = parseDraft(draft(), FN);
    if (!r.ok) throw new Error(r.error);
    const spec = draftToSpec(base, r.draft, new Set(['e1']), [{ ask: 'Do partial refunds count?', answer: 'No' }], 'How many orders were refunded?');
    expect(spec.returns).toBe('number');
    expect(spec.doc).toContain('How many orders were refunded?');
    expect(spec.doc).toContain('exactly "refunded"');
    expect(spec.doc).toContain('- Do partial refunds count? No');
    expect(spec.tests).toContain('an empty table has none');
    expect(spec.properties).toBe('');
    expect(keptCount(r.draft, new Set(['e1']))).toBe('1 example and 0 house rules');
  });
});
