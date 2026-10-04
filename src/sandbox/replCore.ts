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
 */
import type { EvalOutcome, Json } from '../types';
import { evalMasked, isInvariantViolation, MASKED_NAMES, takeViolations, violationMessage } from './mask';
import { callString, isMap, isPlainObject, isSet, show } from '../shared/show';
import { decodeEnv, encodeEnv, encodeValue } from '../shared/serialize';
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

export class ReplCore {
  private readonly functions = new Map<string, (...args: unknown[]) => unknown>();
  private env = new Map<string, unknown>();
  private readonly thunks = new WeakSet<object>();
  private calls: string[] = [];
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

  snapshotEnv(): Record<string, Json> {
    return encodeEnv(Object.fromEntries(this.env)).env;
  }

  /**
   * Replace the env from an encoded snapshot. A variable whose encoding holds an `unserializable` placeholder (at any
   * depth: a function, class instance, cycle…) is NOT bound to a lossy copy; it is dropped and its name returned.
   */
  restoreEnv(env: Record<string, Json>): string[] {
    const { env: decoded, unserializable } = decodeEnv(env);
    const lost = new Set(unserializable);
    this.env = new Map(Object.entries(decoded).filter(([k]) => !lost.has(k)));
    return unserializable;
  }

  envShown(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.env) {
      Object.defineProperty(out, k, { value: show(v), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }

  /** Replace functions and env wholesale. Returns the variables that could not be restored (see restoreEnv). */
  reset(functions: Record<string, string>, env: Record<string, Json>): string[] {
    this.functions.clear();
    for (const [name, js] of Object.entries(functions)) this.define(name, js);
    return this.restoreEnv(env);
  }

  evaluate(input: string): EvalOutcome {
    this.calls = [];
    takeViolations();
    const start = now();
    const src = input.trim().replace(/;+\s*$/, '');
    try {
      if (src === '') return { kind: 'value', shown: 'undefined', ms: 0, calls: [] };
      const bind = BIND_DECL.exec(src) ?? BIND_ASSIGN.exec(src);
      const value = this.run(bind ? bind[2]! : src);
      this.rejectThunk(value);
      if (bind) this.assign(bind[1]!, value);
      return { kind: 'value', shown: show(value), ms: now() - start, calls: [...this.calls] };
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
      deleteProperty: (_t, key) => (typeof key === 'string' ? this.env.delete(key) || true : false),
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
      takeViolations();
      core.hooks.onEnter?.(name, call);
      try {
        const result = fn.apply(undefined, args);
        const violations = takeViolations();
        if (violations.length > 0) {
          throw new CommittedFault(name, call, new ReplError('InvariantViolation', violationMessage(violations[0]!)));
        }
        return result;
      } catch (e) {
        if (e instanceof CommittedFault) throw e; // tag only once: the innermost wrapper wins
        throw new CommittedFault(name, call, e);
      } finally {
        core.hooks.onLeave?.(name);
      }
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
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
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
      return out;
    }
    if (e instanceof CommittedFault) {
      const err = e.error;
      const out: EvalOutcome = { kind: 'fault', fn: e.fn, call: e.call, errorName: nameOf(err), message: messageOf(err) };
      if (err instanceof Error && typeof err.stack === 'string') out.stack = err.stack;
      if (isInvariantViolation(err)) out.errorName = 'InvariantViolation';
      return out;
    }
    return { kind: 'error', errorName: nameOf(e), message: messageOf(e) };
  }
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
  | { id: number; type: 'reset'; functions: Record<string, string>; env: Record<string, Json> };

/** `evaluate` replies carry the env snapshot taken right after the evaluation (the main thread's last good env). */
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
          return emit({ type: 'reply', id: req.id, ok: true, result: { lost: core.reset(req.functions, req.env) } });
      }
    } catch (e) {
      emit({ type: 'reply', id: req.id, ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    }
  };
}
