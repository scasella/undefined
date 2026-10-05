import { beforeAll, describe, expect, it } from 'vitest';
import type { Decision, FunctionSpec, Json, Recording } from '@scasella/undefined-engine/types';
import { transpileUserCode, warmUp, compileCandidate } from '@scasella/undefined-engine/gates/compile';
import { executeGates } from '@scasella/undefined-engine/sandbox/gateExecutor';
import { hashesFor } from '@scasella/undefined-engine/shared/hash';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import { buildPrompt } from '../shared/prompt';
import { describeEvidence, describeProperties, describeTests } from '@scasella/undefined-engine/shared/evidence';
import { specWithDecisions, withDecisions, recordFor } from '@scasella/undefined-engine/program';
import { readDecisions, toImage, validateImage } from '../core/store';
import { ReplayGenerator, RecordingSink, recordedAttempt, recordedPrompt, validateRecording } from '../core/generator';
import { EXAMPLES } from '../examples';
import {
  agrees,
  allImplied,
  buildDecision,
  callSource,
  decidedOn,
  decisionNote,
  decisionPromptLine,
  decisionSummary,
  decisionTest,
  effectiveChecks,
  ruleDomain,
  sameOutcome,
  upsertDecision,
  waiverText,
  withoutDecisions,
} from '@scasella/undefined-engine/decide/decisions';
import { classifyGap, returnCategory, tableRows } from '@scasella/undefined-engine/decide/gaps';

const MEDIAN = EXAMPLES.find((e) => e.id === 'median')!.spec!;
const AT = Date.UTC(2026, 9, 4, 12);

const nanDecision = (reason?: string): Decision =>
  buildDecision({
    fn: 'median',
    kind: 'empty',
    args: [[]],
    ruling: { kind: 'outcome', outcome: { returns: encodeValue(NaN) } },
    answers: { check: 'agrees with a sort-based reference', checkKind: 'property', silentOn: 'what the median of nothing is', gate: 'properties' },
    expected: { returns: encodeValue(NaN) },
    decidedAt: AT,
    ...(reason ? { reason } : {}),
  });
const throwsDecision = (): Decision =>
  buildDecision({
    fn: 'median',
    kind: 'empty',
    args: [[]],
    ruling: { kind: 'outcome', outcome: { throws: true } },
    answers: { check: 'agrees with a sort-based reference', checkKind: 'property', silentOn: 'what the median of nothing is', gate: 'properties' },
    expected: { returns: encodeValue(NaN) },
    decidedAt: AT,
  });

beforeAll(async () => {
  await warmUp();
}, 60_000);

