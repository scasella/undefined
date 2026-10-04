/**
 * The live program's runtime: one long-lived worker running replCore, driven from the main thread.
 *
 * - Requests are serialised through a queue; each gets an id and exactly one reply.
 * - define() hot-swaps a function in the live worker: no restart, REPL variables untouched.
 * - The main thread keeps its own record of the committed functions and the last good env (every evaluate reply
 *   carries the env snapshot), so a worker can be rebuilt at any time without losing anything.
 * - evaluate() has a hard wall-clock limit of `callBudgetMs` for the whole line, and additionally a committed
 *   function defined with its own `budgetMs` gets that limit per call (the worker posts enter/leave around each
 *   REPL-level committed call). On overrun the worker is terminated — the only thing that stops a synchronous
 *   loop — and a fresh one is built from the record; the outcome is `{kind:'timeout'}` naming the call in flight.
 * - Messages from a worker that has been replaced are ignored, so a late reply cannot be mistaken for a new one.
 */
import type { EvalOutcome, Json } from '../types';
import type { RuntimeMessage, RuntimeRequest } from './replCore';

/** The part of a Worker the runtime uses. Injectable so the queue/timeout/rebuild logic is testable in Node. */
export interface RuntimeWorkerLike {
  postMessage(message: RuntimeRequest): void;
  terminate(): void;
  onMessage(cb: (message: RuntimeMessage) => void): void;
  onError(cb: (message: string) => void): void;
}

export interface RuntimeOptions {
  /** Hard limit for one REPL evaluation, in ms. Default 3000. */
  callBudgetMs?: number;
  workerFactory?: () => RuntimeWorkerLike;
}

/** A committed function as the runtime records it. `budgetMs` (the spec's) caps each REPL-level call. */
export type RuntimeFunction = string | { js: string; budgetMs?: number };

interface FnEntry {
  js: string;
  budgetMs?: number;
}

interface Live {
  port: RuntimeWorkerLike;
}

type Reply = { result: unknown; env?: Record<string, Json> };
type RequestBody = RuntimeRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

const DEFAULT_BUDGET_MS = 3000;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function defaultWorkerFactory(): RuntimeWorkerLike {
  const w = new Worker(new URL('./runtimeWorker.ts', import.meta.url), { type: 'module' });
  return {
    postMessage: (m) => w.postMessage(m),
    terminate: () => w.terminate(),
    onMessage: (cb) => {
      w.onmessage = (ev: MessageEvent) => cb(ev.data as RuntimeMessage);
    },
    onError: (cb) => {
      w.onerror = (ev: ErrorEvent) => {
        ev.preventDefault();
        cb(ev.message || 'uncaught error in runtime worker');
      };
      w.onmessageerror = () => cb('a message from the runtime worker could not be deserialised');
    },
  };
}

export class Runtime {
  private readonly callBudgetMs: number;
  private readonly factory: () => RuntimeWorkerLike;
  private worker: Live | null = null;
  private readonly pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private functions = new Map<string, FnEntry>();
  private env: Record<string, Json> = {};
  private tail: Promise<unknown> = Promise.resolve();
  private disposed = false;
  /** Set while an evaluate is in flight: receives the worker's enter/leave events. */
  private watcher: { enter(fn: string, call: string): void; leave(fn: string): void } | null = null;

  constructor(opts: RuntimeOptions = {}) {
    this.callBudgetMs = opts.callBudgetMs ?? DEFAULT_BUDGET_MS;
    this.factory = opts.workerFactory ?? defaultWorkerFactory;
  }

