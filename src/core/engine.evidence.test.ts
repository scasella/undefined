/**
 * Evidence, the lazy mutation check and re-certification, end to end in Node with the REAL compiler, the REAL gate
 * executor, the REAL REPL core and the REAL store (memory backend). A scripted generator is the only fake.
 * Node has no watchdog: nothing here can be 'killed-by-bound' (classifyMutant is unit-tested for that mapping).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, FunctionSpec, GateResult, GenerateRequest, GenerateResult, Generator, ProgressLine, Revision } from '../types';
import { warmUp } from '../gates/compile';
import { executeGates } from '../sandbox/gateExecutor';
import type { ExecGateInput } from '../sandbox/gateRunner';
import { Runtime, type RuntimeWorkerLike } from '../sandbox/runtime';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from '../sandbox/replCore';
import { hashesFor } from '../shared/hash';
import { describeEvidence, MUTATION_FAILED_PREFIX } from '../shared/evidence';
import { NO_TESTS_REASON } from '../mutation/classify';
import { alwaysChecked, suggestProperties } from '../suggest/suggest';
import { EXAMPLES } from '../examples';
import { classifyMutant, createEngine, RECHECK_FAILED_INFO, type EngineDeps, type EngineExample, type EngineHandle } from './engine';
import { GenerationFailure } from './generator';
import { isLive, isStale } from './program';
import { _useBackend, loadPersisted, memoryBackend } from './store';

// ───────────────────────── harness ─────────────────────────

class ScriptedGenerator implements Generator {
  readonly mode = 'live' as const;
  readonly requests: GenerateRequest[] = [];
  constructor(private readonly script: Record<string, string[]>) {}
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
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function setup(opts: { script?: Record<string, string[]>; examples?: EngineExample[]; deps?: Partial<EngineDeps> } = {}) {
  const gen = new ScriptedGenerator(opts.script ?? {});
  let clock = Date.UTC(2026, 9, 4, 9, 0, 0);
  const engine = createEngine({
    examples: opts.examples ?? [],
    probeService: async () => ({ state: 'up', model: 'test-model', codexVersion: '0.0.1' }),
    createLiveGenerator: () => gen,
    createReplayGenerator: () => gen,
    loadRecordings: async () => [],
    createRuntime: () => new Runtime({ callBudgetMs: 10_000, workerFactory: () => new InProcessWorker() }),
    execGates: realExec,
    now: () => (clock += 1000),
    sleep: async () => {},
    pacing: { typeCharMs: 0, gateDwellMs: 0, replayMaxMs: 0 },
    inputMemory: { load: () => null, save: () => {} },
    // by default the check never starts on its own here; tests that want it shorten the idle time
    mutation: { idleMs: 3_600_000, quietMs: 0, timeBoxMs: 120_000 },
    ...opts.deps,
  });
  engines.push(engine);
  const s = (): EngineState => engine.state.value;
  const run = async (text: string) => {
    engine.setInput(text);
    await engine.submit();
  };
  return { engine, gen, s, run };
}

async function until(cond: () => boolean, ms = 60_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await tick(10);
  }
}

beforeAll(async () => {
  await warmUp();
}, 60_000);
beforeEach(() => _useBackend(memoryBackend()));
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  _useBackend(null);
});

// ───────────────────────── specs ─────────────────────────

const MEDIAN = EXAMPLES.find((e) => e.id === 'median')!;
const MEDIAN_EX: EngineExample = { ...MEDIAN, spec: MEDIAN.spec! };

const SORT_SPEC: FunctionSpec = {
  name: 'sortNumbers',
  params: [{ name: 'xs', type: 'number[]' }],
  returns: 'number[]',
  doc: 'The numbers in ascending order, as a new array.',
  tests: 'test("three", () => eq(sortNumbers([3, 1, 2]), [1, 2, 3]));',
  properties: '',
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'user',
};
const SORT_GOOD = 'return [...xs].sort((a, b) => a - b);';
/** Lexicographic: passes the one unit test, fails "sorted" (e.g. [10, 2]). */
const SORT_LEXICAL = 'return [...xs].sort();';

