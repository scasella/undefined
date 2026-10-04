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
import { NEVER_CALLED_NOTE } from '../sandbox/gateExecutor';
import { FUNCTION_ARG_TYPE } from '../shared/inferType';
import {
  ARRAY_CALLBACK_INFO,
  createEngine,
  decodeCallArgs,
  DECLINED_GATE_NOTE,
  declineMessage,
  FUNCTION_ARG_NOTE,
  notGrowableReason,
  LOST_PREFIX,
  RECURSION_HINT,
  TAKEAWAY_TEXT,
  type EngineDeps,
  type EngineExample,
  type EngineHandle,
  type RuntimeLike,
} from './engine';
import { GenerationFailure, validateRecording } from './generator';
import { specFromCall } from '../gates/source';

const specFromCallFor = (name: string, argTypes: string[]): FunctionSpec => specFromCall(name, argTypes);
import { hashesFor } from '../shared/hash';
import { isLive, isStale } from './program';
import { _useBackend, memoryBackend } from './store';
import { sampleForModel } from '../data/sample';
import { DEFAULT_DATASET_NAME, PINNED_INFO, parseDataText, pinLabel, typeNameFor } from './engine';
import { BUNDLED_ORDERS_CSV } from '../data/orders';

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

/** A scripted candidate: a body (notes 'scripted'), a body with the model's notes, or a generation failure. */
type ScriptItem = string | { body: string; notes: string } | GenerateError;

/** The model stand-in: hands out scripted bodies (or failures) per function, in order. */
class ScriptedGenerator implements Generator {
  readonly requests: GenerateRequest[] = [];
  constructor(
    readonly mode: 'live' | 'replay',
    private readonly script: Record<string, ScriptItem[]>,
  ) {}

  push(fn: string, ...items: ScriptItem[]): void {
    (this.script[fn] ??= []).push(...items);
  }

