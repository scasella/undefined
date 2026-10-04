/**
 * The engine end to end in Node: a scripted generator stands in for the model (it is the only fake), while the
 * REAL TypeScript compile gate, the REAL gate executor (tests, fast-check properties, invariants), the REAL REPL
 * core (behind the real Runtime with an in-process worker) and the REAL store (in-memory backend) decide.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  EngineState,
  FunctionSpec,
  GenerateError,
  GenerateRequest,
  GenerateResult,
  Generator,
  ProgressLine,
  Recording,
  ReplEntry,
  ServiceStatus,
} from '../types';
import { warmUp } from '../gates/compile';
import { executeGates } from '../sandbox/gateExecutor';
import { Runtime, type RuntimeWorkerLike } from '../sandbox/runtime';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from '../sandbox/replCore';
import type { ExecGateInput } from '../sandbox/gateRunner';
import { encodeValue } from '../shared/serialize';
import {
  createEngine,
  decodeCallArgs,
  LOST_PREFIX,
  RECURSION_HINT,
  TAKEAWAY_TEXT,
  type EngineDeps,
  type EngineExample,
  type EngineHandle,
  type RuntimeLike,
} from './engine';
import { GenerationFailure, validateRecording } from './generator';
import { hashesFor } from '../shared/hash';
import { isLive, isStale } from './program';
import { _useBackend, memoryBackend } from './store';

// ───────────────────────── a median spec (inline; not the examples module) ─────────────────────────

const MEDIAN_SPEC: FunctionSpec = {
  name: 'median',
  params: [{ name: 'numbers', type: 'number[]' }],
  returns: 'number',
  doc: 'The median of a non-empty list of finite numbers. For an even count, the mean of the two middle values. Throws RangeError on an empty list.',
  // Odd-length tests only: the off-by-one candidate passes them, so the properties must catch it.
  tests: `test("odd count", () => eq(median([3, 1, 2]), 2));
test("single", () => eq(median([7]), 7));`,
  properties: `matchesReference("agrees with the sort-based reference",
  [fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1 })],
  (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; });`,
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'example',
  exampleId: 'median',
};

const MEDIAN_BAD = `const sorted = [...numbers].sort((a, b) => a - b);
return sorted[Math.floor((sorted.length - 1) / 2)];`;

const MEDIAN_GOOD = `if (numbers.length === 0) throw new RangeError("median of an empty list");
const sorted = [...numbers].sort((a, b) => a - b);
const mid = Math.floor(sorted.length / 2);
return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];`;

const MEDIAN_COMPILE_BAD = `const sorted = [...numbers].sort((a, b) => a - b);
const result: number = "even";
return result;`;

const EXAMPLE: EngineExample = {
  id: 'median',
  title: 'median',
  blurb: 'Off-by-one on even lengths; a property catches it.',
  call: 'median([3, 1, 4, 2])',
  fn: 'median',
  breakIt: { label: 'Break it: ignore NaN', description: 'NaN values are skipped.' },
  spec: MEDIAN_SPEC,
  breakPatch: {
    doc: `${MEDIAN_SPEC.doc} NaN values are ignored.`,
    tests: `${MEDIAN_SPEC.tests}\ntest("ignores NaN", () => eq(median([1, NaN, 3]), 2));`,
  },
};

// ───────────────────────── harness ─────────────────────────

/** The model stand-in: hands out scripted bodies (or failures) per function, in order. */
class ScriptedGenerator implements Generator {
  readonly requests: GenerateRequest[] = [];
  constructor(
    readonly mode: 'live' | 'replay',
    private readonly script: Record<string, Array<string | GenerateError>>,
  ) {}

  push(fn: string, ...items: Array<string | GenerateError>): void {
    (this.script[fn] ??= []).push(...items);
  }

  async generate(req: GenerateRequest, onProgress: (p: ProgressLine) => void): Promise<GenerateResult> {
    this.requests.push(req);
    const next = this.script[req.fn]?.shift();
    if (next === undefined) throw new GenerationFailure({ code: 'recording_exhausted', message: `script for ${req.fn} is exhausted` });
    if (typeof next !== 'string') throw new GenerationFailure(next);
    const line: ProgressLine = { t: 1, text: 'drafting function body', channel: 'event' };
    onProgress(line);
    return { body: next, notes: 'scripted', model: 'test-model', codexVersion: '0.0.1', durationMs: 3, source: this.mode, progress: [line] };
  }
}

/** Runs the real replCore dispatcher in-process with Worker-like async delivery (as runtime.test.ts does). */
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

const ZERO_PACING = { typeCharMs: 0, gateDwellMs: 0, replayMaxMs: 0 };

const realRuntime = (): Runtime => new Runtime({ callBudgetMs: 10_000, workerFactory: () => new InProcessWorker() });

/** The real runtime with some methods replaced (to simulate what a test needs from the runtime side). */
function wrapRuntime(rt: Runtime, over: (rt: Runtime) => Partial<RuntimeLike>): RuntimeLike {
  return {
    define: (name, js, budgetMs) => rt.define(name, js, budgetMs),
    undefine: (name) => rt.undefine(name),
    evaluate: (input) => rt.evaluate(input),
    snapshotEnv: () => rt.snapshotEnv(),
    envShown: () => rt.envShown(),
    reset: (fns, env) => rt.reset(fns, env),
    dispose: () => rt.dispose(),
    ...over(rt),
  };
}

/**
 * Supplies the encoded `args` of an undefined call when the runtime does not send them yet (replCore emits them
 * once the sandbox change lands; then this wrapper is a no-op).
 */
const withCallArgs = (args: Record<string, unknown[]>) => (rt: Runtime): Partial<RuntimeLike> => ({
  evaluate: async (input) => {
    const o = await rt.evaluate(input);
    if (o.kind === 'undefined-call' && !Array.isArray((o as { args?: unknown }).args) && args[o.call]) {
      return { ...o, args: args[o.call]!.map(encodeValue) };
    }
    return o;
  },
});

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const engines: EngineHandle[] = [];

