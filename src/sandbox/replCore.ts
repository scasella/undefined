/**
 * Environment-agnostic core of the live-program runtime (runs inside the runtime worker; unit-tested in Node).
 *
 * It owns the committed functions (each a masked function from mask.ts behind a recording wrapper), the REPL
 * variable store, and `evaluate(input)`. Name lookup in a REPL line goes through a Proxy `with` scope:
 *   committed function → REPL variable → standard global (minus the masked names) → undefined-name thunk.
 * The thunk is a callable Proxy. Calling it throws an internal UndefinedCallSignal *after* JS has evaluated the
 * arguments, which is how a call to a never-written function becomes `{kind:'undefined-call'}` with real argument
 * values. Any other use of the thunk is a ReferenceError, like JS itself.
 *
 * Known limitations (honest, not hidden):
 * - Growth re-evaluates the ORIGINAL input. Side effects that ran before the undefined call (e.g. `(n = n + 1,
 *   median(xs))`) therefore run twice: once before the call was found undefined, once on re-evaluation.
 * - `typeof someUndefinedName` is 'function': `typeof` on a Proxy fires no trap. `typeof x.y` does throw.
 * - REPL lines are expressions or a single binding statement (`x = …`, `const|let|var x = …`). Destructuring
 *   bindings and multi-statement lines are not supported (they end up as SyntaxError).
 * - Masked globals other than Math/Date (fetch, setTimeout, globalThis, …) and `eval`/`Function` are hidden from the
 *   REPL; calling one is reported as an undefined call of that name. The REPL line itself runs in strict mode with
 *   `this === undefined`, but code that obtains a constructor through a value (`(()=>0).constructor('return this')`)
 *   can still reach the real global object; the worker scrubs network/storage APIs for that reason (mask.ts).
 * - An undefined name anywhere inside a value (`median([1, foo])`, `x = {a: foo}`) is a plain ReferenceError; it never
 *   reaches a committed function. A REPL variable holding a committed function (`g = median`) stops working (as a
 *   ReferenceError) once that function is undefined or redefined.
 * - Committed functions cannot see each other (each is compiled alone); recursion uses the inner declaration name,
 *   so only REPL-level calls go through the wrapper (and produce enter/leave events).
 * - An undefined function passed to an Array method (`[1, 2, 3].map(double)`) is first called with (value, index,
 *   array). When the arguments have exactly that shape and the line does not call the name directly, only the value
 *   is kept for the inferred spec (`argsTrimmed: 'array-callback'`); the grown function ignores the extra arguments.
 * - A function passed directly as an argument (`compose(x => x + 1, f)`) is typed `(...args: any[]) => any` and
 *   passed through; it cannot be serialised, so the gates cannot replay that call.
 *
 * Datasets (docs/DESIGN.md "Datasets, tables and pins"):
 * - bindDataset(name, hash, rows, typeName) binds a REPL variable to an array of rows and registers it. Identity is
 *   what counts: a variable (or a call argument) that IS (===) a registered array is that dataset; an equal copy is
 *   not. snapshotEnv() writes such a variable as the ref `{"$t":"dataset","name","hash","typeName"}` (rows are stored
 *   once, outside the env); restoreEnv/reset resolve refs from a `hash → rows` map and drop (report as lost) the ones
 *   they cannot resolve. Reassigning the dataset's own variable to another value (`rows = rows.slice(0, 5)`)
 *   unregisters the dataset; an alias made earlier (`all = rows`) then encodes as an ordinary value.
 * - Rows are READ-ONLY: bindDataset and restoreEnv deep-freeze them, so the rows a variable holds are always the rows
 *   stored under its hash (pins, env snapshots and rebuilt workers agree). A REPL line that tries to change them gets
 *   "rows is a dataset and is read-only; make a copy first …" instead of a bare TypeError; a committed function that
 *   tries to faults with the purity message "candidate mutated its argument".
 */
