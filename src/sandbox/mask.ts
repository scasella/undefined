/**
 * Purity masking shared by the gate worker and the runtime worker.
 *
 * Candidate code is evaluated with `new Function(<masked names>, '"use strict"; …')`, so every ambient global that
 * could do I/O, read the clock, or reach the real global object is *shadowed by a trap*. Touching a trap records a
 * violation and throws InvariantViolation. This is a real runtime trap, not a string match.
 *
 * Honest limits (also in the README): `(()=>{}).constructor('return this')()` can still reach the real global object
 * from inside a worker. That is why workers additionally call scrubWorkerGlobals() at startup, which removes
 * network/storage APIs from the worker scope for real. The model is not adversarial; these checks exist to catch
 * accidental impurity, and to make the decision visible.
 */

export class InvariantViolation extends Error {
  readonly isInvariantViolation = true;
  constructor(
    public readonly what: string,
    public readonly invariant: 'pure' | 'bounded' = 'pure',
  ) {
    super(`candidate used ${what}`);
    this.name = 'InvariantViolation';
  }
}

export function isInvariantViolation(e: unknown): e is InvariantViolation {
  return typeof e === 'object' && e !== null && (e as { isInvariantViolation?: unknown }).isInvariantViolation === true;
}

const recorded: string[] = [];

/** Violations recorded since the last take. A candidate may `try { fetch() } catch {}`; the record survives that. */
export function takeViolations(): string[] {
  return recorded.splice(0, recorded.length);
}

function fire(what: string): never {
  recorded.push(what);
  throw new InvariantViolation(what);
}

function trap(what: string): unknown {
  const fail = (): never => fire(what);
  return new Proxy(function () {}, {
    get: fail,
    set: fail,
    has: fail,
    apply: fail,
    construct: fail,
    deleteProperty: fail,
    defineProperty: fail,
    getOwnPropertyDescriptor: fail,
    ownKeys: fail,
  });
}

const TRAPPED = [
  // reach to the real global object
  'self', 'globalThis', 'window', 'global', 'top', 'parent', 'frames',
  // network / storage / other contexts
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches',
  'BroadcastChannel', 'Worker', 'SharedWorker', 'MessageChannel', 'navigator', 'location',
  'localStorage', 'sessionStorage', 'document', 'process', 'require', 'postMessage', 'close',
  // ambient nondeterminism / timing / scheduling
  'performance', 'crypto', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'clearTimeout', 'clearInterval',
] as const;

let cached: { names: string[]; values: unknown[] } | null = null;

function build(): { names: string[]; values: unknown[] } {
  if (cached) return cached;
  const RealDate = Date;
  class MaskedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) fire('Date (reads the clock)');
      super(...(args as [number]));
    }
    static override now(): number {
      return fire('Date.now');
    }
  }
  const maskedMath = Object.create(Object.getPrototypeOf(Math), Object.getOwnPropertyDescriptors(Math)) as Math;
  Object.defineProperty(maskedMath, 'random', {
    value: () => fire('Math.random'),
    writable: true,
    configurable: true,
    enumerable: false,
  });
  const names: string[] = [...TRAPPED, 'Date', 'Math'];
  const values: unknown[] = [...TRAPPED.map((n) => trap(n)), MaskedDate, maskedMath];
  cached = { names, values };
  return cached;
}

export const MASKED_NAMES: readonly string[] = [...TRAPPED, 'Date', 'Math'];

/**
 * Evaluate strict-mode `js` (which must declare a function called `exportName`) with all masked names shadowed,
 * and return that function. Recursion works because the declaration name is in scope inside the function.
 */
export function evalMasked<T = (...args: never[]) => unknown>(js: string, exportName: string): T {
  if (!/^[A-Za-z_$][\w$]*$/.test(exportName)) throw new Error(`invalid function name: ${exportName}`);
  const { names, values } = build();
  // eslint-disable-next-line no-new-func
  const factory = new Function(...names, `"use strict";\n${js}\n;return ${exportName};`);
  return factory(...values) as T;
}

/**
 * Call once at worker start, AFTER capturing `postMessage`. Removes network/storage/IPC APIs from the worker scope
 * so they are unavailable even to code that escapes the shadowing above.
 */
export function scrubWorkerGlobals(scope: object): string[] {
  const removed: string[] = [];
  const names = [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches',
    'BroadcastChannel', 'Worker', 'SharedWorker', 'MessageChannel', 'WebTransport', 'RTCPeerConnection',
  ];
  for (const n of names) {
    try {
      if (!(n in scope)) continue;
      Object.defineProperty(scope, n, { value: undefined, writable: false, configurable: false });
      removed.push(n);
    } catch {
      /* non-configurable in this engine: the shadowing above still applies */
    }
  }
  return removed;
}