function setup(
  opts: {
    script?: Record<string, Array<string | GenerateError>>;
    service?: ServiceStatus;
    deps?: Partial<EngineDeps>;
  } = {},
) {
  const gen = new ScriptedGenerator(opts.service && opts.service.state === 'down' ? 'replay' : 'live', opts.script ?? {});
  let clock = Date.UTC(2026, 9, 4, 9, 0, 0);
  const memory = { last: null as string | null };
  const engine = createEngine({
    examples: [EXAMPLE],
    initialExampleId: 'median',
    probeService: async () => opts.service ?? { state: 'up', model: 'test-model', codexVersion: '0.0.1' },
    createLiveGenerator: () => gen,
    createReplayGenerator: () => gen,
    loadRecordings: async () => [],
    createRuntime: realRuntime,
    execGates: (input, onGate) =>
      Promise.resolve(executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) })),
    now: () => (clock += 1000),
    sleep: async () => {},
    pacing: ZERO_PACING,
    inputMemory: { load: () => memory.last, save: (t) => void (memory.last = t) },
    ...opts.deps,
  });
  engines.push(engine);
  const s = (): EngineState => engine.state.value;
  const run = async (text: string): Promise<ReplEntry[]> => {
    const before = s().repl.length;
    engine.setInput(text);
    await engine.submit();
    return s().repl.slice(before);
  };
  return { engine, gen, s, run };
}

const strip = (entries: ReplEntry[]) => entries.map(({ id: _id, ...rest }) => rest);
const lastError = (s: EngineState) => [...s.repl].reverse().find((e): e is Extract<ReplEntry, { kind: 'error' }> => e.kind === 'error')!;

beforeAll(async () => {
  await warmUp();
}, 60_000);

beforeEach(() => {
  _useBackend(memoryBackend());
});

afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  _useBackend(null);
});

// ───────────────────────── tests ─────────────────────────