import type { CallRecord, EvalOutcome, Hash, Json, PinArg, TablePreview } from '../types';
import { deepFreeze, evalMasked, isInvariantViolation, isReadOnlyWriteError, MASKED_NAMES, takeViolations, violationMessage } from './mask';
import { callString, isMap, isPlainObject, isSet, show } from '../shared/show';
import { decodeEnv, encodeEnv, encodeReport, encodeValue } from '../shared/serialize';
import { inferArgType } from '../shared/inferType';

/** Masked for candidates, but harmless and necessary for ordinary REPL arithmetic. */
const REPL_ALLOWED = new Set(['Math', 'Date']);
const HIDDEN_GLOBALS = new Set([...MASKED_NAMES.filter((n) => !REPL_ALLOWED.has(n)), 'eval', 'Function']);

const BIND_DECL = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/;
const BIND_ASSIGN = /^\s*([A-Za-z_$][\w$]*)\s*=(?![=>])\s*([\s\S]+)$/;

class UndefinedCallSignal {
  constructor(
    readonly name: string,
    readonly args: unknown[],
  ) {}
}

/** An error thrown inside a committed function, tagged once by the innermost wrapper. */
class CommittedFault {
  constructor(
    readonly fn: string,
    readonly call: string,
    readonly error: unknown,
  ) {}
}

class ReplError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

export interface ReplHooks {
  /** A committed function is about to be called from the REPL line. */
  onEnter?(fn: string, call: string): void;
  onLeave?(fn: string): void;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Encoded values (an evaluation's `encoded`, a call record's result or argument) larger than this are left out. */
export const MAX_ENCODED_BYTES = 256 * 1024;
/** At most this many call records per evaluation (the rest are not recorded, so they cannot be pinned). */
export const MAX_CALL_RECORDS = 100;
/** Table preview limits. */
export const TABLE_MAX_ROWS = 100;
export const TABLE_MAX_COLUMNS = 30;
export const TABLE_MAX_CELL = 80;

/** A dataset bound to a REPL variable, as the core knows it. */
export interface DatasetBinding {
  name: string;
  hash: Hash;
  typeName: string;
}

/** The env-snapshot form of a variable that IS a registered dataset. */
export interface DatasetRefJson {
  $t: 'dataset';
  name: string;
  hash: Hash;
  typeName: string;
}

export function isDatasetRefJson(j: Json | undefined): j is Json & DatasetRefJson {
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return false;
  return j.$t === 'dataset' && typeof j.name === 'string' && typeof j.hash === 'string' && typeof j.typeName === 'string';
}

export class ReplCore {
  private readonly functions = new Map<string, (...args: unknown[]) => unknown>();
  private env = new Map<string, unknown>();
  private readonly thunks = new WeakSet<object>();
  private calls: string[] = [];
  private records: CallRecord[] = [];
  /** Nesting depth of committed calls: only depth-0 calls are made "directly from the line". */
  private depth = 0;
  private bindings = new Map<string, DatasetBinding & { value: unknown[] }>();
  private readonly scope: object;

  constructor(private readonly hooks: ReplHooks = {}) {
    this.scope = this.makeScope();
  }

  /** (Re)define a committed function from strict-mode JS declaring `function <name>`. Hot swap: env is untouched. */
  define(name: string, js: string): void {
    const fn = evalMasked<(...args: unknown[]) => unknown>(js, name);
    if (typeof fn !== 'function') throw new TypeError(`${name} is not a function after evaluating its code`);
    this.functions.set(name, this.wrap(name, fn));
  }

  undefine(name: string): void {
    this.functions.delete(name);
  }

  functionNames(): string[] {
    return [...this.functions.keys()];
  }

  /**
   * Bind REPL variable `name` to `rows` and register it as a dataset (see the header). Rows are bound as given (the
   * same array object, not a copy) and deep-frozen: a dataset is read-only. Throws when `name` is a committed function.
   */
  bindDataset(name: string, hash: Hash, rows: unknown[], typeName: string): void {
    if (!Array.isArray(rows)) throw new TypeError(`dataset ${name}: rows must be an array`);
    if (this.functions.has(name)) throw new ReplError('TypeError', `${name} is a committed function; pick another variable name`);
    deepFreeze(rows);
    this.assign(name, rows);
    this.bindings.set(name, { name, hash, typeName, value: rows });
  }

