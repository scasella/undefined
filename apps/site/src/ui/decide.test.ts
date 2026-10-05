import { describe, expect, it } from 'vitest';
import type { GapQuestion } from '@scasella/undefined-engine/types';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import { altParts, consequenceLines, decisionTestName, questionLine, removalMessage, rulingAgrees, rulingFor, sourceTag, testPreview } from './decide';

const NAN = { returns: encodeValue(NaN) };
const q: GapQuestion = {
  fn: 'median',
  kind: 'empty',
  call: 'median([])',
  args: [[]],
  silentOn: 'what the median of nothing is',
  check: { name: 'agrees with a sort-based reference', kind: 'property', gate: 'properties' },
  expectedShown: 'NaN',
  actualShown: 'threw Error: empty list',
  alternatives: [
    { id: 'tests', label: 'NaN', source: 'tests', outcome: NAN, agrees: true },
    { id: 'candidate', label: 'throws', source: 'candidate', outcome: { throws: true }, agrees: false },
    { id: 'zero', label: '0', source: 'common', outcome: { returns: 0 }, agrees: false },
    { id: 'undefined', label: 'undefined', source: 'common', outcome: { returns: encodeValue(undefined) }, agrees: false, disabled: 'no' },
  ],
};
const spec = { params: [{ name: 'numbers', type: 'number[]' }] };

describe('Decide card copy', () => {
  it('asks the question and labels choices by where they come from', () => {
    expect(questionLine(q)).toBe("The spec didn't say what the median of nothing is.");
    expect(altParts(q.alternatives[0]!)).toEqual({ verb: 'returns', value: 'NaN' });
    expect(altParts(q.alternatives[1]!)).toEqual({ verb: 'throws an error', value: null });
    expect(sourceTag(q.alternatives[0]!, 1)).toBe('what your tests expect');
    expect(sourceTag(q.alternatives[1]!, 1)).toBe('what draft #1 did');
  });
  it('builds the ruling as the engine does, and previews the exact test', () => {
    const nan = rulingFor(q, { kind: 'alternative', id: 'tests' }, null)!;
    expect(rulingAgrees(q, nan)).toBe(true);
    expect(rulingFor(q, { kind: 'alternative', id: 'undefined' }, null)).toBeNull();
    const t = testPreview(spec, q, nan, 'call');
    expect(t.plain).toBe('Adds a test: median([]) returns NaN.');
    expect(t.source).toContain('eq(median([]), NaN);');
    expect(decisionTestName({ test: t.source })).toBe('decided: median([]) returns NaN');
    // typed: a clean value is a value (it can agree); a call of the function stays source
    expect(rulingFor(q, { kind: 'custom', expr: 'NaN', throws: false }, { ok: true, shown: 'NaN', outcome: NAN, mentionsFn: false })).toEqual({ kind: 'outcome', outcome: NAN });
    expect(rulingFor(q, { kind: 'custom', expr: 'median([0])', throws: false }, { ok: true, shown: '0', outcome: { returns: 0 }, mentionsFn: true })).toEqual({ kind: 'expr', expr: 'median([0])' });
    expect(rulingFor(q, { kind: 'custom', expr: 'x', throws: false }, { ok: false, error: 'nope' })).toBeNull();
    expect(rulingFor(q, { kind: 'custom', expr: '', throws: true }, null)).toEqual({ kind: 'outcome', outcome: { throws: true } });
  });
  it('says what is replaced, and flags replay for a disagreeing ruling only', () => {
    expect(consequenceLines(q, true, { committed: true, replay: true })).toMatchObject({ needsLive: false });
    const w = consequenceLines(q, false, { committed: true, replay: true });
    expect(w.needsLive).toBe(true);
    expect(w.lines[0]).toMatch(/replaces your check "agrees with a sort-based reference" where the spec was silent/);
    expect(consequenceLines({ ...q, check: { name: 'apostrophes', kind: 'test', gate: 'tests' } }, false, { committed: true, replay: false }).lines[0]).toMatch(/replaces your test "apostrophes", all of it/);
  });
});

describe('removalMessage', () => {
  const prog = (artifact: object | null) => ({ functions: { median: { specHash: 's', testsHash: 't', artifact } } }) as never;
  it('says the committed function is back when it passes without the decision', () => {
    expect(removalMessage(prog({ specHash: 's', testsHash: 't', revision: 2 }), 'median', 'median([]) → NaN')).toBe('Removed your decision median([]) → NaN. median r2 passes the spec without it.');
  });
  it('never claims a stale or missing function is live', () => {
    expect(removalMessage(prog({ specHash: 's', testsHash: 'old', revision: 2 }), 'median', 'x')).toBe('Removed your decision x. median is written again on its next call.');
    expect(removalMessage(prog(null), 'median', 'x')).toBe('Removed your decision x. median is written again on its next call.');
  });
});