  async generate(req: GenerateRequest, onProgress: (p: ProgressLine) => void): Promise<GenerateResult> {
    this.requests.push(req);
    const next = this.script[req.fn]?.shift();
    if (next === undefined) throw new GenerationFailure({ code: 'recording_exhausted', message: `script for ${req.fn} is exhausted` });
    if (typeof next !== 'string' && !('body' in next)) throw new GenerationFailure(next);
    const { body, notes } = typeof next === 'string' ? { body: next, notes: 'scripted' } : next;
    const line: ProgressLine = { t: 1, text: 'drafting function body', channel: 'event' };
    onProgress(line);
    return { body, notes, model: 'test-model', codexVersion: '0.0.1', durationMs: 3, source: this.mode, progress: [line] };
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
    reset: (fns, env, datasets) => rt.reset(fns, env, datasets),
    bindDataset: (name, hash, rows, typeName) => rt.bindDataset(name, hash, rows, typeName),
    unbindDataset: (name) => rt.unbindDataset(name),
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
    script?: Record<string, ScriptItem[]>;
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
      // the re-evaluated call is the outermost committed call of the line: it can be pinned as a unit test
      { kind: 'output', value: '2.5', ms: expect.any(Number), label: 'generated', detail: 'revision 2', pinnable: { fn: 'median', call: 'median([3, 1, 4, 2])', args: [{ kind: 'value', encoded: [3, 1, 4, 2] }], expected: 2.5 } },
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
      { kind: 'output', value: '3', ms: expect.any(Number), label: 'cached artifact', detail: 'certified r2', pinnable: { fn: 'median', call: 'median([5, 1, 3])', args: [{ kind: 'value', encoded: [5, 1, 3] }], expected: 3 } },
      { kind: 'takeaway', text: TAKEAWAY_TEXT },
    ]);
    expect(s().hints.takeaway).toBe(true);
    const third = await run('median([10, 2, 38, 23])');
    expect(strip(third)).toEqual([
      { kind: 'input', text: 'median([10, 2, 38, 23])' },
      { kind: 'output', value: '16.5', ms: expect.any(Number), label: 'cached artifact', detail: 'certified r2', pinnable: { fn: 'median', call: 'median([10, 2, 38, 23])', args: [{ kind: 'value', encoded: [10, 2, 38, 23] }], expected: 16.5 } },
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

  it('refuses to grow masked globals and reserved names, saying why in one sentence and what to do instead', async () => {
    const { engine, gen, s, run } = setup();
    await engine.init();
    let out = await run('fetch("https://example.com")');
    expect(strip(out)).toEqual([
      { kind: 'input', text: 'fetch("https://example.com")' },
      {
        kind: 'error',
        name: 'ReferenceError',
        message:
          'fetch is not defined. `fetch` is the name of a host global (network, timers, clock, randomness or the environment) that generated code is not allowed to touch; pick another name, e.g. fetchData.',
      },
    ]);
    // the exact refusals from the hostile-call list
    const expected: Record<string, string> = {
      'process([1, 2, 3])':
        'process is not defined. `process` is the name of a host global (network, timers, clock, randomness or the environment) that generated code is not allowed to touch; pick another name, e.g. processData.',
      'eval("1")': 'eval is not defined. `eval` turns strings into code, which generated code is not allowed to do; pick another name, e.g. evaluate.',
      'constructor(1)':
        'constructor is not defined. `constructor` is a name every JavaScript object already has, so it cannot name a function in this program (functions are looked up by name); pick another name, e.g. construct.',
      'toString()':
        'toString is not defined. `toString` is a name every JavaScript object already has, so it cannot name a function in this program (functions are looked up by name); pick another name, e.g. toText.',
      'größe(3)':
        'größe is not defined. `größe` cannot be generated: function names here must be ASCII letters, digits, _ or $ (and not start with a digit).',
    };
    for (const [input, message] of Object.entries(expected)) {
      out = await run(input);
      expect(strip(out), input).toEqual([
        { kind: 'input', text: input },
        { kind: 'error', name: 'ReferenceError', message },
      ]);
      // one sentence for the reason, ending with a concrete alternative (or the rule)
      expect(message.split('. ').length, input).toBeLessThanOrEqual(3);
    }
    expect(gen.requests).toHaveLength(0);
    expect(s().generation).toBeNull();
  }, 30_000);

  it('notGrowableReason covers every category and allows ordinary names', () => {
    expect(notGrowableReason('median')).toBeNull();
    expect(notGrowableReason('processData')).toBeNull();
    expect(notGrowableReason('Function')).toContain('turns strings into code');
    expect(notGrowableReason('setTimeout')).toContain('host global');
    expect(notGrowableReason('class')).toBe('`class` is a JavaScript keyword or built-in value, so it cannot name a function; pick another name, e.g. classify.');
    expect(notGrowableReason('NaN')).toContain('pick another name, e.g. myNaN');
    expect(notGrowableReason('hasOwnProperty')).toContain('every JavaScript object already has');
    expect(notGrowableReason('café')).toContain('ASCII letters, digits, _ or $');
  });

  it('upsertSpec refuses such a name with the same sentence', async () => {
    const { engine, s } = setup();
    await engine.init();
    await engine.upsertSpec({ ...MEDIAN_SPEC, name: 'toString', origin: 'user' });
    expect(s().notice).toEqual({ tone: 'error', text: notGrowableReason('toString') });
    expect(Object.hasOwn(s().program.functions, 'toString')).toBe(false);
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

  it('an Enter right after clicking an example runs THAT example, not the previous input', async () => {
    const other = setup({
      script: { median2: [MEDIAN_GOOD.replace(/median/g, 'median2')] },
      deps: { examples: [EXAMPLE, { ...EXAMPLE, id: 'median2', fn: 'median2', title: 'm2', call: 'median2([1, 2, 3])', spec: { ...MEDIAN_SPEC, name: 'median2' } }] },
    });
    await other.engine.init();
    expect(other.s().replInput).toBe(EXAMPLE.call);
    const click = other.engine.loadExample('median2'); // not awaited: the user presses Enter immediately
    const enter = other.engine.submit();
    await Promise.all([click, enter]);
    const inputs = other.s().repl.filter((e) => e.kind === 'input').map((e) => (e as { text: string }).text);
    expect(inputs).toEqual(['median2([1, 2, 3])']);
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
      // xs is an ordinary variable (not a dataset), so the pin carries its value
      { kind: 'output', value: '3', ms: expect.any(Number), label: 'cached artifact', detail: 'certified r2', pinnable: { fn: 'median', call: 'median([5, 1, 3])', args: [{ kind: 'value', encoded: [5, 1, 3] }], expected: 3 } },
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
      { kind: 'output', value: '3', ms: expect.any(Number), label: null, pinnable: { fn: 'median', call: 'median([5, 1, 3])', args: [{ kind: 'value', encoded: [5, 1, 3] }], expected: 3 } },
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

// ───────────────────────── hostile, spec-less calls (findings A–E) ─────────────────────────

const declineBody = (tag: 'CANNOT_BE_PURE' | 'NEEDS_SPEC', msg: string): string => `throw new Error("${tag}: ${msg}");`;

describe('engine: the model declines instead of faking (A)', () => {
  it('cannot-be-pure: no gate runs, the verdict is aborted, nothing is retried or committed, the REPL says why', async () => {
    const { engine, gen, s, run } = setup({
      script: { now: [{ body: declineBody('CANNOT_BE_PURE', 'it needs to read the current time'), notes: 'needs the clock' }, 'return 0;'] },
    });
    await engine.init();
    const before = { revisions: s().revisions, program: s().program };
    const out = await run('now()');
    expect(gen.requests).toHaveLength(1); // a decline is final: not retried
    expect(gen.requests[0]!.prompt).toContain('HONESTY (when not to write the function)');
    const g = s().generation!;
    expect(g.phase).toBe('failed');
    expect(g.declined).toEqual({ reason: 'cannot-be-pure', message: 'it needs to read the current time' });
    expect(g.error).toBeUndefined();
    expect(g.attempts).toHaveLength(1);
    const a = g.attempts[0]!;
    expect(a.status).toBe('aborted');
    expect(a.shown).toBe(declineBody('CANNOT_BE_PURE', 'it needs to read the current time'));
    expect(a.gates.map((x) => [x.gate, x.status, x.summary, x.note])).toEqual(
      ['compile', 'tests', 'properties', 'invariants'].map((gate) => [gate, 'skipped', 'not run', DECLINED_GATE_NOTE]),
    );
    expect(a.candidate).toMatchObject({ verdict: 'aborted', declined: g.declined, notes: 'needs the clock', attempt: 1 });
    expect(a.candidate!.rejectedBy).toBeUndefined();
    expect(a.candidate!.headline).toBeUndefined();
    // the program and the history are untouched
    expect(s().revisions).toEqual(before.revisions);
    expect(s().program).toEqual(before.program);
    expect(strip(out)).toEqual([
      { kind: 'input', text: 'now()' },
      { kind: 'error', name: 'ReferenceError', message: 'now is not defined' },
      { kind: 'info', text: 'Generating…', tone: 'accent' },
      {
        kind: 'error',
        name: 'Declined',
        message:
          'The model declined to write `now`: it needs to read the current time. Generated functions are pure — no clock, randomness, network, files or hidden state — so it would only be faking it. Pass what it needs in as an argument (for example a seed or a timestamp).',
        restarts: [{ id: 'dismiss', label: 'Dismiss', description: 'Leave the program as it is.' }],
      },
    ]);
    expect(s().busy).toBe(false);
  }, 30_000);

  it('needs-spec: restarts are "Write a spec" + dismiss; Write a spec focuses the (spec-less) function', async () => {
    const { engine, gen, s, run } = setup({
      script: { clean: [declineBody('NEEDS_SPEC', 'What should clean remove from the string: whitespace, punctuation, or both?')] },
    });
    await engine.init();
    const out = await run('clean("  Hello,   World  ")');
    const err = out[out.length - 1] as Extract<ReplEntry, { kind: 'error' }>;
    expect(err.name).toBe('Declined');
    expect(err.message).toBe(
      "The model couldn't tell what `clean` should do: What should clean remove from the string: whitespace, punctuation, or both? Add a one-line spec and call it again.",
    );
    expect(err.restarts!.map((r) => [r.id, r.label])).toEqual([
      ['edit-spec', 'Write a spec'],
      ['dismiss', 'Dismiss'],
    ]);
    expect(s().generation!.declined!.reason).toBe('needs-spec');
    expect(s().generation!.signature).toBe('function clean(arg0: string)');
    expect(s().program.functions.clean).toBeUndefined();
    expect(gen.requests).toHaveLength(1);
    await engine.invokeRestart(err.id, 'edit-spec');
    expect(s().focusSpec).toEqual({ fn: 'clean', nonce: 1 });
    expect(s().repl.find((e) => e.id === err.id)).toMatchObject({ resolved: true });
  }, 30_000);

  it('accepts every quoting of the sentinel the model may use', async () => {
    const bodies = {
      a: "throw new Error('CANNOT_BE_PURE: needs randomness, e.g. a seed argument')",
      b: 'throw new Error(`CANNOT_BE_PURE: needs randomness, e.g. a seed argument`);',
      c: '{\n  throw new Error("CANNOT_BE_PURE: needs randomness, e.g. a seed argument");\n}',
      d: '\n\n  throw new Error( "CANNOT_BE_PURE:needs randomness, e.g. a seed argument" )  \n',
    };
    const { engine, s, run } = setup({ script: Object.fromEntries(Object.entries(bodies).map(([k, v]) => [k, [v]])) });
    await engine.init();
    for (const fn of Object.keys(bodies)) {
      await run(`${fn}(3)`);
      expect(s().generation!.declined, fn).toEqual({ reason: 'cannot-be-pure', message: 'needs randomness, e.g. a seed argument' });
      expect(lastError(s()).name).toBe('Declined');
    }
    expect(s().revisions).toHaveLength(1);
  }, 30_000);

  it('a body that merely mentions NEEDS_SPEC (comment, conditional throw) is an ordinary candidate and is gated', async () => {
    const { engine, s, run } = setup({
      script: {
        ident: ['// NEEDS_SPEC: what should this do?\nreturn arg0;'],
        guard: ['if (arg0 < 0) throw new Error("NEEDS_SPEC: negative?");\nreturn arg0 * 2;'],
      },
    });
    await engine.init();
    let out = await run('ident(4)');
    expect(s().generation!.declined).toBeUndefined();
    expect(s().generation!.phase).toBe('committed');
    expect(s().generation!.attempts[0]!.gates[0]!.status).toBe('pass');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value: '4', label: 'generated' });
    out = await run('guard(4)');
    expect(s().generation!.phase).toBe('committed');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value: '8' });
  }, 30_000);

  it('a decline after rejected candidates ends the grow: no further attempt, revisions unchanged', async () => {
    const { engine, gen, s, run } = setup({
      script: { median: [MEDIAN_BAD, declineBody('NEEDS_SPEC', 'What is the median of an even-length list?'), MEDIAN_GOOD] },
    });
    await engine.init();
    await run('median([3, 1, 4, 2])');
    expect(gen.requests).toHaveLength(2);
    const g = s().generation!;
    expect(g.attempts.map((a) => a.status)).toEqual(['rejected', 'aborted']);
    expect(g.attempts[1]!.candidate!.declined).toEqual({ reason: 'needs-spec', message: 'What is the median of an even-length list?' });
    expect(g.phase).toBe('failed');
    // the spec has tests and properties: the decline is shown as is, never counted as accepted
    expect(g.ungated).toBe(false);
    expect(s().program.functions.median!.artifact).toBeNull();
    expect(s().revisions).toHaveLength(1);
    expect(lastError(s()).name).toBe('Declined');
  }, 30_000);

  it('a decline mid-chain stops the chain: the outer function is never generated', async () => {
    const { engine, gen, s, run } = setup({ script: { dbl: [declineBody('NEEDS_SPEC', 'Double what?')], inc: ['return arg0 + 1;'] } });
    await engine.init();
    await run('inc(dbl(2))');
    expect(gen.requests.map((r) => r.fn)).toEqual(['dbl']);
    expect(s().revisions).toHaveLength(1);
  }, 30_000);

  it('declines replay from a recording like any candidate', async () => {
    const spec = specFromCallFor('shuffle', ['number[]']);
    const { specHash, testsHash } = await hashesFor(spec);
    const body = declineBody('CANNOT_BE_PURE', 'shuffling needs a source of randomness; pass a seed');
    const recording: Recording = {
      format: 'undefined-recording',
      version: 1,
      id: 'r',
      title: 'r',
      recordedAt: '2026-10-01T00:00:00.000Z',
      model: 'm',
      codexVersion: '0',
      effort: 'low',
      sessions: [{ fn: 'shuffle', specHash, testsHash, label: 'shuffle', attempts: [{ prompt: 'P', body, notes: 'n', durationMs: 0, progress: [] }] }],
    };
    const { ReplayGenerator } = await import('./generator');
    const { engine, s, run } = setup({
      service: { state: 'down' },
      deps: { loadRecordings: async () => [recording], createReplayGenerator: (recs) => new ReplayGenerator(recs, { maxMs: 0 }) },
    });
    await engine.init();
    expect(s().mode).toBe('replay');
    await run('shuffle([1, 2, 3, 4, 5])');
    const c = s().generation!.attempts[0]!.candidate!;
    expect(c).toMatchObject({ source: 'replay', verdict: 'aborted', prompt: 'P' });
    expect(c.declined).toEqual({ reason: 'cannot-be-pure', message: 'shuffling needs a source of randomness; pass a seed' });
    expect(lastError(s()).name).toBe('Declined');
    expect(s().revisions).toHaveLength(1);
  }, 30_000);

  it('a live decline is recorded, so it can be replayed', async () => {
    const { engine, run } = setup({ script: { uuid: [declineBody('CANNOT_BE_PURE', 'a fresh id needs randomness or a counter')] } });
    await engine.init();
    await run('uuid()');
    const rec = engine.exportRecording()!;
    expect(rec.sessions[0]!.attempts[0]!.body).toBe(declineBody('CANNOT_BE_PURE', 'a fresh id needs randomness or a counter'));
  }, 30_000);

  it('declineMessage ends the model sentence once, whatever punctuation it used', () => {
    expect(declineMessage('f', { reason: 'cannot-be-pure', message: 'needs the clock.' })).toMatch(/^The model declined to write `f`: needs the clock\. Generated/);
    expect(declineMessage('f', { reason: 'needs-spec', message: 'Sort by what' })).toBe(
      "The model couldn't tell what `f` should do: Sort by what. Add a one-line spec and call it again.",
    );
  });

  // The stranger-style calls from the hostile run whose stubs were committed with a green tick. With the model
  // declining (scripted here), none of them may reach the program.
  it.each([
    ['shuffle([1, 2, 3, 4, 5])', 'CANNOT_BE_PURE'],
    ['randomInt(1, 10)', 'CANNOT_BE_PURE'],
    ['now()', 'CANNOT_BE_PURE'],
    ['uuid()', 'CANNOT_BE_PURE'],
    ['counter()', 'CANNOT_BE_PURE'],
    ['nextId()', 'CANNOT_BE_PURE'],
    ['fetchUser(42)', 'CANNOT_BE_PURE'],
    ['sleep(100)', 'CANNOT_BE_PURE'],
    ['getWeather("Paris")', 'CANNOT_BE_PURE'],
    ['loadConfig("app.json")', 'CANNOT_BE_PURE'],
    ['readFile("notes.txt")', 'CANNOT_BE_PURE'],
    ['httpGet("https://example.com")', 'CANNOT_BE_PURE'],
    ['saveToDisk({ a: 1 })', 'CANNOT_BE_PURE'],
    ['printReport([1, 2, 3])', 'CANNOT_BE_PURE'],
    ['getCookie("session")', 'CANNOT_BE_PURE'],
    ['clean("  Hello,   World  ")', 'NEEDS_SPEC'],
    ['handle({ type: "click", x: 3 })', 'NEEDS_SPEC'],
    ['transform({ a: 1, b: 2 })', 'NEEDS_SPEC'],
    ['data([1, 2])', 'NEEDS_SPEC'],
  ] as const)('%s: a decline (%s) leaves the program unchanged', async (call, tag) => {
    const fn = call.slice(0, call.indexOf('('));
    const { engine, gen, s, run } = setup({ script: { [fn]: [declineBody(tag, 'the one sentence')] } });
    await engine.init();
    const out = await run(call);
    expect(gen.requests).toHaveLength(1);
    expect(gen.requests[0]!.prompt).toContain('HONESTY');
    expect(s().generation!.declined!.reason).toBe(tag === 'NEEDS_SPEC' ? 'needs-spec' : 'cannot-be-pure');
    expect(s().program.functions[fn]).toBeUndefined();
    expect(s().revisions).toHaveLength(1);
    expect(out.some((e) => e.kind === 'output')).toBe(false);
    expect(out[out.length - 1]).toMatchObject({ kind: 'error', name: 'Declined' });
  }, 30_000);

  // ...while the ones a reasonable programmer would write from the name alone are still written and committed.
  it.each([
    ['flatten([[1, [2]], [3]])', 'return (arg0 as unknown[]).flat(Infinity) as number[];', '[1, 2, 3]'],
    ['sortDescending([3, 1, 2])', 'return arg0.slice().sort((a, b) => b - a);', '[3, 2, 1]'],
    ['isPalindrome("abba")', 'return arg0 === [...arg0].reverse().join("");', 'true'],
    ['hello()', 'return "Hello, world!";', '"Hello, world!"'],
    ['add(1, 2)', 'return arg0 + arg1;', '3'],
  ] as const)('%s is written and committed', async (call, body, value) => {
    const fn = call.slice(0, call.indexOf('('));
    const { engine, s, run } = setup({ script: { [fn]: [body] } });
    await engine.init();
    const out = await run(call);
    expect(s().generation!.phase).toBe('committed');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value, label: 'generated' });
  }, 30_000);
});

