import { describe, expect, it } from 'vitest';
import { createDispatcher, ReplCore, type RuntimeMessage } from './replCore';

const MEDIAN = `function median(numbers) {
  if (numbers.length === 0) throw new RangeError("median of empty array");
  const s = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}`;
const DOUBLE = 'function double(x) { return x * 2; }';
const TRIPLE_AS_DOUBLE = 'function double(x) { return x * 3; }';
const FIB = 'function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }';

function coreWith(fns: Record<string, string> = { median: MEDIAN }): ReplCore {
  const core = new ReplCore();
  for (const [n, js] of Object.entries(fns)) core.define(n, js);
  return core;
}

describe('ReplCore.evaluate — values', () => {
  it('evaluates a committed function and lists the committed calls in order', () => {
    const core = coreWith({ median: MEDIAN, double: DOUBLE });
    const out = core.evaluate('double(median([3, 1, 4, 2]))');
    expect(out).toMatchObject({ kind: 'value', shown: '5', calls: ['median', 'double'] });
    if (out.kind === 'value') expect(out.ms).toBeGreaterThanOrEqual(0);
  });

  it('evaluates plain expressions with standard globals (Math, JSON, Date) and no committed calls', () => {
    const core = coreWith();
    expect(core.evaluate('Math.max(1, 2) + JSON.parse("[3]")[0]')).toMatchObject({ kind: 'value', shown: '5', calls: [] });
    expect(core.evaluate('new Date(0).getTime()')).toMatchObject({ kind: 'value', shown: '0' });
  });

  it('shows undefined, strings, bigint, and handles trailing semicolons and empty input', () => {
    const core = coreWith();
    expect(core.evaluate('undefined')).toMatchObject({ kind: 'value', shown: 'undefined' });
    expect(core.evaluate('"a" + "b";')).toMatchObject({ kind: 'value', shown: '"ab"' });
    expect(core.evaluate('2n ** 70n')).toMatchObject({ kind: 'value', shown: `${2n ** 70n}n` });
    expect(core.evaluate('   ')).toMatchObject({ kind: 'value', shown: 'undefined', calls: [] });
  });

  it('supports recursion inside committed functions (only the REPL-level call is recorded)', () => {
    const core = coreWith({ fib: FIB });
    expect(core.evaluate('fib(15)')).toMatchObject({ kind: 'value', shown: '610', calls: ['fib'] });
  });

  it('allows a trailing line comment in the input', () => {
    const core = coreWith();
    expect(core.evaluate('median([1, 2, 3]) // the middle')).toMatchObject({ kind: 'value', shown: '2' });
  });

  it('treats arrow functions as expressions, not assignments', () => {
    const core = coreWith();
    expect(core.evaluate('x => x * 2')).toMatchObject({ kind: 'value', shown: '[Function (anonymous)]' });
    expect(core.envShown()).toEqual({});
  });
});

describe('ReplCore — REPL variables', () => {
  it('binds with assignment, const, let and var, then reuses the variables', () => {
    const core = coreWith();
    expect(core.evaluate('x = median([1, 2, 3, 4])')).toMatchObject({ kind: 'value', shown: '2.5', calls: ['median'] });
    expect(core.evaluate('x * 2')).toMatchObject({ kind: 'value', shown: '5', calls: [] });
    core.evaluate('const a = 1');
    core.evaluate('let b = a + 1');
    core.evaluate('var c = [a, b]');
    expect(core.evaluate('c')).toMatchObject({ shown: '[1, 2]' });
    expect(core.envShown()).toEqual({ x: '2.5', a: '1', b: '2', c: '[1, 2]' });
  });

  it('creates variables from nested assignments and supports update operators', () => {
    const core = coreWith();
    expect(core.evaluate('(y = 3) + 1')).toMatchObject({ shown: '4' });
    core.evaluate('y++');
    core.evaluate('y += 10');
    expect(core.evaluate('y')).toMatchObject({ shown: '14' });
  });

  it('does not treat comparison as assignment', () => {
    const core = coreWith();
    core.evaluate('x = 1');
    expect(core.evaluate('x == 1')).toMatchObject({ kind: 'value', shown: 'true' });
    expect(core.envShown()).toEqual({ x: '1' });
  });

  it('refuses to shadow a committed function with a variable', () => {
    const core = coreWith();
    expect(core.evaluate('median = 5')).toMatchObject({ kind: 'error', errorName: 'TypeError' });
    expect(core.evaluate('median([5])')).toMatchObject({ kind: 'value', shown: '5' });
  });

  it('round-trips the env through snapshot/restore, including bigint, Map, NaN and undefined', () => {
    const core = coreWith();
    core.evaluate('big = 12345678901234567890n');
    core.evaluate('m = new Map([["a", 1], ["b", [2n]]])');
    core.evaluate('n = NaN');
    core.evaluate('u = undefined');
    core.evaluate('s = new Set([1, 2])');
    const snap = JSON.parse(JSON.stringify(core.snapshotEnv()));

    const fresh = coreWith();
    fresh.restoreEnv(snap);
    expect(fresh.envShown()).toEqual(core.envShown());
    expect(fresh.evaluate('big + 1n')).toMatchObject({ shown: '12345678901234567891n' });
    expect(fresh.evaluate('m.get("b")[0] * 2n')).toMatchObject({ shown: '4n' });
    expect(fresh.evaluate('m instanceof Map && s.has(2)')).toMatchObject({ shown: 'true' });
    expect(fresh.evaluate('Number.isNaN(n) && u === undefined')).toMatchObject({ shown: 'true' });
  });

  it('keeps variables named like Object.prototype members as ordinary variables', () => {
    const core = coreWith();
    core.evaluate('constructor = 1');
    core.evaluate('toString = 2');
    expect(core.evaluate('constructor + toString')).toMatchObject({ kind: 'value', shown: '3' });
    expect(core.evaluate('hasOwnProperty')).toMatchObject({ kind: 'error', errorName: 'ReferenceError' });
  });
});

