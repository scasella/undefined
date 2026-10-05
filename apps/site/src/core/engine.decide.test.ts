/**
 * Decide, end to end in Node: the REAL compiler, gate executor, REPL core and store (memory backend). The model is a
 * scripted generator (live) or the REAL ReplayGenerator over the shipped public/recordings (replay). Covers the
 * re-check in place (re-certify / re-grow with the ruling), removal, replay (implied rulings replay; others need live
 * mode), persistence and export.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineState, GateResult, GenerateRequest, GenerateResult, Generator, ProgressLine, Recording } from '@scasella/undefined-engine/types';
import { warmUp } from '@scasella/undefined-engine/gates/compile';
import { executeGates } from '@scasella/undefined-engine/sandbox/gateExecutor';
import type { ExecGateInput } from '../sandbox/gateRunner';
import { Runtime, type RuntimeWorkerLike } from '../sandbox/runtime';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from '../sandbox/replCore';
import { hashesFor } from '@scasella/undefined-engine/shared/hash';
import { describeEvidence } from '@scasella/undefined-engine/shared/evidence';
import { EXAMPLES } from '../examples';
import { createEngine, type EngineDeps, type EngineExample, type EngineHandle } from './engine';
import { GenerationFailure, ReplayGenerator, validateRecording } from './generator';
import { isLive, isStale } from '@scasella/undefined-engine/program';
import { _useBackend, loadPersisted, memoryBackend, validateImage } from './store';

class ScriptedGenerator implements Generator {
  readonly requests: GenerateRequest[] = [];
  constructor(
    readonly mode: 'live' | 'replay',
    private readonly script: Record<string, string[]>,
  ) {}
  push(fn: string, ...bodies: string[]): void {
    (this.script[fn] ??= []).push(...bodies);
  }
  async generate(req: GenerateRequest, onProgress: (p: ProgressLine) => void): Promise<GenerateResult> {
    this.requests.push(req);
    const body = this.script[req.fn]?.shift();
    if (body === undefined) throw new GenerationFailure({ code: 'recording_exhausted', message: `script for ${req.fn} is exhausted` });
    const line: ProgressLine = { t: 1, text: 'drafting', channel: 'event' };
    onProgress(line);
    return { body, notes: 'scripted', model: 'test-model', codexVersion: '0.0.1', durationMs: 3, source: 'live', progress: [line] };
  }
}

class InProcessWorker implements RuntimeWorkerLike {
  private terminated = false;
  private listener: ((m: RuntimeMessage) => void) | null = null;
  private readonly dispatch = createDispatcher((m) =>
    queueMicrotask(() => {
      if (!this.terminated) this.listener?.(m);
    }),
  );
  postMessage(req: RuntimeRequest): void {
    setTimeout(() => {
      if (!this.terminated) this.dispatch(req);
    }, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
  onMessage(cb: (m: RuntimeMessage) => void): void {
    this.listener = cb;
  }
  onError(): void {}
}

const realExec = (input: ExecGateInput, onGate?: (r: GateResult) => void): Promise<GateResult[]> =>
  Promise.resolve(executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) }));

const engines: EngineHandle[] = [];
const MEDIAN = EXAMPLES.find((e) => e.id === 'median')!;
const SLUGIFY = EXAMPLES.find((e) => e.id === 'slugify')!;
const asEx = (e: typeof MEDIAN): EngineExample => ({ ...e, spec: e.spec! });
const MEDIAN_THROWS = MEDIAN.badBodies.find((b) => b.silentOn)!.body;
const MEDIAN_GOOD = MEDIAN.goodBodies[0]!;
const RECORDING = (id: string): Recording => {
  const v = validateRecording(JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'public', 'recordings', `${id}.json`), 'utf8')));
  if (!v.ok) throw new Error(v.error);
  return v.recording;
};

function setup(opts: { script?: Record<string, string[]>; replay?: boolean; example?: 'median' | 'slugify'; deps?: Partial<EngineDeps> } = {}) {
  const gen = new ScriptedGenerator(opts.replay ? 'replay' : 'live', opts.script ?? {});
  let clock = Date.UTC(2026, 9, 4, 9, 0, 0);
  const ex = opts.example === 'slugify' ? SLUGIFY : MEDIAN;
  const engine = createEngine({
    examples: [asEx(ex)],
    initialExampleId: ex.id,
    probeService: async () => (opts.replay ? { state: 'down' } : { state: 'up', model: 'test-model', codexVersion: '0.0.1' }),
    createLiveGenerator: () => gen,
    createReplayGenerator: (recs) => new ReplayGenerator(recs, { maxMs: 0, sleep: async () => {} }),
    loadRecordings: async () => [RECORDING(ex.id)],
    createRuntime: () => new Runtime({ callBudgetMs: 10_000, workerFactory: () => new InProcessWorker() }),
    execGates: realExec,
    now: () => (clock += 1000),
    sleep: async () => {},
    pacing: { typeCharMs: 0, gateDwellMs: 0, replayMaxMs: 0 },
    inputMemory: { load: () => null, save: () => {} },
    mutation: { idleMs: 3_600_000, quietMs: 0, timeBoxMs: 120_000 },
    ...opts.deps,
  });
  engines.push(engine);
  const s = (): EngineState => engine.state.value;
  const run = async (text: string) => {
    engine.setInput(text);
    await engine.submit();
  };
  /** The GapRef of the first rejected candidate of the head artifact (persisted state). */
  const firstGap = (fn: string, gate: 'tests' | 'properties') => {
    const a = s().program.functions[fn]!.artifact!;
    const index = a.candidates[0]!.gates.find((g) => g.gate === gate)!.diagnostics.findIndex((d) => 'silentOn' in d && d.silentOn !== undefined);
    return { fn, revision: a.revision, candidate: 0, gate, index };
  };
  return { engine, gen, s, run, firstGap };
}