describe('effective checks and hashes', () => {
  it('no decisions: the very same strings, nothing waived, the same hashes', async () => {
    const eff = effectiveChecks(MEDIAN);
    expect(eff.tests).toBe(MEDIAN.tests);
    expect(eff.properties).toBe(MEDIAN.properties);
    expect(eff.waived).toEqual([]);
    expect(effectiveChecks({ ...MEDIAN, decisions: [] }).tests).toBe(MEDIAN.tests);
  });

  it('decisions append a block to the effective tests; hashes change only with what changes a verdict', async () => {
    const d = nanDecision('first reason');
    const spec = specWithDecisions(MEDIAN, [d]);
    const eff = effectiveChecks(spec);
    expect(eff.tests).toBe(`${MEDIAN.tests.trimEnd()}\n\n// Decisions (decided by you; listed in the Repo tab)\n${d.test}\n`);
    expect(eff.properties).toBe(MEDIAN.properties);
    const base = await hashesFor(MEDIAN);
    const h = await hashesFor(spec);
    expect(h.specHash).toBe(base.specHash);
    expect(h.testsHash).not.toBe(base.testsHash);
    // the date, the reason, the id and the label are not hashed
    const other = { ...d, decidedAt: AT + 86_400_000, reason: 'another reason', id: 'd-other', call: 'x', ruling: { ...d.ruling, label: 'x' } } as Decision;
    expect(await hashesFor(specWithDecisions(MEDIAN, [other]))).toEqual(h);
    // the waiver is: same test text, waiving → different hash
    expect((await hashesFor(specWithDecisions(MEDIAN, [{ ...d, waives: true }]))).testsHash).not.toBe(h.testsHash);
    // removing the last decision removes the field
    expect('decisions' in specWithDecisions(spec, [])).toBe(false);
    expect(withoutDecisions(spec)).toEqual(MEDIAN);
    expect(await hashesFor(specWithDecisions(spec, []))).toEqual(base);
  });

  it('withDecisions recomputes the record; an artifact certified before goes stale', async () => {
    const p = { functions: { median: await recordFor(MEDIAN) } };
    const q = await withDecisions(p, 'median', [nanDecision()]);
    expect(q.functions.median!.testsHash).not.toBe(p.functions.median!.testsHash);
    await expect(withDecisions(p, 'nope', [])).rejects.toThrow(/no function named nope/);
  });

  it('waivers: distinct checks of the waiving decisions only; implied = none waives', () => {
    const t = throwsDecision();
    expect(effectiveChecks(specWithDecisions(MEDIAN, [t])).waived).toEqual([{ kind: 'property', name: 'agrees with a sort-based reference' }]);
    expect(allImplied(specWithDecisions(MEDIAN, [nanDecision()]))).toBe(true);
    expect(allImplied(specWithDecisions(MEDIAN, [t]))).toBe(false);
    expect(allImplied(MEDIAN)).toBe(false);
  });
});

