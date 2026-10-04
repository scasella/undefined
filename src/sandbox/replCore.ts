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
 * - Committed functions cannot see each other (each is compiled alone); recursion uses the inner declaration name,
 *   so only REPL-level calls go through the wrapper (and produce enter/leave events).
 */
import type { EvalOutcome, Json } from '../types';
import { evalMasked, isInvariantViolation, MASKED_NAMES, takeViolations } from './mask';
import { callString, show } from '../shared/show';
import { decodeEnv, encodeEnv } from '../shared/serialize';
import { inferType } from '../shared/inferType';

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

  restoreEnv(env: Record<string, Json>): void {
    this.env = new Map(Object.entries(decodeEnv(env).env));
  }

  envShown(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.env) {
      Object.defineProperty(out, k, { value: show(v), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }

  /** Replace functions and env wholesale. */
  reset(functions: Record<string, string>, env: Record<string, Json>): void {
    this.functions.clear();
    for (const [name, js] of Object.entries(functions)) this.define(name, js);
    this.restoreEnv(env);
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
      return this.outcomeFor(e);
    } finally {
      takeViolations();
    }
  }

  private run(expr: string): unknown {
    // The outer function is sloppy so `with` is legal; the inner one is strict so `this` is undefined everywhere in
    // the user's expression (a sloppy function would see the real global object as `this`).
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      '__scope',
      `with (__scope) { return (function () { "use strict"; return (${expr}\n); }).call(undefined); }`,
    ) as (scope: object) => unknown;
    return fn(this.scope);
  }

  private assign(name: string, value: unknown): void {
    if (this.functions.has(name)) throw new ReplError('TypeError', `${name} is a committed function; pick another variable name`);
    this.rejectThunk(value);
    this.env.set(name, value);
  }

  private rejectThunk(v: unknown): void {
    if (typeof v === 'function' && this.thunks.has(v)) throw new ReplError('ReferenceError', `${thunkName(v)} is not defined`);
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
    return function (this: unknown, ...args: unknown[]): unknown {
      for (const a of args) core.rejectThunk(a);
      const call = callString(name, args);
      core.calls.push(name);
      takeViolations();
      core.hooks.onEnter?.(name, call);
      try {
        const result = fn.apply(undefined, args);
        const violations = takeViolations();
        if (violations.length > 0) {
          throw new CommittedFault(name, call, new ReplError('InvariantViolation', `candidate used ${violations[0]}`));
        }
        return result;
      } catch (e) {
        if (e instanceof CommittedFault) throw e; // tag only once: the innermost wrapper wins
        throw new CommittedFault(name, call, e);
      } finally {
        core.hooks.onLeave?.(name);
      }
    };
  }

  private outcomeFor(e: unknown): EvalOutcome {
    if (e instanceof UndefinedCallSignal) {
      const argTypes: string[] = [];
      for (let i = 0; i < e.args.length; i++) {
        const a = e.args[i];
        if (typeof a === 'function' && this.thunks.has(a)) {
          return { kind: 'error', errorName: 'ReferenceError', message: `${thunkName(a)} is not defined` };
        }
        try {
          argTypes.push(inferType(a));
        } catch (err) {
          return { kind: 'error', errorName: 'TypeError', message: `cannot infer a type for argument ${i + 1}: ${messageOf(err)}` };
        }
      }
      return { kind: 'undefined-call', name: e.name, argTypes, argShown: e.args.map(show), call: callString(e.name, e.args) };
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
          core.reset(req.functions, req.env);
          return emit({ type: 'reply', id: req.id, ok: true, result: null });
      }
    } catch (e) {
      emit({ type: 'reply', id: req.id, ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    }
  };
}