beforeAll(async () => {
  await warmUp();
}, 60_000);
beforeEach(() => _useBackend(memoryBackend()));
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  _useBackend(null);
});

const lastInfo = (s: EngineState): string => [...s.repl].reverse().find((e) => e.kind === 'info')!.text as string;

describe('decide (live): re-check in place', () => {
  it('ruling NaN agrees with the tests: one decision, re-certified in place, nothing generated', async () => {
    const { engine, gen, s, run, firstGap } = setup({ script: { median: [MEDIAN_THROWS, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const before = s().program.functions.median!;
    expect(before.artifact!.candidates[0]!.rejectedBy).toBe('properties');
    const ref = firstGap('median', 'properties');
    const q = engine.gapQuestion(ref)!;
    expect(q.call).toBe('median([])');
    expect(q.alternatives.map((a) => a.id)).toEqual(['tests', 'candidate', 'zero', 'undefined']);

    await engine.decide(ref, { alternative: 'tests' }, { reason: 'NaN propagates' });
    const rec = s().program.functions.median!;
    expect(gen.requests).toHaveLength(2); // nothing regenerated
    expect(rec.spec.decisions).toHaveLength(1);
    expect(rec.spec.decisions![0]).toMatchObject({ call: 'median([])', waives: false, reason: 'NaN propagates', ruling: { kind: 'outcome', label: 'NaN' } });
    expect(rec.testsHash).not.toBe(before.testsHash);
    expect(isLive(rec)).toBe(true);
    expect(rec.artifact!.body).toBe(MEDIAN_GOOD);
    const last = s().revisions[s().revisions.length - 1]!;
    expect(last).toMatchObject({ kind: 'decision', fn: 'median', title: "Decided: median([]) → NaN — re-certified (r2's artifact passes)" });
    expect(rec.artifact!.recertified).toEqual([{ at: expect.any(Number), revision: last.id, reason: 'Decided: median([]) → NaN' }]);
    expect(rec.artifact!.evidence!.decisions).toBe(1);
    expect(describeEvidence(rec.artifact!.evidence!)).toContain('5 unit tests, including 1 decision.');
    expect(lastInfo(s())).toBe(`median: Decided: median([]) → NaN. The committed function already satisfies it: re-certified at r${last.id}, nothing regenerated.`);
    // the GapRef still resolves after the decision (it points into persisted history), and says it is already decided
    expect(engine.gapQuestion(ref)!.existing).toBe(rec.spec.decisions![0]!.id);
    // the same ruling again is a no-op
    const n = s().revisions.length;
    await engine.decide(ref, { alternative: 'tests' }, { reason: 'NaN propagates' });
    expect(s().revisions).toHaveLength(n);
    expect(s().notice?.text).toBe('Already decided: median([]) → NaN.');
  });

  it('ruling "throws" disagrees: the committed function fails it, and median is re-grown with the RULING in the prompt', async () => {
    const { engine, gen, s, run, firstGap } = setup({ script: { median: [MEDIAN_THROWS, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const inputs = s().repl.filter((e) => e.kind === 'input').length;
    gen.push('median', MEDIAN_GOOD, MEDIAN_THROWS); // first re-grow candidate returns NaN (rejected by Tests), second throws
    await engine.decide(firstGap('median', 'properties'), { throws: true });

    const rec = s().program.functions.median!;
    expect(rec.spec.decisions![0]).toMatchObject({ waives: true, ruling: { kind: 'outcome', outcome: { throws: true } } });
    expect(isLive(rec)).toBe(true);
    expect(rec.artifact!.body).toBe(MEDIAN_THROWS);
    expect(s().revisions.slice(-2).map((r) => [r.kind, r.title])).toEqual([
      ['decision', 'Decided: median([]) → throws — the committed function fails it; re-growing'],
      ['commit', 'median certified — attempt 2 of 3 (rejected by tests first)'],
    ]);
    const regrow = gen.requests.slice(2);
    expect(regrow).toHaveLength(2);
    const p0 = regrow[0]!.prompt;
    expect(p0).toContain('DECISIONS (cases the doc did not cover; the user ruled on each; follow them exactly)\n- median([]) must throw an Error.');
    expect(p0).toContain('- "decided: median([]) throws"');
    expect(p0).toContain('- "agrees with a sort-based reference" (replaced by a decision above where the doc was silent)');
    expect(p0).toContain('RULING\nThe user ruled on a case the doc did not cover: median([]) must throw an Error.');
    expect(p0).toContain('TESTS FAILED — 1 of 5');
    expect(regrow[1]!.prompt).not.toContain('RULING');
    expect(regrow[1]!.prompt).toContain('PREVIOUS ATTEMPT (rejected)');
    // live: no fallback key (the decision waives a check)
    expect(regrow.every((r) => r.fallbackTestsHash === undefined)).toBe(true);
    // the re-grow is not a REPL call: nothing was re-run, and the view says what it was for
    expect(s().repl.filter((e) => e.kind === 'input').length).toBe(inputs);
    const g = s().generation!;
    expect(g).toMatchObject({ phase: 'committed', call: 'median([]) (your decision)', decision: { call: 'median([])' } });
    expect(lastInfo(s())).toMatch(/^median re-grown against your decision: saved as r\d+$/);
    // an export of this session is a version 3 recording (its spec carries the decision)
    const recording = engine.exportRecording()!;
    expect(recording.version).toBe(3);
    expect(recording.sessions.at(-1)!.spec!.decisions).toHaveLength(1);
    // the re-grow was not triggered by a REPL input, so it records no call
    expect(recording.sessions.at(-1)!.calls).toBeUndefined();
    expect(validateRecording(JSON.parse(JSON.stringify(recording))).ok).toBe(true);
  });

  it('removing a waiving decision re-checks the weaker spec: the throwing body fails the reference again and is re-grown', async () => {
    const { engine, gen, s, run, firstGap } = setup({ script: { median: [MEDIAN_THROWS, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const base = s().program.functions.median!;
    gen.push('median', MEDIAN_THROWS);
    await engine.decide(firstGap('median', 'properties'), { throws: true });
    expect(s().program.functions.median!.artifact!.body).toBe(MEDIAN_THROWS);
    gen.push('median', MEDIAN_GOOD);
    const id = s().program.functions.median!.spec.decisions![0]!.id;
    await engine.removeDecision('median', id);
    const rec = s().program.functions.median!;
    expect(rec.spec.decisions).toBeUndefined();
    expect('decisions' in rec.spec).toBe(false);
    expect(rec.testsHash).toBe(base.testsHash);
    expect(rec.artifact!.body).toBe(MEDIAN_GOOD);
    expect(isLive(rec)).toBe(true);
    expect(s().revisions.slice(-2).map((r) => r.kind)).toEqual(['decision', 'commit']);
    expect(s().revisions.at(-2)!.title).toBe('Removed decision: median([]) → throws — the committed function fails the checks without it; re-growing');
  });

  it('removing an agreeing decision re-certifies with the original hashes', async () => {
    const { engine, s, run, firstGap } = setup({ script: { median: [MEDIAN_THROWS, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const base = s().program.functions.median!;
    await engine.decide(firstGap('median', 'properties'), { alternative: 'tests' });
    await engine.removeDecision('median', s().program.functions.median!.spec.decisions![0]!.id);
    const rec = s().program.functions.median!;
    expect({ specHash: rec.specHash, testsHash: rec.testsHash }).toEqual({ specHash: base.specHash, testsHash: base.testsHash });
    expect(isLive(rec)).toBe(true);
    expect(rec.artifact!.recertified!.map((r) => r.reason)).toEqual(['Decided: median([]) → NaN', 'Removed decision: median([]) → NaN']);
    expect(rec.artifact!.evidence!.decisions).toBeUndefined();
    // the notice speaks of the spec without the decision, not of "satisfying" a decision that is gone
    expect(lastInfo(s())).toBe(`median: Removed decision: median([]) → NaN. The committed function passes the spec without it: re-certified at r${s().headRevision}, nothing regenerated.`);
  });

  it('a typed expectation: a plain value is stored as a value; one that calls the function is kept as source', async () => {
    const { engine, gen, s, run, firstGap } = setup({ script: { median: [MEDIAN_THROWS, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    expect(await engine.previewExpectation('median', 'NaN')).toEqual({ ok: true, shown: 'NaN', mentionsFn: false, outcome: { returns: { $t: 'number', v: 'NaN' } } });
    expect(await engine.previewExpectation('median', 'median([1, 3])')).toMatchObject({ ok: true, shown: '2', mentionsFn: true });
    expect(await engine.previewExpectation('median', '1, 2')).toEqual({ ok: false, error: 'type one expression (no commas or semicolons at the top level)' });
    expect((await engine.previewExpectation('median', '(() => { throw new Error("no") })()'))).toEqual({ ok: false, error: 'it threw Error: no' });
    expect((await engine.previewExpectation('median', 'if (x) 1')).ok).toBe(false);
    // a one-line typo is not reported at "line 3" of the hidden wrapper
    const typo = await engine.previewExpectation('median', 'nope(');
    expect(typo.ok).toBe(false);
    expect(typo.ok ? '' : typo.error).toMatch(/^not an expression: /);
    expect(typo.ok ? '' : typo.error).not.toMatch(/line \d+/);
    expect(await engine.previewExpectation('median', 'fetch("https://example.com")')).toMatchObject({ ok: false, error: expect.stringMatching(/^it threw /) });
    expect(await engine.previewExpectation('median', '  ')).toMatchObject({ ok: false });

    // a typed NaN is the tests' answer: agrees, re-certifies
    await engine.decide(firstGap('median', 'properties'), { expr: 'NaN' });
    expect(s().program.functions.median!.spec.decisions![0]).toMatchObject({ waives: false, ruling: { kind: 'outcome', label: 'NaN' } });
    // an expression over the function itself is kept as source (always waiving); the committed body satisfies it
    await engine.decide(firstGap('median', 'properties'), { expr: 'median([0, 0])' });
    const d = s().program.functions.median!.spec.decisions!;
    expect(d).toHaveLength(1); // same call, same check: replaced
    expect(d[0]).toMatchObject({ waives: true, ruling: { kind: 'expr', expr: 'median([0, 0])' }, test: 'test("decided: median([]) returns median([0, 0])", () => {\n  eq(median([]), (median([0, 0])));\n});' });
    // NaN !== 0: the committed body fails it, so a re-grow was asked for (the script has nothing left: it fails)
    expect(gen.requests).toHaveLength(3);
    expect(gen.requests[2]!.prompt).toContain('- median([]) must return the value of: median([0, 0])');
    expect(isStale(s().program.functions.median!)).toBe(true);
    expect(s().generation).toMatchObject({ phase: 'failed', decision: { call: 'median([])' } });
  });

  it('rejects what cannot be decided, with a notice and no change', async () => {
    const { engine, s, run, firstGap } = setup({ script: { median: [MEDIAN_THROWS, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const n = s().revisions.length;
    const ref = firstGap('median', 'properties');
    expect(engine.gapQuestion({ ...ref, index: 5 })).toBeNull();
    await engine.decide({ ...ref, index: 5 }, { alternative: 'tests' });
    expect(s().notice?.text).toMatch(/^Nothing to decide/);
    await engine.decide(ref, { alternative: 'undefined' });
    expect(s().notice?.text).toBe('Your signature says `number`; returning undefined needs the return type changed (Edit spec).');
    await engine.decide(ref, { alternative: 'tests' }, { scope: 'rule' });
    expect(s().notice?.text).toMatch(/^A rule needs a single number or bigint parameter/);
    await engine.decide(ref, { expr: '1;2' });
    expect(s().notice?.text).toMatch(/^Your expectation cannot be used/);
    expect(s().revisions).toHaveLength(n);
  });

  it('a rejection from checks the user has since edited cannot be decided (its "your tests expect" is stale)', async () => {
    const { engine, s, run, firstGap } = setup({ script: { median: [MEDIAN_THROWS, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const ref = firstGap('median', 'properties');
    const d = s().program.functions.median!.artifact!.candidates[0]!.gates.find((g) => g.gate === 'properties')!.diagnostics[ref.index]!;
    expect(engine.gapQuestion(ref)).not.toBeNull();
    // the reference now says 0 for the empty list: the stored rejection's "expected NaN" no longer holds
    const props = s().program.functions.median!.spec.properties;
    await engine.editSpec('median', { properties: props.replace('return s.length % 2', 'if (s.length === 0) return 0;\n  return s.length % 2') });
    const n = s().revisions.length;
    expect(engine.gapQuestion(ref)).toBeNull();
    await engine.decide(ref, { alternative: 'tests' });
    expect(s().notice?.text).toMatch(/^Nothing was decided: the checks of median changed since that rejection/);
    expect(s().revisions).toHaveLength(n);
    expect(s().program.functions.median!.spec.decisions).toBeUndefined();
    // a detached diagnostic whose check no longer exists by name is refused too
    const renamed = s().program.functions.median!.spec.properties.replace("'agrees with a sort-based reference'", "'agrees with the reference'");
    await engine.editSpec('median', { properties: renamed });
    expect(engine.gapQuestion({ fn: 'median', diagnostic: d })).toBeNull();
  });

  it('a grow that committed nothing: its rejection stops being decidable once the check it ran is edited (same name)', async () => {
    const { engine, s, run } = setup({ script: { median: [MEDIAN_THROWS, MEDIAN_THROWS, MEDIAN_THROWS] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    expect(s().generation!.phase).toBe('failed');
    const d = s().generation!.attempts[0]!.gates.find((g) => g.gate === 'properties')!.diagnostics[0]!;
    expect(engine.gapQuestion({ fn: 'median', diagnostic: d })).not.toBeNull();
    const props = s().program.functions.median!.spec.properties;
    await engine.editSpec('median', { properties: props.replace('return s.length % 2', 'if (s.length === 0) return 0;\n  return s.length % 2') });
    expect(engine.gapQuestion({ fn: 'median', diagnostic: d })).toBeNull();
  });

  it('a typed expectation is checked in the shape the generated test uses; the call compared with itself is refused', async () => {
    const { engine, s, run, firstGap } = setup({ script: { median: [MEDIAN_THROWS, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    // a trailing line comment would swallow the generated test's closing `));`: refused at preview, not at Decide
    expect((await engine.previewExpectation('median', 'NaN // why')).ok).toBe(false);
    // closing the assertion early to append statements is refused before anything runs
    expect(await engine.previewExpectation('median', '1); globalThis.__x = 1; (1')).toEqual({ ok: false, error: 'unbalanced brackets: type one expression' });
    const n = s().revisions.length;
    await engine.decide(firstGap('median', 'properties'), { expr: ' median( [] ) ' });
    expect(s().notice?.text).toBe('Your expectation cannot be used: median([]) compared with itself accepts any answer.');
    expect(s().revisions).toHaveLength(n);
  });

  it('a waiver by a name two checks share is refused: it would switch off the other check (and could excuse a failing ruling)', async () => {
    const { engine, s, run } = setup({ script: { f: ['return n;', "if (n < 0) throw new Error('negative'); return n;"] } });
    await engine.init();
    await engine.upsertSpec({
      name: 'f',
      params: [{ name: 'n', type: 'number' }],
      returns: 'number',
      doc: 'Returns n.',
      tests: "test('dup', () => throws(() => f(-1)), { silentOn: 'what a negative n means' });\ntest('dup', () => eq(f(2), 2));",
      properties: '',
      budgetMs: 1000,
      maxAttempts: 3,
      origin: 'user',
    });
    await run('f(3)');
    const a = s().program.functions.f!.artifact!;
    expect(a.candidates[0]!.rejectedBy).toBe('tests');
    const ref = { fn: 'f', revision: a.revision, candidate: 0, gate: 'tests' as const, index: 0 };
    expect(engine.gapQuestion(ref)).not.toBeNull();
    const n = s().revisions.length;
    await engine.decide(ref, { alternative: 'candidate' }); // returns -1: disagrees, so it would waive "dup"
    expect(s().notice?.text).toMatch(/^Nothing was decided: more than one check is named "dup"/);
    expect(s().revisions).toHaveLength(n);
    // an agreeing ruling waives nothing, so it is fine
    await engine.decide(ref, { alternative: 'tests' });
    expect(s().program.functions.f!.spec.decisions).toHaveLength(1);
    expect(isLive(s().program.functions.f!)).toBe(true);
  });

  it('decisions persist (stored image, version 2 export, import) and rollback restores the spec without them', async () => {
    const { engine, s, run, firstGap } = setup({ script: { median: [MEDIAN_THROWS, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const plain = JSON.parse(await engine.exportImage());
    expect(plain.version).toBe(1);
    await engine.decide(firstGap('median', 'properties'), { alternative: 'tests' }, { reason: 'why not' });
    const decided = s().program.functions.median!;
    const json = await engine.exportImage();
    const img = JSON.parse(json);
    expect(img.version).toBe(2);
    const v = validateImage(img);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.image.revisions.at(-1)!.program.functions.median!.spec.decisions).toEqual(decided.spec.decisions);
    // an older build's rule: a v1 image may not carry decisions
    expect(validateImage({ ...img, version: 1 })).toEqual({ ok: false, error: 'version must be 2: the image holds decisions (a version 2 field)' });
    const stored = await loadPersisted();
    expect(stored!.image.revisions.at(-1)!.program.functions.median!.spec.decisions).toHaveLength(1);

    await engine.rollback(2);
    expect(s().program.functions.median!.spec.decisions).toBeUndefined();
    expect(isLive(s().program.functions.median!)).toBe(true);
    await engine.importImage(json);
    const back = s().program.functions.median!;
    expect(back.spec.decisions).toEqual(decided.spec.decisions);
    expect(await hashesFor(back.spec)).toEqual({ specHash: decided.specHash, testsHash: decided.testsHash });
    expect(isLive(back)).toBe(true);
  });
});

describe('decide (replay, the shipped recordings)', () => {
  it('median: the opening is unchanged; NaN re-certifies; "throws" says it needs live mode; removing it brings r2 back', async () => {
    const { engine, s, run, firstGap } = setup({ replay: true });
    await engine.init();
    expect(s().mode).toBe('replay');
    await run('median([3, 1, 4, 2])');
    const g = s().generation!;
    expect(g.phase).toBe('committed');
    expect(g.attempts[0]!.candidate!.rejectedBy).toBe('properties');
    const d0 = g.attempts[0]!.gates[2]!.diagnostics[0]!;
    expect(d0).toMatchObject({ silentOn: 'what the median of nothing is', args: [[]], actualOutcome: { throws: true } });
    const r2 = s().program.functions.median!;

    await engine.decide(firstGap('median', 'properties'), { alternative: 'tests' });
    expect(isLive(s().program.functions.median!)).toBe(true);
    expect(s().revisions.at(-1)!.kind).toBe('decision');

    await engine.decide(firstGap('median', 'properties'), { alternative: 'candidate' });
    const rec = s().program.functions.median!;
    expect(rec.spec.decisions).toHaveLength(1);
    expect(rec.spec.decisions![0]!.waives).toBe(true);
    expect(isStale(rec)).toBe(true);
    const gen = s().generation!;
    expect(gen.phase).toBe('failed');
    expect(gen.attempts).toEqual([]); // nothing was asked: no attempt card
    expect(gen.error).toMatchObject({ code: 'no_recording' });
    expect(gen.error!.message).toBe(
      'Your decision (median([]) → throws) differs from what the recorded session was checked against, so there is no recorded answer to replay. Run live to grow median against it.',
    );
    expect(gen.error!.fix!.length).toBeGreaterThan(0);

    await engine.removeDecision('median', rec.spec.decisions![0]!.id);
    const back = s().program.functions.median!;
    expect(back.spec.decisions).toBeUndefined();
    // the NaN decision's restamp is gone with it; the r2 artifact was re-certified under the NaN hashes, so removing
    // the waiving one re-checks it (it passes the original checks)
    expect(isLive(back)).toBe(true);
    expect(back.testsHash).toBe(r2.testsHash);

    // the console's Retry on the needs-live error is moot once the decision is gone: it must not re-grow live median
    const err = [...s().repl].reverse().find((e) => e.kind === 'error' && e.name === 'GenerationFailed' && !e.resolved)!;
    const head = s().headRevision;
    await engine.invokeRestart(err.id, 'retry');
    expect(s().headRevision).toBe(head);
    expect(lastInfo(s())).toBe(`median: nothing to retry. The decision it was being written against is gone, and r${back.artifact!.revision} passes the spec as it is.`);
  });

  it('median: an implied ruling replays the session recorded before it (fallback key); attempt 1 is now rejected by Tests', async () => {
    const { engine, s, run, firstGap } = setup({ replay: true });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const ref = firstGap('median', 'properties');
    await engine.rollback(1); // no artifact any more; the GapRef still points into r2
    expect(s().program.functions.median!.artifact).toBeNull();
    await engine.decide(ref, { alternative: 'tests' });
    const rec = s().program.functions.median!;
    expect(rec.spec.decisions).toHaveLength(1);
    expect(isLive(rec)).toBe(true);
    const g = s().generation!;
    expect(g.phase).toBe('committed');
    expect(g.attempts.map((a) => a.candidate!.rejectedBy ?? 'accepted')).toEqual(['tests', 'accepted']);
    expect(g.attempts[0]!.candidate!.headline).toMatch(/^Rejected: median\(\[\]\) threw /);
    expect(g.attempts[0]!.candidate!.source).toBe('replay');
  });

  it('slugify: "dont-stop" re-certifies; "don-t-stop" needs live mode', async () => {
    const { engine, s, run, firstGap } = setup({ replay: true, example: 'slugify' });
    await engine.init();
    await run('slugify("Hello, World! Crème Brûlée")');
    const a = s().program.functions.slugify!.artifact!;
    expect(a.candidates[0]!.rejectedBy).toBe('tests');
    const ref = firstGap('slugify', 'tests');
    const q = engine.gapQuestion(ref)!;
    expect(q.call).toBe('slugify("Don\'t Stop")');
    expect(q.alternatives.map((x) => [x.id, x.label])).toEqual([
      ['tests', '"dont-stop"'],
      ['candidate', '"don-t-stop"'],
    ]);
    await engine.decide(ref, { alternative: 'tests' });
    expect(isLive(s().program.functions.slugify!)).toBe(true);
    await engine.decide(ref, { alternative: 'candidate' });
    expect(isStale(s().program.functions.slugify!)).toBe(true);
    expect(s().generation!.error!.message).toMatch(/^Your decision \(slugify\("Don't Stop"\) → "don-t-stop"\) differs from what the recorded session was checked against/);
  });
});

describe('decide: one ruling per call', () => {
  it('a rule-scope ruling replaces a call-scope one on the same call of the same check', async () => {
    const FIB = {
      name: 'fib',
      params: [{ name: 'n', type: 'number' }],
      returns: 'number',
      doc: 'Fibonacci numbers.',
      tests: "test('small', () => eq(fib(10), 55));\ntest('negatives', () => eq(fib(-1), 0), { silentOn: 'what a negative n means' });",
      properties: '',
      budgetMs: 1000,
      maxAttempts: 3,
      origin: 'user' as const,
    };
    const LOOP = 'let a = 0, b = 1; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a;';
    const THROWING = `if (n < 0) throw new RangeError("negative"); ${LOOP}`;
    const ex: EngineExample = { id: 'fib', title: 'fib', blurb: '', call: 'fib(10)', fn: 'fib', breakIt: { label: 'x', description: 'x' }, spec: FIB, breakPatch: {} };
    const { engine, gen, s, run, firstGap } = setup({ script: { fib: [`if (n < 0) return -1; ${LOOP}`, LOOP] }, deps: { examples: [ex], initialExampleId: 'fib' } });
    await engine.init();
    await run('fib(10)');
    const ref = firstGap('fib', 'tests');
    expect(engine.gapQuestion(ref)!.ruleScope).toEqual({ label: 'for every negative n' });
    await engine.decide(ref, { alternative: 'tests' }); // fib(-1) → 0: agrees, re-certified
    expect(s().program.functions.fib!.spec.decisions!.map((d) => d.placement)).toEqual(['tests']);
    gen.push('fib', THROWING);
    await engine.decide(ref, { throws: true }, { scope: 'rule' });
    const ds = s().program.functions.fib!.spec.decisions!;
    expect(ds.map((d) => [d.placement, d.ruling.label, d.rule?.phrase])).toEqual([['properties', 'throws', 'every negative n']]);
    expect(engine.gapQuestion(ref)!.existing).toBe(ds[0]!.id);
    expect(s().program.functions.fib!.artifact!.body).toBe(THROWING);
    expect(isLive(s().program.functions.fib!)).toBe(true);
    expect(gen.requests.at(-1)!.prompt).toContain('- For every negative n, fib(n) must throw an Error.');
  });

  it('replay mode, all rulings implied but no recorded session: says so truthfully', async () => {
    const { engine, s, run, firstGap } = setup({ replay: true });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const ref = firstGap('median', 'properties');
    await engine.editSpec('median', { doc: 'Returns the median of a list of numbers (edited).' });
    await engine.decide(ref, { alternative: 'tests' });
    expect(s().generation!.error!.message).toBe(
      'There is no recorded session for this spec (your decision agrees with its checks, but this spec text was never recorded). Run live to grow median.',
    );
  });
});
