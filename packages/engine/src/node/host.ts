/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *  THE NODE HOST IS NOT A SECURE SANDBOX.
 *
 *  It executes untrusted code (the function being certified and its tests) in a Node `worker_thread` with a watchdog,
 *  inside a `node:vm` realm whose global object has no Node APIs. `node:vm` is not a security mechanism (Node's own
 *  documentation says so), and a worker thread shares the operating-system process, its memory and its privileges
 *  with the program that started it. What this catches: accidental impurity (clock, randomness, network, globals),
 *  runaway loops and recursion (hard termination by the watchdog), runaway memory (a heap cap). What it does NOT do:
 *  resist code written to escape. Run it only on code you would run anyway, or inside a disposable VM or container.
 *  docs/SECURITY.md ("The Node host") lists what is contained and what is not, as measured by host.test.ts.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Main-thread side. The gate runner, its Watchdog, the nonce protocol, timeoutResults/crashResults and the 25 ms
 * cadence are the engine's (sandbox/gateRunner.ts), unchanged and shared with the browser: this file only supplies a
 * `createWorker` that returns a GateWorkerPort over `node:worker_threads`. One fresh worker per gate run:
 *   - `worker.terminate()` on a watchdog overrun stops even a tight synchronous loop (V8 TerminateExecution);
 *   - `resourceLimits` caps the heap; hitting it is reported as an Invariants `bounded` failure (gateRunner.ts
 *     outOfMemoryResults), i.e. a rejection, and for a mutant 'killed-by-bound';
 *   - the worker gets an empty environment, no argv/execArgv, and piped (discarded) stdout/stderr;
 *   - the run message crosses into the realm as one encoded string (sandbox/vmHarness.ts).
 */
import { Worker } from 'node:worker_threads';
import type { GateResult } from '../types';
import { encodeValue } from '../shared/serialize';
import { runExecutionGates, type ExecGateInput, type GateWorkerPort, type ToWorker } from '../sandbox/gateRunner';
import { setLibSource, type LibSource } from '../gates/compile';
import { harnessSource } from './harnessSource';
import { useNodeLibs } from './libs';

export interface NodeHostOptions {
  /** V8 old-generation heap cap per gate worker, MB. Default 256. */
  heapMb?: number;
  /** Young-generation cap, MB. Default 32. */
  youngMb?: number;
  /**
   * Thread stack, MB. Default 1, close to a Chrome worker's (~1 MB; Node's own default for worker threads is 4). The
   * match is approximate: a very deep recursion can throw RangeError on one host and run on the other (docs/SECURITY.md).
   */
  stackMb?: number;
  /** Prebuilt harness (an IIFE defining `__undefinedHarness`); default: bundled from source on first use. */
  harnessPath?: string;
  /**
   * Where the compile gate reads the TypeScript lib .d.ts files; default: the installed `typescript` package on disk
   * (libs.ts). A bundle that ships without node_modules (the GitHub Action) passes the texts it embedded.
   */
  libs?: LibSource;
}

export const DEFAULT_HEAP_MB = 256;
export const DEFAULT_YOUNG_MB = 32;
export const DEFAULT_STACK_MB = 1;

const WORKER_URL = new URL('./worker.mjs', import.meta.url);

/** What the engine's certify() and mutation check need from a host (certify.ts GateHost). */
export interface NodeGateHost {
  execGates(input: ExecGateInput, onGate?: (r: GateResult) => void): Promise<GateResult[]>;
  /** A fresh worker port (exposed for tests that drive the runner directly). */
  createWorker(): GateWorkerPort;
  now(): number;
  readonly limits: { heapMb: number; youngMb: number; stackMb: number };
}

/** Load the harness and the TypeScript libs once, then hand out workers synchronously (the runner's contract). */
export async function createNodeGateHost(opts: NodeHostOptions = {}): Promise<NodeGateHost> {
  if (opts.libs) setLibSource(opts.libs);
  else useNodeLibs();
  const harness = await harnessSource(opts.harnessPath);
  const limits = { heapMb: opts.heapMb ?? DEFAULT_HEAP_MB, youngMb: opts.youngMb ?? DEFAULT_YOUNG_MB, stackMb: opts.stackMb ?? DEFAULT_STACK_MB };
  const createWorker = (): GateWorkerPort => nodeGateWorker(harness, limits);
  return {
    execGates: (input, onGate) => runExecutionGates(input, onGate, { createWorker }),
    createWorker,
    now: () => Date.now(),
    limits,
  };
}

/**
 * Start worker.mjs with `harness` evaluated in its realm, with the host's isolation settings. Exported so tests can
 * probe the realm with their own harness text under exactly the settings the gates get.
 */
export function spawnRealmWorker(harness: string, limits: { heapMb: number; youngMb: number; stackMb: number }): Worker {
  const w = new Worker(WORKER_URL, {
    workerData: { harness },
    env: {},
    argv: [],
    execArgv: [],
    stdout: true,
    stderr: true,
    name: 'undefined-gate',
    resourceLimits: { maxOldGenerationSizeMb: limits.heapMb, maxYoungGenerationSizeMb: limits.youngMb, stackSizeMb: limits.stackMb },
  });
  // Nothing in the realm can write here (its console is a no-op); drain anyway so a stray write never buffers up.
  w.stdout.resume();
  w.stderr.resume();
  return w;
}

/** One gate worker as a GateWorkerPort. */
export function nodeGateWorker(harness: string, limits: { heapMb: number; youngMb: number; stackMb: number }): GateWorkerPort {
  const w = spawnRealmWorker(harness, limits);
  let stopped = false;
  let failed = false;
  return {
    postMessage(m: ToWorker): void {
      w.postMessage(JSON.stringify(encodeValue(m)));
    },
    terminate(): void {
      stopped = true;
      void w.terminate();
    },
    onMessage(cb): void {
      w.on('message', cb);
    },
    onError(cb): void {
      w.on('error', (e: Error & { code?: string }) => {
        failed = true;
        if (e.code === 'ERR_WORKER_OUT_OF_MEMORY') cb(e.message, { kind: 'out-of-memory', limitMb: limits.heapMb });
        else cb(e.message || 'the gate worker failed');
      });
      // An exit the runner did not ask for (e.g. process.exit reached from inside the worker) is a worker failure.
      w.on('exit', (code) => {
        if (!stopped && !failed) cb(`the gate worker exited unexpectedly (exit code ${code})`);
      });
    },
  };
}