describe('decision source and text', () => {
  it('ids: the same call of the same check replaces; upsert keeps order', () => {
    const a = nanDecision();
    const b = throwsDecision();
    expect(a.id).toBe(b.id);
    expect(upsertDecision([a], b)).toEqual([b]);
    expect(agrees({ kind: 'outcome', outcome: { throws: true } }, { throws: true })).toBe(true);
    expect(agrees({ kind: 'expr', expr: 'NaN' }, { returns: encodeValue(NaN) })).toBe(false);
    expect(sameOutcome({ returns: encodeValue(-0) }, { returns: 0 })).toBe(false);
  });

  it('literals round-trip exactly through eq() in the real executor: NaN, -0, undefined, bigint, Map, Set, Date, objects', async () => {
    const values: unknown[] = [NaN, -0, undefined, Infinity, 12n, new Map([[1, 'a']]), new Set([1, 2]), new Date(5), { a: [1, { b: null }] }, 'it\'s "q"', [1, , 3]];
    for (const v of values) {
      const enc = encodeValue(v);
      const fn = 'ident';
      const src = decisionTest(fn, [enc], { kind: 'outcome', outcome: { returns: enc } });
      const spec: FunctionSpec = { name: fn, params: [{ name: 'x', type: 'unknown' }], returns: 'unknown', doc: '', tests: src, properties: '', budgetMs: 1000, maxAttempts: 1, origin: 'user' };
      const c = await compileCandidate(spec, 'return x;');
      const t = transpileUserCode(src);
      expect(t.error, src).toBeUndefined();
      const r = executeGates({ name: fn, js: c.js!, testsJs: t.js, propertiesJs: '', budgetMs: 1000, seed: 1, phases: ['tests'] }, { phase() {}, enter() {}, leave() {} });
      expect(r[0]!.status, src).toBe('pass');
    }
  });

  it('call source is rebuilt from the encoded arguments, never the (possibly cut) display text', () => {
    const long = Array.from({ length: 300 }, (_, i) => i);
    const src = callSource('f', [encodeValue(long) as Json]);
    expect(src).toContain('299');
    expect(src).not.toContain('…');
  });

  it('a rule ruling is a property over the gap kind (single number parameter)', async () => {
    const spec: FunctionSpec = { name: 'fib', params: [{ name: 'n', type: 'number' }], returns: 'number', doc: '', tests: '', properties: '', budgetMs: 1000, maxAttempts: 1, origin: 'user' };
    const rule = ruleDomain(spec, 'negative')!;
    expect(rule).toMatchObject({ phrase: 'every negative n', arbitrary: 'fc.integer({ max: -1 })' });
    expect(ruleDomain(spec, 'empty')).toBeNull();
    expect(ruleDomain({ params: [{ name: 'n', type: 'bigint' }] }, 'non-integer')).toBeNull();
    expect(ruleDomain({ params: [{ name: 'n', type: 'number' }] }, 'non-integer')!.arbitrary).toMatch(/noInteger: true/);
    expect(ruleDomain({ params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }] }, 'negative')).toBeNull();
    const d = buildDecision({
      fn: 'fib',
      kind: 'negative',
      args: [-1],
      ruling: { kind: 'outcome', outcome: { throws: true } },
      answers: { check: 'negatives', checkKind: 'test', silentOn: 'negative n', gate: 'tests' },
      expected: { returns: 0 },
      rule,
      decidedAt: AT,
    });
    expect(d.placement).toBe('properties');
    expect(d.test).toBe('property("decided: for every negative n, fib(n) throws", [fc.integer({ max: -1 })], (n: number) => {\n  throws(() => fib(n));\n});');
    expect(decisionSummary(d)).toBe('for every negative n: throws');
    expect(decisionPromptLine('fib', d)).toBe('- For every negative n, fib(n) must throw an Error.');
    const withRule = specWithDecisions({ ...spec, tests: "test('negatives', () => eq(fib(-1), 0), { silentOn: 'negative n' });" }, [d]);
    const eff = effectiveChecks(withRule);
    expect(eff.properties).toContain(d.test);
    const body = 'if (n < 0) throw new RangeError("negative"); let a = 0, b = 1; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a;';
    const c = await compileCandidate(withRule, body);
    const r = executeGates(
      { name: 'fib', js: c.js!, testsJs: transpileUserCode(eff.tests).js, propertiesJs: transpileUserCode(eff.properties).js, budgetMs: 1000, seed: 7, waived: eff.waived },
      { phase() {}, enter() {}, leave() {} },
    );
    expect(r.map((g) => g.status)).toEqual(['skipped', 'pass', 'pass']);
    expect(r[0]!.note).toBe('1 check replaced by your decision');
  });

  it('notes, summaries and waiver text', () => {
    const d = nanDecision('NaN propagates');
    expect(decisionNote(d)).toBe('decided by you on 4 Oct 2026: NaN propagates');
    expect(decisionNote(throwsDecision())).toBe('decided by you on 4 Oct 2026');
    // the viewer's local date, not UTC: late evening and just after midnight stay on their own calendar day
    expect(decidedOn(new Date(2026, 9, 4, 23, 30).getTime())).toBe('decided by you on 4 Oct 2026');
    expect(decidedOn(new Date(2026, 9, 5, 0, 30).getTime())).toBe('decided by you on 5 Oct 2026');
    expect(decisionSummary(d)).toBe('median([]) → NaN');
    expect(waiverText(d)).toBeNull();
    expect(waiverText(throwsDecision())).toBe('replaces the property "agrees with a sort-based reference" where the spec was silent (what the median of nothing is)');
  });
});

