/**
 * What of the user's data can reach the model (retry feedback) and the local session log, end to end in Node with the
 * REAL compiler, gate executor, REPL core and store (memory backend). A scripted live generator records every prompt.
 * Unique canary strings sit in the dataset rows: with sample rows off none may appear in any prompt, and none may ever
 * appear in any session-log entry.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, GateResult, GenerateRequest, GenerateResult, Generator, ProgressLine, ReplEntry } from '@scasella/undefined-engine/types';
import { warmUp } from '@scasella/undefined-engine/gates/compile';
import { executeGates, PINNED_PREFIX } from '@scasella/undefined-engine/sandbox/gateExecutor';
import type { ExecGateInput } from '../sandbox/gateRunner';
import { Runtime, type RuntimeWorkerLike } from '../sandbox/runtime';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from '../sandbox/replCore';
import { createSessionLog, memoryBackend as logMemory, type SessionLog } from '../sessionlog/log';
import { buildPrompt } from '../shared/prompt';
import {
  clipText,
  createEngine,
  DATA_QUOTE_MAX,
  PINNED_TEST_PREFIX,
  redactFaultForModel,
  redactHistoryForModel,
  WITHHELD,
  type EngineHandle,
} from './engine';
import { GenerationFailure } from './generator';
import { _useBackend, memoryBackend } from './store';

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
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

function memStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

function setup(script: Record<string, string[]>, log?: SessionLog) {
  const gen = new ScriptedGenerator(script);
  let clock = Date.UTC(2026, 9, 4, 9, 0, 0);
  const engine = createEngine({
    examples: [],
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
    mutation: { idleMs: 3_600_000, quietMs: 0, timeBoxMs: 120_000 },
    createSessionLog: () => log ?? createSessionLog({ backend: logMemory(), storage: memStorage() }),
    location: () => null,
    createTabChannel: () => null,
  });
  engines.push(engine);
  const s = (): EngineState => engine.state.value;
  const run = async (text: string) => {
    engine.setInput(text);
    await engine.submit();
  };
  return { engine, gen, s, run };
}

beforeAll(async () => {
  await warmUp();
}, 60_000);
beforeEach(() => _useBackend(memoryBackend()));
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  _useBackend(null);
});

const CANARY = 'CANARYq7xk';
const ROWS_CSV = `name,amount\n${CANARY}Row1,10\nbeta,20\n${CANARY}Row3,30\n`;
/** Mutates its argument: the Invariants replay of the triggering call (the real rows) rejects it. */
const MUTATES = 'arg0.reverse();\nreturn arg0.length;';
const GOOD_COUNT = 'return arg0.length;';

const outputs = (s: EngineState) => s.repl.filter((e): e is Extract<ReplEntry, { kind: 'output' }> => e.kind === 'output');
const lastError = (s: EngineState) => [...s.repl].reverse().find((e): e is Extract<ReplEntry, { kind: 'error' }> => e.kind === 'error')!;

describe('retry feedback to the model, sample rows OFF', () => {
  it('the pinned-test prefix the engine redacts is the gate executor\'s', () => {
    expect(PINNED_TEST_PREFIX).toBe(PINNED_PREFIX);
  });

  it('no canary in any prompt: first attempt, and the retry after an INVARIANT failure on the real rows', async () => {
    const { engine, gen, s, run } = setup({ count: [MUTATES, GOOD_COUNT] });
    await engine.init();
    engine.setSendSamples(false);
    await engine.loadDataset({ text: ROWS_CSV, name: 'rows' });
    await run('count(rows)');
    expect(gen.requests.length).toBe(2);
    for (const r of gen.requests) expect(r.prompt).not.toContain(CANARY);
    // the retry still says what went wrong, without the values
    expect(gen.requests[1]!.prompt).toContain('INVARIANTS FAILED');
    expect(gen.requests[1]!.prompt).toContain('mutated its argument');
    expect(gen.requests[1]!.prompt).toContain(WITHHELD);
    // "What the model saw" is exactly what was sent
    const attempts = s().generation!.attempts;
    expect(attempts.map((a) => a.candidate!.prompt)).toEqual(gen.requests.map((r) => r.prompt));
    // the local gate panel keeps the full diagnostic (it never leaves the browser)
    expect(JSON.stringify(attempts[0]!.gates)).toContain(CANARY);
    expect(s().generation!.phase).toBe('committed');
  }, 120_000);

  it('no canary in the retry after a PINNED-test failure (the pin\'s expected value came from the rows)', async () => {
    const { engine, gen, s, run } = setup({ first: ['return arg0[0]!.name;', 'return arg0[1]!.name;', 'return arg0[0]!.name;'] });
    await engine.init();
    engine.setSendSamples(false);
    await engine.loadDataset({ text: ROWS_CSV, name: 'rows' });
    await run('first(rows)');
    expect(outputs(s()).at(-1)!.value).toContain(CANARY);
    await engine.pinResult(outputs(s()).at(-1)!.id);
    expect(s().program.functions.first!.spec.pins!.length).toBe(1);
    await engine.editSpec('first', { doc: 'The name on the first row.' }); // the artifact goes stale: the next call regrows
    await run('first(rows)');
    expect(gen.requests.length).toBe(3);
    const retry = gen.requests[2]!.prompt;
    expect(retry).toContain('TESTS FAILED');
    expect(retry).toContain(`test "${PINNED_TEST_PREFIX}first(rows)"`);
    expect(retry).toContain(WITHHELD);
    for (const r of gen.requests) expect(r.prompt).not.toContain(CANARY);
    expect(s().generation!.attempts.map((a) => a.candidate!.prompt)).toEqual(gen.requests.slice(1).map((r) => r.prompt));
  }, 120_000);

  it('no canary in a runtime-fault retry ("retry with the error fed back") whose message quoted a row', async () => {
    const { engine, gen, s, run } = setup({ boom: ['throw new TypeError("bad row " + arg0[0]!.name);', GOOD_COUNT] });
    await engine.init();
    engine.setSendSamples(false);
    await engine.loadDataset({ text: ROWS_CSV, name: 'rows' });
    await run('boom(rows)');
    const err = lastError(s());
    expect(err.name).toBe('TypeError');
    expect(err.message).toContain(CANARY); // shown locally, in the REPL
    await engine.invokeRestart(err.id, 'retry');
    expect(gen.requests.length).toBe(2);
    expect(gen.requests[1]!.prompt).toContain('RUNTIME FAULT');
    for (const r of gen.requests) expect(r.prompt).not.toContain(CANARY);
  }, 120_000);
});