async function committedSort(body: string, deps: Partial<EngineDeps> = {}) {
  const t = setup({ script: { sortNumbers: [body] }, deps });
  await t.engine.init();
  await t.engine.upsertSpec(SORT_SPEC);
  await t.run('sortNumbers([3, 1, 2])');
  const rec = t.s().program.functions.sortNumbers!;
  expect(rec.artifact).not.toBeNull();
  return t;
}

const lastOutput = (st: EngineState) => [...st.repl].reverse().find((e) => e.kind === 'output')!;
const revisionsOf = async (): Promise<Revision[]> => (await loadPersisted())!.image.revisions;

// ───────────────────────── tests ─────────────────────────

describe('evidence at commit', () => {
  it('records what ran (facts from the gate summaries), and the mutation check is still to come', async () => {
    const { engine, s, run } = setup({ script: { median: [MEDIAN.goodBodies[0]!] }, examples: [MEDIAN_EX] });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const a = s().program.functions.median!.artifact!;
    const ev = a.evidence!;
    expect(ev.compiled).toBe(true);
    expect(ev.unitTests).toBe(MEDIAN.spec!.tests.match(/\btest\(/g)!.length);
    expect(ev.pinnedTests).toBe(0);
    expect(ev.properties.length).toBeGreaterThanOrEqual(1);
    expect(ev.properties.every((p) => p.runs > 0)).toBe(true);
    expect(ev.sampledCalls).toBeGreaterThan(0);
    expect(ev.mutation).toBeUndefined();
    expect(describeEvidence(ev)).toMatch(/^Compiled\. \d+ unit tests\. .* replayed for purity\. Mutation check: not run yet\.$/);
    expect(s().mutation).toEqual({ fn: 'median', phase: 'waiting', done: 0, total: 0 });
    // stored with the commit revision
    const stored = (await revisionsOf()).find((r) => r.id === a.revision)!;
    expect(stored.program.functions.median!.artifact!.evidence).toEqual(ev);
  });

  it('a function with no tests, properties or pins gets the skipped report at once (nothing is scheduled)', async () => {
    const { engine, s, run } = setup({ script: { double: ['return arg0 * 2;'] } });
    await engine.init();
    await run('double(21)');
    const ev = s().program.functions.double!.artifact!.evidence!;
    expect(ev.unitTests).toBe(0);
    expect(ev.properties).toEqual([]);
    expect(ev.mutation?.skipped).toBe(NO_TESTS_REASON);
    expect(ev.mutation?.total).toBe(0);
    expect(s().mutation).toBeUndefined();
    expect(describeEvidence(ev)).toContain('No unit tests. No properties.');
  });
});

describe('the lazy mutation check', () => {
  it('runs after the engine has been idle, stores the report on the head AND the commit revision, changes no hash', async () => {
    const { engine, s, run } = setup({ script: { median: [MEDIAN.goodBodies[0]!] }, examples: [MEDIAN_EX], deps: { mutation: { idleMs: 30, quietMs: 0, timeBoxMs: 120_000 } } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const before = s().program.functions.median!;
    const revsBefore = s().revisions.length;
    await until(() => s().mutation?.phase === 'done');
    const rec = s().program.functions.median!;
    const m = rec.artifact!.evidence!.mutation!;
    expect(m.skipped).toBeUndefined();
    expect(m.total).toBe(12);
    expect(m.killed + m.killedByBound + m.survived).toBe(12);
    expect(m.killedByBound).toBe(0); // no watchdog in Node
    expect(m.killed).toBeGreaterThanOrEqual(9);
    expect(m.survivors.length).toBe(Math.min(5, m.survived));
    for (const sv of m.survivors) expect(sv).not.toHaveProperty('js');
    expect(s().mutation).toEqual({ fn: 'median', phase: 'done', done: 12, total: 12 });
    // metadata after the fact: no new revision, no hash change, still live
    expect(s().revisions.length).toBe(revsBefore);
    expect(rec.specHash).toBe(before.specHash);
    expect(rec.testsHash).toBe(before.testsHash);
    expect(rec.artifact!.specHash).toBe(before.artifact!.specHash);
    expect(isLive(rec)).toBe(true);
    // persisted on the commit revision too (it IS the head here), and in the export
    const stored = (await revisionsOf()).find((r) => r.id === rec.artifact!.revision)!;
    expect(stored.program.functions.median!.artifact!.evidence!.mutation).toEqual(m);
    const exported = JSON.parse(await engine.exportImage()) as { revisions: Revision[] };
    expect(exported.revisions.find((r) => r.id === rec.artifact!.revision)!.program.functions.median!.artifact!.evidence!.mutation).toEqual(m);
  }, 120_000);

  it('patches every revision that holds the same artifact (a later pin revision too), not stale or other ones', async () => {
    const { engine, s, run } = setup({ script: { median: [MEDIAN.goodBodies[0]!] }, examples: [MEDIAN_EX] });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const out = lastOutput(s());
    await engine.pinResult(out.id);
    const headId = s().headRevision;
    const commitId = s().program.functions.median!.artifact!.revision;
    expect(headId).toBe(commitId + 1);
    await engine.runMutation('median');
    const revs = await revisionsOf();
    for (const id of [commitId, headId]) expect(revs.find((r) => r.id === id)!.program.functions.median!.artifact!.evidence!.mutation?.total).toBe(12);
    expect(revs.find((r) => r.id === 1)!.program.functions.median!.artifact).toBeNull();
  }, 120_000);

  it('a submit while it runs cancels it (no partial report); it re-runs to completion after the next idle', async () => {
    let mutantRuns = 0;
    const slowExec: EngineDeps['execGates'] = async (input, onGate) => {
      if (input.phases) {
        mutantRuns++;
        await tick(15);
      }
      return realExec(input, onGate);
    };
    const { engine, s, run } = setup({
      script: { median: [MEDIAN.goodBodies[0]!] },
      examples: [MEDIAN_EX],
      deps: { execGates: slowExec, mutation: { idleMs: 40, quietMs: 0, timeBoxMs: 120_000 } },
    });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    await until(() => s().mutation?.phase === 'running' && s().mutation!.done >= 2);
    const p = run('1 + 1');
    // cancelled synchronously when the submit was requested
    expect(s().mutation?.phase).toBe('waiting');
    expect(s().program.functions.median!.artifact!.evidence!.mutation).toBeUndefined();
    await p;
    const runsAtCancel = mutantRuns;
    await until(() => s().mutation?.phase === 'done');
    expect(mutantRuns).toBeGreaterThanOrEqual(runsAtCancel + 12); // a fresh full run, not a resumed partial one
    expect(s().program.functions.median!.artifact!.evidence!.mutation!.total).toBe(12);
  }, 120_000);

  it('a mutant that cannot load makes the check fail visibly; never counted as a kill', async () => {
    const loadFail: EngineDeps['execGates'] = async (input, onGate) => {
      if (!input.phases) return realExec(input, onGate);
      return [
        { gate: 'tests', status: 'fail', ms: 0, summary: 'candidate failed to load', headline: 'Rejected: candidate failed to load: boom', diagnostics: [{ kind: 'test', name: '(load)', message: 'candidate failed to load', error: 'boom' }] },
        { gate: 'properties', status: 'skipped', ms: 0, summary: 'not reached', diagnostics: [] },
      ];
    };
    const { engine, s, run } = setup({ script: { median: [MEDIAN.goodBodies[0]!] }, examples: [MEDIAN_EX], deps: { execGates: loadFail } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    await engine.runMutation('median');
    const m = s().program.functions.median!.artifact!.evidence!.mutation!;
    expect(m.skipped).toMatch(new RegExp(`^${MUTATION_FAILED_PREFIX}`));
    expect(m.skipped).toContain('boom');
    expect(m.killed).toBe(0);
    expect(m.total).toBe(0);
  }, 60_000);

  it('a gate-runner fault (rejected promise) also fails the check visibly', async () => {
    const broken: EngineDeps['execGates'] = async (input, onGate) => {
      if (input.phases) throw new Error('worker exploded');
      return realExec(input, onGate);
    };
    const { engine, s, run } = setup({ script: { median: [MEDIAN.goodBodies[0]!] }, examples: [MEDIAN_EX], deps: { execGates: broken } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    await engine.runMutation('median');
    const m = s().program.functions.median!.artifact!.evidence!.mutation!;
    expect(m.skipped).toBe(`${MUTATION_FAILED_PREFIX}worker exploded`);
    expect(describeEvidence(s().program.functions.median!.artifact!.evidence!)).toContain('Mutation check could not run: worker exploded.');
  }, 60_000);

  it('mutant runs use phases tests+properties, the pins, the gate seed, a budget of at most 1000 ms', async () => {
    const seen: ExecGateInput[] = [];
    const spy: EngineDeps['execGates'] = async (input, onGate) => {
      if (input.phases) seen.push(input);
      return realExec(input, onGate);
    };
    const { engine, s, run } = setup({ script: { median: [MEDIAN.goodBodies[0]!] }, examples: [MEDIAN_EX], deps: { execGates: spy } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    await engine.pinResult(lastOutput(s()).id);
    await engine.runMutation('median');
    // the unmutated function first (the baseline, through the same runner), then 12 mutants
    expect(seen.length).toBe(13);
    const rec = s().program.functions.median!;
    const { gateSeed } = await import('../shared/hash');
    expect(seen[0]!.js).toBe(rec.artifact!.js);
    for (const [n, i] of seen.entries()) {
      expect(i.phases).toEqual(['tests', 'properties']);
      expect(i.budgetMs).toBe(Math.min(rec.spec.budgetMs, 1000));
      expect(i.seed).toBe(gateSeed(rec.specHash, rec.testsHash));
      expect(i.pinned?.length).toBe(1);
      if (n > 0) expect(i.js).not.toBe(rec.artifact!.js);
    }
  }, 120_000);
});

describe('the mutation check needs a passing baseline', () => {
  it('a committed function that fails its own checks (a pin it contradicts) gets no kills: the report is skipped and says why', async () => {
    const { encodeValue } = await import('../shared/serialize');
    const { MUTATION_BASELINE_FAILED } = await import('../shared/evidence');
    const { plainMutation } = await import('../ui/evidence');
    const seen: ExecGateInput[] = [];
    const spy: EngineDeps['execGates'] = async (input, onGate) => {
      if (input.phases) seen.push(input);
      return realExec(input, onGate);
    };
    const { engine, s, run } = setup({ script: { median: [MEDIAN.goodBodies[0]!] }, examples: [MEDIAN_EX], deps: { execGates: spy } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    await engine.pinResult(lastOutput(s()).id);
    // the pin now expects a different value; pins are outside both hashes, so the artifact stays live
    const rec = s().program.functions.median!;
    const pin = rec.spec.pins![0]!;
    await engine.upsertSpec({ ...rec.spec, pins: [{ ...pin, expected: encodeValue(99) }] });
    expect(isLive(s().program.functions.median!)).toBe(true);
    await engine.runMutation('median');
    const m = s().program.functions.median!.artifact!.evidence!.mutation!;
    expect(m.skipped).toBe(MUTATION_BASELINE_FAILED);
    expect(m.skipped).toBe('the committed function fails its own checks, so mutation results would mean nothing');
    expect(m.total).toBe(0);
    expect(m.killed + m.killedByBound + m.survived).toBe(0);
    // only the baseline ran: no mutant was tried
    expect(seen.length).toBe(1);
    expect(seen[0]!.js).toBe(rec.artifact!.js);
    expect(plainMutation(m)).toMatch(/^No broken copies were counted: the function fails its own checks/);
    expect(describeEvidence(s().program.functions.median!.artifact!.evidence!)).toContain('The committed function fails its own checks, so mutation results would mean nothing.');
  }, 120_000);
});

describe('a slow-but-correct function is not reported as failing its own checks', () => {
  it('a baseline that hits the per-call time limit is skipped as too slow, with no kills counted', async () => {
    const { MUTATION_BASELINE_SLOW_PREFIX, MUTATION_BASELINE_FAILED } = await import('../shared/evidence');
    let calls = 0;
    const slowBaseline: EngineDeps['execGates'] = async (input, onGate) => {
      if (input.phases) {
        calls++;
        // what the watchdog reports for a call that exceeds the budget: tests/properties interrupted, Invariants bounded
        const skipped = (gate: GateResult['gate']): GateResult => ({ gate, status: 'skipped', ms: 0, summary: 'interrupted', diagnostics: [] });
        return [skipped('tests'), skipped('properties'), { gate: 'invariants', status: 'fail', ms: 1000, summary: 'bounded violated', diagnostics: [{ kind: 'invariant', invariant: 'bounded', message: 'too slow', budgetMs: 1000, elapsedMs: 1010 }] }];
      }
      return realExec(input, onGate);
    };
    const { engine, s, run } = setup({ script: { median: [MEDIAN.goodBodies[0]!] }, examples: [MEDIAN_EX], deps: { execGates: slowBaseline } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    await engine.runMutation('median');
    const m = s().program.functions.median!.artifact!.evidence!.mutation!;
    expect(m.skipped).toMatch(new RegExp('^' + MUTATION_BASELINE_SLOW_PREFIX));
    expect(m.skipped).not.toBe(MUTATION_BASELINE_FAILED);
    expect(m.killed + m.killedByBound + m.survived).toBe(0);
    expect(calls).toBe(1); // only the baseline was tried
  }, 120_000);
});

describe('classifyMutant', () => {
  const g = (gate: GateResult['gate'], status: GateResult['status'], extra: Partial<GateResult> = {}): GateResult => ({ gate, status, ms: 0, summary: '', diagnostics: [], ...extra });
  it('maps the four outcomes', () => {
    expect(classifyMutant([g('tests', 'pass'), g('properties', 'pass')])).toBe('survived');
    expect(classifyMutant([g('tests', 'fail', { diagnostics: [{ kind: 'test', name: 'odd', message: 'x' }] }), g('properties', 'skipped')])).toBe('killed');
    const bounded = g('invariants', 'fail', { diagnostics: [{ kind: 'invariant', invariant: 'bounded', message: 'median([1]) did not return within 1000 ms', detail: 'worker terminated by the watchdog' }] });
    expect(classifyMutant([g('tests', 'skipped'), g('properties', 'skipped'), bounded])).toBe('killed-by-bound');
    const pure = g('invariants', 'fail', { diagnostics: [{ kind: 'invariant', invariant: 'pure', message: 'candidate mutated its argument' }] });
    expect(classifyMutant([g('tests', 'pass'), g('properties', 'skipped'), pure])).toBe('killed');
    expect(() => classifyMutant([g('tests', 'fail', { note: 'spec error', summary: 'spec error', diagnostics: [{ kind: 'test', name: '(spec error)', message: 'bad', error: 'bad' }] })])).toThrow(/spec error/);
    expect(() => classifyMutant([g('tests', 'fail', { summary: 'gate worker error', note: 'gate worker error', diagnostics: [{ kind: 'test', name: '(gate worker)', message: 'x', error: 'x' }] })])).toThrow(/x/);
  });
});

describe('re-certify: adding a suggested check', () => {
  it('a passing check restamps the committed artifact in place; the generator is NOT called', async () => {
    const { engine, gen, s, run } = await committedSort(SORT_GOOD);
    const base = s().program;
    const rec0 = base.functions.sortNumbers!;
    const commitRev = rec0.artifact!.revision;
    const suggestions = suggestProperties(rec0.spec, base);
    const sorted = suggestions.find((x) => x.kind === 'sorted')!;
    expect(sorted).toBeDefined();
    const requests = gen.requests.length;

    await engine.addSuggestedProperty('sortNumbers', sorted.id);

    expect(gen.requests.length).toBe(requests);
    const rec = s().program.functions.sortNumbers!;
    const h = await hashesFor(rec.spec);
    expect(rec.spec.properties).toContain(`// suggested:${sorted.id}`);
    expect(rec.testsHash).toBe(h.testsHash);
    expect(rec.testsHash).not.toBe(rec0.testsHash);
    expect(rec.artifact!.testsHash).toBe(h.testsHash);
    expect(rec.artifact!.specHash).toBe(h.specHash);
    expect(rec.artifact!.revision).toBe(commitRev);
    expect(rec.artifact!.body).toBe(SORT_GOOD);
    expect(isLive(rec)).toBe(true);
    const last = s().revisions[s().revisions.length - 1]!;
    expect(last.kind).toBe('recertify');
    expect(last.title).toBe(`Added check “${sorted.title}”: committed function re-certified`);
    expect(rec.artifact!.recertified).toEqual([{ at: expect.any(Number), revision: last.id, reason: `Added check “${sorted.title}”` }]);
    expect(rec.artifact!.evidence!.properties.map((p) => p.name)).toEqual([sorted.title]);
    expect(rec.artifact!.evidence!.mutation).toBeUndefined();
    expect(s().mutation).toEqual({ fn: 'sortNumbers', phase: 'waiting', done: 0, total: 0 });
    // still live in the runtime: a call is served from the artifact, nothing regrows
    await run('sortNumbers([5, 4])');
    const out = lastOutput(s());
    expect(out.kind === 'output' && out.value).toBe('[4, 5]');
    expect(out.kind === 'output' && out.label).toBe('cached artifact');
    expect(gen.requests.length).toBe(requests);
    // no longer offered once added
    expect(suggestProperties(rec.spec, s().program).some((x) => x.id === sorted.id)).toBe(false);
  }, 60_000);

  it('a failing check makes the artifact stale and shows the re-check with its shrunk counterexample', async () => {
    const { engine, gen, s, run } = await committedSort(SORT_LEXICAL);
    const rec0 = s().program.functions.sortNumbers!;
    const sorted = suggestProperties(rec0.spec, s().program).find((x) => x.kind === 'sorted')!;
    await engine.addSuggestedProperty('sortNumbers', sorted.id);

    const rec = s().program.functions.sortNumbers!;
    expect(isStale(rec)).toBe(true);
    expect(rec.spec.properties).toContain(`// suggested:${sorted.id}`);
    const last = s().revisions[s().revisions.length - 1]!;
    expect(last.kind).toBe('spec-edit');
    expect(last.title).toBe(`Added check “${sorted.title}”: the committed function fails it`);
    expect(rec.artifact!.recertified).toBeUndefined();
    const g = s().generation!;
    expect(g.kind).toBe('recheck');
    expect(g.recheck).toEqual({ reason: `Added check “${sorted.title}”` });
    expect(g.phase).toBe('failed');
    expect(g.attempts).toHaveLength(1);
    const gates = g.attempts[0]!.gates;
    expect(gates.map((x) => x.gate)).toEqual(['compile', 'tests', 'properties', 'invariants']);
    expect(gates[0]!.status).toBe('pass');
    expect(gates[2]!.status).toBe('fail');
    const d = gates[2]!.diagnostics[0]!;
    expect(d.kind).toBe('property');
    expect(d.kind === 'property' && d.counterexample.length).toBeGreaterThan(0);
    expect(g.attempts[0]!.candidate!.headline).toMatch(/^Rejected:/);
    expect(s().repl.some((e) => e.kind === 'info' && e.text === RECHECK_FAILED_INFO)).toBe(true);
    // only that line: applySpec's own "artifact invalidated" line is suppressed
    expect(s().repl.some((e) => e.kind === 'info' && /artifact invalidated/.test(e.text))).toBe(false);
    // the next call regenerates
    const requests = gen.requests.length;
    gen['script'].sortNumbers = [SORT_GOOD];
    await run('sortNumbers([10, 2])');
    expect(gen.requests.length).toBe(requests + 1);
    expect(isLive(s().program.functions.sortNumbers!)).toBe(true);
  }, 60_000);

  it('recertified survives persistence, export and import', async () => {
    const { engine, s } = await committedSort(SORT_GOOD);
    const sorted = suggestProperties(s().program.functions.sortNumbers!.spec, s().program).find((x) => x.kind === 'sorted')!;
    await engine.addSuggestedProperty('sortNumbers', sorted.id);
    const want = s().program.functions.sortNumbers!.artifact!;
    const persisted = await loadPersisted();
    const head = persisted!.image.revisions.find((r) => r.id === persisted!.image.head)!;
    expect(head.kind).toBe('recertify');
    expect(head.program.functions.sortNumbers!.artifact!.recertified).toEqual(want.recertified);
    expect(head.program.functions.sortNumbers!.artifact!.evidence).toEqual(want.evidence);

    const json = await engine.exportImage();
    const t2 = setup();
    await t2.engine.init();
    await t2.engine.importImage(json);
    const imported = t2.s().program.functions.sortNumbers!;
    expect(isLive(imported)).toBe(true);
    expect(imported.artifact!.recertified).toEqual(want.recertified);
    expect(imported.artifact!.evidence).toEqual(want.evidence);

    // and a reload from the store (a new engine over the same backend)
    const t3 = setup();
    await t3.engine.init();
    expect(t3.s().program.functions.sortNumbers!.artifact!.recertified).toEqual(want.recertified);
  }, 60_000);

  it('an unknown or already-added suggestion changes nothing', async () => {
    const { engine, s } = await committedSort(SORT_GOOD);
    const n = s().revisions.length;
    await engine.addSuggestedProperty('sortNumbers', 'nope:sortNumbers');
    expect(s().revisions.length).toBe(n);
    expect(s().notice?.tone).toBe('error');
  }, 60_000);

  it('determinism and argument non-mutation are never offered (the Invariants gate checks them)', () => {
    const titles = new Set(alwaysChecked.map((c) => c.title.toLowerCase()));
    const specs: FunctionSpec[] = [
      SORT_SPEC,
      { ...SORT_SPEC, name: 'normalizeEmail', params: [{ name: 'email', type: 'string' }], returns: 'string', doc: 'Lowercases and trims.' },
      { ...SORT_SPEC, name: 'add', params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }], returns: 'number' },
      ...EXAMPLES.flatMap((e) => (e.spec ? [e.spec] : [])),
    ];
    for (const spec of specs) {
      for (const sug of suggestProperties(spec, { functions: {} })) {
        expect(titles.has(sug.title.toLowerCase())).toBe(false);
        expect(sug.title).not.toMatch(/deterministic|twice|not modified|mutat/i);
      }
    }
  });
});

// ───────────────────────── measured kill rates (README) ─────────────────────────

describe('kill rates of the shipped checks on the shipped known-good bodies (engine path)', () => {
  it('prints the reports', async () => {
    const lines: string[] = [];
    for (const ex of EXAMPLES) {
      if (!ex.spec) {
        lines.push(`${ex.id.padEnd(10)} (spec-less: grown from the call, no tests) → ${NO_TESTS_REASON}`);
        continue;
      }
      for (const [i, body] of ex.goodBodies.entries()) {
        _useBackend(memoryBackend()); // a fresh image per body
        const { engine, s, run } = setup({ script: { [ex.fn]: [body] }, examples: [{ ...ex, spec: ex.spec }], deps: { mutation: { idleMs: 3_600_000, quietMs: 0 } } });
        await engine.init();
        await run(ex.call);
        if (!s().program.functions[ex.fn]) throw new Error(`${ex.id}: ${JSON.stringify(s().repl.slice(-4))} ${JSON.stringify(s().notice)}`);
        expect(isLive(s().program.functions[ex.fn]!), `${ex.id}#${i} committed`).toBe(true);
        const t0 = performance.now();
        await engine.runMutation(ex.fn);
        const ev = s().program.functions[ex.fn]!.artifact!.evidence!;
        lines.push(`${`${ex.id}#${i}`.padEnd(10)} ${describeEvidence(ev)} [${Math.round(performance.now() - t0)} ms]`);
        for (const sv of ev.mutation!.survivors) lines.push(`             survivor: compiled line ${sv.line}: ${sv.original} → ${sv.mutated}`);
        expect(ev.mutation!.skipped ?? '').not.toMatch(/could not run/);
        engine.dispose();
      }
    }
    console.log(`\nKill rates (engine path, default 6 s time box, Node: no watchdog):\n${lines.join('\n')}\n`);
  }, 300_000);
});