  /** Hot-swap: (re)define a committed function in the live worker. No restart, env untouched. */
  define(name: string, js: string, budgetMs?: number): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureWorker();
      await this.request({ type: 'define', name, js });
      this.functions.set(name, budgetMs === undefined ? { js } : { js, budgetMs });
    });
  }

  undefine(name: string): Promise<void> {
    return this.enqueue(async () => {
      this.functions.delete(name);
      if (this.worker) await this.request({ type: 'undefine', name });
    });
  }

  evaluate(input: string): Promise<EvalOutcome> {
    return this.enqueue(async () => {
      await this.ensureWorker();
      const outcome = await this.evaluateWithWatchdog(input);
      if (outcome.kind === 'timeout') await this.ensureWorker().catch(() => undefined); // rebuild eagerly
      return outcome;
    });
  }

  /** Encoded env (encodeValue per var). */
  snapshotEnv(): Promise<Record<string, Json>> {
    return this.enqueue(async () => {
      if (!this.worker) return { ...this.env };
      this.env = (await this.request({ type: 'snapshot' })).result as Record<string, Json>;
      return { ...this.env };
    });
  }

  /** Shown values for the UI. */
  envShown(): Promise<Record<string, string>> {
    return this.enqueue(async () => {
      await this.ensureWorker();
      return (await this.request({ type: 'envShown' })).result as Record<string, string>;
    });
  }

  /** Replace functions + env wholesale (rollback / import / reload) in a fresh worker. */
  reset(functions: Record<string, RuntimeFunction>, env: Record<string, Json>): Promise<void> {
    return this.enqueue(async () => {
      const previous = { functions: this.functions, env: this.env };
      this.kill(new Error('runtime reset'));
      this.functions = new Map(
        Object.entries(functions).map(([name, f]): [string, FnEntry] => [name, typeof f === 'string' ? { js: f } : { ...f }]),
      );
      this.env = env;
      try {
        await this.ensureWorker();
      } catch (e) {
        this.kill(e instanceof Error ? e : new Error(String(e)));
        this.functions = previous.functions;
        this.env = previous.env;
        throw e;
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.kill(new Error('runtime disposed'));
  }

  // ───────────────────────── internals ─────────────────────────

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => {
      if (this.disposed) throw new Error('runtime disposed');
      return op();
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async ensureWorker(): Promise<void> {
    if (this.worker) return;
    const live: Live = { port: this.factory() };
    live.port.onMessage((m) => {
      if (this.worker === live) this.handle(m);
    });
    live.port.onError((message) => {
      if (this.worker === live) this.kill(new Error(`runtime worker crashed: ${message}`));
    });
    this.worker = live;
    const functions: Record<string, string> = {};
    for (const [name, f] of this.functions) functions[name] = f.js;
    await this.request({ type: 'reset', functions, env: this.env });
  }

  private handle(m: RuntimeMessage): void {
    if (m.type === 'enter') return this.watcher?.enter(m.fn, m.call);
    if (m.type === 'leave') return this.watcher?.leave(m.fn);
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.ok) p.resolve({ result: m.result, ...(m.env ? { env: m.env } : {}) });
    else p.reject(new Error(m.error));
  }

  /** Terminate the current worker (if any) and fail everything waiting on it. */
  private kill(reason: Error): void {
    const w = this.worker;
    this.worker = null;
    this.watcher = null;
    if (w) {
      try {
        w.port.terminate();
      } catch {
        /* already gone */
      }
    }
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
  }

  private request(body: RequestBody): Promise<Reply> {
    const w = this.worker;
    if (!w) return Promise.reject(new Error('runtime worker is not running'));
    const id = this.nextId++;
    return new Promise<Reply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        w.port.postMessage({ ...body, id } as RuntimeRequest);
      } catch (e) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private evaluateWithWatchdog(input: string): Promise<EvalOutcome> {
    const start = now();
    return new Promise<EvalOutcome>((resolve) => {
      let settled = false;
      let inFlight: { fn: string; call: string } | undefined;
      let callTimer: ReturnType<typeof setTimeout> | undefined;
      const settle = (o: EvalOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(overall);
        clearTimeout(callTimer);
        this.watcher = null;
        resolve(o);
      };
      const timeout = (): void => {
        if (settled) return;
        const outcome: EvalOutcome = { kind: 'timeout', ms: Math.round(now() - start) };
        if (inFlight) Object.assign(outcome, inFlight);
        settle(outcome);
        this.kill(new Error('evaluation timed out'));
      };
      const overall = setTimeout(timeout, this.callBudgetMs);
      this.watcher = {
        enter: (fn, call) => {
          inFlight = { fn, call };
          const budget = this.functions.get(fn)?.budgetMs;
          clearTimeout(callTimer);
          if (budget !== undefined) callTimer = setTimeout(timeout, budget);
        },
        leave: () => {
          inFlight = undefined;
          clearTimeout(callTimer);
        },
      };
      this.request({ type: 'evaluate', input }).then(
        ({ result, env }) => {
          if (env) this.env = env;
          settle(result as EvalOutcome);
        },
        (e: Error) => settle({ kind: 'error', errorName: 'Error', message: e.message }),
      );
    });
  }
}