describe('retry feedback to the model, sample rows ON', () => {
  it('may quote the data (the documented behaviour), each quoted field cut to 200 characters', async () => {
    const big = Array.from({ length: 40 }, (_, i) => `${CANARY}Long${i}${'x'.repeat(30)},${i}`).join('\n');
    const { engine, gen, run } = setup({ count: [MUTATES, GOOD_COUNT] });
    await engine.init();
    expect(engine.state.value.send.samples).toBe(true); // the default
    await engine.loadDataset({ text: `name,amount\n${big}\n`, name: 'rows' });
    await run('count(rows)');
    const retry = gen.requests[1]!.prompt;
    expect(retry).toContain(CANARY);
    expect(retry).not.toContain(WITHHELD);
    for (const line of retry.split('\n')) {
      const m = /^\s+(?:call|detail):\s+(.*)$/.exec(line);
      if (m) expect(m[1]!.length).toBeLessThanOrEqual(DATA_QUOTE_MAX);
    }
  }, 120_000);
});

describe('redactHistoryForModel / redactFaultForModel (pure)', () => {
  const pinnedFail: GateResult = {
    gate: 'tests',
    status: 'fail',
    ms: 1,
    summary: '0/1 tests passed',
    headline: `Rejected: f(rows) returned "beta", expected "${CANARY}"`,
    diagnostics: [{ kind: 'test', name: `${PINNED_TEST_PREFIX}f(rows)`, call: 'f(rows)', expected: `"${CANARY}"`, actual: '"beta"', message: `expected "${CANARY}"`, error: `TypeError: ${CANARY}` }],
  };
  const unitFail: GateResult = {
    gate: 'tests',
    status: 'fail',
    ms: 1,
    summary: '0/1 tests passed',
    headline: 'Rejected: f([1]) returned 2, expected 1',
    diagnostics: [{ kind: 'test', name: 'one', call: 'f([1])', expected: '1', actual: '2', message: 'x' }],
  };
  const propFail: GateResult = {
    gate: 'properties',
    status: 'fail',
    ms: 1,
    summary: 'failed',
    headline: 'Rejected: property "p" failed for f([0])',
    diagnostics: [{ kind: 'property', name: 'p', counterexample: '[[0]]', call: 'f([0])', shrinks: 1, runs: 2, seed: 3 }],
  };

  it('samples off: pinned values and invariant call/detail are withheld; unit tests and property counterexamples are kept', () => {
    const inv: GateResult = {
      gate: 'invariants',
      status: 'fail',
      ms: 1,
      summary: 'impure',
      headline: `Rejected: f([{name:"${CANARY}"}]) mutated its argument`,
      diagnostics: [{ kind: 'invariant', invariant: 'pure', message: 'mutated its argument', call: `f([{name:"${CANARY}"}])`, detail: `argument became [${CANARY}]` }],
    };
    const out = redactHistoryForModel(
      [
        { attempt: 1, body: 'a', gates: [pinnedFail], headline: pinnedFail.headline },
        { attempt: 2, body: 'b', gates: [unitFail] },
        { attempt: 3, body: 'c', gates: [propFail] },
        { attempt: 4, body: 'd', gates: [inv], headline: inv.headline },
      ],
      { samples: false },
    );
    const text = JSON.stringify(out);
    expect(text).not.toContain(CANARY);
    expect(out[0]!.gates[0]!.diagnostics[0]).toMatchObject({ call: WITHHELD, expected: WITHHELD, actual: WITHHELD, error: `TypeError: ${WITHHELD}` });
    expect(out[1]!.gates[0]).toEqual(unitFail);
    expect(out[2]!.gates[0]).toEqual(propFail);
    expect(out[3]!.headline).toMatch(/^Rejected by invariants: pure: mutated its argument/);
    const prompt = buildPrompt({ spec: { name: 'f', params: [], returns: null, doc: '', tests: '', properties: '', budgetMs: 100, maxAttempts: 3, origin: 'call' }, history: out });
    expect(prompt).not.toContain(CANARY);
  });

  it('samples on: the same fields are kept but cut to 200 characters', () => {
    const long = `"${CANARY}${'y'.repeat(400)}"`;
    const g: GateResult = { ...pinnedFail, diagnostics: [{ kind: 'test', name: `${PINNED_TEST_PREFIX}f(rows)`, call: 'f(rows)', expected: long, actual: '"b"', message: long }] };
    const [h] = redactHistoryForModel([{ attempt: 1, body: 'a', gates: [g] }], { samples: true });
    const d = h!.gates[0]!.diagnostics[0]!;
    expect(d.kind === 'test' && d.expected).toBe(clipText(long, DATA_QUOTE_MAX));
    expect(d.kind === 'test' && d.expected!.length).toBe(DATA_QUOTE_MAX);
    expect(JSON.stringify(h)).toContain(CANARY);
  });

  it('a runtime fault: call and message withheld (off) or cut (on)', () => {
    const f = { call: `boom([{name:"${CANARY}"}])`, errorName: 'TypeError', message: `bad row ${CANARY}`, previousBody: 'x' };
    expect(JSON.stringify(redactFaultForModel(f, 'boom', { samples: false }))).not.toContain(CANARY);
    expect(redactFaultForModel(f, 'boom', { samples: false })).toMatchObject({ call: `boom(${WITHHELD})`, errorName: 'TypeError', message: WITHHELD });
    expect(redactFaultForModel(f, 'boom', { samples: true }).message).toBe(f.message);
  });
});