describe('engine: an undefined function used as an Array callback (B)', () => {
  it('[1, 2, 3].map(double) grows double(arg0: number) from the value only and gives [2, 4, 6]', async () => {
    const { engine, gen, s, run } = setup({ script: { double: [{ body: 'return arg0 * arg1;', notes: 'wrong' }, 'return arg0 * 2;'] } });
    await engine.init();
    const out = await run('[1, 2, 3].map(double)');
    expect(strip(out).slice(0, 4)).toEqual([
      { kind: 'input', text: '[1, 2, 3].map(double)' },
      { kind: 'error', name: 'ReferenceError', message: 'double is not defined' },
      { kind: 'info', text: ARRAY_CALLBACK_INFO, tone: 'muted' },
      { kind: 'info', text: 'Generating…', tone: 'accent' },
    ]);
    expect(ARRAY_CALLBACK_INFO).toBe('(called by an Array method with (value, index, array); using the value only)');
    // the 3-parameter body of the hostile run cannot even compile against the one-parameter spec
    expect(s().generation!.signature).toBe('function double(arg0: number)');
    expect(s().generation!.call).toBe('double(1)');
    expect(gen.requests[0]!.prompt).toContain('with 1 argument(s) of these types (values are not shown): (number)');
    expect(s().generation!.attempts[0]!.candidate!.rejectedBy).toBe('compile');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value: '[2, 4, 6]', label: 'generated' });
  }, 30_000);

  it('a real 3-argument call is not trimmed', async () => {
    const { engine, s, run } = setup({ script: { pick: ['return arg2[arg1] === arg0;'] } });
    await engine.init();
    const out = await run('pick(2, 1, [1, 2, 3])');
    expect(out.some((e) => e.kind === 'info' && e.text === ARRAY_CALLBACK_INFO)).toBe(false);
    expect(s().generation!.signature).toBe('function pick(arg0: number, arg1: number, arg2: number[])');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value: 'true' });
  }, 30_000);
});