describe('ReplCore — undefined names', () => {
  it('reports a call to an undefined function with the real argument types and values', () => {
    const core = coreWith({});
    expect(core.evaluate('median([3, 1, 4, 2])')).toEqual({
      kind: 'undefined-call',
      name: 'median',
      argTypes: ['number[]'],
      argShown: ['[3, 1, 4, 2]'],
      call: 'median([3, 1, 4, 2])',
    });
  });

  it('evaluates arguments (with variables and committed calls) before reporting the undefined call', () => {
    const core = coreWith({ double: DOUBLE });
    core.evaluate('xs = ["a", "b"]');
    expect(core.evaluate('join(xs, double(2), { k: 1n })')).toMatchObject({
      kind: 'undefined-call',
      name: 'join',
      argTypes: ['string[]', 'number', '{ k: bigint }'],
      argShown: ['["a", "b"]', '4', '{ k: 1n }'],
      call: 'join(["a", "b"], 4, { k: 1n })',
    });
  });

  it('reports the innermost undefined call first in nested calls (JS evaluates arguments first)', () => {
    const core = coreWith({});
    expect(core.evaluate('f(g(1))')).toMatchObject({ kind: 'undefined-call', name: 'g', argTypes: ['number'], call: 'g(1)' });
  });

  it('does not bind the variable when the right-hand side hits an undefined call', () => {
    const core = coreWith({});
    expect(core.evaluate('x = median([1])')).toMatchObject({ kind: 'undefined-call', name: 'median' });
    expect(core.envShown()).toEqual({});
  });

  it('documents the re-evaluation side effect: assignments before the undefined call already happened', () => {
    const core = coreWith({});
    core.evaluate('n = 0');
    expect(core.evaluate('(n = n + 1, median([n]))')).toMatchObject({ kind: 'undefined-call' });
    core.define('median', MEDIAN);
    expect(core.evaluate('(n = n + 1, median([n]))')).toMatchObject({ kind: 'value', shown: '2' });
  });

  it('turns a non-call use of an unknown identifier into a ReferenceError', () => {
    const core = coreWith({});
    for (const src of ['foo', 'foo + 1', 'foo.bar', 'typeof foo.bar', '`${foo}`', 'foo.valueOf()', 'x = foo', '[1].concat(foo)']) {
      expect(core.evaluate(src), src).toMatchObject({ kind: 'error', errorName: 'ReferenceError', message: 'foo is not defined' });
    }
    expect(core.envShown()).toEqual({});
  });

  it('reports an unknown identifier passed as an argument as a ReferenceError, not a fault or a call', () => {
    const core = coreWith();
    expect(core.evaluate('median(foo)')).toMatchObject({ kind: 'error', errorName: 'ReferenceError', message: 'foo is not defined' });
    expect(core.evaluate('bar(foo)')).toMatchObject({ kind: 'error', errorName: 'ReferenceError', message: 'foo is not defined' });
  });

  it('reports an argument whose type cannot be inferred as an error', () => {
    const core = coreWith({});
    expect(core.evaluate('apply(x => x, 1)')).toEqual({
      kind: 'error',
      errorName: 'TypeError',
      message: 'cannot infer a type for argument 1: function arguments are not supported',
    });
  });

  it('hides masked globals and eval/Function from the REPL without exposing the real global object', () => {
    const core = coreWith({});
    expect(core.evaluate('globalThis')).toMatchObject({ kind: 'error', errorName: 'ReferenceError' });
    expect(core.evaluate('self.x')).toMatchObject({ kind: 'error', errorName: 'ReferenceError' });
    expect(core.evaluate('fetch("http://example.com")')).toMatchObject({ kind: 'undefined-call', name: 'fetch' });
    expect(core.evaluate('eval("1")')).toMatchObject({ kind: 'undefined-call', name: 'eval' });
    expect(core.evaluate('this')).toMatchObject({ kind: 'value', shown: 'undefined' });
    expect(core.evaluate('[1].map(function () { return this; })[0]')).toMatchObject({ kind: 'value', shown: 'undefined' });
  });
});