  /** Forget dataset `name` and delete its variable if it still holds the rows. */
  unbindDataset(name: string): void {
    const b = this.bindings.get(name);
    this.bindings.delete(name);
    if (b && this.env.get(name) === b.value) this.env.delete(name);
  }

  /** The registered datasets, in binding order. */
  datasets(): DatasetBinding[] {
    return [...this.bindings.values()].map(({ name, hash, typeName }) => ({ name, hash, typeName }));
  }

  /** The registered dataset whose rows ARE `v` (identity), or null. */
  private datasetOf(v: unknown): (DatasetBinding & { value: unknown[] }) | null {
    if (!Array.isArray(v)) return null;
    const own = [...this.bindings.values()];
    return own.find((b) => b.value === v) ?? null;
  }

  /** Encoded env (encodeValue per var); a variable that IS a registered dataset becomes a dataset ref. */
  snapshotEnv(): Record<string, Json> {
    const plain: Record<string, unknown> = {};
    const refs = new Map<string, Json>();
    for (const [k, v] of this.env) {
      const b = this.datasetOf(v);
      if (b) refs.set(k, { $t: 'dataset', name: b.name, hash: b.hash, typeName: b.typeName });
      else Object.defineProperty(plain, k, { value: v, enumerable: true, writable: true, configurable: true });
    }
    const encoded = encodeEnv(plain).env;
    const out: Record<string, Json> = {};
    for (const k of this.env.keys()) {
      const value = refs.has(k) ? refs.get(k)! : encoded[k]!;
      Object.defineProperty(out, k, { value, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }

  /**
   * Replace the env (and the dataset registry) from an encoded snapshot. A variable whose encoding holds an
   * `unserializable` placeholder (at any depth: a function, class instance, cycle…) is NOT bound to a lossy copy; it
   * is dropped and its name returned. A dataset ref is resolved from `datasets` (hash → rows): every variable with
   * that hash is bound to the SAME array object and the dataset is registered again; a ref whose hash is missing is
   * dropped and reported the same way.
   */
  restoreEnv(env: Record<string, Json>, datasets: Record<Hash, unknown[]> = {}): string[] {
    const rest: Record<string, Json> = {};
    for (const k of Object.keys(env)) {
      if (!isDatasetRefJson(env[k])) Object.defineProperty(rest, k, { value: env[k], enumerable: true, writable: true, configurable: true });
    }
    const { env: decoded, unserializable } = decodeEnv(rest);
    const bad = new Set(unserializable);
    const lost: string[] = [];
    const next = new Map<string, unknown>();
    const bindings = new Map<string, DatasetBinding & { value: unknown[] }>();
    for (const k of Object.keys(env)) {
      const j = env[k];
      if (isDatasetRefJson(j)) {
        const rows = Object.prototype.hasOwnProperty.call(datasets, j.hash) ? datasets[j.hash] : undefined;
        if (!Array.isArray(rows)) {
          lost.push(k);
          continue;
        }
        deepFreeze(rows);
        next.set(k, rows);
        if (!bindings.has(j.name) || k === j.name) bindings.set(j.name, { name: j.name, hash: j.hash, typeName: j.typeName, value: rows });
      } else if (bad.has(k)) {
        lost.push(k);
      } else {
        next.set(k, decoded[k]);
      }
    }
    this.env = next;
    this.bindings = bindings;
    return lost;
  }

  envShown(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.env) {
      Object.defineProperty(out, k, { value: show(v), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }

  /** Replace functions and env wholesale. Returns the variables that could not be restored (see restoreEnv). */
  reset(functions: Record<string, string>, env: Record<string, Json>, datasets?: Record<Hash, unknown[]>): string[] {
    this.functions.clear();
    for (const [name, js] of Object.entries(functions)) this.define(name, js);
    return this.restoreEnv(env, datasets);
  }

  evaluate(input: string): EvalOutcome {
    this.calls = [];
    this.records = [];
    this.depth = 0;
    takeViolations();
    const start = now();
    const src = input.trim().replace(/;+\s*$/, '');
    try {
      if (src === '') return { kind: 'value', shown: 'undefined', ms: 0, calls: [] };
      const bind = BIND_DECL.exec(src) ?? BIND_ASSIGN.exec(src);
      const value = this.run(bind ? bind[2]! : src);
      this.rejectThunk(value);
      if (bind) this.assign(bind[1]!, value);
      const ms = now() - start;
      const out: EvalOutcome = { kind: 'value', shown: show(value), ms, calls: [...this.calls] };
      const encoded = encodeCapped(value);
      if (encoded.ok) out.encoded = encoded.json;
      const table = tablePreview(value);
      if (table) out.table = table;
      if (this.records.length > 0) out.callRecords = [...this.records];
      return out;
    } catch (e) {
      return this.outcomeFor(e, src);
    } finally {
      takeViolations();
    }
  }

  private run(expr: string): unknown {
    // The outer function is sloppy so `with` is legal; the inner one is strict so `this` is undefined everywhere in
    // the user's expression (a sloppy function would see the real global object as `this`).
    let fn: (scope: object) => unknown;
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function(
        '__scope',
        `with (__scope) { return (function () { "use strict"; return (${expr}\n); }).call(undefined); }`,
      ) as (scope: object) => unknown;
    } catch (e) {
      if (e instanceof SyntaxError) throw new ReplError('SyntaxError', syntaxErrorMessage(expr, e));
      throw e;
    }
    return fn(this.scope);
  }

  private assign(name: string, value: unknown): void {
    if (this.functions.has(name)) throw new ReplError('TypeError', `${name} is a committed function; pick another variable name`);
    this.rejectThunk(value);
    this.env.set(name, value);
    // the dataset's own variable now holds something else: it is no longer a dataset
    const b = this.bindings.get(name);
    if (b && b.value !== value) this.bindings.delete(name);
  }

  private deleteVariable(name: string): void {
    this.env.delete(name);
    this.bindings.delete(name);
  }

  /** A committed call's argument as a pin argument: a dataset by reference, anything else encoded. */
  private pinArg(a: unknown): { arg: PinArg; pinnable: boolean } {
    const b = this.datasetOf(a);
    if (b) return { arg: { kind: 'dataset', name: b.name, hash: b.hash }, pinnable: true };
    const e = encodeCapped(a);
    // an oversized argument is not carried (the record could never be pinned anyway)
    return { arg: { kind: 'value', encoded: e.ok ? e.json : null }, pinnable: e.ok && !e.lossy };
  }

  /** Throws the plain ReferenceError if an undefined-name thunk occurs anywhere inside `v`. */
  private rejectThunk(v: unknown): void {
    const t = this.findThunk(v);
    if (t !== null) throw new ReplError('ReferenceError', `${thunkName(t)} is not defined`);
  }

  /**
   * The first undefined-name thunk at any depth of `v` (arrays, plain objects, Map keys/values, Set elements), or null.
   * Never descends into functions (any operation on a thunk but calling it throws) and never invokes getters. Bounded
   * by a cycle guard, a depth cap and a node cap; a value that throws while being inspected counts as thunk-free.
   */
  private findThunk(v: unknown): object | null {
    const seen = new Set<object>();
    let budget = THUNK_SCAN_NODES;
    const walk = (x: unknown, depth: number): object | null => {
      if (typeof x === 'function') return this.thunks.has(x) ? x : null;
      if (typeof x !== 'object' || x === null || depth > THUNK_SCAN_DEPTH || seen.has(x) || --budget < 0) return null;
      seen.add(x);
      if (Array.isArray(x)) {
        for (let i = 0; i < x.length; i++) {
          if (--budget < 0) return null;
          const d = Object.getOwnPropertyDescriptor(x, i);
          const r = d && 'value' in d ? walk(d.value, depth + 1) : null;
          if (r) return r;
        }
        return null;
      }
      if (isMap(x)) {
        for (const [k, val] of Map.prototype.entries.call(x) as IterableIterator<[unknown, unknown]>) {
          if (--budget < 0) return null;
          const r = walk(k, depth + 1) ?? walk(val, depth + 1);
          if (r) return r;
        }
        return null;
      }
      if (isSet(x)) {
        for (const el of Set.prototype.values.call(x) as IterableIterator<unknown>) {
          if (--budget < 0) return null;
          const r = walk(el, depth + 1);
          if (r) return r;
        }
        return null;
      }
      if (!isPlainObject(x)) return null;
      for (const k of Object.keys(x)) {
        if (--budget < 0) return null;
        const d = Object.getOwnPropertyDescriptor(x, k);
        const r = d && 'value' in d ? walk(d.value, depth + 1) : null;
        if (r) return r;
      }
      return null;
    };
    try {
      return walk(v, 0);
    } catch {
      return null;
    }
  }

  private makeScope(): object {
    const target = Object.create(null) as object;
    return new Proxy(target, {
      has: (_t, key) => key !== '__scope',
      get: (_t, key) => {
        if (typeof key === 'symbol') return undefined; // includes Symbol.unscopables
        const fn = this.functions.get(key);
        if (fn) return fn;
        if (this.env.has(key)) return this.env.get(key);
        if (!HIDDEN_GLOBALS.has(key) && key in globalThis && !(key in Object.prototype)) return (globalThis as Record<string, unknown>)[key];
        return this.thunk(key);
      },
      set: (_t, key, value) => {
        if (typeof key === 'symbol') return false;
        this.assign(key, value);
        return true;
      },
      deleteProperty: (_t, key) => {
        if (typeof key !== 'string') return false;
        this.deleteVariable(key);
        return true;
      },
    });
  }

  private thunk(name: string): unknown {
    const notDefined = (): never => {
      throw new ReplError('ReferenceError', `${name} is not defined`);
    };
    const p = new Proxy(function () {}, {
      apply: (_t, _this, args: unknown[]) => {
        throw new UndefinedCallSignal(name, args);
      },
      get: notDefined,
      set: notDefined,
      has: notDefined,
      construct: notDefined,
      deleteProperty: notDefined,
      defineProperty: notDefined,
      ownKeys: notDefined,
      getOwnPropertyDescriptor: notDefined,
      getPrototypeOf: notDefined,
    });
    thunkNames.set(p, name);
    this.thunks.add(p);
    return p;
  }

  private wrap(name: string, fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
    const core = this;
    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      // A REPL alias (`g = median`) outlives its definition: after undefine/redefine it must not run the old code.
      if (core.functions.get(name) !== wrapper) throw new ReplError('ReferenceError', `${name} is not defined`);
      core.rejectThunk(args); // an undefined name anywhere in the arguments is the REPL line's error, not a fault
      const call = callString(name, args);
      core.calls.push(name);
      // A call made directly from the REPL line (not from inside another committed call) is recorded for "Pin as
      // test"; its arguments are captured BEFORE the call.
      const direct = core.depth === 0 && core.records.length < MAX_CALL_RECORDS;
      const pinArgs = direct ? args.map((a) => core.pinArg(a)) : null;
      takeViolations();
      core.hooks.onEnter?.(name, call);
      core.depth++;
      let result: unknown;
      try {
        result = fn.apply(undefined, args);
        const violations = takeViolations();
        if (violations.length > 0) {
          throw new CommittedFault(name, call, new ReplError('InvariantViolation', violationMessage(violations[0]!)));
        }
      } catch (e) {
        if (e instanceof CommittedFault) throw e; // tag only once: the innermost wrapper wins
        // A write to a frozen argument (a dataset's rows, or a value the caller froze) is a purity fault, not a bug
        // report about Array.prototype.push.
        if (isReadOnlyWriteError(e) && args.some(isFrozenObject)) {
          throw new CommittedFault(name, call, new ReplError('InvariantViolation', `candidate mutated its argument (${(e as Error).message})`));
        }
        throw new CommittedFault(name, call, e);
      } finally {
        core.depth--;
        core.hooks.onLeave?.(name);
      }
      if (pinArgs && core.records.length < MAX_CALL_RECORDS) {
        const r = encodeCapped(result);
        const pinnable = r.ok && !r.lossy && pinArgs.every((p) => p.pinnable);
        core.records.push({ fn: name, call, args: pinArgs.map((p) => p.arg), result: pinnable && r.ok ? r.json : null });
      }
      return result;
    };
    return wrapper;
  }

  private outcomeFor(e: unknown, src = ''): EvalOutcome {
    if (e instanceof UndefinedCallSignal) {
      const thunk = this.findThunk(e.args);
      if (thunk !== null) return { kind: 'error', errorName: 'ReferenceError', message: `${thunkName(thunk)} is not defined` };
      const trimmed = isArrayCallbackCall(e.name, e.args, src);
      const args = trimmed ? e.args.slice(0, 1) : e.args;
      const argTypes: string[] = [];
      const argDatasets: Array<string | null> = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const b = this.datasetOf(a);
        argDatasets.push(b ? b.name : null);
        if (b) {
          argTypes.push(`${b.typeName}[]`);
          continue;
        }
        try {
          argTypes.push(inferArgType(a));
        } catch (err) {
          return { kind: 'error', errorName: 'TypeError', message: `cannot infer a type for argument ${i + 1}: ${messageOf(err)}` };
        }
      }
      const out: EvalOutcome = {
        kind: 'undefined-call',
        name: e.name,
        argTypes,
        argShown: args.map(show),
        // a function argument encodes as the `unserializable` placeholder: the engine then omits the replay
        args: args.map(encodeValue),
        call: callString(e.name, args),
      };
      if (trimmed) out.argsTrimmed = 'array-callback';
      if (argDatasets.some((d) => d !== null)) out.argDatasets = argDatasets;
      return out;
    }
    if (e instanceof CommittedFault) {
      const err = e.error;
      const out: EvalOutcome = { kind: 'fault', fn: e.fn, call: e.call, errorName: nameOf(err), message: messageOf(err) };
      if (err instanceof Error && typeof err.stack === 'string') out.stack = err.stack;
      if (isInvariantViolation(err)) out.errorName = 'InvariantViolation';
      return out;
    }
    if (isReadOnlyWriteError(e)) {
      const ds = this.datasetNamed(src);
      if (ds) {
        return {
          kind: 'error',
          errorName: 'TypeError',
          message: `${ds} is a dataset and is read-only; make a copy first, e.g. ${ds}.slice().sort(...) or ${ds} = ${ds}.filter(...)`,
        };
      }
    }
    return { kind: 'error', errorName: nameOf(e), message: messageOf(e) };
  }

  /**
   * The variable the line most likely tried to change, when it holds (or is part of) a registered dataset: the first
   * variable named in `src` whose value is a dataset's rows, else the first registered dataset. null when there are
   * no datasets.
   */
  private datasetNamed(src: string): string | null {
    if (this.bindings.size === 0) return null;
    const idents = new Set(src.match(/[A-Za-z_$][\w$]*/g) ?? []);
    for (const [k, v] of this.env) if (idents.has(k) && this.datasetOf(v)) return k;
    return [...this.bindings.keys()][0] ?? null;
  }
}

function isFrozenObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && Object.isFrozen(v);
}

/**
 * True when `args` is exactly what Array.prototype.map/filter/forEach/find/some/every/flatMap pass a callback —
 * (value, index, array) with `array[index]` being `value` — AND the line never calls `name` directly (a direct call
 * with three such arguments is the user's choice, not a callback).
 */
export function isArrayCallbackCall(name: string, args: unknown[], src: string): boolean {
  if (args.length !== 3) return false;
  const [x, i, arr] = args;
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || !Array.isArray(arr) || i >= arr.length) return false;
  let atI: unknown;
  try {
    const d = Object.getOwnPropertyDescriptor(arr, i);
    if (!d || !('value' in d)) return false;
    atI = d.value;
  } catch {
    return false;
  }
  if (!Object.is(atI, x)) return false;
  const escaped = name.replace(/[$]/g, '\\$');
  return !new RegExp(`(?<![\\w$.])${escaped}\\s*(?:\\?\\.\\s*)?\\(`).test(src);
}

/**
 * What a REPL line's SyntaxError should say. The harness wraps the line in `return (<line>\n)`, so V8's message for
 * the wrapped text can point at a token the user never typed (`median([1, 2` → "Unexpected token ')'"). The bare line
 * is re-parsed (never run) to get the real problem; if it parses as statements, it is not one expression.
 */
export function syntaxErrorMessage(expr: string, wrapped: SyntaxError): string {
  const open = unclosed(expr);
  if (open) return `unexpected end of input: ${open}`;
  let bare: unknown = null;
  try {
    // parse only (the function is never called); `new Function` adds its own closing brace after the body
    // eslint-disable-next-line no-new-func
    new Function(`"use strict";\n${expr}\n`);
  } catch (e) {
    bare = e;
  }
  if (bare === null) {
    return 'a REPL line must be one expression or one binding (x = …); this parses only as statements';
  }
  const msg = bare instanceof SyntaxError ? bare.message : wrapped.message;
  // a token the user never typed can only come from a wrapper: the line ended too early (`1 +`)
  const token = /^Unexpected token '([)}\]])'$/.exec(msg)?.[1];
  if ((token && !expr.includes(token)) || /end of input/i.test(msg)) return 'unexpected end of input';
  return msg.replace(/^./, (c) => c.toLowerCase());
}

/** The innermost bracket or quote left open at the end of `src` (simple scan: strings, templates, comments). */
function unclosed(src: string): string | null {
  const stack: string[] = [];
  const close: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  for (let k = 0; k < src.length; k++) {
    const c = src[k]!;
    if (c === '"' || c === "'" || c === '`') {
      let j = k + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) return `the string starting with ${c} is not closed`;
      k = j;
    } else if (c === '/' && src[k + 1] === '/') {
      const nl = src.indexOf('\n', k);
      if (nl < 0) break;
      k = nl;
    } else if (c === '/' && src[k + 1] === '*') {
      const end = src.indexOf('*/', k + 2);
      if (end < 0) return 'a /* comment is not closed';
      k = end + 1;
    } else if (c in close) {
      stack.push(c);
    } else if (c === ')' || c === ']' || c === '}') {
      if (!stack.length || close[stack[stack.length - 1]!] !== c) return null; // a stray closer: the parser says it best
      stack.pop();
    }
  }
  const top = stack[stack.length - 1];
  return top ? `a \`${top}\` is never closed (missing \`${close[top]}\`)` : null;
}

