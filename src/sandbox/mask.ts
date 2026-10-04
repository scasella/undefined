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
 *
 * Intrinsic integrity: candidates run in the same realm as the harness, so `Object.is = () => true` or a replaced
 * `Array.prototype.push` would silently corrupt every later check. At module load a table of key intrinsics (their
 * own property descriptors and own-key counts) is snapshotted; takeViolations() verifies it, records e.g.
 * "modified Object.is" / "added property foo to Array.prototype", and RESTORES the originals. In the runtime worker
 * this also means intrinsic edits typed at the REPL itself are reverted at the end of each evaluation.
 */

// Captured before any candidate can run: the integrity sweep must not call anything a candidate could replace.
const gOPD = Object.getOwnPropertyDescriptor;
const defineProp = Object.defineProperty;
const ownKeys = Reflect.ownKeys;
const deleteProp = Reflect.deleteProperty;
const objectIs = Object.is;

export class InvariantViolation extends Error {
  readonly isInvariantViolation = true;
  constructor(
    public readonly what: string,
    public readonly invariant: 'pure' | 'bounded' = 'pure',
  ) {
    super(violationMessage(what));
    this.name = 'InvariantViolation';
  }
}

export function isInvariantViolation(e: unknown): e is InvariantViolation {
  return typeof e === 'object' && e !== null && (e as { isInvariantViolation?: unknown }).isInvariantViolation === true;
}

/** `candidate used fetch`, or `candidate modified Object.is` for an intrinsic-integrity violation. */
export function violationMessage(what: string): string {
  return isIntegrityViolation(what) ? `candidate ${what}` : `candidate used ${what}`;
}

export function isIntegrityViolation(what: string): boolean {
  return what.startsWith('modified ') || what.startsWith('added property ');
}

const recorded: string[] = [];

/** Append without Array.prototype.push (a candidate may have replaced it). */
function append(what: string): void {
  defineProp(recorded, recorded.length, { value: what, writable: true, enumerable: true, configurable: true });
}

/**
 * Violations recorded since the last take. A candidate may `try { fetch() } catch {}`; the record survives that.
 * Also verifies (and restores) the intrinsic table, so call it after every candidate call.
 */
export function takeViolations(): string[] {
  verifyIntrinsics();
  return recorded.splice(0, recorded.length);
}

function fire(what: string): never {
  append(what);
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
  // code from strings (`eval` cannot be shadowed: it is not a legal parameter name in strict mode)
  'Function',
] as const;

interface Masked {
  names: string[];
  values: unknown[];
  /** Shared across every evalMasked in this realm, so part of the integrity table. */
  shared: Array<[string, object]>;
}

let cached: Masked | null = null;

function build(): Masked {
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
    /** Real Date values (made outside the mask, e.g. test arguments) are Dates too. */
    static override [Symbol.hasInstance](v: unknown): boolean {
      return v instanceof RealDate;
    }
  }
  // `Date()` without `new` returns the current time as a string: a clock read, not a TypeError.
  const maskedDateCtor = new Proxy(MaskedDate, { apply: () => fire('Date (reads the clock)') });
  const maskedMath = Object.create(Object.getPrototypeOf(Math), Object.getOwnPropertyDescriptors(Math)) as Math;
  Object.defineProperty(maskedMath, 'random', {
    value: () => fire('Math.random'),
    writable: true,
    configurable: true,
    enumerable: false,
  });
  const names: string[] = [...TRAPPED, 'Date', 'Math'];
  const values: unknown[] = [...TRAPPED.map((n) => trap(n)), maskedDateCtor, maskedMath];
  cached = {
    names,
    values,
    shared: [
      ['Date', MaskedDate],
      ['Date.prototype', MaskedDate.prototype],
      ['Math', maskedMath],
    ],
  };
  return cached;
}

export const MASKED_NAMES: readonly string[] = [...TRAPPED, 'Date', 'Math'];

// ───────────────────────── intrinsic integrity ─────────────────────────