describe('ReplCore — errors and faults', () => {
  it('maps a syntax error to an error outcome', () => {
    const core = coreWith();
    expect(core.evaluate('median([1, 2')).toMatchObject({ kind: 'error', errorName: 'SyntaxError' });
  });

  it('maps an error thrown by REPL code (not a committed function) to an error outcome', () => {
    const core = coreWith();
    expect(core.evaluate('null.x')).toMatchObject({ kind: 'error', errorName: 'TypeError' });
    expect(core.evaluate('JSON.parse("{")')).toMatchObject({ kind: 'error', errorName: 'SyntaxError' });
  });

  it('maps an error thrown inside a committed function to a fault with the call string', () => {
    const core = coreWith();
    const out = core.evaluate('median([])');
    expect(out).toMatchObject({ kind: 'fault', fn: 'median', call: 'median([])', errorName: 'RangeError', message: 'median of empty array' });
    if (out.kind === 'fault') expect(out.stack).toContain('RangeError');
  });

  it('tags the innermost committed function when committed calls nest through the REPL', () => {
    const core = coreWith({ median: MEDIAN, double: DOUBLE });
    expect(core.evaluate('double(median([]))')).toMatchObject({ kind: 'fault', fn: 'median', call: 'median([])' });
    expect(core.evaluate('[[1], []].map(xs => double(median(xs)))')).toMatchObject({ kind: 'fault', fn: 'median', call: 'median([])' });
  });

  it('reports a thrown non-Error value as a fault', () => {
    const core = coreWith({ boom: 'function boom() { throw 42; }' });
    expect(core.evaluate('boom()')).toMatchObject({ kind: 'fault', fn: 'boom', call: 'boom()', errorName: 'Error', message: 'uncaught 42' });
  });

  it('reports a committed function touching a masked global as an InvariantViolation fault', () => {
    const core = coreWith({ get: 'function get(url) { return fetch(url); }' });
    expect(core.evaluate('get("http://x")')).toMatchObject({
      kind: 'fault',
      fn: 'get',
      call: 'get("http://x")',
      errorName: 'InvariantViolation',
      message: 'candidate used fetch',
    });
  });

  it('still faults when the committed function swallows the masked-global trap', () => {
    const core = coreWith({ roll: 'function roll() { try { return Math.random(); } catch { return 4; } }' });
    expect(core.evaluate('roll()')).toMatchObject({ kind: 'fault', fn: 'roll', errorName: 'InvariantViolation', message: 'candidate used Math.random' });
  });

  it('REPL code may use Math.random itself (purity is a candidate invariant)', () => {
    const core = coreWith();
    expect(core.evaluate('Math.random() < 1')).toMatchObject({ kind: 'value', shown: 'true' });
  });
});

describe('ReplCore — hot swap', () => {
  it('redefines a function without losing variables', () => {
    const core = coreWith({ double: DOUBLE });
    core.evaluate('x = double(5)');
    core.define('double', TRIPLE_AS_DOUBLE);
    expect(core.evaluate('double(x)')).toMatchObject({ kind: 'value', shown: '30' });
    expect(core.envShown()).toEqual({ x: '10' });
  });

  it('undefine turns calls back into undefined calls', () => {
    const core = coreWith({ double: DOUBLE });
    core.undefine('double');
    expect(core.evaluate('double(1)')).toMatchObject({ kind: 'undefined-call', name: 'double' });
  });

  it('define rejects code that does not declare the named function', () => {
    const core = new ReplCore();
    expect(() => core.define('median', 'function (')).toThrow(SyntaxError);
    expect(() => core.define('median', 'function other() {}')).toThrow();
    expect(core.functionNames()).toEqual([]);
  });

  it('reset replaces functions and env wholesale', () => {
    const core = coreWith({ double: DOUBLE });
    core.evaluate('x = 1');
    core.reset({ median: MEDIAN }, { y: 2 });
    expect(core.functionNames()).toEqual(['median']);
    expect(core.envShown()).toEqual({ y: '2' });
    expect(core.evaluate('double(y)')).toMatchObject({ kind: 'undefined-call' });
  });
});

describe('createDispatcher', () => {
  it('answers requests and emits enter/leave around committed calls', () => {
    const msgs: RuntimeMessage[] = [];
    const dispatch = createDispatcher((m) => msgs.push(m));
    dispatch({ id: 1, type: 'define', name: 'double', js: DOUBLE });
    dispatch({ id: 2, type: 'evaluate', input: 'x = double(21)' });
    dispatch({ id: 3, type: 'define', name: 'bad', js: 'nope(' });
    expect(msgs).toEqual([
      { type: 'reply', id: 1, ok: true, result: null },
      { type: 'enter', fn: 'double', call: 'double(21)' },
      { type: 'leave', fn: 'double' },
      { type: 'reply', id: 2, ok: true, result: expect.objectContaining({ kind: 'value', shown: '42', calls: ['double'] }), env: { x: 42 } },
      { type: 'reply', id: 3, ok: false, error: expect.stringContaining('SyntaxError') },
    ]);
  });
});