// ───────────────────────── encoded values and table previews ─────────────────────────

const utf8 = new TextEncoder();

/** encodeReport, or `ok: false` when the encoded JSON is over MAX_ENCODED_BYTES (UTF-8). */
export function encodeCapped(v: unknown): { ok: true; json: Json; lossy: boolean } | { ok: false } {
  const { json, lossy } = encodeReport(v);
  const text = JSON.stringify(json);
  // cheap reject first: the UTF-8 byte count is never smaller than the UTF-16 length
  if (text.length > MAX_ENCODED_BYTES || utf8.encode(text).length > MAX_ENCODED_BYTES) return { ok: false };
  return { ok: true, json, lossy };
}

/**
 * The table rendering of a non-empty array whose elements are all plain objects (not arrays, Maps, class instances…),
 * else null. Columns: union of own keys over the first TABLE_MAX_ROWS rows in first-seen order, at most
 * TABLE_MAX_COLUMNS. Cells: show() of the value cut to TABLE_MAX_CELL characters; '' for a missing key; getters are
 * never invoked (`[Getter]`). `total` is the full array length.
 */
export function tablePreview(v: unknown): TablePreview | null {
  try {
    if (!Array.isArray(v) || v.length === 0) return null;
    const arr = v as unknown[];
    for (let i = 0; i < arr.length; i++) {
      const d = Object.getOwnPropertyDescriptor(arr, i);
      const x: unknown = d && 'value' in d ? d.value : undefined;
      if (typeof x !== 'object' || x === null || Array.isArray(x) || !isPlainObject(x)) return null;
    }
    const rows = arr.slice(0, TABLE_MAX_ROWS) as object[];
    const columns: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        if (seen.has(k)) continue;
        seen.add(k);
        columns.push(k);
      }
    }
    const shownColumns = columns.slice(0, TABLE_MAX_COLUMNS);
    return {
      columns: shownColumns,
      rows: rows.map((r) =>
        shownColumns.map((c) => {
          const d = Object.getOwnPropertyDescriptor(r, c);
          if (!d) return '';
          return cutCell('value' in d ? show(d.value) : '[Getter]');
        }),
      ),
      total: arr.length,
    };
  } catch {
    return null; // hostile values (revoked proxies…) simply get no table
  }
}