describe('engine: the opening story', () => {
  it('grows median on an undefined call, the properties reject candidate 1, candidate 2 is committed as r2', async () => {
    const { engine, gen, s, run } = setup({ script: { median: [MEDIAN_BAD, MEDIAN_GOOD] } });
    await engine.init();

    expect(s().ready).toBe(true);
    expect(s().mode).toBe('live');
    expect(s().replInput).toBe('median([3, 1, 4, 2])');
    expect(s().hints).toEqual({ opener: true, takeaway: false });
    expect(s().revisions.map((r) => [r.id, r.kind])).toEqual([[1, 'init']]);
    expect(s().program.functions.median!.artifact).toBeNull();
    expect(s().examples).toEqual([
      { id: 'median', title: 'median', blurb: EXAMPLE.blurb, call: EXAMPLE.call, fn: 'median', breakIt: EXAMPLE.breakIt },
    ]);

    await engine.submit();

    expect(strip(s().repl)).toEqual([
      { kind: 'input', text: 'median([3, 1, 4, 2])' },
      { kind: 'error', name: 'ReferenceError', message: 'median is not defined' },
      { kind: 'info', text: 'Generating…', tone: 'accent' },
      { kind: 'output', value: '2.5', ms: expect.any(Number), label: 'generated', detail: 'revision 2' },
    ]);
    expect(s().busy).toBe(false);
    expect(s().hints.opener).toBe(false);
    expect(s().replInput).toBe('');

    const g = s().generation!;
    expect(g).toMatchObject({ fn: 'median', phase: 'committed', revision: 2, attempt: 2, maxAttempts: 3, ungated: false, mode: 'live' });
    expect(g.signature).toBe('function median(numbers: number[]): number');
    expect(g.call).toBe('median([3, 1, 4, 2])');
    const [a1, a2] = g.attempts;
    expect(a1!.status).toBe('rejected');
    expect(a1!.candidate!.rejectedBy).toBe('properties');
    expect(a1!.candidate!.headline).toMatch(/^Rejected: median\(\[.*\]\) returned -?\d+, expected -?\d+(\.5)?$/);
    expect(a1!.gates.map((x) => x.status)).toEqual(['pass', 'pass', 'fail', 'skipped']);
    expect(a1!.gates[3]!.note).toBe('not reached');
    expect(a2!.status).toBe('accepted');
    expect(a2!.gates.map((x) => x.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(a2!.shown).toBe(MEDIAN_GOOD);

    // the toolchain's verdict reached the model on the retry; replay indices are contiguous
    expect(gen.requests.map((r) => r.attempt)).toEqual([0, 1]);
    expect(gen.requests[0]!.prompt).not.toContain('PREVIOUS ATTEMPT');
    expect(gen.requests[1]!.prompt).toContain('PREVIOUS ATTEMPT (rejected)');
    expect(gen.requests[1]!.prompt).toContain('PROPERTIES FAILED');
    // "what the model saw" is the exact prompt that was sent, kept on each candidate
    expect(a1!.candidate!.prompt).toBe(gen.requests[0]!.prompt);
    expect(a2!.candidate!.prompt).toBe(gen.requests[1]!.prompt);

    expect(s().headRevision).toBe(2);
    const r2 = s().revisions[1]!;
    expect(r2).toMatchObject({ id: 2, kind: 'commit', fn: 'median', fns: 1, artifacts: 1 });
    expect(r2.title).toBe('median certified — attempt 2 of 3 (rejected by properties first)');
    const art = s().program.functions.median!.artifact!;
    expect(art).toMatchObject({ body: MEDIAN_GOOD, returnType: 'number', model: 'test-model', codexVersion: '0.0.1', revision: 2 });
    expect(art.candidates.map((c) => c.verdict)).toEqual(['rejected', 'accepted']);
    expect(art.candidates.map((c) => c.prompt)).toEqual(gen.requests.map((r) => r.prompt));
    expect(art.js).toContain('function median(numbers)');

    // second call: cached artifact + the takeaway, once
    const second = await run('median([5, 1, 3])');
    expect(strip(second)).toEqual([
      { kind: 'input', text: 'median([5, 1, 3])' },
      { kind: 'output', value: '3', ms: expect.any(Number), label: 'cached artifact', detail: 'certified r2' },
      { kind: 'takeaway', text: TAKEAWAY_TEXT },
    ]);
    expect(s().hints.takeaway).toBe(true);
    const third = await run('median([10, 2, 38, 23])');
    expect(strip(third)).toEqual([
      { kind: 'input', text: 'median([10, 2, 38, 23])' },
      { kind: 'output', value: '16.5', ms: expect.any(Number), label: 'cached artifact', detail: 'certified r2' },
    ]);
    const plain = await run('1 + 1');
    expect(strip(plain)[1]).toEqual({ kind: 'output', value: '2', ms: expect.any(Number), label: null });
    expect(gen.requests).toHaveLength(2);
    expect(s().revisions).toHaveLength(2);
  }, 60_000);
});

describe('engine: growth paths', () => {
  it('a novel call with no spec is gated by compile + invariants only and works end to end', async () => {
    const { engine, gen, s, run } = setup({ script: { double: ['return arg0 * 2;'] } });
    await engine.init();
    const out = await run('double(21)');
    expect(strip(out).map((e) => e.kind)).toEqual(['input', 'error', 'info', 'output']);
    expect(out[3]).toMatchObject({ value: '42', label: 'generated', detail: 'revision 2' });
    const g = s().generation!;
    expect(g.ungated).toBe(true);
    expect(g.signature).toBe('function double(arg0: number)');
    expect(g.attempts[0]!.gates.map((x) => [x.gate, x.status])).toEqual([
      ['compile', 'pass'],
      ['tests', 'skipped'],
      ['properties', 'skipped'],
      ['invariants', 'pass'],
    ]);
    const rec = s().program.functions.double!;
    expect(rec.spec.origin).toBe('call');
    expect(rec.artifact!.returnType).toBe('number');
    expect(gen.requests[0]!.prompt).toContain('TRIGGERING CALL');
    expect(gen.requests[0]!.prompt).toContain('(number)');
  }, 30_000);

  it('grows chained unknowns one after another and re-evaluates the original input', async () => {
    const { engine, s, run } = setup({ script: { dbl: ['return arg0 * 2;'], inc: ['return arg0 + 1;'] } });
    await engine.init();
    const out = await run('inc(dbl(2))');
    expect(strip(out).filter((e) => e.kind === 'error').map((e) => (e as { message: string }).message)).toEqual([
      'dbl is not defined',
      'inc is not defined',
    ]);
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value: '5', label: 'generated', detail: 'revision 3' });
    expect(s().revisions.map((r) => r.kind)).toEqual(['init', 'commit', 'commit']);
  }, 30_000);

  it('budget exhaustion leaves the program and the revisions unchanged; retry runs the grow again', async () => {
    const { engine, gen, s, run } = setup({ script: { median: [MEDIAN_BAD, MEDIAN_BAD, MEDIAN_COMPILE_BAD] } });
    await engine.init();
    const programBefore = s().program;
    const out = await run('median([1, 2])');
    const err = out[out.length - 1]!;
    expect(err).toMatchObject({ kind: 'error', name: 'GrowthFailed' });
    expect((err as { message: string }).message).toBe('median([1, 2]): Budget exhausted after 3 candidates — the program is unchanged.');
    expect((err as { restarts: { id: string }[] }).restarts.map((r) => r.id)).toEqual(['retry', 'edit-spec', 'dismiss']);
    expect(s().revisions).toHaveLength(1);
    expect(s().program).toBe(programBefore);
    expect(s().program.functions.median!.artifact).toBeNull();
    const g = s().generation!;
    expect(g.phase).toBe('failed');
    expect(g.error).toBeUndefined();
    expect(g.attempts.map((a) => [a.status, a.candidate?.rejectedBy])).toEqual([
      ['rejected', 'properties'],
      ['rejected', 'properties'],
      ['rejected', 'compile'],
    ]);
    expect(gen.requests).toHaveLength(3);

    // retry: a fresh grow; the original input is re-evaluated after the commit
    gen.push('median', MEDIAN_GOOD);
    await engine.invokeRestart(err.id, 'retry');
    expect(s().repl.find((e) => e.id === err.id)).toMatchObject({ resolved: true });
    expect(s().repl[s().repl.length - 1]).toMatchObject({ kind: 'output', value: '1.5', label: 'generated', detail: 'revision 2' });
    expect(gen.requests[3]!.attempt).toBe(0);
    expect(s().busy).toBe(false);
  }, 60_000);

  it('a compile rejection feeds the TypeScript diagnostic into the next prompt', async () => {
    const { engine, gen, s, run } = setup({ script: { median: [MEDIAN_COMPILE_BAD, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    const a1 = s().generation!.attempts[0]!;
    expect(a1.candidate).toMatchObject({ verdict: 'rejected', rejectedBy: 'compile' });
    expect(a1.candidate!.headline).toBe("Rejected: line 2: Type 'string' is not assignable to type 'number'.");
    expect(a1.gates.slice(1).map((x) => x.note)).toEqual(['not reached', 'not reached', 'not reached']);
    expect(gen.requests[1]!.prompt).toContain('COMPILE FAILED');
    expect(gen.requests[1]!.prompt).toContain('TS2322');
    expect(s().revisions[1]!.title).toBe('median certified — attempt 2 of 3 (rejected by compile first)');
  }, 30_000);

  it('a generation error surfaces the error and its fix; the program is unchanged', async () => {
    const problem: GenerateError = { code: 'not_logged_in', message: 'Codex is installed but not logged in.', fix: ['codex login'] };
    const { engine, s, run } = setup({
      service: { state: 'degraded', problem, model: 'test-model' },
      script: { median: [{ code: 'codex_failed', message: 'codex exited with status 1' }] },
    });
    await engine.init();
    expect(s().mode).toBe('live');
    expect(s().service.problem).toEqual(problem);
    const out = await run('median([1, 2, 3])');
    const g = s().generation!;
    expect(g.phase).toBe('failed');
    expect(g.error).toEqual({ code: 'codex_failed', message: 'codex exited with status 1', fix: ['codex login'] });
    expect(g.attempts[0]!.status).toBe('aborted');
    const err = out[out.length - 1]!;
    expect(err).toMatchObject({ kind: 'error', name: 'GenerationFailed', message: 'codex exited with status 1' });
    expect((err as { restarts: { id: string }[] }).restarts.map((r) => r.id)).toEqual(['retry', 'dismiss']);
    expect(s().revisions).toHaveLength(1);
  }, 30_000);

  it('a spec error aborts the grow loop without burning the budget (transpile error and load-time throw)', async () => {
    const { engine, gen, s, run } = setup({ script: { median: [MEDIAN_GOOD, MEDIAN_GOOD] } });
    await engine.init();
    await engine.editSpec('median', { tests: 'test("broken", () => { eq(median([1]), 1) ' });
    let out = await run('median([1])');
    expect(gen.requests).toHaveLength(1);
    let a = s().generation!.attempts[0]!;
    expect(a.status).toBe('aborted');
    expect(a.candidate!.verdict).toBe('aborted');
    expect(a.gates[1]).toMatchObject({ gate: 'tests', status: 'fail', note: 'spec error' });
    expect(s().generation!.phase).toBe('failed');
    expect(out[out.length - 1]).toMatchObject({ kind: 'error', name: 'SpecError' });
    expect((out[out.length - 1] as { message: string }).message).toContain('Fix the spec');

    await engine.editSpec('median', { tests: 'notAFunction();' });
    out = await run('median([1])');
    expect(gen.requests).toHaveLength(2);
    a = s().generation!.attempts[0]!;
    expect(a.status).toBe('aborted');
    expect(a.gates[1]).toMatchObject({ status: 'fail', note: 'spec error' });
    expect(s().generation!.attempts).toHaveLength(1);
    expect(s().program.functions.median!.artifact).toBeNull();
  }, 30_000);

  it('refuses to grow masked globals and reserved names', async () => {
    const { engine, gen, s, run } = setup();
    await engine.init();
    let out = await run('fetch("https://example.com")');
    expect(strip(out)).toEqual([
      { kind: 'input', text: 'fetch("https://example.com")' },
      { kind: 'error', name: 'ReferenceError', message: expect.stringMatching(/^fetch is not defined \(fetch is a masked global/) },
    ]);
    out = await run('constructor(1)');
    expect(out[1]).toMatchObject({ kind: 'error', message: expect.stringContaining('reserved name') });
    out = await run('eval("1")');
    expect(out[1]).toMatchObject({ kind: 'error', message: expect.stringContaining('masked global') });
    expect(gen.requests).toHaveLength(0);
    expect(s().generation).toBeNull();
  }, 30_000);

  it('TS7023 (recursion without a declared return type) is not charged and the hint reaches the next prompt', async () => {
    const { engine, gen, s, run } = setup({
      script: {
        fact: ['if (n <= 1) return 1;\nreturn n * fact(n - 1);', 'let r = 1;\nfor (let i = 2; i <= n; i++) r *= i;\nreturn r;'],
      },
    });
    await engine.init();
    await engine.upsertSpec({
      name: 'fact',
      params: [{ name: 'n', type: 'number' }],
      returns: null,
      doc: 'n factorial',
      tests: '',
      properties: '',
      budgetMs: 1000,
      maxAttempts: 1,
      origin: 'user',
    });
    const out = await run('fact(5)');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value: '120', label: 'generated' });
    const g = s().generation!;
    expect(g.attempts[0]!.candidate!.rejectedBy).toBe('compile');
    expect(g.attempts[0]!.gates[0]!.diagnostics.some((d) => d.kind === 'compile' && d.code === 7023)).toBe(true);
    expect(g.maxAttempts).toBe(2);
    expect(gen.requests[1]!.prompt).toContain(RECURSION_HINT);
  }, 30_000);
});

describe('engine: specs, examples, history', () => {
  it('editSpec invalidates the artifact and the next call regenerates from the new spec', async () => {
    const { engine, gen, s, run } = setup({ script: { median: [MEDIAN_GOOD, MEDIAN_GOOD] } });
    await engine.init();
    await run('median([1, 2])');
    const before = s().program.functions.median!;
    await engine.editSpec('median', { doc: `${MEDIAN_SPEC.doc} Be exact.` });
    const after = s().program.functions.median!;
    expect(after.specHash).not.toBe(before.specHash);
    expect(isStale(after)).toBe(true);
    const rev = s().revisions[s().revisions.length - 1]!;
    expect(rev).toMatchObject({ id: 3, kind: 'spec-edit', fn: 'median', title: 'Spec edited: median — artifact invalidated', artifacts: 0 });
    const infoLine = s().repl[s().repl.length - 1]!;
    expect(infoLine).toMatchObject({ kind: 'info' });
    expect((infoLine as { text: string }).text).toBe(
      `median: spec hash ${before.specHash.slice(0, 4)}… → ${after.specHash.slice(0, 4)}… · artifact invalidated; the next call regenerates`,
    );

    const out = await run('median([1, 2])');
    expect(strip(out).map((e) => e.kind)).toEqual(['input', 'error', 'info', 'output']);
    expect(out[3]).toMatchObject({ value: '1.5', label: 'generated', detail: 'revision 4' });
    expect(gen.requests[1]!.specHash).toBe(after.specHash);
    expect(s().program.functions.median!.artifact!.revision).toBe(4);

    // maxAttempts is not hashed: editing it keeps the artifact live
    await engine.editSpec('median', { maxAttempts: 5 });
    expect(s().program.functions.median!.artifact!.revision).toBe(4);
    expect(isStale(s().program.functions.median!)).toBe(false);
    expect(s().revisions[s().revisions.length - 1]!.title).toBe('Spec edited: median — artifact unaffected');
  }, 30_000);

  it('breakIt applies the example patch, invalidates the artifact and pre-types the example call', async () => {
    const { engine, s, run } = setup({ script: { median: [MEDIAN_GOOD] } });
    await engine.init();
    await run('median([1, 2])');
    const before = s().program.functions.median!;
    await engine.breakIt('median');
    const after = s().program.functions.median!;
    expect(after.testsHash).not.toBe(before.testsHash);
    expect(after.spec.tests).toBe(EXAMPLE.breakPatch.tests);
    expect(isStale(after)).toBe(true);
    expect(s().replInput).toBe(EXAMPLE.call);
    expect(s().revisions[s().revisions.length - 1]).toMatchObject({ kind: 'spec-edit', title: 'Spec edited: median — artifact invalidated' });
  }, 30_000);

  it('loadExample adds a missing spec as an example revision, or just pre-types the call', async () => {
    const { engine, s } = setup();
    await engine.init();
    await engine.loadExample('median');
    expect(s().revisions).toHaveLength(1); // already present: input only
    expect(s().replInput).toBe(EXAMPLE.call);
    await engine.resetImage();
    // a fresh engine whose program lacks the example
    const other = setup({ deps: { examples: [EXAMPLE, { ...EXAMPLE, id: 'median2', fn: 'median2', title: 'm2', call: 'median2([1])', spec: { ...MEDIAN_SPEC, name: 'median2' } }] } });
    await other.engine.init();
    await other.engine.loadExample('median2');
    expect(other.s().revisions[other.s().revisions.length - 1]).toMatchObject({ kind: 'example', title: 'Loaded example: m2', fn: 'median2' });
    expect(other.s().replInput).toBe('median2([1])');
  }, 30_000);

  it('rollback restores functions AND REPL variables exactly as they were at that revision', async () => {
    const { engine, gen, s, run } = setup({ script: { median: [MEDIAN_GOOD] } });
    await engine.init();
    await run('a = 1');
    await run('xs = [4, 1, 3]');
    await run('median(xs)'); // r2 snapshots a and xs
    await run('a = 99');
    await run('b = new Map([["k", 1n]])');
    expect(s().env).toEqual({ a: '99', xs: '[4, 1, 3]', b: 'Map(1) { "k" => 1n }' });

    await engine.rollback(2);
    expect(s().headRevision).toBe(3);
    expect(s().revisions[2]).toMatchObject({ kind: 'rollback', restoredFrom: 2, title: 'Rolled back to r2' });
    expect(s().env).toEqual({ a: '1', xs: '[4, 1, 3]' });
    expect((s().repl[s().repl.length - 1] as { text: string }).text).toBe('Rolled back to r2 — restored 1 function and 2 variables');
    const out = await run('median(xs)');
    expect(out[1]).toMatchObject({ value: '3', label: 'cached artifact' });

    await engine.rollback(1);
    expect(s().env).toEqual({});
    expect(s().program.functions.median!.artifact).toBeNull();
    gen.push('median', MEDIAN_GOOD);
    const regrow = await run('median([1, 2])');
    expect(regrow[1]).toMatchObject({ kind: 'error', message: 'median is not defined' });
  }, 30_000);

  it('a runtime fault offers retry / rollback / edit-spec; retry regenerates with the fault fed back', async () => {
    const { engine, gen, s, run } = setup({ script: { median: [MEDIAN_GOOD] } });
    await engine.init();
    await run('median([1, 2])'); // r2
    const out = await run('median([])');
    const err = out[1] as Extract<ReplEntry, { kind: 'error' }>;
    expect(err).toMatchObject({ kind: 'error', name: 'RangeError', message: 'median([]) threw RangeError: median of an empty list' });
    expect(err.restarts!.map((r) => r.id)).toEqual(['retry', 'rollback', 'edit-spec']);

    gen.push('median', MEDIAN_GOOD);
    await engine.invokeRestart(err.id, 'retry');
    expect(s().repl.find((e) => e.id === err.id)).toMatchObject({ resolved: true });
    const req = gen.requests[1]!;
    expect(req.attempt).toBe(0);
    expect(req.prompt).toContain('RUNTIME FAULT');
    expect(req.prompt).toContain('median([])');
    expect(req.prompt).not.toContain('PREVIOUS ATTEMPT');
    expect(s().headRevision).toBe(3);
    // same contract, same verdict: the re-evaluated call faults again, with fresh restarts
    const again = lastError(s());
    expect(again.id).not.toBe(err.id);
    expect(again.resolved).toBeUndefined();

    await engine.invokeRestart(again.id, 'edit-spec');
    expect(s().focusSpec).toEqual({ fn: 'median', nonce: 1 });

    const third = await run('median([])');
    const err3 = third[1] as Extract<ReplEntry, { kind: 'error' }>;
    await engine.invokeRestart(err3.id, 'rollback');
    // the faulting artifact was committed in r3: roll back to r2
    expect(s().revisions[s().revisions.length - 1]).toMatchObject({ kind: 'rollback', restoredFrom: 2 });
    expect(s().program.functions.median!.artifact!.revision).toBe(2);
  }, 30_000);
});

describe('engine: images and persistence', () => {
  it('export → reset → import round-trips the image and the live functions', async () => {
    const { engine, gen, s, run } = setup({ script: { median: [MEDIAN_GOOD] } });
    await engine.init();
    await run('xs = [9, 1, 5]');
    await run('median(xs)');
    const json = await engine.exportImage();
    expect(JSON.parse(json)).toMatchObject({ format: 'undefined-image', version: 1, head: 2 });

    await engine.resetImage();
    expect(s().revisions).toHaveLength(1);
    expect(s().repl).toEqual([]);
    expect(s().hints.opener).toBe(true);
    expect(s().replInput).toBe(EXAMPLE.call);
    expect(s().env).toEqual({});

    await engine.importImage(json);
    expect(s().revisions.map((r) => r.kind)).toEqual(['init', 'commit', 'import']);
    expect(s().revisions[2]!.title).toBe('Imported image (2 revisions)');
    expect(s().env).toEqual({ xs: '[9, 1, 5]' });
    const out = await run('median(xs)');
    expect(out[1]).toMatchObject({ value: '5', label: 'cached artifact', detail: 'certified r2' });
    expect(gen.requests).toHaveLength(1);
  }, 30_000);

  it('an invalid import sets a precise error notice and changes nothing', async () => {
    const { engine, s } = setup();
    await engine.init();
    const before = { program: s().program, revisions: s().revisions };
    await engine.importImage('{"format":"undefined-image","version":2}');
    expect(s().notice).toEqual({ tone: 'error', text: 'Import failed: version must be 1' });
    await engine.importImage('not json');
    expect(s().notice!.text).toMatch(/^Import failed: the file is not JSON/);
    expect(s().program).toBe(before.program);
    expect(s().revisions).toBe(before.revisions);
  }, 30_000);

  it('init restores the persisted image, flags and live state; the takeaway is shown once ever', async () => {
    const first = setup({ script: { median: [MEDIAN_GOOD] } });
    await first.engine.init();
    await first.run('xs = [5, 1, 3]');
    await first.run('median(xs)');
    const cached = await first.run('median(xs)');
    expect(cached.map((e) => e.kind)).toEqual(['input', 'output', 'takeaway']);
    first.engine.dispose();

    const second = setup();
    await second.engine.init();
    const s = second.s();
    expect(s.revisions.map((r) => r.kind)).toEqual(['init', 'commit']);
    expect(s.headRevision).toBe(2);
    expect(s.hints).toEqual({ opener: false, takeaway: true });
    expect(s.env).toEqual({ xs: '[5, 1, 3]' });
    const out = await second.run('median(xs)');
    expect(strip(out)).toEqual([
      { kind: 'input', text: 'median(xs)' },
      { kind: 'output', value: '3', ms: expect.any(Number), label: 'cached artifact', detail: 'certified r2' },
    ]);
    expect(second.gen.requests).toHaveLength(0);
  }, 30_000);

  it('replay mode when the service is down; recheckService switches to live when it comes up', async () => {
    let status: ServiceStatus = { state: 'down' };
    const { engine, s } = setup({ service: { state: 'down' }, deps: { probeService: async () => status } });
    await engine.init();
    expect(s().mode).toBe('replay');
    status = { state: 'up', model: 'test-model', codexVersion: '0.0.1' };
    await engine.recheckService();
    expect(s().mode).toBe('live');
    expect(s().service.state).toBe('up');
    expect(s().notice).toEqual({ tone: 'info', text: 'Live service connected' });
  }, 30_000);

  it('exportRecording collects live generations', async () => {
    const { engine, run } = setup({ script: { median: [MEDIAN_BAD, MEDIAN_GOOD] } });
    await engine.init();
    expect(engine.exportRecording()).toBeNull();
    await run('median([1, 2])');
    const rec = engine.exportRecording()!;
    expect(rec.id).toMatch(/^median-\d{8}T\d{6}$/);
    expect(rec.sessions).toHaveLength(1);
    expect(rec.sessions[0]!.attempts.map((a) => a.body)).toEqual([MEDIAN_BAD, MEDIAN_GOOD]);
    expect(rec.sessions[0]!.label.startsWith('median — The median of a non-empty list')).toBe(true);
    // v2: the spec it was generated against and the REPL input that triggered it
    expect(rec.version).toBe(2);
    expect(rec.sessions[0]!.spec).toEqual(MEDIAN_SPEC);
    expect(rec.sessions[0]!.calls).toEqual(['median([1, 2])']);
    const v = validateRecording(JSON.parse(JSON.stringify(rec)));
    expect(v.ok).toBe(true);
  }, 30_000);

  it('a replayed candidate keeps the prompt stored in the recording, not the one this build would send', async () => {
    const { specHash, testsHash } = await hashesFor(MEDIAN_SPEC);
    const recording: Recording = {
      format: 'undefined-recording',
      version: 1,
      id: 'r',
      title: 'r',
      recordedAt: '2026-10-01T00:00:00.000Z',
      model: 'm',
      codexVersion: '0',
      effort: 'low',
      sessions: [
        {
          fn: 'median',
          specHash,
          testsHash,
          label: 'median',
          attempts: [{ prompt: 'THE RECORDED PROMPT', body: MEDIAN_GOOD, notes: '', durationMs: 0, progress: [] }],
        },
      ],
    };
    const { engine, gen, s } = setup({
      service: { state: 'down' },
      script: { median: [MEDIAN_GOOD] },
      deps: { loadRecordings: async () => [recording] },
    });
    await engine.init();
    expect(s().mode).toBe('replay');
    await engine.submit();
    const c = s().generation!.attempts[0]!.candidate!;
    expect(c.source).toBe('replay');
    expect(gen.requests[0]!.prompt).not.toBe('THE RECORDED PROMPT');
    expect(c.prompt).toBe('THE RECORDED PROMPT');
    expect(engine.exportRecording()).toBeNull(); // replayed candidates are never re-recorded
  }, 30_000);
});

describe('engine: pacing and cancellation', () => {
  it('types the candidate in and keeps each gate visibly running before its verdict', async () => {
    const { engine, s } = setup({
      script: { median: [MEDIAN_BAD, MEDIAN_GOOD] },
      deps: { pacing: { typeCharMs: 1, gateDwellMs: 5, replayMaxMs: 0 }, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    });
    await engine.init();
    const letter: Record<string, string> = { pending: '.', running: 'R', pass: 'P', fail: 'F', skipped: 's' };
    const seen: Array<{ attempt: number; status: string; shown: number; gates: string }> = [];
    const stop = engine.state.subscribe((st) => {
      const g = st.generation;
      if (!g) return;
      for (const a of g.attempts) {
        seen.push({ attempt: a.attempt, status: a.status, shown: a.shown.length, gates: a.gates.map((x) => letter[x.status]).join('') });
      }
    });
    await engine.submit();
    stop();
    const first = seen.filter((x) => x.attempt === 1);
    // typewriter: partial reveals between empty and the full body
    expect(first.some((x) => x.status === 'typing' && x.shown > 0 && x.shown < MEDIAN_BAD.length)).toBe(true);
    // each gate is shown running before it is shown final; gates after the failure are skipped
    const gateStates = [...new Set(first.map((x) => x.gates))];
    expect(gateStates).toEqual(['', '....', 'R...', 'P...', 'PR..', 'PP..', 'PPR.', 'PPFs']);
    const second = [...new Set(seen.filter((x) => x.attempt === 2).map((x) => x.gates))];
    expect(second).toEqual(['', '....', 'R...', 'P...', 'PR..', 'PP..', 'PPR.', 'PPP.', 'PPPR', 'PPPP']);
    expect(s().generation!.phase).toBe('committed');
  }, 30_000);

  it('resetImage aborts an in-flight generation and leaves a clean, idle engine', async () => {
    const hanging: Generator = {
      mode: 'live',
      generate: (_req, _onProgress, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new GenerationFailure({ code: 'aborted', message: 'cancelled' })));
        }),
    };
    const { engine, s } = setup({ deps: { createLiveGenerator: () => hanging } });
    await engine.init();
    const pending = engine.submit();
    await new Promise((r) => setTimeout(r, 20));
    expect(s().busy).toBe(true);
    expect(s().generation!.phase).toBe('generating');
    await engine.resetImage();
    await pending;
    expect(s().busy).toBe(false);
    expect(s().repl).toEqual([]);
    expect(s().generation).toBeNull();
    expect(s().revisions).toHaveLength(1);
  }, 30_000);
});

// ───────────────────────── review fixes ─────────────────────────

describe('engine: the triggering call reaches the Invariants gate', () => {
  it('decodeCallArgs decodes the runtime encoding and refuses placeholders or a missing list', () => {
    expect(decodeCallArgs([encodeValue([1, 2]), encodeValue(1n), encodeValue(new Map([['a', NaN]]))])).toEqual([[1, 2], 1n, new Map([['a', NaN]])]);
    expect(decodeCallArgs(undefined)).toBeUndefined();
    expect(decodeCallArgs([1, { $t: 'unserializable', show: '[Function f]' }])).toBeUndefined();
    expect(decodeCallArgs([[1, { $t: 'unserializable', show: 'x' }]])).toBeUndefined();
  });

  it('a spec-less call whose body mutates its argument is rejected by Invariants (pure); the next candidate is committed', async () => {
    const gateInputs: ExecGateInput[] = [];
    const { engine, s, run } = setup({
      script: { bump: ['arg0.push(0);\nreturn arg0.length;', 'return arg0.length + 1;'] },
      deps: {
        createRuntime: () => wrapRuntime(realRuntime(), withCallArgs({ 'bump([1, 2])': [[1, 2]] })),
        execGates: (input, onGate) => {
          gateInputs.push(input);
          return Promise.resolve(executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) }));
        },
      },
    });
    await engine.init();
    const out = await run('bump([1, 2])');
    expect(gateInputs[0]!.callArgs).toEqual([[1, 2]]);
    const [a1, a2] = s().generation!.attempts;
    expect(a1!.candidate).toMatchObject({ verdict: 'rejected', rejectedBy: 'invariants' });
    expect(a1!.candidate!.headline).toMatch(/mutated its argument/);
    expect(a1!.gates.map((g) => g.status)).toEqual(['pass', 'skipped', 'skipped', 'fail']);
    expect(a2!.candidate!.verdict).toBe('accepted');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value: '3', label: 'generated' });
  }, 30_000);

  it('a spec-less call whose body reads Math.random is rejected by Invariants (pure)', async () => {
    const { engine, s, run } = setup({
      script: { noisy: Array(3).fill('return arg0 + Math.random();') },
      deps: { createRuntime: () => wrapRuntime(realRuntime(), withCallArgs({ 'noisy(1)': [1] })) },
    });
    await engine.init();
    const out = await run('noisy(1)');
    const a1 = s().generation!.attempts[0]!;
    expect(a1.candidate).toMatchObject({ verdict: 'rejected', rejectedBy: 'invariants' });
    expect(a1.candidate!.headline).toContain('Math.random');
    expect(out[out.length - 1]).toMatchObject({ kind: 'error', name: 'GrowthFailed' });
    expect(s().program.functions.noisy).toBeUndefined();
  }, 30_000);

  it('arguments containing an unserializable placeholder are not passed to the gates', async () => {
    const gateInputs: ExecGateInput[] = [];
    const { engine, run } = setup({
      script: { first: ['return arg0;'] },
      deps: {
        createRuntime: () =>
          wrapRuntime(realRuntime(), (rt) => ({
            evaluate: async (input) => {
              const o = await rt.evaluate(input);
              return o.kind === 'undefined-call' ? { ...o, args: [{ $t: 'unserializable', show: '[Function f]' }] } : o;
            },
          })),
        execGates: (input, onGate) => {
          gateInputs.push(input);
          return Promise.resolve(executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) }));
        },
      },
    });
    await engine.init();
    await run('first(1)');
    expect(gateInputs).toHaveLength(1);
    expect('callArgs' in gateInputs[0]!).toBe(false);
  }, 30_000);
});