describe('engine: function-valued arguments (C)', () => {
  it('compose(x => x + 1, x => x * 2) grows with any-function parameters; Invariants says why it was not exercised', async () => {
    const gateInputs: ExecGateInput[] = [];
    const { engine, gen, s, run } = setup({
      script: { compose: ['return (x: number) => arg1(arg0(x));'] },
      deps: {
        execGates: (input, onGate) => {
          gateInputs.push(input);
          return Promise.resolve(executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) }));
        },
      },
    });
    await engine.init();
    const out = await run('compose(x => x + 1, x => x * 2)');
    expect(s().generation!.signature).toBe(`function compose(arg0: ${FUNCTION_ARG_TYPE}, arg1: ${FUNCTION_ARG_TYPE})`);
    expect(gen.requests[0]!.prompt).toContain(`(${FUNCTION_ARG_TYPE}, ${FUNCTION_ARG_TYPE})`);
    expect('callArgs' in gateInputs[0]!).toBe(false); // a function cannot be frozen and replayed
    const inv = s().generation!.attempts[0]!.gates[3]!;
    expect(inv).toMatchObject({ status: 'skipped', note: `${NEVER_CALLED_NOTE}: ${FUNCTION_ARG_NOTE}` });
    expect(FUNCTION_ARG_NOTE).toBe("an argument was a function, which can't be replayed");
    expect(s().generation!.phase).toBe('committed');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', label: 'generated' });
    // the real functions are passed through at runtime
    const again = await run('compose(x => x + 1, x => x * 2)(5)');
    expect(again.find((e) => e.kind === 'output')).toMatchObject({ kind: 'output', value: '12', label: 'cached artifact' });
  }, 30_000);

  it('the Invariants note is unchanged for a call without function arguments', async () => {
    const { engine, s, run } = setup({
      script: { first: ['return arg0;'] },
      deps: {
        createRuntime: () =>
          wrapRuntime(realRuntime(), (rt) => ({
            evaluate: async (input) => {
              const o = await rt.evaluate(input);
              return o.kind === 'undefined-call' ? { ...o, args: [{ $t: 'unserializable', show: 'x' }] } : o;
            },
          })),
      },
    });
    await engine.init();
    await run('first(1)');
    expect(s().generation!.attempts[0]!.gates[3]!.note).toBe(NEVER_CALLED_NOTE);
  }, 30_000);
});