function cutCell(s: string): string {
  if (s.length <= TABLE_MAX_CELL) return s;
  let end = TABLE_MAX_CELL - 1;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return s.slice(0, end) + '…';
}

const THUNK_SCAN_DEPTH = 64;
const THUNK_SCAN_NODES = 100_000;

const thunkNames = new WeakMap<object, string>();
function thunkName(v: object): string {
  return thunkNames.get(v) ?? 'name';
}

function nameOf(e: unknown): string {
  if (e instanceof Error) return typeof e.name === 'string' && e.name ? e.name : 'Error';
  return 'Error';
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return typeof e.message === 'string' ? e.message : '';
  return `uncaught ${show(e)}`;
}

// ───────────────────────── worker protocol (shared by runtimeWorker.ts and in-process fakes) ─────────────────────────

export type RuntimeRequest =
  | { id: number; type: 'define'; name: string; js: string }
  | { id: number; type: 'undefine'; name: string }
  | { id: number; type: 'evaluate'; input: string }
  | { id: number; type: 'snapshot' }
  | { id: number; type: 'envShown' }
  | { id: number; type: 'reset'; functions: Record<string, string>; env: Record<string, Json>; datasets?: Record<Hash, unknown[]> }
  | { id: number; type: 'bindDataset'; name: string; hash: Hash; rows: unknown[]; typeName: string }
  | { id: number; type: 'unbindDataset'; name: string }
  | { id: number; type: 'datasets' };