describe('engine: operations are serialised', () => {
  it('two rollbacks fired without awaiting get distinct ids, and the image exports and re-imports', async () => {
    const { engine, s, run } = setup({ script: { median: [MEDIAN_GOOD] } });
    await engine.init();
    await run('median([1, 2])'); // r2
    const a = engine.rollback(1);
    const b = engine.rollback(2);
    await Promise.all([a, b]);
    expect(s().revisions.map((r) => [r.id, r.kind, r.restoredFrom])).toEqual([
      [1, 'init', undefined],
      [2, 'commit', undefined],
      [3, 'rollback', 1],
      [4, 'rollback', 2],
    ]);
    expect(s().headRevision).toBe(4);
    expect(isLive(s().program.functions.median!)).toBe(true);
    const json = await engine.exportImage();
    await engine.resetImage();
    await engine.importImage(json);
    expect(s().notice?.tone).toBe('info');
    expect(s().revisions.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    const out = await run('median([1, 2])');
    expect(out[1]).toMatchObject({ value: '1.5', label: 'cached artifact', detail: 'certified r2' });
  }, 30_000);

  it('a spec edit requested while a grow is in flight waits for the commit, then applies on top of it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Generator = {
      mode: 'live',
      generate: async () => {
        await gate;
        return { body: MEDIAN_GOOD, notes: '', model: 'test-model', codexVersion: '0.0.1', durationMs: 1, source: 'live', progress: [] };
      },
    };
    const { engine, s } = setup({ deps: { createLiveGenerator: () => slow } });
    await engine.init();
    const pending = engine.submit();
    await tick();
    expect(s().busy).toBe(true);
    const edit = engine.editSpec('median', { doc: `${MEDIAN_SPEC.doc} Be exact.` });
    await tick();
    expect(s().notice).toEqual({ tone: 'info', text: 'Waiting for the current operation to finish before you edit the spec…' });
    expect(s().revisions).toHaveLength(1); // not applied yet, not dropped either
    release();
    await Promise.all([pending, edit]);
    expect(s().notice).toBeUndefined(); // the waiting notice is gone once the edit ran
    expect(s().revisions.map((r) => [r.id, r.kind])).toEqual([
      [1, 'init'],
      [2, 'commit'],
      [3, 'spec-edit'],
    ]);
    expect(s().revisions[2]!.title).toBe('Spec edited: median — artifact invalidated');
    expect(s().program.functions.median!.spec.doc).toContain('Be exact.');
    expect(s().busy).toBe(false);
  }, 30_000);
});