describe('session log: never dataset rows', () => {
  it('with data in play every entry is value-free (gates, faults, errors, declines); no canary anywhere in the log', async () => {
    const log = createSessionLog({ backend: logMemory(), storage: memStorage() });
    const { engine, s, run } = setup({ count: [MUTATES, GOOD_COUNT], boom: ['throw new TypeError("bad row " + arg0[0]!.name);'] }, log);
    await engine.init();
    await engine.setSessionLogEnabled(true);
    await engine.loadDataset({ text: ROWS_CSV, name: 'rows' });
    await run('count(rows)'); // invariant rejection on the real rows, then a commit
    await run('boom(rows)'); // commits (nothing checks it), then throws with a row value in its message
    await run('JSON.parse(rows[0].name)'); // a REPL error whose message quotes the cell
    await run('x = rows[2]');
    await engine.pinResult(outputs(s()).find((o) => o.pinnable)?.id ?? '');
    await tick(50);
    const json = await engine.exportSessionLog();
    expect(json).not.toContain(CANARY);
    const entries = (JSON.parse(json) as { entries: Array<{ kind: string; summary: string; fn?: string }> }).entries;
    expect(entries.find((e) => e.kind === 'gate' && e.fn === 'count')!.summary).toBe('rejected by invariants (pure)');
    expect(entries.some((e) => e.kind === 'error' && e.summary === 'boom threw TypeError')).toBe(true);
    expect(entries.some((e) => e.kind === 'error' && e.summary === 'error: SyntaxError')).toBe(true);
    // the inputs the user typed are kept (they are the user's own text)
    expect(entries.some((e) => e.kind === 'input' && e.summary === 'REPL input')).toBe(true);
  }, 120_000);

  it('with no data in play a gate headline is logged, cut to 200 characters', async () => {
    const log = createSessionLog({ backend: logMemory(), storage: memStorage() });
    const { engine, run } = setup({ big: ['return xs.slice().reverse();', 'return xs.slice();'] }, log);
    await engine.init();
    await engine.setSessionLogEnabled(true);
    await engine.upsertSpec({
      name: 'big',
      params: [{ name: 'xs', type: 'string[]' }],
      returns: 'string[]',
      doc: 'Same list.',
      tests: `test("same", () => eq(big(["${'z'.repeat(150)}", "${'w'.repeat(150)}"]), ["${'z'.repeat(150)}", "${'w'.repeat(150)}"]));`,
      properties: '',
      budgetMs: 1000,
      maxAttempts: 3,
      origin: 'user',
    });
    await run('big(["a"])');
    await tick(50);
    const entries = (JSON.parse(await engine.exportSessionLog()) as { entries: Array<{ kind: string; summary: string }> }).entries;
    const gate = entries.find((e) => e.kind === 'gate')!;
    expect(gate.summary).toMatch(/^Rejected: /);
    expect(gate.summary.length).toBeLessThanOrEqual(200);
  }, 120_000);
});