describe('gap kinds and the table', () => {
  it('classifies the first matching kind', () => {
    expect(classifyGap([[]])).toBe('empty');
    expect(classifyGap([''])).toBe('empty');
    expect(classifyGap([new Map()])).toBe('empty');
    expect(classifyGap([[1, NaN]])).toBe('non-finite');
    expect(classifyGap([-0])).toBe('negative');
    expect(classifyGap([-3n])).toBe('negative');
    expect(classifyGap([[1.5, 2]])).toBe('non-integer');
    expect(classifyGap([[2, 1, 2]])).toBe('duplicates');
    expect(classifyGap(['Straße'])).toBe('non-ascii');
    expect(classifyGap(["Don't Stop"])).toBe('symbols');
    expect(classifyGap(['plain words', 3])).toBe('other');
  });

  it('return categories and rows', () => {
    expect(returnCategory('number')).toEqual({ category: 'number', nullable: false, optional: false });
    expect(returnCategory('number | undefined')).toEqual({ category: 'number', nullable: false, optional: true });
    expect(returnCategory('string | null')).toEqual({ category: 'string', nullable: true, optional: false });
    expect(returnCategory('Array<number>').category).toBe('array');
    expect(returnCategory('{ a: 1 }').category).toBe('other');
    expect(tableRows('empty', 'number').map((r) => r.id)).toEqual(['throws', 'nan', 'zero', 'undefined']);
    expect(tableRows('empty', 'string').map((r) => r.id)).toEqual(['throws', 'empty-string']);
    expect(tableRows('negative', 'bigint').map((r) => r.id)).toEqual(['throws', 'zero-n']);
    expect(tableRows('non-ascii', 'string')).toEqual([]);
    expect(tableRows('symbols', 'number')).toEqual([]);
  });
});

describe('prompt', () => {
  it('no decisions: the prompt is unchanged', () => {
    expect(buildPrompt({ spec: { ...MEDIAN, decisions: [] }, history: [] })).toBe(buildPrompt({ spec: MEDIAN, history: [] }));
    expect(buildPrompt({ spec: MEDIAN, history: [] })).not.toContain('DECISIONS');
  });

  it('decisions: a DECISIONS section, the decision tests in CHECKS, the replaced check marked; the reason is never sent', () => {
    const p = buildPrompt({ spec: specWithDecisions(MEDIAN, [{ ...throwsDecision(), reason: 'SECRET REASON' }]), history: [] });
    expect(p).toContain('CONTRACT (the doc; follow it exactly)\nReturns the median of a list of numbers.\n\nDECISIONS (cases the doc did not cover; the user ruled on each; follow them exactly)\n- median([]) must throw an Error.\n\nCHECKS');
    expect(p).toContain('- "decided: median([]) throws"');
    expect(p).toContain('- "agrees with a sort-based reference" (replaced by a decision above where the doc was silent)');
    expect(p).not.toContain('SECRET REASON');
  });
});

describe('evidence line', () => {
  it('counts decisions without changing lines that have none', () => {
    expect(describeTests(4, 0)).toBe('4 unit tests.');
    expect(describeTests(6, 0, 2)).toBe('6 unit tests, including 2 decisions.');
    expect(describeTests(1, 0, 1)).toBe('1 unit test, your decision.');
    expect(describeTests(2, 0, 2)).toBe('2 unit tests, all your decisions.');
    expect(describeTests(6, 1, 2)).toBe('6 unit tests (including 2 decisions) and 1 pinned.');
    expect(describeProperties([{ name: 'a', runs: 100 }, { name: 'b', runs: 100 }], 1)).toBe('2 properties, 100 runs each, including 1 decision.');
    expect(describeEvidence({ compiled: true, unitTests: 5, pinnedTests: 0, properties: [], sampledCalls: 3, decisions: 1 })).toBe(
      'Compiled. 5 unit tests, including 1 decision. No properties. 3 calls replayed for purity. Mutation check: not run yet.',
    );
  });
});