describe('engine: a spec-less accept is not an endorsement (E)', () => {
  it("a function grown with no tests and no properties carries the model's note on its result line", async () => {
    const notes = 'Uppercases the first ASCII letter at each word boundary and leaves other characters unchanged.';
    const { engine, run } = setup({
      script: { titleCase: [{ body: 'return arg0.replace(/\\b([A-Za-z])/g, (c) => c.toUpperCase());', notes }] },
    });
    await engine.init();
    const out = await run('titleCase("élan vital")');
    const last = out[out.length - 1] as Extract<ReplEntry, { kind: 'output' }>;
    expect(last).toMatchObject({ kind: 'output', label: 'generated', note: notes });
    // a later cached call is not a growth: no note
    const again = await run('titleCase("ab")');
    expect(again.find((e) => e.kind === 'output')).toMatchObject({ value: '"Ab"', label: 'cached artifact' });
    expect(again.find((e) => e.kind === 'output')).not.toHaveProperty('note');
  }, 30_000);

  it("note is '' when the model wrote no notes (the unchecked line still shows); joined per function when chained", async () => {
    const { engine, run } = setup({
      script: { dbl: [{ body: 'return arg0 * 2;', notes: '' }], inc: [{ body: 'return arg0 + 1;', notes: 'adds one' }], neg: [{ body: 'return -arg0;', notes: '  ' }] },
    });
    await engine.init();
    let out = await run('neg(2)');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value: '-2', note: '' });
    out = await run('inc(dbl(2))');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value: '5', note: 'inc: adds one' });
  }, 30_000);

  it('a function grown under a spec with tests or properties has no note', async () => {
    const { engine, run } = setup({ script: { median: [{ body: MEDIAN_GOOD, notes: 'sort a copy' }] } });
    await engine.init();
    const out = await run('median([1, 2])');
    expect(out[out.length - 1]).toMatchObject({ kind: 'output', value: '1.5', label: 'generated' });
    expect(out[out.length - 1]).not.toHaveProperty('note');
  }, 30_000);
});

// ───────────────────────── data scratchpad ─────────────────────────

const ORDERS_CSV = `customer,amount,status
Ada,10,paid
Bob,5,refunded
Ada,7,paid
Cy,3,paid
`;
const ROW_DECL = 'type Row = { customer: string; amount: number; status: string }';
/** Paid totals per customer, highest first. */
const TOTALS_GOOD = `const t = new Map<string, number>();
for (const r of arg0) if (r.status !== "refunded") t.set(r.customer, (t.get(r.customer) ?? 0) + r.amount);
return [...t].map(([customer, total]) => ({ customer, total })).sort((a, b) => b.total - a.total);`;
/** Counts refunds too: disagrees with a pinned paid-only result. */
const TOTALS_WITH_REFUNDS = `const t = new Map<string, number>();
for (const r of arg0) t.set(r.customer, (t.get(r.customer) ?? 0) + r.amount);
return [...t].map(([customer, total]) => ({ customer, total })).sort((a, b) => b.total - a.total);`;
/** Sorts the caller's rows in place: the Invariants replay on frozen rows rejects it. */
const TOTALS_MUTATES = `arg0.sort((a, b) => b.amount - a.amount);
return arg0.map((r) => ({ customer: r.customer, total: r.amount }));`;

const outputs = (s: EngineState) => s.repl.filter((e): e is Extract<ReplEntry, { kind: 'output' }> => e.kind === 'output');

