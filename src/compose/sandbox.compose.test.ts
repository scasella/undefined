/**
 * Composition in the sandbox (docs/COMPOSE-DESIGN.md §A5): masked bindings, the gate executor's linked callees, and the
 * REPL core's late-bound callees.
 */
import { describe, expect, it } from 'vitest';
import { evalMasked } from '../sandbox/mask';
import { executeGates, type ExecGateInput } from '../sandbox/gateExecutor';
import { createDispatcher, ReplCore, type RuntimeMessage } from '../sandbox/replCore';
import { Runtime, type RuntimeWorkerLike } from '../sandbox/runtime';

const SLUGIFY = 'function slugify(t) { return t.toLowerCase().split(" ").join("-"); }';
const ALL = 'function slugifyAll(titles) { return titles.map((t) => slugify(t)); }';

describe('evalMasked with bindings', () => {
  it('binds other functions by name; refuses masked names and itself', () => {
    const slug = evalMasked<(t: string) => string>(SLUGIFY, 'slugify');
    const all = evalMasked<(t: string[]) => string[]>(ALL, 'slugifyAll', { slugify: slug });
    expect(all(['A b', 'C'])).toEqual(['a-b', 'c']);
    expect(() => evalMasked(ALL, 'slugifyAll', { fetch: slug })).toThrow(/masked/);
    expect(() => evalMasked(ALL, 'slugifyAll', { slugifyAll: slug })).toThrow(/itself/);
    // no bindings: still the plain factory (a free name is a ReferenceError when called)
    expect(() => evalMasked<(t: string[]) => string[]>(ALL, 'slugifyAll')(['x'])).toThrow(ReferenceError);
  });
});

const hooks = () => {
  const entered: string[] = [];
  return { entered, h: { phase() {}, enter: (l: string) => void entered.push(l), leave() {} } };
};

const input = (over: Partial<ExecGateInput>): ExecGateInput => ({
  name: 'slugifyAll',
  js: ALL,
  testsJs: 'test("each", () => eq(slugifyAll(["A b"]), ["a-b"]));',
  propertiesJs: '',
  budgetMs: 1000,
  seed: 1,
  deps: [{ name: 'slugify', js: SLUGIFY, deps: [] }],
  ...over,
});

describe('executeGates with linked callees', () => {
  it('runs the candidate through its callees; only candidate calls are instrumented', () => {
    const { entered, h } = hooks();
    const r = executeGates(input({}), h);
    expect(r.map((g) => g.status)).toEqual(['pass', 'skipped', 'pass']);
    expect(entered.every((l) => l.startsWith('slugifyAll('))).toBe(true);
  });

  it('links a closure callees-first: a callee of a callee works', () => {
    const r = executeGates(
      input({
        name: 'report',
        js: 'function report(xs) { return slugifyAll(xs).join(","); }',
        testsJs: 'test("r", () => eq(report(["A b", "C"]), "a-b,c"));',
        deps: [
          { name: 'slugify', js: SLUGIFY, deps: [] },
          { name: 'slugifyAll', js: ALL, deps: ['slugify'] },
        ],
      }),
      hooks().h,
    );
    expect(r[0]!.status).toBe('pass');
  });

  it('a callee that reads randomness rejects the caller, and the diagnostic names both', () => {
    const r = executeGates(
      input({ deps: [{ name: 'slugify', js: 'function slugify(t) { return t + Math.random(); }', deps: [] }], testsJs: 'test("x", () => { slugifyAll(["a"]); });' }),
      hooks().h,
    );
    const inv = r.find((g) => g.gate === 'invariants')!;
    expect(inv.status).toBe('fail');
    expect(inv.diagnostics[0]).toMatchObject({ kind: 'invariant', invariant: 'pure', message: "candidate read global 'Math.random'", detail: 'inside slugify, called by slugifyAll' });
  });

  it('a callee that mutates what the caller passed through makes the caller mutate its argument', () => {
    const r = executeGates(
      input({
        js: 'function slugifyAll(titles) { return slugify(titles); }',
        deps: [{ name: 'slugify', js: 'function slugify(ts) { ts.push("x"); return ts.length; }', deps: [] }],
        testsJs: '',
        callArgs: [['a']],
      }),
      hooks().h,
    );
    expect(r.find((g) => g.gate === 'invariants')!.diagnostics[0]).toMatchObject({ invariant: 'pure', message: 'mutated its argument' });
  });

  it('a non-deterministic callee makes the caller non-deterministic', () => {
    const r = executeGates(
      input({
        js: 'function slugifyAll(titles) { return slugify(titles[0]); }',
        deps: [{ name: 'slugify', js: 'let n = 0;\nfunction slugify(t) { return t + n++; }', deps: [] }],
        testsJs: '',
        callArgs: [['a']],
      }),
      hooks().h,
    );
    expect(r.find((g) => g.gate === 'invariants')!.diagnostics[0]).toMatchObject({ message: 'returned different results for identical input (non-deterministic)' });
  });

  it('a closure that is not callees-first fails to load (never runs half-linked)', () => {
    const r = executeGates(input({ deps: [{ name: 'slugifyAll2', js: ALL.replace('slugifyAll', 'slugifyAll2'), deps: ['slugify'] }] }), hooks().h);
    expect(r[0]).toMatchObject({ status: 'fail', summary: 'candidate failed to load' });
  });

  it('without deps the candidate is evaluated exactly as before (a free callee is a test failure, not a link)', () => {
    const { deps: _d, ...plain } = input({});
    const r = executeGates(plain, hooks().h);
    expect(r[0]!.status).toBe('fail');
    expect(r[0]!.headline).toContain('slugify is not defined');
  });
});

