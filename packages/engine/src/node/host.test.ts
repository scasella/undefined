/**
 * The Node gate host, end to end: the real worker_thread, the real `node:vm` realm, the real watchdog.
 *
 * What these tests record (each one says CONTAINED or NOT CONTAINED in its name; docs/SECURITY.md "The Node host"
 * repeats the list). Containment here means "the accident is stopped and reported", not "an attacker is stopped": the
 * host is NOT a secure sandbox.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Worker } from 'node:worker_threads';
import type { GateResult } from '../types';
import { runExecutionGates, type ExecGateInput } from '../sandbox/gateRunner';
import { classifyMutant } from '../certify';
import { createNodeGateHost, spawnRealmWorker, type NodeGateHost } from './host';
import { harnessSource } from './harnessSource';

let host: NodeGateHost;
let smallHeap: NodeGateHost;
beforeAll(async () => {
  host = await createNodeGateHost();
  smallHeap = await createNodeGateHost({ heapMb: 32, youngMb: 8 });
});

const input = (js: string, tests: string, extra: Partial<ExecGateInput> = {}): ExecGateInput => ({
  name: 'f',
  js,
  testsJs: tests,
  propertiesJs: '',
  budgetMs: 300,
  seed: 42,
  ...extra,
});
const byGate = (rs: readonly GateResult[], g: GateResult['gate']): GateResult => rs.find((r) => r.gate === g)!;
const inv = (rs: readonly GateResult[]) => {
  const d = byGate(rs, 'invariants').diagnostics[0];
  return d && d.kind === 'invariant' ? d : undefined;
};

describe('Node gate host: the protocol and the gates run unchanged', () => {
  it('runs tests, properties and invariants in a worker realm and passes a correct function', async () => {
    const rs = await host.execGates({
      ...input('function f(a, b) { return a + b; }', "test('adds', () => { eq(f(2, 3), 5); });"),
      propertiesJs: "property('commutes', [fc.integer(), fc.integer()], (a, b) => f(a, b) === f(b, a));",
    });
    expect(rs.map((r) => `${r.gate}:${r.status}`)).toEqual(['tests:pass', 'properties:pass', 'invariants:pass']);
    expect(byGate(rs, 'properties').summary).toContain('100 runs');
  });

  it('reports a wrong result with the site headline', async () => {
    const rs = await host.execGates(input('function f(a, b) { return a - b; }', "test('adds', () => { eq(f(2, 3), 5); });"));
    expect(byGate(rs, 'tests').headline).toBe('Rejected: f(2, 3) returned -1, expected 5');
  });

  it('carries callArgs, pins and decoded values (NaN, -0, bigint, Map) into the realm intact', async () => {
    const rs = await host.execGates(
      input('function f(m) { return [m.get("n"), Object.is(m.get("z"), -0), typeof m.get("b")]; }', '', {
        callArgs: [new Map<string, unknown>([['n', NaN], ['z', -0], ['b', 10n]])],
        pinned: [{ label: 'f(m)', args: [new Map<string, unknown>([['n', NaN], ['z', -0], ['b', 1n]])], expected: [NaN, true, 'bigint'] }],
      }),
    );
    expect(rs.map((r) => `${r.gate}:${r.status}`)).toEqual(['tests:pass', 'properties:skipped', 'invariants:pass']);
  });
});

describe('Node gate host: the watchdog has real hard-terminate semantics', () => {
  it('CONTAINED: an infinite loop in a call is terminated at the per-call budget and reported as bounded', async () => {
    const t0 = performance.now();
    const rs = await host.execGates(input('function f(n) { while (true) {} }', "test('loops', () => { f(1); });"));
    const elapsed = performance.now() - t0;
    expect(byGate(rs, 'invariants').headline).toBe('Rejected: f(1) did not return within 300 ms (bounded)');
    expect(inv(rs)).toMatchObject({ invariant: 'bounded', call: 'f(1)', phase: 'tests', budgetMs: 300, detail: 'worker terminated by the watchdog' });
    expect(inv(rs)!.elapsedMs!).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(5000);
    expect(classifyMutant(rs)).toBe('killed-by-bound');
  });

  it('CONTAINED: a hang in the Properties phase is attributed to that phase', async () => {
    const rs = await host.execGates({
      ...input('function f(n) { if (n > 5) { for (;;) {} } return n; }', "test('small', () => { eq(f(1), 1); });"),
      propertiesJs: "property('any', [fc.integer({ min: 0, max: 100 })], (n) => f(n) <= n);",
    });
    expect(rs.map((r) => `${r.gate}:${r.status}`)).toEqual(['tests:pass', 'properties:skipped', 'invariants:fail']);
    expect(inv(rs)).toMatchObject({ invariant: 'bounded', phase: 'properties' });
  });

  it('CONTAINED: a loop outside any call (in test code) is stopped by the overall cap', async () => {
    const rs = await host.execGates(input('function f() { return 1; }', "test('spins', () => { f(); for (;;) {} });", { overallCapMs: 600 }));
    expect(byGate(rs, 'invariants').headline).toBe('Rejected: the gates did not finish within the 600 ms overall cap (bounded)');
    expect(inv(rs)?.detail).toBe('worker terminated by the watchdog (overall cap); last call f()');
  });

  it('CONTAINED: Atomics.wait (a blocked thread, not a busy one) is terminated too', async () => {
    const rs = await host.execGates(input('function f() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); return 1; }', "test('waits', () => { f(); });"));
    expect(inv(rs)).toMatchObject({ invariant: 'bounded', call: 'f()' });
  });

  it('CONTAINED: deep recursion throws RangeError inside the realm (a test failure, not a crash)', async () => {
    const rs = await host.execGates(input('function f(n) { return n === 0 ? 0 : 1 + f(n - 1); }', "test('deep', () => { eq(f(1e7), 1e7); });", { budgetMs: 5000 }));
    expect(byGate(rs, 'tests').status).toBe('fail');
    expect(byGate(rs, 'tests').headline).toContain('RangeError');
  });
});

describe('Node gate host: memory', () => {
  it('CONTAINED: a heap blow-up stops the worker at its heap limit and is reported as bounded (never a crash)', async () => {
    const rs = await smallHeap.execGates(
      input('function f() { const a = []; for (;;) a.push(new Array(1e5).fill(1)); }', "test('grows', () => { f(); });", { budgetMs: 20_000 }),
    );
    expect(byGate(rs, 'invariants').headline).toBe('Rejected: f() used more than the 32 MB heap limit (bounded)');
    expect(inv(rs)).toMatchObject({ invariant: 'bounded', call: 'f()', phase: 'tests', detail: 'worker stopped by its heap limit' });
    expect(classifyMutant(rs)).toBe('killed-by-bound');
  }, 30_000);

  it('the main process survives and the next run is unaffected', async () => {
    const rs = await smallHeap.execGates(input('function f() { return 2; }', "test('ok', () => { eq(f(), 2); });"));
    expect(byGate(rs, 'tests').status).toBe('pass');
  });
});

describe('Node gate host: a wrong function cannot turn its rejection into "could not run"', () => {
  const hostile = "new Proxy({}, { get() { throw new Error('trap'); }, getPrototypeOf() { throw new Error('trap'); }, has() { throw new Error('trap'); } })";
  it('CONTAINED (regression): throwing a Proxy whose traps throw is a test failure of that call, not a gate worker error', async () => {
    const rs = await host.execGates(input(`function f(x) { throw ${hostile}; }`, "test('adds one', () => { eq(f(1), 2); });"));
    expect(byGate(rs, 'tests').status).toBe('fail');
    expect(byGate(rs, 'tests').note).not.toBe('gate worker error');
    expect(byGate(rs, 'tests').headline).toBe('Rejected: f(1) threw Error: threw a value that cannot be inspected (reading it throws)');
  });

  it('CONTAINED (regression): the same in a property', async () => {
    const rs = await host.execGates({
      ...input(`function f(x) { if (x > 3) throw ${hostile}; return x + 1; }`, ''),
      propertiesJs: "property('adds one', [fc.integer({ min: 0, max: 100 })], (x) => f(x) === x + 1);",
    });
    expect(byGate(rs, 'properties').status).toBe('fail');
    expect(byGate(rs, 'properties').note).not.toBe('gate worker error');
    expect(byGate(rs, 'properties').headline).toContain('cannot be inspected');
  });

  it('CONTAINED: an unhandled rejection (and a throwing .then) neither crashes the worker nor changes the verdict', async () => {
    const wrong = await host.execGates(input("function f(x) { Promise.reject(new Error('boom')); Promise.resolve().then(() => { throw new Error('b2'); }); return x + 2; }", "test('adds one', () => { eq(f(1), 2); });"));
    expect(byGate(wrong, 'tests').headline).toBe('Rejected: f(1) returned 3, expected 2');
    const right = await host.execGates(input("function f(x) { Promise.reject(new Error('boom')); return x + 1; }", "test('adds one', () => { eq(f(1), 2); });"));
    expect(right.map((r) => `${r.gate}:${r.status}`)).toEqual(['tests:pass', 'properties:skipped', 'invariants:pass']);
  });
});

describe('Node gate host: reaching for the process (accidents the mask and the realm catch)', () => {
  it('CONTAINED (mask): process.exit() by name is a purity violation, and nothing exits', async () => {
    const rs = await host.execGates(input('function f() { process.exit(1); return 1; }', "test('exits', () => { f(); });"));
    expect(byGate(rs, 'invariants').headline).toBe("Rejected: candidate read global 'process' (pure)");
  });

  it('CONTAINED (mask): require("fs") by name is a purity violation', async () => {
    const rs = await host.execGates(input('function f() { return require("fs").readFileSync("/etc/hosts", "utf8"); }', "test('reads', () => { f(); });"));
    expect(byGate(rs, 'invariants').headline).toBe("Rejected: candidate read global 'require' (pure)");
  });

  it('CONTAINED (realm): the real global object, reached past the mask, has no process, require, Buffer, fetch or host hooks', async () => {
    const js = `function f() {
      const g = (() => 0).constructor('return this')();
      return ['process', 'require', 'Buffer', 'fetch', 'setImmediate', 'postMessage', '__undefinedHost', '__undefinedHarness'].map((n) => n + ':' + typeof g[n]).join(' ')
        + ' ctor:' + g.constructor.constructor('return typeof process')();
    }`;
    const want = 'process:undefined require:undefined Buffer:undefined fetch:undefined setImmediate:undefined postMessage:undefined __undefinedHost:undefined __undefinedHarness:undefined ctor:undefined';
    const rs = await host.execGates(input(js, `test('looks', () => { eq(f(), ${JSON.stringify(want)}); });`));
    expect(byGate(rs, 'tests').headline).toBeUndefined();
    expect(byGate(rs, 'tests').status).toBe('pass');
  });

  it('CONTAINED (realm): an argument handed in cannot reach the outer Function (inbound data is decoded in-realm)', async () => {
    const js = `function f(xs) { return xs.constructor.constructor('return typeof process')(); }`;
    const rs = await host.execGates(input(js, '', { callArgs: [[1, 2]], pinned: [{ label: 'f([1, 2])', args: [[1, 2]], expected: 'undefined' }] }));
    expect(byGate(rs, 'tests').status).toBe('pass');
  });
});

/** Run `code` in a realm built exactly like the gates' (same worker.mjs, same options), with a probe harness. */
async function probeRealm(code: string, deliver = false): Promise<Array<{ k: string; v: string }>> {
  const harness = `var __undefinedHarness = { deliver() {} };
    const out = (k, v) => __undefinedHost.post({ k, v: String(v) });
    try { ${code} } catch (e) { out('threw', (e && (e.code || e.name)) + ': ' + (e && e.message)); }`;
  const w: Worker = spawnRealmWorker(harness, host.limits);
  const got: Array<{ k: string; v: string }> = [];
  return new Promise((resolve) => {
    w.on('message', (m: { k: string; v: string }) => got.push(m));
    w.on('error', (e: Error & { code?: string }) => got.push({ k: 'worker-error', v: `${e.code} ${e.message}` }));
    w.on('exit', () => resolve(got));
    if (deliver) setTimeout(() => w.postMessage('go'), 200);
    setTimeout(() => void w.terminate(), 800);
  });
}