describe('engine: data scratchpad (pure helpers)', () => {
  it('parseDataText: CSV with coercion, TSV by sniffing, JSON by its first character or the filename', () => {
    const csv = parseDataText(ORDERS_CSV);
    expect(csv).toMatchObject({ ok: true, format: 'csv' });
    expect(csv.ok && csv.rows[0]).toEqual({ customer: 'Ada', amount: 10, status: 'paid' });
    const tsv = parseDataText('a\tb\n1\tx\n');
    expect(tsv).toMatchObject({ ok: true, format: 'tsv', rows: [{ a: 1, b: 'x' }] });
    expect(parseDataText('[{"a":1}]')).toMatchObject({ ok: true, format: 'json', rows: [{ a: 1 }] });
    expect(parseDataText('{"a":1}\n{"a":2}\n', 'x.jsonl')).toMatchObject({ ok: true, format: 'json', rows: [{ a: 1 }, { a: 2 }] });
    expect(parseDataText('   ')).toEqual({ ok: false, error: expect.stringContaining('Nothing to load') });
    expect(parseDataText('a,b\n')).toEqual({ ok: false, error: expect.stringContaining('no data lines') });
  });

  it('typeNameFor and pinLabel', () => {
    expect(DEFAULT_DATASET_NAME).toBe('rows');
    expect(typeNameFor('rows')).toBe('Row');
    expect(typeNameFor('orders')).toBe('OrdersRow');
    expect(pinLabel('top', [{ kind: 'dataset', name: 'rows', hash: 'h' }, { kind: 'value', encoded: 3 }])).toBe('top(rows, 3)');
    expect(pinLabel('median', [{ kind: 'value', encoded: [1, 2] }])).toBe('median([1, 2])');
  });
});

