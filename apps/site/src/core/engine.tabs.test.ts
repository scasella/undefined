/**
 * The stored program across tabs and imports, end to end in Node with the REAL compiler, gate executor, REPL core
 * and store (memory backend): importing asks first (previewImage changes nothing), two tabs never wipe the stored
 * image, a damaged stored image is repaired or visibly discarded, and tabs warn each other.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, GateResult, GenerateRequest, GenerateResult, Generator, ProgressLine, Revision } from '@scasella/undefined-engine/types';
import { warmUp } from '@scasella/undefined-engine/gates/compile';
import { executeGates } from '@scasella/undefined-engine/sandbox/gateExecutor';
import type { ExecGateInput } from '../sandbox/gateRunner';
import { Runtime, type RuntimeWorkerLike } from '../sandbox/runtime';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from '../sandbox/replCore';
import { createSessionLog, memoryBackend as logMemory, type SessionLog } from '../sessionlog/log';
import { createEngine, DATASETS_UNBOUND_PREFIX, STORED_DISCARDED_PREFIX, type EngineDeps, type EngineHandle, type TabChannel } from './engine';
import { GenerationFailure } from './generator';
import { emptyProgram, initialRevision } from '@scasella/undefined-engine/program';
import { _useBackend, memoryBackend, type Backend } from './store';

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

function setup(script: Record<string, string[]> = {}, log?: SessionLog, deps: Partial<EngineDeps> = {}) {
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
    ...deps,
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
let mem: Backend;
beforeEach(() => {
  mem = memoryBackend();
  _useBackend(mem);
});
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  _useBackend(null);
});


const CSV = (tag: string) => `name,n\n${tag}a,1\n${tag}b,2\n`;

describe('import asks first', () => {
  it('previewImage says what the file holds and what it would replace, and changes nothing', async () => {
    const a = setup();
    await a.engine.init();
    await a.engine.loadDataset({ text: CSV('x'), name: 'rows' });
    await a.engine.upsertSpec({ name: 'f', params: [{ name: 'n', type: 'number' }], returns: 'number', doc: 'n', tests: '', properties: '', budgetMs: 100, maxAttempts: 1, origin: 'user' });
    const json = await a.engine.exportImage();

    _useBackend((mem = memoryBackend()));
    const b = setup();
    await b.engine.init();
    await b.engine.upsertSpec({ name: 'g', params: [], returns: 'number', doc: 'one', tests: '', properties: '', budgetMs: 100, maxAttempts: 1, origin: 'user' });
    const before = b.s();
    const stored = JSON.stringify(await mem.readAll());

    const p = await b.engine.previewImage(json);
    expect(p).toEqual({
      ok: true,
      revisions: 3,
      functions: 1,
      datasets: 1,
      exportedAt: expect.any(String),
      current: { revisions: 2, functions: 1 },
    });
    // nothing changed: state, history, store
    expect(b.s()).toBe(before);
    expect(JSON.stringify(await mem.readAll())).toBe(stored);

    expect(await b.engine.previewImage('{not json')).toMatchObject({ ok: false, error: expect.stringMatching(/^the file is not JSON/) });
    expect(await b.engine.previewImage('{"format":"undefined-image","version":1}')).toMatchObject({ ok: false });
    expect(b.s()).toBe(before);

    // Replace (the confirmed path) imports as before
    await b.engine.importImage(json);
    expect(b.s().program.functions.f).toBeDefined();
    expect(b.s().program.functions.g).toBeUndefined();
  }, 60_000);
});

describe('two tabs on one stored program', () => {
  it('interleaved dataset loads in two tabs never wipe the stored image: a third load restores it without a notice', async () => {
    const a = setup();
    const b = setup();
    await a.engine.init();
    await b.engine.init(); // both booted on the same r1
    await a.engine.loadDataset({ text: CSV('A'), name: 'rows' });
    await b.engine.loadDataset({ text: CSV('B'), name: 'other' }); // overwrites A's r2, saves only B's rows
    await a.engine.loadDataset({ text: CSV('C'), name: 'more' }); // r3: refers to rows (A) and more (C)
    const kv = (await mem.readAll()).kv as { datasets: Record<string, unknown> };
    expect(Object.keys(kv.datasets).length).toBe(3); // nobody's rows were dropped

    const c = setup();
    await c.engine.init();
    expect(c.s().notice).toBeUndefined();
    expect(c.s().revisions.length).toBe(3);
    expect(c.s().datasets.map((d) => d.name).sort()).toEqual(['more', 'rows']);
  }, 60_000);

  it('a stored image with a bound dataset whose rows are missing is repaired and says so; nothing else is lost', async () => {
    const ref = { name: 'rows', hash: 'a'.repeat(64), typeName: 'Row', typeDecl: 'type Row = { a: number }', rowCount: 1, columns: [{ name: 'a', type: 'number' }], source: 'paste' as const, bytes: 7 };
    const r1 = { ...initialRevision({ ...emptyProgram(), datasets: { rows: ref } }), title: 'kept title' };
    await mem.write({ revisions: [r1], kv: { head: 1 } });
    const { engine, s } = setup();
    await engine.init();
    expect(s().notice).toEqual({ tone: 'error', text: `${DATASETS_UNBOUND_PREFIX}rows.` });
    expect(s().notice!.text).toBe('These datasets could not be restored and were unbound: rows.');
    expect(s().revisions[0]!.title).toBe('kept title');
    expect(s().datasets).toEqual([]);
  }, 60_000);

  it('a stored image that cannot be read is discarded VISIBLY (a notice with the reason), not silently', async () => {
    const bad = { ...initialRevision(emptyProgram()), kind: 'bogus' } as unknown as Revision;
    await mem.write({ revisions: [bad], kv: { head: 1 } });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const { engine, s } = setup();
      await engine.init();
      expect(s().notice?.tone).toBe('error');
      expect(s().notice!.text.startsWith(STORED_DISCARDED_PREFIX)).toBe(true);
      expect(s().notice!.text).toMatch(/^Your stored program could not be read \(revisions\[0\]\.kind must be one of .*\) and was discarded/);
      expect(s().revisions.length).toBe(1); // a fresh r1
    } finally {
      console.warn = warn;
    }
  }, 60_000);
});

describe('multi-tab warning', () => {
  /** An in-memory BroadcastChannel: every message reaches every OTHER member. */
  function hub() {
    const members = new Set<{ cb?: (m: unknown) => void }>();
    const factory = (): TabChannel => {
      const me: { cb?: (m: unknown) => void } = {};
      members.add(me);
      return {
        post: (m) => {
          for (const o of members) if (o !== me) queueMicrotask(() => o.cb?.(m));
        },
        onMessage: (cb) => {
          me.cb = cb;
        },
        close: () => void members.delete(me),
      };
    };
    return { factory, members };
  }

  it('alone: no banner. A second tab: both are told; the banner can be dismissed; dispose closes the channel', async () => {
    const h = hub();
    const a = setup({}, undefined, { createTabChannel: h.factory });
    await a.engine.init();
    await tick(20);
    expect(a.s().otherTab).toBeUndefined();
    const b = setup({}, undefined, { createTabChannel: h.factory });
    await b.engine.init();
    await tick(20);
    expect(b.s().otherTab).toEqual({ dismissed: false }); // the newcomer: someone answered 'present'
    expect(a.s().otherTab).toEqual({ dismissed: false }); // and the tab that was already open heard the hello
    b.engine.dismissOtherTabBanner();
    expect(b.s().otherTab).toEqual({ dismissed: true });
    expect(h.members.size).toBe(2);
    b.engine.dispose();
    a.engine.dispose();
    expect(h.members.size).toBe(0);
  }, 60_000);

  it('no channel available (null factory): nothing happens', async () => {
    const { engine, s } = setup({}, undefined, { createTabChannel: () => null });
    await engine.init();
    expect(s().otherTab).toBeUndefined();
  }, 60_000);
});