describe('engine: artifact liveness', () => {
  it("labels a call 'cached artifact' only when the called function's artifact is live", async () => {
    // The runtime fails to drop the invalidated function (undefine is a no-op), so the stale js still answers.
    const { engine, s, run } = setup({
      script: { median: [MEDIAN_GOOD] },
      deps: { createRuntime: () => wrapRuntime(realRuntime(), () => ({ undefine: async () => {} })) },
    });
    await engine.init();
    await run('median([1, 2])');
    await engine.editSpec('median', { doc: `${MEDIAN_SPEC.doc} Be exact.` });
    expect(isStale(s().program.functions.median!)).toBe(true);
    const out = await run('median([5, 1, 3])');
    expect(strip(out)).toEqual([
      { kind: 'input', text: 'median([5, 1, 3])' },
      { kind: 'output', value: '3', ms: expect.any(Number), label: null },
    ]);
  }, 30_000);

  it('editing a spec back to its certified text revalidates the artifact and defines it again', async () => {
    const { engine, gen, s, run } = setup({ script: { median: [MEDIAN_GOOD] } });
    await engine.init();
    await run('median([1, 2])'); // r2
    await engine.editSpec('median', { doc: `${MEDIAN_SPEC.doc} Be exact.` }); // r3: invalidated
    await engine.editSpec('median', { doc: MEDIAN_SPEC.doc }); // r4: back to the certified text
    expect(s().revisions[3]).toMatchObject({ id: 4, kind: 'spec-edit', title: 'Spec edited: median — artifact revalidated (certified r2)', artifacts: 1 });
    expect(isLive(s().program.functions.median!)).toBe(true);
    const out = await run('median([5, 1, 3])');
    expect(out[1]).toMatchObject({ kind: 'output', value: '3', label: 'cached artifact', detail: 'certified r2' });
    expect(gen.requests).toHaveLength(1);
  }, 30_000);
});