describe('engine: data scratchpad', () => {
  it('previewDataset: counts, the declared type, the first rows as a table, and exactly the sample text; never throws', async () => {
    const { engine } = setup();
    await engine.init();
    const p = await engine.previewDataset({ text: ORDERS_CSV });
    expect(p).toMatchObject({ ok: true, name: 'rows', rowCount: 4, typeName: 'Row', typeDecl: ROW_DECL, warnings: [] });
    if (!p.ok) throw new Error('preview failed');
    expect(p.columns).toEqual([
      { name: 'customer', type: 'string' },
      { name: 'amount', type: 'number' },
      { name: 'status', type: 'string' },
    ]);
    expect(p.table).toEqual({ columns: ['customer', 'amount', 'status'], rows: [['"Ada"', '10', '"paid"'], ['"Bob"', '5', '"refunded"'], ['"Ada"', '7', '"paid"'], ['"Cy"', '3', '"paid"']], total: 4 });
    expect(p.sampleText).toBe(sampleForModel([{ customer: 'Ada', amount: 10, status: 'paid' }, { customer: 'Bob', amount: 5, status: 'refunded' }, { customer: 'Ada', amount: 7, status: 'paid' }, { customer: 'Cy', amount: 3, status: 'paid' }], { count: 3 }).text);
    expect(p.sendDescription).toContain('3 sample rows');
    // 20 rows shown at most, the total says how many there are
    const big = await engine.previewDataset({ text: BUNDLED_ORDERS_CSV(), filename: 'orders.csv' });
    expect(big.ok && [big.table.rows.length, big.table.total, big.rowCount]).toEqual([20, 332, 332]);
    // problems are values, not exceptions
    expect(await engine.previewDataset({ text: '' })).toMatchObject({ ok: false });
    expect(await engine.previewDataset({ text: ORDERS_CSV, name: 'class' })).toEqual({ ok: false, error: expect.stringContaining('reserved word') });
    engine.setSendSamples(false);
    const off = await engine.previewDataset({ text: ORDERS_CSV });
    expect(off.ok && off.sendDescription).toContain('no sample rows');
  });

  it('loadDataset binds rows (a revision), a spec-less call over it gets the type and samples, runs the gates on the real rows, shows a table, and can be pinned', async () => {
    const { engine, gen, s, run } = setup({ script: { totals: [TOTALS_MUTATES, TOTALS_GOOD] } });
    await engine.init();
    await engine.loadDataset({ text: ORDERS_CSV });
    expect(s().revisions.map((r) => [r.id, r.kind, r.title])).toEqual([
      [1, 'init', expect.any(String)],
      [2, 'dataset', 'Loaded dataset rows: 4 rows × 3 columns'],
    ]);
    expect(s().datasets).toEqual([expect.objectContaining({ name: 'rows', typeName: 'Row', typeDecl: ROW_DECL, rowCount: 4, source: 'paste' })]);
    expect(s().program.datasets?.rows?.hash).toMatch(/^[0-9a-f]{64}$/);
    const bound = [...s().repl].reverse().find((e) => e.kind === 'info')!;
    expect(bound).toMatchObject({ kind: 'info', text: `\`rows\` is bound: \`${ROW_DECL}\` (4 rows)` });
    expect(s().env.rows).toContain('Ada');

    const out = await run('totals(rows)');
    // the prompt: the TYPES block, the DATA block with exactly the sample text, never "First rows"
    const prompt = gen.requests[0]!.prompt;
    expect(prompt).toContain(`TYPES (declared before your function; use them, do not redeclare them)\n${ROW_DECL}`);
    expect(prompt).toContain('function totals(arg0: Row[])');
    const sample = sampleForModel(
      [{ customer: 'Ada', amount: 10, status: 'paid' }, { customer: 'Bob', amount: 5, status: 'refunded' }, { customer: 'Ada', amount: 7, status: 'paid' }, { customer: 'Cy', amount: 3, status: 'paid' }],
      { count: 3 },
    ).text;
    expect(prompt).toContain(`DATA\n\`rows\` is bound to 4 rows of Row.\nA few rows, spread across the data (exactly what you are being shown; nothing else is shared):\n${sample}\n`);
    expect(prompt).not.toContain('First rows');
    // the gates ran on the REAL rows: the in-place sort is caught by the frozen replay of the triggering call
    const g = s().generation!;
    expect(g.call).toBe('totals(rows)');
    expect(g.ungated).toBe(true);
    expect(g.attempts[0]!.candidate!.rejectedBy).toBe('invariants');
    expect(g.attempts[0]!.candidate!.headline).toContain('mutated its argument (pure)');
    expect(g.attempts[1]!.status).toBe('accepted');
    const rec = s().program.functions.totals!;
    expect(rec.spec).toMatchObject({ params: [{ name: 'arg0', type: 'Row[]' }], typeDecls: ROW_DECL, origin: 'call' });
    expect(rec.spec.exampleId).toBeUndefined();
    // the result: a table, and pinnable with the dataset referenced (not inlined)
    const o = out.find((e): e is Extract<ReplEntry, { kind: 'output' }> => e.kind === 'output')!;
    expect(o.value).toBe('[{ customer: "Ada", total: 17 }, { customer: "Cy", total: 3 }]');
    expect(o.table).toEqual({ columns: ['customer', 'total'], rows: [['"Ada"', '17'], ['"Cy"', '3']], total: 2 });
    const hash = s().program.datasets!.rows!.hash;
    expect(o.pinnable).toEqual({
      fn: 'totals',
      call: 'totals(rows)',
      args: [{ kind: 'dataset', name: 'rows', hash }],
      expected: [{ customer: 'Ada', total: 17 }, { customer: 'Cy', total: 3 }],
    });
    expect(o.pinned).toBeUndefined();

    // pin it: a revision, the artifact stays certified, the entry is marked, the REPL says what it means
    const artifactBefore = rec.artifact;
    await engine.pinResult(o.id);
    const head = s().revisions[s().revisions.length - 1]!;
    expect(head).toMatchObject({ kind: 'pin', title: 'Pinned: totals(rows)', fn: 'totals' });
    const after = s().program.functions.totals!;
    expect(isLive(after)).toBe(true);
    expect(after.artifact).toEqual(artifactBefore);
    expect(after.specHash).toBe(rec.specHash);
    expect(after.spec.pins).toEqual([
      { id: expect.stringMatching(/^[0-9a-f]{12}$/), label: 'totals(rows)', args: [{ kind: 'dataset', name: 'rows', hash }], expected: o.pinnable!.expected, pinnedAt: expect.any(Number) },
    ]);
    expect(outputs(s()).find((e) => e.id === o.id)!.pinned).toBe(true);
    expect(s().repl[s().repl.length - 1]).toMatchObject({ kind: 'info', text: PINNED_INFO });
    // pinning the same result again does nothing; a later identical result is shown as already pinned
    await engine.pinResult(o.id);
    expect(s().program.functions.totals!.spec.pins).toHaveLength(1);
    const again = await run('totals(rows)');
    expect(again.find((e) => e.kind === 'output')).toMatchObject({ label: 'cached artifact', pinned: true });
  }, 60_000);

  it('a pin is a unit test at the next regeneration: a candidate that disagrees is rejected by Tests with the pinned headline; a good one passes it', async () => {
    const { engine, gen, s, run } = setup({ script: { totals: [TOTALS_GOOD] } });
    await engine.init();
    await engine.loadDataset({ text: ORDERS_CSV });
    await run('totals(rows)');
    await engine.pinResult(outputs(s()).at(-1)!.id);
    // change the meaning: the artifact goes stale, the next call regrows it, and the pin travels with the spec
    await engine.editSpec('totals', { doc: 'Paid totals per customer, highest first.' });
    expect(isStale(s().program.functions.totals!)).toBe(true);
    gen.push('totals', TOTALS_WITH_REFUNDS, TOTALS_GOOD);
    await run('totals(rows)');
    const g = s().generation!;
    expect(g.ungated).toBe(false); // the pin alone makes it gated
    const [a1, a2] = g.attempts;
    expect(a1!.candidate!.rejectedBy).toBe('tests');
    expect(a1!.candidate!.headline).toBe(
      'Rejected: totals(rows) returned [{ customer: "Ada", total: 17 }, { customer: "Bob", total: 5 }, { customer: "Cy", total: 3 }], expected [{ customer: "Ada", total: 17 }, { customer: "Cy", total: 3 }]',
    );
    const d = a1!.gates[1]!.diagnostics[0]!;
    expect(d.kind === 'test' && d.name).toBe('pinned: totals(rows)');
    expect(a2!.status).toBe('accepted');
    expect(a2!.gates[1]).toMatchObject({ status: 'pass', summary: '1 pinned passed' });
    // the result line no longer carries the "nothing checked" note: a pin checked it
    expect(outputs(s()).at(-1)!.note).toBeUndefined();

    // remove the pin: a revision, hashes unchanged, earlier entries unmarked
    const pin = s().program.functions.totals!.spec.pins![0]!;
    await engine.removePin('totals', pin.id);
    expect(s().revisions.at(-1)).toMatchObject({ kind: 'pin', title: 'Unpinned: totals(rows)' });
    expect(s().program.functions.totals!.spec.pins).toBeUndefined();
    expect(isLive(s().program.functions.totals!)).toBe(true);
    expect(outputs(s()).some((e) => e.pinned)).toBe(false);
  }, 60_000);

  it('samples off: the prompt carries the type only, never a row value', async () => {
    const { engine, gen, s, run } = setup({ script: { totals: [TOTALS_GOOD] } });
    await engine.init();
    engine.setSendSamples(false);
    expect(s().send).toEqual({ samples: false, sampleRows: 3 });
    await engine.loadDataset({ text: ORDERS_CSV });
    await run('totals(rows)');
    const prompt = gen.requests[0]!.prompt;
    expect(prompt).toContain('`rows` is bound to 4 rows of Row.\n(The user chose not to share sample rows; only the type is shared.)');
    expect(prompt).not.toMatch(/Ada|Bob|refunded/);
    expect(prompt).toContain(ROW_DECL); // the type is still shared
  }, 60_000);

  it('replay mode: nothing is sent, so the prompt has the type only even with samples on', async () => {
    const { engine, gen, s, run } = setup({ service: { state: 'down' }, script: { totals: [TOTALS_GOOD] } });
    await engine.init();
    expect(s().mode).toBe('replay');
    expect(s().send.samples).toBe(true);
    await engine.loadDataset({ text: ORDERS_CSV });
    await run('totals(rows)');
    const prompt = gen.requests[0]!.prompt;
    expect(prompt).toContain('(The user chose not to share sample rows; only the type is shared.)');
    expect(prompt).not.toMatch(/Ada|Bob|refunded/);
  }, 60_000);

  it('the samples choice persists; datasets and pins survive a reload, export/import, and rollback rebinds rows', async () => {
    const first = setup({ script: { totals: [TOTALS_GOOD] } });
    await first.engine.init();
    first.engine.setSendSamples(false);
    await first.engine.loadDataset({ text: ORDERS_CSV });
    await first.run('totals(rows)');
    await first.engine.pinResult(outputs(first.s()).at(-1)!.id);
    const hash = first.s().program.datasets!.rows!.hash;

    // reload: same store
    const second = setup();
    await second.engine.init();
    expect(second.s().send.samples).toBe(false);
    expect(second.s().datasets.map((d) => d.name)).toEqual(['rows']);
    expect(second.s().env.rows).toContain('Ada');
    const cached = await second.run('totals(rows)');
    expect(cached.find((e) => e.kind === 'output')).toMatchObject({ value: '[{ customer: "Ada", total: 17 }, { customer: "Cy", total: 3 }]', label: 'cached artifact', pinned: true });
    expect(second.gen.requests).toHaveLength(0);

    // export carries only referenced rows; import into a fresh store restores the binding
    await second.engine.loadDataset({ text: 'n\n1\n2\n', name: 'nums' });
    await second.engine.removeDataset('nums');
    const image = JSON.parse(await second.engine.exportImage()) as { datasets: Record<string, unknown> };
    // nums was bound in some revision, so it is still referenced (rollback can restore it)
    expect(Object.keys(image.datasets)).toContain(hash);
    expect(Object.keys(image.datasets)).toHaveLength(2);

    _useBackend(memoryBackend());
    const third = setup();
    await third.engine.init();
    expect(third.s().datasets).toEqual([]);
    await third.engine.importImage(JSON.stringify(image));
    expect(third.s().notice?.tone).toBe('info');
    expect(third.s().datasets.map((d) => d.name)).toEqual(['rows']);
    const viaImport = await third.run('totals(rows)');
    expect(viaImport.find((e) => e.kind === 'output')).toMatchObject({ label: 'cached artifact', pinned: true });
    expect(third.s().program.functions.totals!.spec.pins).toHaveLength(1);

    // rollback to before the data was loaded: rows is gone; forward again: rows is bound again
    const loadRev = third.s().revisions.find((r) => r.kind === 'dataset')!.id;
    await third.engine.rollback(loadRev - 1);
    expect(third.s().datasets).toEqual([]);
    expect(third.s().env.rows).toBeUndefined();
    await third.engine.rollback(loadRev);
    expect(third.s().datasets.map((d) => d.name)).toEqual(['rows']);
    expect(third.s().env.rows).toContain('Ada');
  }, 60_000);

  it('removeDataset unbinds the variable (a revision); a name taken by a function is refused', async () => {
    const { engine, s, run } = setup({ script: { totals: [TOTALS_GOOD] } });
    await engine.init();
    await engine.loadDataset({ text: ORDERS_CSV });
    await engine.removeDataset('rows');
    expect(s().revisions.at(-1)).toMatchObject({ kind: 'dataset', title: 'Removed dataset rows' });
    expect(s().datasets).toEqual([]);
    expect(s().program.datasets).toBeUndefined();
    const out = await run('rows');
    expect(out[1]).toMatchObject({ kind: 'error', name: 'ReferenceError' });
    await engine.loadDataset({ text: ORDERS_CSV, name: 'median' });
    expect(s().notice).toEqual({ tone: 'error', text: expect.stringContaining('is a function in this program') });
    await engine.loadDataset({ text: 'a,b\n' });
    expect(s().notice).toEqual({ tone: 'error', text: expect.stringContaining('Could not load the data: No rows') });
  }, 60_000);

  it('the orders example: clicking it binds the bundled rows; "Break it" asks for the call first; the grown spec carries the example id', async () => {
    const ordersExample: EngineExample = {
      id: 'orders',
      title: 'orders',
      blurb: 'spec-less',
      call: 'topCustomersByRevenue(rows)',
      fn: 'topCustomersByRevenue',
      dataset: { name: 'rows', filename: 'orders.csv' },
      breakIt: { label: 'Break it: refunds and discounts', description: 'x' },
      breakPatch: { doc: 'Refunded orders do not count.' },
    };
    const body = `const t = new Map<string, number>();
for (const r of arg0) t.set(r.customer, (t.get(r.customer) ?? 0) + r.quantity * r.unitPrice);
return [...t].map(([customer, revenue]) => ({ customer, revenue })).sort((a, b) => b.revenue - a.revenue).slice(0, 5);`;
    const { engine, gen, s } = setup({ script: { topCustomersByRevenue: [body] }, deps: { examples: [EXAMPLE, ordersExample] } });
    await engine.init();
    await engine.breakIt('orders');
    expect(s().notice).toEqual({ tone: 'info', text: expect.stringContaining('Run the call first') });
    expect(s().datasets).toEqual([expect.objectContaining({ name: 'rows', source: 'bundled', filename: 'orders.csv', rowCount: 332, typeName: 'Row' })]);
    expect(s().replInput).toBe('topCustomersByRevenue(rows)');
    const revs = s().revisions.length;
    await engine.loadExample('orders'); // already bound: not reloaded
    expect(s().revisions).toHaveLength(revs);
    await engine.submit();
    const rec = s().program.functions.topCustomersByRevenue!;
    expect(rec.spec.exampleId).toBe('orders');
    expect(rec.spec.typeDecls).toContain('discount: number | null');
    expect(gen.requests[0]!.prompt).toContain('`rows` is bound to 332 rows of Row.');
    const o = outputs(s()).at(-1)!;
    expect(o.table?.columns).toEqual(['customer', 'revenue']);
    expect(o.pinnable?.call).toBe('topCustomersByRevenue(rows)');
    await engine.breakIt('orders');
    expect(s().program.functions.topCustomersByRevenue!.spec.doc).toBe('Refunded orders do not count.');
    expect(isStale(s().program.functions.topCustomersByRevenue!)).toBe(true);
  }, 60_000);
});