interface Watched {
  label: string;
  obj: object;
  keys: PropertyKey[];
  descs: PropertyDescriptor[];
  /** Also detect added own properties (not for globalThis, whose key set legitimately changes). */
  countKeys: boolean;
}

const watched: Watched[] = [];

function watch(label: string, obj: unknown, only?: readonly string[]): void {
  if ((typeof obj !== 'object' && typeof obj !== 'function') || obj === null) return;
  const keys: PropertyKey[] = [];
  const descs: PropertyDescriptor[] = [];
  for (const k of only ?? ownKeys(obj)) {
    const d = gOPD(obj, k);
    if (!d) continue;
    keys.push(k);
    descs.push(d);
  }
  watched.push({ label, obj, keys, descs, countKeys: only === undefined });
}

function sameDescriptor(a: PropertyDescriptor | undefined, b: PropertyDescriptor): boolean {
  return (
    a !== undefined &&
    objectIs(a.value, b.value) &&
    a.get === b.get &&
    a.set === b.set &&
    a.writable === b.writable &&
    a.enumerable === b.enumerable &&
    a.configurable === b.configurable
  );
}

function keyText(label: string, k: PropertyKey): string {
  if (typeof k !== 'symbol') return label + '.' + String(k);
  let desc = '';
  try {
    desc = String(k.description);
  } catch {
    /* Symbol.prototype tampered with */
  }
  return label + '[' + desc + ']';
}

function snapshotIntrinsics(): void {
  const proto = (f: unknown): unknown => (f as { prototype?: unknown }).prototype;
  const ctors: Array<[string, unknown]> = [
    ['Object', Object], ['Array', Array], ['String', String], ['Number', Number], ['Boolean', Boolean],
    ['BigInt', BigInt], ['Symbol', Symbol], ['Map', Map], ['Set', Set], ['Date', Date], ['RegExp', RegExp],
    ['Promise', Promise], ['Function', Function], ['Error', Error],
  ];
  for (const [name, c] of ctors) {
    watch(name, c);
    watch(`${name}.prototype`, proto(c));
  }
  watch('JSON', JSON);
  watch('Reflect', Reflect);
  watch('Math', Math);
  const arrayIterator = Object.getPrototypeOf([][Symbol.iterator]()) as object;
  watch('ArrayIterator.prototype', arrayIterator);
  watch('Iterator.prototype', Object.getPrototypeOf(arrayIterator));
  for (const [label, obj] of build().shared) watch(label, obj);
  const globals = [...ctors.map(([n]) => n), 'JSON', 'Reflect', 'Math', 'structuredClone'];
  watch('globalThis', globalThis, globals.filter((n) => gOPD(globalThis, n) !== undefined));
}

/** Compare every watched intrinsic with its snapshot; record and restore any difference. Calls nothing replaceable. */
function verifyIntrinsics(): void {
  for (let w = 0; w < watched.length; w++) {
    const { label, obj, keys, descs, countKeys } = watched[w]!;
    for (let i = 0; i < keys.length; i++) {
      const orig = descs[i]!;
      if (sameDescriptor(gOPD(obj, keys[i]!), orig)) continue;
      append('modified ' + keyText(label, keys[i]!));
      try {
        defineProp(obj, keys[i]!, orig);
      } catch {
        /* frozen / non-configurable now: recorded, cannot be undone */
      }
    }
    if (!countKeys) continue;
    const now = ownKeys(obj);
    if (now.length === keys.length) continue;
    for (let j = 0; j < now.length; j++) {
      let known = false;
      for (let i = 0; i < keys.length && !known; i++) known = objectIs(keys[i], now[j]);
      if (known) continue;
      const k = now[j]!;
      append('added property ' + (typeof k === 'symbol' ? keyText('', k).slice(1) : String(k)) + ' to ' + label);
      deleteProp(obj, k);
    }
  }
}

snapshotIntrinsics();

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
    // font loading and notifications reach the network / the user; WebSocketStream is a second WebSocket API
    'FontFace', 'FontFaceSet', 'fonts', 'WebSocketStream', 'Notification',
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