describe('engine: stored and imported js is never trusted', () => {
  const TAMPERED_JS = 'function median(numbers) { return 42; }';
  type ImageJson = { revisions: Array<{ program: { functions: Record<string, { artifact: { js: string; body: string } | null }> } }> };
  const tamper = (revisions: ImageJson['revisions'], edit: (a: { js: string; body: string }) => void) => {
    for (const r of revisions) for (const rec of Object.values(r.program.functions)) if (rec.artifact) edit(rec.artifact);
  };

  it('importImage recompiles live artifacts from their bodies and ignores the stored js', async () => {
    const { engine, s, run } = setup({ script: { median: [MEDIAN_GOOD] } });
    await engine.init();
    await run('median([1, 2])');
    const img = JSON.parse(await engine.exportImage()) as ImageJson;
    tamper(img.revisions, (a) => (a.js = TAMPERED_JS));
    await engine.resetImage();
    await engine.importImage(JSON.stringify(img));
    expect(s().notice).toEqual({ tone: 'info', text: 'Imported image: recompiled 1 artifact from its body.' });
    const art = s().program.functions.median!.artifact!;
    expect(art.js).not.toBe(TAMPERED_JS);
    expect(art).toMatchObject({ body: MEDIAN_GOOD, revision: 2, model: 'test-model', returnType: 'number' });
    expect(art.candidates).toHaveLength(1);
    const out = await run('median([1, 2])');
    expect(out[1]).toMatchObject({ value: '1.5', label: 'cached artifact' });
  }, 30_000);

  it('importImage drops an artifact whose body does not compile and names the function', async () => {
    const { engine, s, run } = setup({ script: { median: [MEDIAN_GOOD] } });
    await engine.init();
    await run('median([1, 2])');
    const img = JSON.parse(await engine.exportImage()) as ImageJson;
    tamper(img.revisions, (a) => (a.body = MEDIAN_COMPILE_BAD));
    await engine.resetImage();
    await engine.importImage(JSON.stringify(img));
    expect(s().notice?.tone).toBe('error');
    expect(s().notice?.text).toBe(
      'Imported image: recompiled 0 artifacts from their bodies; dropped the artifact of median (its body does not compile; the next call regenerates).',
    );
    expect(s().program.functions.median!.artifact).toBeNull();
    expect(s().revisions.map((r) => r.artifacts)).toEqual([0, 0, 0]);
  }, 30_000);

  it('init recompiles persisted artifacts; a body that does not compile is dropped with a notice', async () => {
    const backend = memoryBackend();
    _useBackend(backend);
    const first = setup({ script: { median: [MEDIAN_GOOD] } });
    await first.engine.init();
    await first.run('xs = [5, 1, 3]');
    await first.run('median(xs)');
    first.engine.dispose();

    let data = await backend.readAll();
    tamper(data.revisions as unknown as ImageJson['revisions'], (a) => (a.js = TAMPERED_JS));
    await backend.write({ revisions: data.revisions });
    const second = setup();
    await second.engine.init();
    expect(second.s().notice).toBeUndefined();
    const out = await second.run('median(xs)');
    expect(out[1]).toMatchObject({ value: '3', label: 'cached artifact', detail: 'certified r2' });
    second.engine.dispose();

    data = await backend.readAll();
    tamper(data.revisions as unknown as ImageJson['revisions'], (a) => (a.body = MEDIAN_COMPILE_BAD));
    await backend.write({ revisions: data.revisions });
    const third = setup();
    await third.engine.init();
    expect(third.s().notice).toEqual({
      tone: 'error',
      text: 'Restored image: recompiled 0 artifacts from their bodies; dropped the artifact of median (its body does not compile; the next call regenerates).',
    });
    expect(third.s().program.functions.median!.artifact).toBeNull();
  }, 30_000);
});