function core(): { core: ReplCore; events: string[] } {
  const events: string[] = [];
  const c = new ReplCore({ onEnter: (fn) => events.push(`enter ${fn}`), onLeave: (fn) => events.push(`leave ${fn}`) });
  return { core: c, events };
}

describe('ReplCore with late-bound callees', () => {
  it('a dependent reaches its callee; only the outer call fires enter/leave, is listed, and can be pinned', () => {
    const { core: c, events } = core();
    c.define('slugify', SLUGIFY);
    c.define('slugifyAll', ALL, ['slugify']);
    const out = c.evaluate('slugifyAll(["A b", "C d"])');
    expect(out).toMatchObject({ kind: 'value', shown: '["a-b", "c-d"]', calls: ['slugifyAll'] });
    expect(events).toEqual(['enter slugifyAll', 'leave slugifyAll']);
    if (out.kind === 'value') expect(out.callRecords!.map((r) => r.fn)).toEqual(['slugifyAll']);
  });

  it('binds late: defined before its callee, and a redefined callee is used from then on', () => {
    const { core: c } = core();
    c.define('slugifyAll', ALL, ['slugify']);
    c.define('slugify', SLUGIFY);
    expect(c.evaluate('slugifyAll(["A b"])')).toMatchObject({ shown: '["a-b"]' });
    c.define('slugify', 'function slugify(t) { return t.toUpperCase(); }');
    expect(c.evaluate('slugifyAll(["A b"])')).toMatchObject({ shown: '["A B"]' });
  });

  it('a callee with no runnable code is an undefined call OF THE CALLEE, with the real arguments and who called it', () => {
    const { core: c } = core();
    c.define('slugifyAll', ALL, ['slugify']);
    const out = c.evaluate('slugifyAll(["Crème", "x"])');
    expect(out).toMatchObject({ kind: 'undefined-call', name: 'slugify', call: 'slugify("Crème")', argTypes: ['string'], args: ['Crème'], calledBy: 'slugifyAll' });
  });

  it('even when the dependent swallows it', () => {
    const { core: c } = core();
    c.define('safe', 'function safe(t) { try { return slugify(t); } catch { return "fallback"; } }', ['slugify']);
    expect(c.evaluate('x = safe("A")')).toMatchObject({ kind: 'undefined-call', name: 'slugify', calledBy: 'safe' });
    expect(c.envShown()).toEqual({}); // nothing was assigned
  });

  it('a fault inside the callee is the callee\'s, naming its caller', () => {
    const { core: c } = core();
    c.define('slugify', 'function slugify(t) { if (t === "") throw new RangeError("empty"); return t; }');
    c.define('slugifyAll', ALL, ['slugify']);
    expect(c.evaluate('slugifyAll(["a", ""])')).toMatchObject({ kind: 'fault', fn: 'slugify', call: 'slugify("")', errorName: 'RangeError', calledBy: 'slugifyAll' });
  });

  it('a purity violation the caller caught before calling is the caller\'s, never the callee\'s', () => {
    const { core: c } = core();
    c.define('slugify', SLUGIFY);
    c.define('sneaky', 'function sneaky(t) { try { Math.random(); } catch {} return slugify(t); }', ['slugify']);
    expect(c.evaluate('sneaky("A")')).toMatchObject({ kind: 'fault', fn: 'sneaky', errorName: 'InvariantViolation' });
  });

  it('reset takes { js, deps } entries', () => {
    const { core: c } = core();
    c.reset({ slugify: SLUGIFY, slugifyAll: { js: ALL, deps: ['slugify'] } }, {});
    expect(c.evaluate('slugifyAll(["A b"])')).toMatchObject({ shown: '["a-b"]' });
  });
});

class InProcessWorker implements RuntimeWorkerLike {
  private listener: ((m: RuntimeMessage) => void) | null = null;
  readonly dispatch = createDispatcher((m) => queueMicrotask(() => this.listener?.(m)));
  postMessage(req: Parameters<RuntimeWorkerLike['postMessage']>[0]): void {
    setTimeout(() => this.dispatch(req), 0);
  }
  terminate(): void {}
  onMessage(cb: (m: RuntimeMessage) => void): void {
    this.listener = cb;
  }
  onError(): void {}
}

describe('Runtime carries deps to the worker, and to a rebuilt worker', () => {
  it('define(name, js, budget, deps) works, and survives a reset', async () => {
    const workers: InProcessWorker[] = [];
    const rt = new Runtime({ workerFactory: () => (workers.push(new InProcessWorker()), workers.at(-1)!) });
    await rt.define('slugify', SLUGIFY, 1000);
    await rt.define('slugifyAll', ALL, 1000, ['slugify']);
    expect(await rt.evaluate('slugifyAll(["A b"])')).toMatchObject({ shown: '["a-b"]' });
    await rt.reset({ slugify: { js: SLUGIFY }, slugifyAll: { js: ALL, deps: ['slugify'] } }, {});
    expect(await rt.evaluate('slugifyAll(["C d"])')).toMatchObject({ shown: '["c-d"]' });
    expect(workers.length).toBe(2);
    rt.dispose();
  });
});