describe('Node gate host: the realm boundary, probed directly (what an escape attempt meets)', () => {
  it('CONTAINED: import() is refused in the realm, from a script and from code made with Function', async () => {
    const got = await probeRealm(`
      import('node:fs').then(() => out('script', 'LOADED'), (e) => out('script', e.code));
      (() => 0).constructor('return import("node:fs")')().then(() => out('fn', 'LOADED'), (e) => out('fn', e.code));`);
    expect(got).toEqual(
      expect.arrayContaining([
        { k: 'script', v: 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING' },
        { k: 'fn', v: 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING' },
      ]),
    );
  });

  it('CONTAINED: WebAssembly code generation is disallowed', async () => {
    const got = await probeRealm(`WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(() => out('wasm', 'COMPILED'), (e) => out('wasm', e.message));`);
    expect(got[0]?.v).toContain('disallowed');
  });

  it('CONTAINED on this Node: stack-trace frames of the outer (worker) code expose no outer function', async () => {
    // The classic vm escape: Error.prepareStackTrace → CallSite.getFunction() of an outer, sloppy-mode frame. The
    // worker and Node's internals are strict-mode modules, so getFunction() returns undefined for them.
    const got = await probeRealm(
      `__undefinedHarness.deliver = function () {
        Error.prepareStackTrace = (e, frames) => frames;
        const frames = new Error().stack;
        const outer = frames.map((f) => f.getFunction()).filter((fn) => fn && fn.constructor !== Function);
        out('outer', outer.length);
      };`,
      true,
    );
    expect(got).toContainEqual({ k: 'outer', v: '0' });
  });

  it('the harness bundle carries no TypeScript and no Node built-in import', async () => {
    const src = await harnessSource();
    expect(src).not.toMatch(/require\(["']|from ["']node:|import\(["']/);
    expect(src).not.toContain('createProgram');
    expect(src.length).toBeLessThan(1_000_000);
  });
});