describe('engine: REPL variables the runtime could not restore are reported', () => {
  const infos = (s: EngineState) => s.repl.filter((e): e is Extract<ReplEntry, { kind: 'info' }> => e.kind === 'info').map((e) => e.text);

  it('after rollback and import (reset reports `lost`)', async () => {
    const { engine, s, run } = setup({
      script: { median: [MEDIAN_GOOD] },
      deps: {
        createRuntime: () =>
          wrapRuntime(realRuntime(), (rt) => ({
            reset: async (fns, env) => {
              await rt.reset(fns, env);
              return { lost: Object.keys(env).filter((k) => k === 'h') };
            },
          })),
      },
    });
    await engine.init();
    await run('h = 1');
    await run('median([1, 2])'); // r2 snapshots h
    await engine.rollback(2);
    expect(infos(s()).slice(-2)).toEqual(['Rolled back to r2 — restored 1 function and 0 variables', `${LOST_PREFIX}h`]);
    const json = await engine.exportImage();
    await engine.resetImage();
    await engine.importImage(json);
    expect(infos(s()).slice(-1)).toEqual([`${LOST_PREFIX}h`]);
  }, 30_000);

  it('after a timeout (the outcome carries `lost`): never "the program was restored" without the caveat', async () => {
    const { engine, s, run } = setup({
      deps: {
        createRuntime: () =>
          wrapRuntime(realRuntime(), (rt) => ({
            evaluate: async (input) => (input === 'spin()' ? { kind: 'timeout', ms: 5, call: 'spin()', lost: ['h', 'k'] } : rt.evaluate(input)),
          })),
      },
    });
    await engine.init();
    const out = await run('spin()');
    expect(strip(out)).toEqual([
      { kind: 'input', text: 'spin()' },
      {
        kind: 'error',
        name: 'TimeoutError',
        message: 'spin() exceeded 5 ms and was terminated; the program was restored except 2 variables that could not be restored (h, k)',
      },
      { kind: 'info', text: `${LOST_PREFIX}h, k`, tone: 'warn' },
    ]);
    expect(lastError(s()).message).not.toMatch(/restored$/);
  }, 30_000);
});