/**
 * `evaluate`, `bindDataset` and `unbindDataset` replies carry the env snapshot taken right after the change (the main
 * thread's last good env).
 */
export type RuntimeMessage =
  | { type: 'reply'; id: number; ok: true; result: unknown; env?: Record<string, Json> }
  | { type: 'reply'; id: number; ok: false; error: string }
  | { type: 'enter'; fn: string; call: string }
  | { type: 'leave'; fn: string };

/** Create a core whose enter/leave events go to `emit`, and a dispatcher that answers requests via `emit`. */
export function createDispatcher(emit: (m: RuntimeMessage) => void): (req: RuntimeRequest) => void {
  const core = new ReplCore({
    onEnter: (fn, call) => emit({ type: 'enter', fn, call }),
    onLeave: (fn) => emit({ type: 'leave', fn }),
  });
  return (req) => {
    try {
      switch (req.type) {
        case 'define':
          core.define(req.name, req.js);
          return emit({ type: 'reply', id: req.id, ok: true, result: null });
        case 'undefine':
          core.undefine(req.name);
          return emit({ type: 'reply', id: req.id, ok: true, result: null });
        case 'evaluate': {
          const result = core.evaluate(req.input);
          return emit({ type: 'reply', id: req.id, ok: true, result, env: core.snapshotEnv() });
        }
        case 'snapshot':
          return emit({ type: 'reply', id: req.id, ok: true, result: core.snapshotEnv() });
        case 'envShown':
          return emit({ type: 'reply', id: req.id, ok: true, result: core.envShown() });
        case 'reset':
          return emit({ type: 'reply', id: req.id, ok: true, result: { lost: core.reset(req.functions, req.env, req.datasets) } });
        case 'bindDataset':
          core.bindDataset(req.name, req.hash, req.rows, req.typeName);
          return emit({ type: 'reply', id: req.id, ok: true, result: null, env: core.snapshotEnv() });
        case 'unbindDataset':
          core.unbindDataset(req.name);
          return emit({ type: 'reply', id: req.id, ok: true, result: null, env: core.snapshotEnv() });
        case 'datasets':
          return emit({ type: 'reply', id: req.id, ok: true, result: core.datasets() });
      }
    } catch (e) {
      emit({ type: 'reply', id: req.id, ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    }
  };
}
