/**
 * `?opener=<id>` at boot, in Node with the REAL compiler, REPL core, store (memory backend) and bundled data: the
 * pre-typed state must be the one clicking that example's chip produces (r1 stays the median seed).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EngineState, ServiceStatus } from '../types';
import { warmUp } from '../gates/compile';
import { executeGates } from '../sandbox/gateExecutor';
import { Runtime, type RuntimeWorkerLike } from '../sandbox/runtime';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from '../sandbox/replCore';
import { EXAMPLES } from '../examples';
import { createEngine, type EngineExample, type EngineHandle } from './engine';
import { ReplayGenerator } from './generator';
import { _useBackend, memoryBackend } from './store';

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

const DOWN: ServiceStatus = { state: 'down' };
const engines: EngineHandle[] = [];

function boot(search: string, opts: { keepStore?: boolean } = {}) {
  if (!opts.keepStore) _useBackend(memoryBackend());
  let clock = Date.UTC(2026, 9, 4, 9, 0, 0);
  const engine = createEngine({
    examples: EXAMPLES as EngineExample[],
    initialExampleId: 'median',
    probeService: async () => DOWN,
    loadRecordings: async () => [],
    createReplayGenerator: (recs) => new ReplayGenerator(recs, { maxMs: 0 }),
    createRuntime: () => new Runtime({ callBudgetMs: 10_000, workerFactory: () => new InProcessWorker() }),
    execGates: (input, onGate) => Promise.resolve(executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) })),
    now: () => (clock += 1000),
    sleep: async () => {},
    pacing: { typeCharMs: 0, gateDwellMs: 0, replayMaxMs: 0 },
    inputMemory: { load: () => null, save: () => {} },
    mutation: { idleMs: 3_600_000, quietMs: 0, timeBoxMs: 120_000 },
    createTabChannel: () => null,
    location: () => ({ search, hash: '' }),
  });
  engines.push(engine);
  return { engine, s: (): EngineState => engine.state.value };
}

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!;

beforeAll(async () => {
  await warmUp();
}, 60_000);
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  _useBackend(null);
});

describe('?opener=', () => {
  it('defaults to median: r1 seeded with its spec, its call pre-typed', async () => {
    for (const search of ['', '?opener=nope', '?opener=', '?opener=median']) {
      const { engine, s } = boot(search);
      await engine.init();
      expect(s().ready).toBe(true);
      expect(s().replInput).toBe(ex('median').call);
      expect(s().revisions.map((r) => r.id)).toEqual([1]);
      expect(Object.keys(s().program.functions)).toEqual(['median']);
      expect(s().hints.opener).toBe(true);
    }
  }, 60_000);

  it('fibonacci / slugify: the chip\'s state (median r1, then the example spec as r2) with its call pre-typed', async () => {
    for (const id of ['fibonacci', 'slugify']) {
      const { engine, s } = boot(`?opener=${id}`);
      await engine.init();
      expect(s().ready).toBe(true);
      expect(s().replInput).toBe(ex(id).call);
      expect(s().revisions.map((r) => r.title)).toEqual([expect.stringContaining('median spec'), `Loaded example: ${ex(id).title}`]);
      expect(s().headRevision).toBe(2);
      expect(Object.keys(s().program.functions).sort()).toEqual([id, 'median'].sort());
      expect(s().program.functions[id]!.artifact ?? null).toBeNull();
      expect(s().hints.opener).toBe(true);
    }
  }, 60_000);

  it('orders: the bundled rows are bound to `rows` before the console is ready, like clicking the chip', async () => {
    const { engine, s } = boot('?opener=orders');
    await engine.init();
    expect(s().ready).toBe(true);
    expect(s().replInput).toBe(ex('orders').call);
    expect(s().datasets.map((d) => [d.name, d.source, d.filename])).toEqual([['rows', 'bundled', 'orders.csv']]);
    expect(s().env).toHaveProperty('rows');
    expect(s().program.datasets?.rows).toBeTruthy();
    expect(s().revisions.at(-1)!.title).toMatch(/^Loaded dataset rows: \d+ rows/);
    expect(s().hints.opener).toBe(true);
  }, 60_000);

  it('is ignored when a stored image exists (first visit only), and reset reseeds median', async () => {
    _useBackend(memoryBackend());
    const first = boot('', { keepStore: true });
    await first.engine.init();
    first.engine.dispose();
    const again = boot('?opener=fibonacci', { keepStore: true });
    await again.engine.init();
    expect(again.s().revisions.map((r) => r.id)).toEqual([1]);
    expect(again.s().program.functions.fibonacci).toBeUndefined();

    const fresh = boot('?opener=orders');
    await fresh.engine.init();
    await fresh.engine.resetImage();
    expect(fresh.s().replInput).toBe(ex('median').call);
    expect(fresh.s().datasets).toEqual([]);
  }, 60_000);
});
