/**
 * The decision flow below the engine, with the REAL compile gate and the REAL gate executor on the shipped examples:
 * the Decide facts a "spec was silent" rejection carries, the alternatives the card offers, the generated test, and
 * the waiver that lets a disagreeing ruling be satisfiable.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Diagnostic, FunctionSpec, GateResult, Json } from '@scasella/undefined-engine/types';
import { compileCandidate, transpileUserCode, warmUp } from '@scasella/undefined-engine/gates/compile';
import { executeGates, type ExecGateInput } from '@scasella/undefined-engine/sandbox/gateExecutor';
import { gateSeed, hashesFor } from '@scasella/undefined-engine/shared/hash';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import { EXAMPLES } from '../examples';
import { buildDecision, effectiveChecks, type RulingSpec } from '@scasella/undefined-engine/decide/decisions';
import { gapQuestion } from '@scasella/undefined-engine/decide/gaps';

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!;
const MEDIAN = ex('median');
const SLUGIFY = ex('slugify');
const MEDIAN_THROWS_ON_EMPTY = MEDIAN.badBodies.find((b) => b.silentOn)!.body;
const MEDIAN_GOOD = MEDIAN.goodBodies[0]!;
const SLUG_APOSTROPHE = SLUGIFY.badBodies.find((b) => b.silentOn === 'whether an apostrophe splits a word')!.body;
const SLUG_GOOD = SLUGIFY.goodBodies[0]!;

beforeAll(async () => {
  await warmUp();
}, 60_000);

async function gates(spec: FunctionSpec, body: string, extra: Partial<ExecGateInput> = {}): Promise<GateResult[]> {
  const c = await compileCandidate(spec, body);
  expect(c.gate.status).toBe('pass');
  const eff = effectiveChecks(spec);
  const t = transpileUserCode(eff.tests);
  const p = transpileUserCode(eff.properties);
  expect(t.error ?? p.error).toBeUndefined();
  const h = await hashesFor(spec);
  return executeGates(
    {
      name: spec.name,
      js: c.js!,
      testsJs: t.js,
      propertiesJs: p.js,
      budgetMs: spec.budgetMs,
      seed: gateSeed(h.specHash, h.testsHash),
      ...(eff.waived.length > 0 ? { waived: eff.waived } : {}),
      ...extra,
    },
    { phase() {}, enter() {}, leave() {} },
  );
}

const firstFailing = (rs: GateResult[]): GateResult | undefined => rs.find((g) => g.status === 'fail');

function decide(spec: FunctionSpec, d: Diagnostic, ruling: RulingSpec) {
  const q = gapQuestion({ spec, diagnostic: d })!;
  const dd = d as Extract<Diagnostic, { kind: 'test' | 'property' }>;
  return buildDecision({
    fn: spec.name,
    kind: q.kind,
    args: q.args,
    ruling,
    answers: { check: q.check.name, checkKind: q.check.kind, silentOn: q.silentOn, gate: q.check.gate },
    expected: dd.expectedOutcome,
    decidedAt: Date.UTC(2026, 9, 4),
  });
}

describe('median: the empty list', () => {
  it('the rejection carries the exact call, what the reference wanted and what the candidate did', async () => {
    const spec = MEDIAN.spec!;
    const fail = firstFailing(await gates(spec, MEDIAN_THROWS_ON_EMPTY))!;
    expect(fail.gate).toBe('properties');
    const d = fail.diagnostics[0]!;
    expect(d).toMatchObject({
      kind: 'property',
      silentOn: 'what the median of nothing is',
      call: 'median([])',
      args: [[]],
      expectedOutcome: { returns: { $t: 'number', v: 'NaN' } },
      actualOutcome: { throws: true },
    });
  });

  it('the Decide card: empty × number, the tests answer, the candidate answer, 0, and undefined disabled', async () => {
    const spec = MEDIAN.spec!;
    const d = firstFailing(await gates(spec, MEDIAN_THROWS_ON_EMPTY))!.diagnostics[0]!;
    const q = gapQuestion({ spec, diagnostic: d })!;
    expect(q).toMatchObject({ fn: 'median', kind: 'empty', call: 'median([])', silentOn: 'what the median of nothing is', expectedShown: 'NaN' });
    expect(q.actualShown).toMatch(/^threw Error: empty list/);
    expect(q.check).toEqual({ name: 'agrees with a sort-based reference', kind: 'property', gate: 'properties' });
    expect(q.alternatives.map((a) => [a.id, a.label, a.source, a.agrees, !!a.disabled])).toEqual([
      ['tests', 'NaN', 'tests', true, false],
      ['candidate', 'throws', 'candidate', false, false],
      ['zero', '0', 'common', false, false],
      ['undefined', 'undefined', 'common', false, true],
    ]);
    expect(q.ruleScope).toBeUndefined();
  });

  it('ruling NaN (agrees): one generated test, no waiver; the good body passes, the throwing body is now rejected by Tests', async () => {
    const spec = MEDIAN.spec!;
    const d = firstFailing(await gates(spec, MEDIAN_THROWS_ON_EMPTY))!.diagnostics[0]!;
    const dec = decide(spec, d, { kind: 'outcome', outcome: { returns: encodeValue(NaN) } });
    expect(dec.waives).toBe(false);
    expect(dec.test).toBe('test("decided: median([]) returns NaN", () => {\n  eq(median([]), NaN);\n});');
    const next: FunctionSpec = { ...spec, decisions: [dec] };
    expect(firstFailing(await gates(next, MEDIAN_GOOD))).toBeUndefined();
    const fail = firstFailing(await gates(next, MEDIAN_THROWS_ON_EMPTY))!;
    expect(fail.gate).toBe('tests');
    expect(fail.headline).toBe('Rejected: median([]) threw Error: empty list');
    // the decision test carries no marker: the rejection no longer says the spec was silent
    expect(fail.diagnostics[0]).not.toHaveProperty('silentOn');
  });

  it('ruling "throws" (disagrees): waives the reference on [] only; the throwing body passes, the NaN body fails', async () => {
    const spec = MEDIAN.spec!;
    const d = firstFailing(await gates(spec, MEDIAN_THROWS_ON_EMPTY))!.diagnostics[0]!;
    const dec = decide(spec, d, { kind: 'outcome', outcome: { throws: true } });
    expect(dec.waives).toBe(true);
    expect(dec.test).toBe('test("decided: median([]) throws", () => {\n  throws(() => median([]));\n});');
    const next: FunctionSpec = { ...spec, decisions: [dec] };
    expect(effectiveChecks(next).waived).toEqual([{ kind: 'property', name: 'agrees with a sort-based reference' }]);
    const ok = await gates(next, MEDIAN_THROWS_ON_EMPTY);
    expect(firstFailing(ok)).toBeUndefined();
    // the reference still ran (and still catches real mistakes off the silent domain)
    expect(ok[1]!.summary).toMatch(/^3\/3 properties held/);
    const fail = firstFailing(await gates(next, MEDIAN_GOOD))!;
    expect(fail.gate).toBe('tests');
    expect(fail.headline).toBe('Rejected: test "decided: median([]) throws" failed after median([]): expected an error, but nothing was thrown');
    // a real mistake off the silent domain is still rejected by the (waived-on-[] only) reference
    const sortBug = MEDIAN.badBodies.find((b) => b.rejectedBy === 'properties' && !b.silentOn)!.body.replace('if (numbers.length === 0) return NaN;', "if (numbers.length === 0) throw new Error('empty');");
    expect(firstFailing(await gates(next, sortBug))?.gate).toBe('properties');
  });
});

describe('slugify: the apostrophe', () => {
  it('the unit-test rejection carries the call, the tests answer and the candidate answer', async () => {
    const spec = SLUGIFY.spec!;
    const fail = firstFailing(await gates(spec, SLUG_APOSTROPHE))!;
    expect(fail.gate).toBe('tests');
    const d = fail.diagnostics.find((x) => x.kind === 'test' && x.name === 'apostrophes')!;
    expect(d).toMatchObject({ args: ["Don't Stop"], expectedOutcome: { returns: 'dont-stop' }, actualOutcome: { returns: 'don-t-stop' } });
    const q = gapQuestion({ spec, diagnostic: d })!;
    expect(q.kind).toBe('symbols');
    expect(q.alternatives.map((a) => [a.id, a.label])).toEqual([
      ['tests', '"dont-stop"'],
      ['candidate', '"don-t-stop"'],
    ]);
  });

  it('ruling "don-t-stop" replaces the apostrophes test; ruling "dont-stop" keeps it', async () => {
    const spec = SLUGIFY.spec!;
    const d = firstFailing(await gates(spec, SLUG_APOSTROPHE))!.diagnostics.find((x) => x.kind === 'test' && x.name === 'apostrophes')!;
    const keep = decide(spec, d, { kind: 'outcome', outcome: { returns: 'dont-stop' } });
    const split = decide(spec, d, { kind: 'outcome', outcome: { returns: 'don-t-stop' } });
    expect(keep.id).toBe(split.id); // same call, same check: deciding again replaces
    expect(keep.waives).toBe(false);
    expect(split.waives).toBe(true);
    expect(split.test).toBe('test("decided: slugify(\\"Don\'t Stop\\") returns \\"don-t-stop\\"", () => {\n  eq(slugify("Don\'t Stop"), "don-t-stop");\n});');
    const splitSpec: FunctionSpec = { ...spec, decisions: [split] };
    const r = await gates(splitSpec, SLUG_APOSTROPHE);
    expect(firstFailing(r)).toBeUndefined();
    // the replaced test is not run and not counted; the note says why; the summary format is unchanged
    expect(r[0]!.summary).toBe('10/10 tests passed');
    expect(r[0]!.note).toBe('1 check replaced by your decision');
    expect(firstFailing(await gates(splitSpec, SLUG_GOOD))?.headline).toBe('Rejected: slugify("Don\'t Stop") returned "dont-stop", expected "don-t-stop"');
    expect(firstFailing(await gates({ ...spec, decisions: [keep] }, SLUG_GOOD))).toBeUndefined();
  });
});

describe('executor details', () => {
  const NUM = { name: 'f', params: [{ name: 'n', type: 'number' }], returns: 'number', doc: '', budgetMs: 1000, maxAttempts: 3, origin: 'user' as const };

  it('collects no Decide facts for an unmarked check (diagnostics unchanged)', async () => {
    const spec: FunctionSpec = { ...NUM, tests: "test('t', () => eq(f(-1), 0));", properties: '' };
    const d = firstFailing(await gates(spec, 'return n;'))!.diagnostics[0]!;
    expect(d).not.toHaveProperty('args');
    expect(gapQuestion({ spec, diagnostic: d })).toBeNull();
  });

  it('a marked throws() check gives expectedOutcome throws; negative × number offers NaN and 0, and the rule scope', async () => {
    const spec: FunctionSpec = { ...NUM, tests: "test('negatives', () => throws(() => f(-1)), { silentOn: 'what a negative n means' });", properties: '' };
    const d = firstFailing(await gates(spec, 'return n;'))!.diagnostics[0]!;
    expect(d).toMatchObject({ args: [-1], expectedOutcome: { throws: true }, actualOutcome: { returns: -1 } });
    const q = gapQuestion({ spec, diagnostic: d })!;
    expect(q.kind).toBe('negative');
    expect(q.alternatives.map((a) => a.id)).toEqual(['tests', 'candidate', 'nan', 'zero']);
    expect(q.ruleScope).toEqual({ label: 'for every negative n' });
  });

  it('declared alternatives are evaluated by the check and offered (deduplicated)', async () => {
    const spec: FunctionSpec = {
      ...NUM,
      tests: "test('neg', () => eq(f(-2), 2), { silentOn: 'negatives', alternatives: [{ label: 'absolute value', value: 2 }, { label: 'minus one', value: -1 }, { label: 'refuse', throws: true }] });",
      properties: '',
    };
    const d = firstFailing(await gates(spec, 'return n;'))!.diagnostics[0]!;
    expect((d as { alternatives?: unknown }).alternatives).toEqual([
      { label: 'absolute value', outcome: { returns: 2 } },
      { label: 'minus one', outcome: { returns: -1 } },
      { label: 'refuse', outcome: { throws: true } },
    ]);
    const q = gapQuestion({ spec, diagnostic: d })!;
    expect(q.alternatives.map((a) => [a.id, a.label, a.source])).toEqual([
      ['tests', '2', 'tests'],
      ['candidate', '-2', 'candidate'],
      ['throws', 'throws', 'common'],
      ['nan', 'NaN', 'common'],
      ['zero', '0', 'common'],
      ['declared-1', 'minus one', 'declared'],
    ]);
  });

  it('a malformed alternatives option is a spec error', async () => {
    const spec: FunctionSpec = { ...NUM, tests: "test('x', () => eq(f(1), 1), { silentOn: 's', alternatives: [{ value: 1 }] });", properties: '' };
    const r = await gates(spec, 'return n;');
    expect(r[0]).toMatchObject({ status: 'fail', note: 'spec error' });
  });

  it('a waived property without `when` is not run; with `when` it passes vacuously only there', async () => {
    const props = "property('p', [fc.integer()], (n) => f(n) === n);\nproperty('q', [fc.integer()], (n) => f(n) === n, { silentOn: 's', when: (n) => n < 0 });";
    const spec: FunctionSpec = { ...NUM, tests: '', properties: props };
    const abs = 'return Math.abs(n);';
    const before = await gates(spec, abs);
    expect(firstFailing(before)?.diagnostics.map((x) => (x as { name: string }).name)).toEqual(['p', 'q']);
    const r = await gates(spec, abs, { waived: [{ kind: 'property', name: 'q' }] });
    expect(firstFailing(r)?.diagnostics.map((x) => (x as { name: string }).name)).toEqual(['p']);
    const r2 = await gates(spec, abs, { waived: [{ kind: 'property', name: 'q' }, { kind: 'property', name: 'p' }] });
    expect(firstFailing(r2)).toBeUndefined();
    expect(r2[1]!.summary).toMatch(/^1\/1 property held/);
    expect(r2[1]!.note).toBe('1 check replaced by your decision');
  });

  it('a property marked silent on EVERY input (no `when`) can only be ruled on with its own answer: a waiver would switch it off everywhere', async () => {
    const ref = "(n) => { if (n < 0) throw new Error('negative'); return n; }";
    const whenless: FunctionSpec = { ...NUM, tests: '', properties: `matchesReference('ref', [fc.integer()], ${ref}, { silentOn: 'what a negative n means' });` };
    const d = firstFailing(await gates(whenless, 'return n;'))!.diagnostics[0]!;
    expect(d).toMatchObject({ kind: 'property', everyInput: true, expectedOutcome: { throws: true } });
    const q = gapQuestion({ spec: whenless, diagnostic: d })!;
    expect(q.onlyAgreeing).toMatch(/switch it off everywhere/);
    expect(q.alternatives.filter((a) => !a.disabled).map((a) => a.id)).toEqual(['tests']);
    expect(q.alternatives.find((a) => a.id === 'candidate')!.disabled).toBe(q.onlyAgreeing);

    // the same check with a `when` is silent only there: every alternative stays open
    const scoped: FunctionSpec = { ...whenless, properties: `matchesReference('ref', [fc.integer()], ${ref}, { silentOn: 'what a negative n means', when: (n) => n < 0 });` };
    const d2 = firstFailing(await gates(scoped, 'return n;'))!.diagnostics[0]!;
    expect(d2).not.toHaveProperty('everyInput');
    const q2 = gapQuestion({ spec: scoped, diagnostic: d2 })!;
    expect(q2.onlyAgreeing).toBeUndefined();
    expect(q2.alternatives.every((a) => !a.disabled)).toBe(true);
  });

  it('the probe reports the encoded value of an expression', async () => {
    const spec: FunctionSpec = { ...NUM, tests: 'test("probe", () => { eq((-0), { __undefinedProbe: true }); });', properties: '' };
    const d = firstFailing(await gates(spec, 'return n;', { probe: true }))!.diagnostics[0]!;
    expect((d as { actualValue?: Json }).actualValue).toEqual({ $t: 'number', v: '-0' });
  });

  it('arguments are cloned before the call: a candidate that empties its argument still reports the original call', async () => {
    const spec: FunctionSpec = {
      name: 'g',
      params: [{ name: 'xs', type: 'number[]' }],
      returns: 'number',
      doc: '',
      tests: "test('t', () => eq(g([1, 2]), 3), { silentOn: 's' });",
      properties: '',
      budgetMs: 1000,
      maxAttempts: 3,
      origin: 'user',
    };
    const d = firstFailing(await gates(spec, 'xs.length = 0; return 0;'))!.diagnostics[0]!;
    expect(d).toMatchObject({ args: [[1, 2]], actualOutcome: { returns: 0 }, expectedOutcome: { returns: 3 } });
  });
});