describe('persistence and recordings', () => {
  it('store: decisions validated strictly; an empty list is dropped; v1 images may not carry them', () => {
    const d = throwsDecision();
    expect(readDecisions(JSON.parse(JSON.stringify([d])), 'd')).toEqual([d]);
    expect(() => readDecisions([{ ...d, waives: 'yes' }], 'd')).toThrow('d[0].waives must be a boolean');
    expect(() => readDecisions([d, d], 'd')).toThrow(/must be unique/);
    expect(() => readDecisions([{ ...d, ruling: { kind: 'outcome', outcome: { returns: NaN }, label: 'x' } }], 'd')).toThrow(/ruling.outcome/);
    expect(() => readDecisions([{ ...d, test: '  ' }], 'd')).toThrow('d[0].test must not be empty');
    const rev = (spec: FunctionSpec) => ({ id: 1, at: 0, kind: 'init' as const, title: 't', program: { functions: { median: { spec, specHash: 'a', testsHash: 'b', artifact: null } } }, env: {} });
    const plain = toImage([rev({ ...MEDIAN, decisions: [] } as FunctionSpec)], 1);
    expect(plain.version).toBe(1);
    const v = validateImage(JSON.parse(JSON.stringify(plain)));
    expect(v.ok && 'decisions' in v.image.revisions[0]!.program.functions.median!.spec).toBe(false);
    const img = toImage([rev(specWithDecisions(MEDIAN, [d]))], 1);
    expect(img.version).toBe(2);
    const back = validateImage(JSON.parse(JSON.stringify(img)));
    expect(back.ok && back.image.revisions[0]!.program.functions.median!.spec.decisions).toEqual([d]);
  });

  it('recordings: decisions are a version 3 field; the sink writes 3 only when a session spec carries them', async () => {
    const spec = specWithDecisions(MEDIAN, [nanDecision()]);
    const h = await hashesFor(spec);
    const sink = new RecordingSink({ now: () => new Date(AT) });
    const req = { fn: 'median', ...h, attempt: 0, prompt: 'p' };
    sink.add(req, { body: 'return NaN;', notes: '', model: 'm', codexVersion: 'c', durationMs: 1, source: 'live', progress: [] }, 'median', { spec });
    const rec = sink.toRecording({ id: 'x', title: 'x' })!;
    expect(rec.version).toBe(3);
    expect(validateRecording(JSON.parse(JSON.stringify(rec)))).toMatchObject({ ok: true });
    const asV2 = { ...JSON.parse(JSON.stringify(rec)), version: 2 };
    expect(validateRecording(asV2)).toEqual({ ok: false, error: 'sessions[0].spec.decisions is a version 3 field: the recording must declare "version": 3' });
    const plainSink = new RecordingSink({ now: () => new Date(AT) });
    plainSink.add({ ...req, ...(await hashesFor(MEDIAN)) }, { body: 'x', notes: '', model: 'm', codexVersion: 'c', durationMs: 1, source: 'live', progress: [] }, 'median', { spec: MEDIAN });
    expect(plainSink.toRecording({ id: 'x', title: 'x' })!.version).toBe(2);
  });

  it('replay: the exact key first, then the fallback (implied decisions); prompts and attempts follow the same lookup', async () => {
    const base = await hashesFor(MEDIAN);
    const decided = await hashesFor(specWithDecisions(MEDIAN, [nanDecision()]));
    const recording: Recording = {
      format: 'undefined-recording',
      version: 2,
      id: 'r',
      title: 'r',
      recordedAt: new Date(AT).toISOString(),
      model: 'm',
      codexVersion: 'c',
      effort: 'low',
      sessions: [{ fn: 'median', ...base, label: 'median', attempts: [{ prompt: 'recorded prompt', body: 'return 1;', notes: '', durationMs: 1, progress: [] }] }],
    };
    const g = new ReplayGenerator([recording], { maxMs: 0, sleep: async () => {} });
    expect(g.has('median', decided.specHash, decided.testsHash)).toBe(false);
    expect(g.has('median', decided.specHash, decided.testsHash, base.testsHash)).toBe(true);
    const req = { fn: 'median', ...decided, attempt: 0, prompt: 'new' };
    await expect(g.generate(req, () => {})).rejects.toMatchObject({ info: { code: 'no_recording' } });
    expect((await g.generate({ ...req, fallbackTestsHash: base.testsHash }, () => {})).body).toBe('return 1;');
    expect(recordedPrompt([recording], { ...req, fallbackTestsHash: base.testsHash })).toBe('recorded prompt');
    expect(recordedPrompt([recording], req)).toBeUndefined();
    expect(recordedAttempt([recording], { ...req, fallbackTestsHash: base.testsHash })?.attempt.body).toBe('return 1;');
  });
});
