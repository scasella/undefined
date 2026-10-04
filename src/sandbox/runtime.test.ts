import { describe, expect, it } from 'vitest';
import { Runtime, type RuntimeWorkerLike } from './runtime';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from './replCore';

const MEDIAN = `function median(numbers) {
  const s = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}`;
const DOUBLE = 'function double(x) { return x * 2; }';

/**
 * A worker that runs the real dispatcher (the same code runtimeWorker.ts runs) in-process, with asynchronous message
 * delivery like a real Worker. An evaluate whose input contains `hang` is never answered (a synchronous loop can't be
 * interrupted in-process); with `hangIn` set, the fake first reports that committed call as in flight.
 */
class FakeWorker implements RuntimeWorkerLike {
  terminated = false;
  received: RuntimeRequest[] = [];
  private listener: ((m: RuntimeMessage) => void) | null = null;
  private readonly dispatch = createDispatcher((m) => this.deliver(m));

  constructor(private readonly hangIn?: { fn: string; call: string }) {}

  postMessage(req: RuntimeRequest): void {
    this.received.push(req);
    setTimeout(() => {
      if (this.terminated) return;
      if (req.type === 'evaluate' && req.input.includes('hang')) {
        if (this.hangIn) this.deliver({ type: 'enter', ...this.hangIn });
        return;
      }
      this.dispatch(req);
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }

  onMessage(cb: (m: RuntimeMessage) => void): void {
    this.listener = cb;
  }

  onError(_cb: (message: string) => void): void {}

  private deliver(m: RuntimeMessage): void {
    queueMicrotask(() => {
      if (!this.terminated) this.listener?.(m);
    });
  }
}

function setup(opts: { callBudgetMs?: number; hangIn?: { fn: string; call: string } } = {}) {
  const workers: FakeWorker[] = [];
  const runtime = new Runtime({
    callBudgetMs: opts.callBudgetMs ?? 1000,
    workerFactory: () => {
      const w = new FakeWorker(opts.hangIn);
      workers.push(w);
      return w;
    },
  });
  return { runtime, workers };
}

describe('Runtime', () => {
  it('creates its worker lazily and evaluates through it', async () => {
    const { runtime, workers } = setup();
    expect(workers).toHaveLength(0);
    await runtime.define('median', MEDIAN);
    expect(workers).toHaveLength(1);
    expect(await runtime.evaluate('median([3, 1, 4, 2])')).toMatchObject({ kind: 'value', shown: '2.5', calls: ['median'] });
    runtime.dispose();
  });

  it('serialises concurrent requests in call order', async () => {
    const { runtime } = setup();
    const results = await Promise.all([
      runtime.evaluate('x = 1'),
      runtime.define('double', DOUBLE),
      runtime.evaluate('x = double(x + 1)'),
      runtime.evaluate('x'),
      runtime.envShown(),
    ]);
    expect(results[3]).toMatchObject({ kind: 'value', shown: '4' });
    expect(results[4]).toEqual({ x: '4' });
    runtime.dispose();
  });

  it('hot-swaps a function in the live worker without restarting or losing variables', async () => {
    const { runtime, workers } = setup();
    await runtime.define('double', DOUBLE);
    await runtime.evaluate('x = double(5)');
    await runtime.define('double', 'function double(x) { return x * 3; }');
    expect(await runtime.evaluate('double(x)')).toMatchObject({ kind: 'value', shown: '30' });
    expect(await runtime.envShown()).toEqual({ x: '10' });
    expect(workers).toHaveLength(1);
    runtime.dispose();
  });

  it('reports an undefined call, then the call succeeds after the function is defined', async () => {
    const { runtime } = setup();
    expect(await runtime.evaluate('median([3, 1, 4, 2])')).toMatchObject({ kind: 'undefined-call', name: 'median', argTypes: ['number[]'] });
    await runtime.define('median', MEDIAN);
    expect(await runtime.evaluate('median([3, 1, 4, 2])')).toMatchObject({ kind: 'value', shown: '2.5' });
    runtime.dispose();
  });

  it('rejects define of invalid code and keeps the previous definition', async () => {
    const { runtime } = setup();
    await runtime.define('double', DOUBLE);
    await expect(runtime.define('double', 'function double( {')).rejects.toThrow(/SyntaxError/);
    expect(await runtime.evaluate('double(2)')).toMatchObject({ kind: 'value', shown: '4' });
    runtime.dispose();
  });

  it('undefine removes a function from the live worker', async () => {
    const { runtime } = setup();
    await runtime.define('double', DOUBLE);
    await runtime.undefine('double');
    expect(await runtime.evaluate('double(2)')).toMatchObject({ kind: 'undefined-call', name: 'double' });
    runtime.dispose();
  });

  it('snapshots the env with tagged values', async () => {
    const { runtime } = setup();
    expect(await runtime.snapshotEnv()).toEqual({});
    await runtime.evaluate('big = 10n');
    await runtime.evaluate('m = new Map([[1, 2]])');
    expect(await runtime.snapshotEnv()).toEqual({ big: { $t: 'bigint', v: '10' }, m: { $t: 'Map', v: [[1, 2]] } });
    runtime.dispose();
  });

  it('times out a hung evaluation, rebuilds the worker, and keeps functions and the last good env', async () => {
    const { runtime, workers } = setup({ callBudgetMs: 50 });
    await runtime.define('double', DOUBLE);
    await runtime.evaluate('x = double(21)');
    const out = await runtime.evaluate('hang()');
    expect(out.kind).toBe('timeout');
    if (out.kind === 'timeout') {
      expect(out.ms).toBeGreaterThanOrEqual(45);
      expect(out.fn).toBeUndefined();
    }
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.received[0]).toMatchObject({ type: 'reset', functions: { double: DOUBLE }, env: { x: 42 } });
    expect(await runtime.evaluate('double(x)')).toMatchObject({ kind: 'value', shown: '84' });
    runtime.dispose();
  });

  it('names the committed call that was in flight when the budget ran out', async () => {
    const { runtime } = setup({ callBudgetMs: 50, hangIn: { fn: 'fib', call: 'fib(90)' } });
    await runtime.define('fib', 'function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }');
    expect(await runtime.evaluate('hang')).toMatchObject({ kind: 'timeout', fn: 'fib', call: 'fib(90)' });
    runtime.dispose();
  });

  it("enforces a function's own per-call budget when it is shorter than the evaluation budget", async () => {
    const { runtime } = setup({ callBudgetMs: 5000, hangIn: { fn: 'fib', call: 'fib(90)' } });
    await runtime.define('fib', 'function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }', 40);
    const started = Date.now();
    expect(await runtime.evaluate('hang')).toMatchObject({ kind: 'timeout', fn: 'fib', call: 'fib(90)' });
    expect(Date.now() - started).toBeLessThan(1000);
    runtime.dispose();
  });

  it('reset replaces functions and env in a fresh worker', async () => {
    const { runtime, workers } = setup();
    await runtime.define('double', DOUBLE);
    await runtime.evaluate('x = 1');
    await runtime.reset({ median: { js: MEDIAN, budgetMs: 100 } }, { y: 7, big: { $t: 'bigint', v: '7' } });
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(await runtime.envShown()).toEqual({ y: '7', big: '7n' });
    expect(await runtime.evaluate('double(1)')).toMatchObject({ kind: 'undefined-call' });
    expect(await runtime.evaluate('median([y, 1, 3])')).toMatchObject({ kind: 'value', shown: '3' });
    runtime.dispose();
  });

  it('a timeout rebuild drops unserializable variables instead of binding them to undefined, and names them', async () => {
    const { runtime, workers } = setup({ callBudgetMs: 50 });
    await runtime.evaluate('f = x => x + 1');
    await runtime.evaluate('y = 3');
    const out = await runtime.evaluate('hang()');
    expect(out).toMatchObject({ kind: 'timeout', lost: ['f'] });
    expect(workers).toHaveLength(2);
    expect(await runtime.envShown()).toEqual({ y: '3' });
    expect(await runtime.evaluate('f')).toMatchObject({ kind: 'error', errorName: 'ReferenceError' });
    expect(await runtime.snapshotEnv()).toEqual({ y: 3 });
    // A second rebuild does not report the same names again.
    const again = await runtime.evaluate('hang()');
    expect(again.kind).toBe('timeout');
    if (again.kind === 'timeout') expect(again.lost).toBeUndefined();
    runtime.dispose();
  });

  it('reset resolves with the names of variables that could not be restored', async () => {
    const { runtime } = setup();
    const r = await runtime.reset({}, { f: { $t: 'unserializable', show: '[Function f]' }, y: 1 });
    expect(r).toEqual({ lost: ['f'] });
    expect(await runtime.envShown()).toEqual({ y: '1' });
    expect(await runtime.reset({}, { y: 2 })).toEqual({ lost: [] });
    runtime.dispose();
  });

  it('a failed reset keeps the previous program', async () => {
    const { runtime } = setup();
    await runtime.define('double', DOUBLE);
    await runtime.evaluate('x = 2');
    await expect(runtime.reset({ bad: 'function bad( {' }, {})).rejects.toThrow();
    expect(await runtime.evaluate('double(x)')).toMatchObject({ kind: 'value', shown: '4' });
    runtime.dispose();
  });

  it('dispose terminates the worker and rejects later calls', async () => {
    const { runtime, workers } = setup();
    await runtime.evaluate('1');
    runtime.dispose();
    expect(workers[0]!.terminated).toBe(true);
    await expect(runtime.evaluate('1')).rejects.toThrow(/disposed/);
  });

  it('turns a worker crash into an error outcome and rebuilds on the next request', async () => {
    let crash: ((msg: string) => void) | null = null;
    const workers: FakeWorker[] = [];
    const runtime = new Runtime({
      workerFactory: () => {
        const w = new FakeWorker();
        w.onError = (cb: (message: string) => void) => {
          crash = cb;
        };
        workers.push(w);
        return w;
      },
    });
    await runtime.evaluate('x = 5');
    const pending = runtime.evaluate('hang');
    await new Promise((r) => setTimeout(r, 5));
    crash!('out of memory');
    expect(await pending).toMatchObject({ kind: 'error', message: expect.stringContaining('out of memory') });
    expect(await runtime.evaluate('x + 1')).toMatchObject({ kind: 'value', shown: '6' });
    expect(workers).toHaveLength(2);
    runtime.dispose();
  });
});

describe('Runtime datasets', () => {
  const ROWS = [
    { customer: 'Ada', total: 12 },
    { customer: 'Lin', total: 3 },
  ];
  const REF = { $t: 'dataset', name: 'rows', hash: 'h1', typeName: 'Row' };

  it('bindDataset binds through the worker; the env record holds a ref, not the rows', async () => {
    const { runtime, workers } = setup();
    await runtime.bindDataset('rows', 'h1', ROWS, 'Row');
    expect(workers[0]!.received.some((r) => r.type === 'bindDataset')).toBe(true);
    expect(await runtime.evaluate('rows.length')).toMatchObject({ kind: 'value', shown: '2' });
    expect(await runtime.snapshotEnv()).toEqual({ rows: REF });
    expect(await runtime.datasets()).toEqual([{ name: 'rows', hash: 'h1', typeName: 'Row' }]);
    expect(await runtime.evaluate('topCustomer(rows)')).toMatchObject({
      kind: 'undefined-call',
      argTypes: ['Row[]'],
      argDatasets: ['rows'],
    });
    runtime.dispose();
  });

  it('a timeout rebuild right after binding keeps the dataset binding (rows re-sent to the new worker)', async () => {
    const { runtime, workers } = setup({ callBudgetMs: 50 });
    await runtime.define('double', DOUBLE);
    await runtime.bindDataset('rows', 'h1', ROWS, 'Row');
    expect(await runtime.evaluate('hang()')).toMatchObject({ kind: 'timeout' });
    expect(workers).toHaveLength(2);
    const reset = workers[1]!.received.find((r) => r.type === 'reset');
    expect(reset).toMatchObject({ type: 'reset', env: { rows: REF }, datasets: { h1: ROWS } });
    expect(await runtime.evaluate('rows[0].customer')).toMatchObject({ kind: 'value', shown: '"Ada"' });
    expect(await runtime.snapshotEnv()).toEqual({ rows: REF });
    expect(await runtime.evaluate('f(rows)')).toMatchObject({ kind: 'undefined-call', argDatasets: ['rows'] });
    runtime.dispose();
  });

  it('a variable reassigned away from the dataset stops being a ref, and survives rebuilds as a value', async () => {
    const { runtime } = setup({ callBudgetMs: 50 });
    await runtime.bindDataset('rows', 'h1', ROWS, 'Row');
    await runtime.evaluate('rows = rows.slice(0, 1)');
    expect(await runtime.snapshotEnv()).toEqual({ rows: [{ customer: 'Ada', total: 12 }] });
    expect(await runtime.evaluate('hang()')).toMatchObject({ kind: 'timeout' });
    expect(await runtime.evaluate('rows.length')).toMatchObject({ kind: 'value', shown: '1' });
    expect(await runtime.datasets()).toEqual([]);
    runtime.dispose();
  });

  it('reset(functions, env, datasets) resolves refs; a ref whose hash is missing is dropped and reported lost', async () => {
    const { runtime } = setup();
    const env = { rows: REF, other: { ...REF, name: 'orders', hash: 'missing' }, n: 1 };
    expect(await runtime.reset({ double: DOUBLE }, env, { h1: ROWS })).toEqual({ lost: ['other'] });
    expect(await runtime.evaluate('rows.length + n')).toMatchObject({ kind: 'value', shown: '3' });
    expect(await runtime.snapshotEnv()).toEqual({ rows: REF, n: 1 });
    // without datasets, every ref is lost
    expect(await runtime.reset({}, { rows: REF })).toEqual({ lost: ['rows'] });
    expect(await runtime.snapshotEnv()).toEqual({});
    runtime.dispose();
  });

  it('unbindDataset removes the binding and its variable', async () => {
    const { runtime } = setup();
    await runtime.bindDataset('rows', 'h1', ROWS, 'Row');
    await runtime.unbindDataset('rows');
    expect(await runtime.snapshotEnv()).toEqual({});
    expect(await runtime.datasets()).toEqual([]);
    runtime.dispose();
  });

  it('bindDataset onto a committed function name rejects', async () => {
    const { runtime } = setup();
    await runtime.define('double', DOUBLE);
    await expect(runtime.bindDataset('double', 'h1', ROWS, 'Row')).rejects.toThrow(/committed function/);
    runtime.dispose();
  });
});
