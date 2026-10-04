import { describe, expect, it } from 'vitest';
import { createDispatcher, isArrayCallbackCall, ReplCore, type RuntimeMessage } from './replCore';
import { FUNCTION_ARG_TYPE } from '../shared/inferType';

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
      args: [[3, 1, 4, 2]],
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

  it('reports an argument whose type cannot be inferred as an error (nested functions, symbols, class instances)', () => {
    const core = coreWith({});
    expect(core.evaluate('apply([x => x], 1)')).toEqual({
      kind: 'error',
      errorName: 'TypeError',
      message: 'cannot infer a type for argument 1: function arguments are not supported',
    });
    expect(core.evaluate('apply(1, Symbol())')).toMatchObject({ kind: 'error', message: 'cannot infer a type for argument 2: symbol arguments are not supported' });
    expect(core.evaluate('apply(new Uint8Array(2))')).toMatchObject({ kind: 'error', errorName: 'TypeError' });
  });

  it('accepts function-valued arguments: typed as an any-function, encoded as the unserializable placeholder', () => {
    const core = coreWith({});
    const out = core.evaluate('compose(x => x + 1, x => x * 2)');
    expect(out).toMatchObject({ kind: 'undefined-call', name: 'compose', argTypes: [FUNCTION_ARG_TYPE, FUNCTION_ARG_TYPE] });
    if (out.kind !== 'undefined-call') throw new Error('expected an undefined call');
    expect(out.args).toEqual([
      { $t: 'unserializable', show: expect.any(String) },
      { $t: 'unserializable', show: expect.any(String) },
    ]);
    expect(out.argsTrimmed).toBeUndefined();
    expect(core.evaluate('applyTwice(x => x + 1, 3)')).toMatchObject({ argTypes: [FUNCTION_ARG_TYPE, 'number'] });
  });

  it('passes the real function through once the function exists', () => {
    const core = coreWith({ compose: 'function compose(f, g) { return (x) => g(f(x)); }' });
    expect(core.evaluate('compose(x => x + 1, x => x * 2)(5)')).toMatchObject({ kind: 'value', shown: '12' });
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

  it('a syntax error names the real problem, never the harness wrapper', () => {
    const core = coreWith();
    const msg = (input: string): string => {
      const out = core.evaluate(input);
      if (out.kind !== 'error' || out.errorName !== 'SyntaxError') throw new Error(`expected a SyntaxError for ${input}: ${JSON.stringify(out)}`);
      return out.message;
    };
    // `median([1, 2` used to read "Unexpected token ')'": a ')' the user never typed
    expect(msg('median([1, 2')).toBe('unexpected end of input: a `[` is never closed (missing `]`)');
    expect(msg('median([1, 2]')).toBe('unexpected end of input: a `(` is never closed (missing `)`)');
    expect(msg('f({ a: 1')).toBe('unexpected end of input: a `{` is never closed (missing `}`)');
    expect(msg('f("abc')).toBe('unexpected end of input: the string starting with " is not closed');
    expect(msg('1 +')).toBe('unexpected end of input');
    expect(msg('x = 1; y = 2')).toBe('a REPL line must be one expression or one binding (x = …); this parses only as statements');
    for (const input of ['median([1, 2', 'median(]', '1 +', 'f(1,,)', 'x = 1; y = 2', ')']) {
      const m = msg(input);
      expect(m, input).not.toMatch(/\bwith\b|__scope|use strict/);
      expect(m, input).not.toBe("Unexpected token ')'");
    }
    expect(msg('median(]')).toMatch(/unexpected token/i);
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

describe('ReplCore — an undefined function used as an Array callback', () => {
  it('[1, 2, 3].map(double) keeps only the value: one parameter, argsTrimmed set', () => {
    const core = coreWith({});
    const out = core.evaluate('[1, 2, 3].map(double)');
    expect(out).toEqual({
      kind: 'undefined-call',
      name: 'double',
      argTypes: ['number'],
      argShown: ['1'],
      args: [1],
      call: 'double(1)',
      argsTrimmed: 'array-callback',
    });
    // once grown from that one-parameter spec, the same line gives the right answer
    core.define('double', 'function double(arg0) { return arg0 * 2; }');
    expect(core.evaluate('[1, 2, 3].map(double)')).toMatchObject({ kind: 'value', shown: '[2, 4, 6]' });
  });

  it('every callback-taking Array method is recognised', () => {
    const core = coreWith({});
    for (const m of ['map', 'filter', 'forEach', 'find', 'findIndex', 'some', 'every', 'flatMap']) {
      expect(core.evaluate(`["a", "b"].${m}(isVowel)`), m).toMatchObject({ argTypes: ['string'], argsTrimmed: 'array-callback', call: 'isVowel("a")' });
    }
    expect(core.evaluate('xs = [[1], [2]]')).toMatchObject({ kind: 'value' });
    expect(core.evaluate('xs.map(total)')).toMatchObject({ argTypes: ['number[]'], argsTrimmed: 'array-callback', call: 'total([1])' });
    expect(core.evaluate('[NaN].map(isMissing)')).toMatchObject({ argTypes: ['number'], argsTrimmed: 'array-callback' });
  });

  it('real three-argument calls that are not callback-shaped are NOT trimmed', () => {
    const core = coreWith({});
    const notTrimmed = [
      'clamp(5, 0, [5, 6])', // arr[i] is 5, but i is not where x sits... 0 → arr[0] = 5 === x: see the direct-call rule below
      'between(2, 7, [1, 2, 3])', // i out of range
      'between(2, 1.5, [1, 2, 3])', // i not an integer
      'between(2, -1, [1, 2, 3])', // negative index
      'between(9, 1, [1, 2, 3])', // arr[i] !== x
      'between(2, 1, "123")', // not an array
      'pick(2, 1, [1, 2, 3], 0)', // four arguments
      'pair(2, 1)', // two arguments
      'xs = [1, 2, 3]',
      'xs.map((x, i, a) => scale(x, i, a))', // callback-shaped, but the user called scale directly with three arguments
    ];
    for (const input of notTrimmed) {
      const out = core.evaluate(input);
      if (out.kind === 'undefined-call') expect(out.argsTrimmed, input).toBeUndefined();
    }
    expect(core.evaluate('between(9, 1, [1, 2, 3])')).toMatchObject({ argTypes: ['number', 'number', 'number[]'] });
    expect(core.evaluate('xs.map((x, i, a) => scale(x, i, a))')).toMatchObject({ argTypes: ['number', 'number', 'number[]'], call: 'scale(1, 0, [1, 2, 3])' });
  });

  it('isArrayCallbackCall: shape AND no direct call of the name in the line', () => {
    const arr = [4, 5];
    expect(isArrayCallbackCall('f', [4, 0, arr], '[4, 5].map(f)')).toBe(true);
    expect(isArrayCallbackCall('f', [5, 1, arr], 'arr.filter(f)')).toBe(true);
    expect(isArrayCallbackCall('f', [4, 0, arr], 'f(4, 0, [4, 5])')).toBe(false);
    expect(isArrayCallbackCall('f', [4, 0, arr], 'g(1) + f (4, 0, [4, 5])')).toBe(false);
    expect(isArrayCallbackCall('f', [4, 0, arr], 'obj.f(1) + [4].map(f)')).toBe(true); // a method named f is not f
    expect(isArrayCallbackCall('$f', [4, 0, arr], '[4].map($f)')).toBe(true);
    expect(isArrayCallbackCall('$f', [4, 0, arr], '$f(4, 0, [4])')).toBe(false);
    expect(isArrayCallbackCall('f', [4, 1, arr], '[4, 5].map(f)')).toBe(false);
    const holes = [, 1]; // eslint-disable-line no-sparse-arrays
    expect(isArrayCallbackCall('f', [undefined, 0, holes], 'h.map(f)')).toBe(false);
  });
});

describe('ReplCore — review fixes', () => {
  it('undefined-call carries the evaluated arguments encoded with encodeValue', () => {
    const core = coreWith({});
    core.evaluate('xs = [3, 1]');
    const out = core.evaluate('join(xs, 2n, new Map([["a", NaN]]), undefined)');
    expect(out).toMatchObject({
      kind: 'undefined-call',
      name: 'join',
      args: [[3, 1], { $t: 'bigint', v: '2' }, { $t: 'Map', v: [['a', { $t: 'number', v: 'NaN' }]] }, { $t: 'undefined' }],
    });
  });

  it('reports an undefined name nested inside an argument as a ReferenceError, not a fault of the committed function', () => {
    const core = coreWith();
    for (const src of ['median([1, foo])', 'median({ a: foo })', 'median([[1, [foo]]])', 'median(new Map([[foo, 1]]))', 'median(new Set([foo]))', 'median(new Map([[1, { b: foo }]]))']) {
      expect(core.evaluate(src), src).toEqual({ kind: 'error', errorName: 'ReferenceError', message: 'foo is not defined' });
    }
  });

  it('does not bind or show a value that contains an undefined name', () => {
    const core = coreWith();
    expect(core.evaluate('x = [foo]')).toEqual({ kind: 'error', errorName: 'ReferenceError', message: 'foo is not defined' });
    expect(core.evaluate('(y = { a: [foo] }) && 1')).toEqual({ kind: 'error', errorName: 'ReferenceError', message: 'foo is not defined' });
    expect(core.evaluate('[1, { b: foo }]')).toEqual({ kind: 'error', errorName: 'ReferenceError', message: 'foo is not defined' });
    expect(core.envShown()).toEqual({});
  });

  it('a nested undefined name inside an undefined call names that inner name', () => {
    const core = coreWith({});
    expect(core.evaluate('foo([1, bar])')).toEqual({ kind: 'error', errorName: 'ReferenceError', message: 'bar is not defined' });
    expect(core.evaluate('foo({ k: new Set([bar]) })')).toEqual({ kind: 'error', errorName: 'ReferenceError', message: 'bar is not defined' });
  });

  it('thunk scan survives cycles and hostile proxies', () => {
    const core = coreWith();
    expect(core.evaluate('(c = [1, 2], c.push(c), median([3]))')).toMatchObject({ kind: 'value', shown: '3' });
    expect(core.evaluate('median([new Proxy({}, { ownKeys() { throw 1; } }) && 5])')).toMatchObject({ kind: 'value', shown: '5' });
    expect(core.evaluate('c.length')).toMatchObject({ kind: 'value', shown: '3' });
  });

  it('a REPL alias of a committed function stops working after undefine or redefine', () => {
    const core = coreWith({ double: DOUBLE });
    core.evaluate('g = double');
    expect(core.evaluate('g(2)')).toMatchObject({ kind: 'value', shown: '4' });
    core.define('double', TRIPLE_AS_DOUBLE);
    expect(core.evaluate('g(2)')).toEqual({ kind: 'error', errorName: 'ReferenceError', message: 'double is not defined' });
    expect(core.evaluate('double(2)')).toMatchObject({ kind: 'value', shown: '6' });
    core.evaluate('h = double');
    core.undefine('double');
    expect(core.evaluate('h(2)')).toEqual({ kind: 'error', errorName: 'ReferenceError', message: 'double is not defined' });
  });

  it('restoreEnv/reset drop variables whose encoded value holds an unserializable placeholder and report them', () => {
    const core = coreWith({});
    const lost = core.reset({}, { f: { $t: 'unserializable', show: '[Function f]' }, g: [1, { $t: 'unserializable', show: '[Function]' }], y: 1 });
    expect(lost).toEqual(['f', 'g']);
    expect(core.envShown()).toEqual({ y: '1' });
    expect(core.evaluate('f')).toMatchObject({ kind: 'error', errorName: 'ReferenceError' });
  });

  it('a committed function that modifies an intrinsic faults, and the intrinsic is restored', () => {
    const core = coreWith({ cheat: 'function cheat() { Object.is = () => true; return 1; }' });
    expect(core.evaluate('cheat()')).toMatchObject({ kind: 'fault', fn: 'cheat', errorName: 'InvariantViolation', message: 'candidate modified Object.is' });
    expect(core.evaluate('Object.is(1, 2)')).toMatchObject({ kind: 'value', shown: 'false' });
  });

  it('dispatcher reset replies with the lost names', () => {
    const msgs: RuntimeMessage[] = [];
    const dispatch = createDispatcher((m) => msgs.push(m));
    dispatch({ id: 1, type: 'reset', functions: {}, env: { f: { $t: 'unserializable', show: 'x' }, y: 2 } });
    expect(msgs).toEqual([{ type: 'reply', id: 1, ok: true, result: { lost: ['f'] } }]);
  });
});

// ───────────────────────── datasets, tables, call records ─────────────────────────

const ROWS = (): Array<{ customer: string; total: number }> => [
  { customer: 'Ada', total: 12 },
  { customer: 'Lin', total: 3 },
  { customer: 'Ada', total: 5 },
];
const REF = { $t: 'dataset', name: 'rows', hash: 'h1', typeName: 'Row' };
const TOTAL = 'function total(rows) { let t = 0; for (const r of rows) t += r.total; return t; }';
const TOP = 'function top(rows) { return [...rows].sort((a, b) => b.total - a.total).slice(0, 2); }';
const BIG = 'function big(n) { return "x".repeat(n); }';
const APPLY = 'function apply(f, x) { return f(x); }';

describe('ReplCore datasets', () => {
  it('bindDataset binds the SAME array; snapshotEnv writes a ref; datasets() lists the binding', () => {
    const core = new ReplCore();
    const rows = ROWS();
    core.bindDataset('rows', 'h1', rows, 'Row');
    core.evaluate('n = rows.length');
    expect(core.snapshotEnv()).toEqual({ rows: REF, n: 3 });
    expect(core.datasets()).toEqual([{ name: 'rows', hash: 'h1', typeName: 'Row' }]);
    // rows are read-only: an in-place change is refused with a clear message, the binding is unchanged
    expect(core.evaluate('rows.push({ customer: "Zed", total: 1 })')).toEqual({
      kind: 'error',
      errorName: 'TypeError',
      message: 'rows is a dataset and is read-only; make a copy first, e.g. rows.slice().sort(...) or rows = rows.filter(...)',
    });
    expect(rows).toHaveLength(3);
    expect(Object.isFrozen(rows) && Object.isFrozen(rows[0])).toBe(true);
    expect(core.snapshotEnv().rows).toEqual(REF);
  });

  it('an alias IS the dataset (ref); reassigning the dataset variable unregisters it and both encode as values', () => {
    const core = new ReplCore();
    core.bindDataset('rows', 'h1', ROWS(), 'Row');
    core.evaluate('all = rows');
    expect(core.snapshotEnv()).toEqual({ rows: REF, all: REF });
    core.evaluate('rows = rows.slice(0, 1)');
    expect(core.datasets()).toEqual([]);
    const snap = core.snapshotEnv();
    expect(snap.rows).toEqual([{ customer: 'Ada', total: 12 }]);
    expect(snap.all).toEqual(ROWS());
  });

  it('a user object shaped like a ref is escaped by the encoder, never mistaken for a dataset', () => {
    const core = new ReplCore();
    core.evaluate('fake = { $t: "dataset", name: "rows", hash: "h1", typeName: "Row" }');
    const snap = core.snapshotEnv();
    expect(snap.fake).toEqual({ $t: 'object', v: { $t: 'dataset', name: 'rows', hash: 'h1', typeName: 'Row' } });
    const other = new ReplCore();
    expect(other.restoreEnv(snap, { h1: ROWS() })).toEqual([]);
    expect(other.evaluate('fake.hash')).toMatchObject({ shown: '"h1"' });
    expect(other.datasets()).toEqual([]);
  });

  it('restoreEnv resolves refs to the SAME array (aliases too) and re-registers the dataset', () => {
    const rows = ROWS();
    const core = new ReplCore();
    const lost = core.restoreEnv({ rows: REF, all: REF, n: 3 }, { h1: rows });
    expect(lost).toEqual([]);
    expect(core.datasets()).toEqual([{ name: 'rows', hash: 'h1', typeName: 'Row' }]);
    expect(core.evaluate('rows === all')).toMatchObject({ shown: 'true' });
    // restored rows are read-only too (a rebuilt worker goes through restoreEnv)
    expect(core.evaluate('rows[0].total = 99')).toMatchObject({ kind: 'error', errorName: 'TypeError', message: expect.stringMatching(/^rows is a dataset and is read-only/) });
    expect(rows[0]!.total).toBe(12);
    expect(core.evaluate('rows[0] === all[0]')).toMatchObject({ shown: 'true' }); // the variable IS the given array
    expect(core.snapshotEnv()).toEqual({ rows: REF, all: REF, n: 3 });
  });

  it('restoreEnv drops refs whose hash is missing and reports them like unserializable variables', () => {
    const core = new ReplCore();
    const lost = core.restoreEnv({ rows: REF, f: { $t: 'unserializable', show: '[Function]' }, n: 1 }, {});
    expect(lost).toEqual(['rows', 'f']);
    expect(core.snapshotEnv()).toEqual({ n: 1 });
    expect(core.evaluate('rows')).toMatchObject({ kind: 'error', errorName: 'ReferenceError' });
    expect(core.datasets()).toEqual([]);
    // a later reset replaces the registry too
    core.reset({}, { rows: REF }, { h1: ROWS() });
    expect(core.datasets()).toHaveLength(1);
    core.reset({}, {});
    expect(core.datasets()).toEqual([]);
  });

  it('undefined-call: an argument that IS the dataset is typed `Row[]` and named; an equal copy is inferred normally', () => {
    const core = new ReplCore();
    core.bindDataset('rows', 'h1', ROWS(), 'Row');
    expect(core.evaluate('summarize(rows, 2)')).toMatchObject({
      kind: 'undefined-call',
      argTypes: ['Row[]', 'number'],
      argDatasets: ['rows', null],
    });
    const copy = core.evaluate('summarize(rows.slice(), 2)');
    expect(copy).toMatchObject({ kind: 'undefined-call', argTypes: ['{ customer: string; total: number }[]', 'number'] });
    expect(copy).not.toHaveProperty('argDatasets');
    const json = core.evaluate('summarize(JSON.parse(JSON.stringify(rows)))');
    expect(json).not.toHaveProperty('argDatasets');
  });

  it('unbindDataset deletes the variable and the binding', () => {
    const core = new ReplCore();
    core.bindDataset('rows', 'h1', ROWS(), 'Row');
    core.unbindDataset('rows');
    expect(core.snapshotEnv()).toEqual({});
    expect(core.datasets()).toEqual([]);
  });

  it('bindDataset refuses a committed function name and non-arrays', () => {
    const core = coreWith({ total: TOTAL });
    expect(() => core.bindDataset('total', 'h1', ROWS(), 'Row')).toThrow(/committed function/);
    expect(() => core.bindDataset('x', 'h1', {} as unknown as unknown[], 'Row')).toThrow(/array/);
  });
});

describe('ReplCore datasets are read-only', () => {
  const MUTATE = 'function addOne(rows) { rows.push({ customer: "Zed", total: 1 }); return rows.length; }';
  const SORTS = 'function sortIt(rows) { return rows.sort((a, b) => a.total - b.total); }';

  it('in-place sort / delete / assignment from a REPL line get the read-only message; copies work', () => {
    const core = new ReplCore();
    core.bindDataset('rows', 'h1', ROWS(), 'Row');
    for (const line of ['rows.sort((a, b) => a.total - b.total)', 'delete rows[0]', 'rows.length = 0', 'rows[0].customer = "x"', 'rows.reverse()']) {
      expect(core.evaluate(line), line).toMatchObject({ kind: 'error', errorName: 'TypeError', message: expect.stringMatching(/^rows is a dataset and is read-only; make a copy first/) });
    }
    expect(core.evaluate('rows.slice().sort((a, b) => a.total - b.total)[0].total')).toMatchObject({ kind: 'value', shown: '3' });
    expect(core.evaluate('rows.map((r) => r.total)')).toMatchObject({ kind: 'value', shown: '[12, 3, 5]' });
    // reassigning is allowed (it unregisters the dataset, as before)
    expect(core.evaluate('rows = rows.filter((r) => r.total > 4)')).toMatchObject({ kind: 'value' });
    expect(core.datasets()).toEqual([]);
  });

  it('names the alias the line used', () => {
    const core = new ReplCore();
    core.bindDataset('rows', 'h1', ROWS(), 'Row');
    core.evaluate('all = rows');
    expect(core.evaluate('all.pop()')).toMatchObject({ message: expect.stringMatching(/^all is a dataset and is read-only/) });
  });

  it('an unrelated TypeError keeps its own message', () => {
    const core = new ReplCore();
    core.bindDataset('rows', 'h1', ROWS(), 'Row');
    expect(core.evaluate('null.x')).toMatchObject({ kind: 'error', errorName: 'TypeError', message: expect.not.stringMatching(/dataset/) });
    const other = new ReplCore();
    expect(other.evaluate('Object.freeze([1]).push(2)')).toMatchObject({ kind: 'error', errorName: 'TypeError', message: expect.not.stringMatching(/dataset/) });
  });

  it('a committed function that writes to the rows faults with the purity message', () => {
    const core = coreWith({ addOne: MUTATE, sortIt: SORTS });
    core.bindDataset('rows', 'h1', ROWS(), 'Row');
    for (const call of ['addOne(rows)', 'sortIt(rows)']) {
      const out = core.evaluate(call);
      expect(out, call).toMatchObject({ kind: 'fault', fn: call.slice(0, call.indexOf('(')), errorName: 'InvariantViolation', message: expect.stringMatching(/^candidate mutated its argument \(/) });
    }
    // a copy is the caller's to change
    expect(core.evaluate('addOne(rows.slice())')).toMatchObject({ kind: 'value', shown: '4' });
  });

  it('pins and env snapshots stay consistent with the stored rows after attempted mutations', () => {
    const msgs: RuntimeMessage[] = [];
    const dispatch = createDispatcher((m) => msgs.push(m));
    const stored = ROWS();
    dispatch({ id: 1, type: 'define', name: 'total', js: TOTAL });
    dispatch({ id: 2, type: 'bindDataset', name: 'rows', hash: 'h1', rows: stored, typeName: 'Row' });
    dispatch({ id: 3, type: 'evaluate', input: 'rows.push({ customer: "Zed", total: 1000 })' });
    dispatch({ id: 4, type: 'evaluate', input: 'rows.sort((a, b) => b.total - a.total)' });
    dispatch({ id: 5, type: 'evaluate', input: 'total(rows)' });
    const reply = msgs.find((m): m is Extract<RuntimeMessage, { type: 'reply'; ok: true }> => m.type === 'reply' && m.id === 5 && m.ok)!;
    const out = reply.result as { kind: string; shown: string; callRecords: Array<{ args: unknown[]; result: unknown }> };
    expect(out).toMatchObject({ kind: 'value', shown: '20' });
    // the pin refers to the dataset by hash, and the stored rows under that hash are exactly what total() saw
    expect(out.callRecords[0]).toMatchObject({ args: [{ kind: 'dataset', name: 'rows', hash: 'h1' }], result: 20 });
    expect(stored).toEqual(ROWS());
    expect(reply.env).toEqual({ rows: REF });
  });
});

describe('ReplCore value outcomes: encoded and table', () => {
  it('carries the encoded value', () => {
    const core = new ReplCore();
    expect(core.evaluate('[1n, NaN, "a"]')).toMatchObject({ encoded: [{ $t: 'bigint', v: '1' }, { $t: 'number', v: 'NaN' }, 'a'] });
    expect(core.evaluate('undefined')).toMatchObject({ encoded: { $t: 'undefined' } });
  });

  it('omits encoded when it is over 256 KB', () => {
    const core = new ReplCore();
    const small = core.evaluate('"x".repeat(1000)');
    expect(small).toHaveProperty('encoded');
    const big = core.evaluate('"x".repeat(300 * 1024)');
    expect(big.kind).toBe('value');
    expect(big).not.toHaveProperty('encoded');
    // multi-byte characters count in UTF-8 bytes
    expect(core.evaluate('"é".repeat(150 * 1024)')).not.toHaveProperty('encoded');
  });

  it('renders an array of plain objects as a table; missing keys are empty cells; columns in first-seen order', () => {
    const core = new ReplCore();
    const out = core.evaluate('[{ a: 1, b: "x" }, { b: "y", c: [1, 2] }, { a: null }]');
    expect(out).toMatchObject({
      kind: 'value',
      table: {
        columns: ['a', 'b', 'c'],
        rows: [
          ['1', '"x"', ''],
          ['', '"y"', '[1, 2]'],
          ['null', '', ''],
        ],
        total: 3,
      },
    });
  });

  it('truncates to 100 rows (total keeps the full length), 30 columns, and 80 characters per cell', () => {
    const core = new ReplCore();
    const out = core.evaluate('Array.from({ length: 150 }, (_, i) => ({ i, s: "z".repeat(200) }))');
    if (out.kind !== 'value' || !out.table) throw new Error('expected a table');
    expect(out.table.rows).toHaveLength(100);
    expect(out.table.total).toBe(150);
    expect(out.table.rows[99]![0]).toBe('99');
    expect(out.table.rows[0]![1]).toHaveLength(80);
    expect(out.table.rows[0]![1]!.endsWith('…')).toBe(true);
    const wide = core.evaluate('[Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["k" + i, i]))]');
    if (wide.kind !== 'value' || !wide.table) throw new Error('expected a table');
    expect(wide.table.columns).toHaveLength(30);
    expect(wide.table.columns[29]).toBe('k29');
    expect(wide.table.rows[0]).toHaveLength(30);
  });

  it('columns are the union over the first 100 rows only', () => {
    const core = new ReplCore();
    const out = core.evaluate('Array.from({ length: 120 }, (_, i) => i < 110 ? { a: i } : { a: i, late: 1 })');
    if (out.kind !== 'value' || !out.table) throw new Error('expected a table');
    expect(out.table.columns).toEqual(['a']);
  });

  it('no table for empty arrays, primitives, nested arrays, Maps, class instances or mixed arrays', () => {
    const core = new ReplCore();
    for (const expr of ['[]', '[1, 2]', '[[1, 2], [3, 4]]', '[new Map()]', '[new Date(0)]', '[{ a: 1 }, 2]', '[{ a: 1 }, null]', '{ a: 1 }', '"s"']) {
      expect(core.evaluate(expr), expr).not.toHaveProperty('table');
    }
  });

  it('never invokes a getter while building a table', () => {
    const core = new ReplCore();
    core.evaluate('hits = { n: 0 }');
    const out = core.evaluate('[Object.defineProperty({ a: 1 }, "g", { get() { hits.n++; return 1; }, enumerable: true })]');
    expect(out).toMatchObject({ table: { columns: ['a', 'g'], rows: [['1', '[Getter]']] } });
    expect(core.evaluate('hits.n')).toMatchObject({ shown: '0' });
  });

  it('the dataset itself renders as a table', () => {
    const core = new ReplCore();
    core.bindDataset('rows', 'h1', ROWS(), 'Row');
    expect(core.evaluate('rows')).toMatchObject({ table: { columns: ['customer', 'total'], total: 3 } });
  });
});

describe('ReplCore value outcomes: callRecords', () => {
  it('records a call over the dataset by reference, with the encoded result', () => {
    const core = coreWith({ total: TOTAL, top: TOP });
    core.bindDataset('rows', 'h1', ROWS(), 'Row');
    const out = core.evaluate('top(rows)');
    expect(out).toMatchObject({
      kind: 'value',
      table: { columns: ['customer', 'total'], total: 2 },
      callRecords: [
        {
          fn: 'top',
          call: expect.stringMatching(/^top\(\[/),
          args: [{ kind: 'dataset', name: 'rows', hash: 'h1' }],
          result: [
            { customer: 'Ada', total: 12 },
            { customer: 'Ada', total: 5 },
          ],
        },
      ],
    });
  });

  it('an equal-but-copied array is a value argument, not a dataset ref', () => {
    const core = coreWith({ total: TOTAL });
    core.bindDataset('rows', 'h1', ROWS(), 'Row');
    const out = core.evaluate('total(rows.slice())');
    expect(out).toMatchObject({ callRecords: [{ fn: 'total', args: [{ kind: 'value', encoded: ROWS() }], result: 20 }] });
  });

  it('nested f(g(x)) records both, in completion order (inner first)', () => {
    const core = coreWith({ median: MEDIAN, double: DOUBLE });
    const out = core.evaluate('double(median([3, 1, 2]))');
    expect(out).toMatchObject({
      calls: ['median', 'double'],
      callRecords: [
        { fn: 'median', call: 'median([3, 1, 2])', args: [{ kind: 'value', encoded: [3, 1, 2] }], result: 2 },
        { fn: 'double', call: 'double(2)', args: [{ kind: 'value', encoded: 2 }], result: 4 },
      ],
    });
  });

  it('records arguments as they were BEFORE the call', () => {
    const core = coreWith({ push: 'function push(xs) { xs.push(9); return xs.length; }' });
    const out = core.evaluate('push([1])');
    expect(out).toMatchObject({ callRecords: [{ args: [{ kind: 'value', encoded: [1] }], result: 2 }] });
  });

  it('a committed call made from inside another committed call is not recorded (not directly from the line)', () => {
    const core = coreWith({ apply: APPLY, double: DOUBLE });
    const out = core.evaluate('apply(double, 3)');
    if (out.kind !== 'value') throw new Error(out.kind);
    expect(out.callRecords).toHaveLength(1);
    // a function argument cannot be pinned
    expect(out.callRecords![0]).toMatchObject({ fn: 'apply', result: null, args: [{ kind: 'value', encoded: { $t: 'unserializable' } }, { kind: 'value', encoded: 3 }] });
  });

  it('calls made from a REPL callback are direct; records stop at 100', () => {
    const core = coreWith({ double: DOUBLE });
    const out = core.evaluate('[1, 2, 3].map((x) => double(x))');
    expect(out).toMatchObject({ callRecords: [{ call: 'double(1)', result: 2 }, { call: 'double(2)' }, { call: 'double(3)', result: 6 }] });
    const many = core.evaluate('Array.from({ length: 150 }, (_, i) => double(i)).length');
    if (many.kind !== 'value') throw new Error(many.kind);
    expect(many.callRecords).toHaveLength(100);
  });

  it('result is null when it is over 256 KB, or contains a function or an unserializable value', () => {
    const core = coreWith({ big: BIG, fnOut: 'function fnOut(x) { return { f: () => x }; }', ok: 'function ok(x) { return x; }' });
    expect(core.evaluate('big(10)')).toMatchObject({ callRecords: [{ fn: 'big', result: 'xxxxxxxxxx' }] });
    const huge = core.evaluate('big(300 * 1024).length');
    expect(huge).toMatchObject({ callRecords: [{ fn: 'big', args: [{ kind: 'value', encoded: 300 * 1024 }], result: null }] });
    expect(core.evaluate('fnOut(1)')).toMatchObject({ callRecords: [{ fn: 'fnOut', result: null }] });
    expect(core.evaluate('ok({ when: new (class K {})() })')).toMatchObject({ callRecords: [{ fn: 'ok', result: null }] });
  });

  it('an oversized non-dataset argument is not carried and makes the call unpinnable', () => {
    const core = coreWith({ ok: 'function ok(s) { return s.length; }' });
    const out = core.evaluate('ok("y".repeat(300 * 1024))');
    expect(out).toMatchObject({ callRecords: [{ fn: 'ok', args: [{ kind: 'value', encoded: null }], result: null }] });
  });

  it('a binding line still carries the call records; plain lines carry none', () => {
    const core = coreWith({ double: DOUBLE });
    expect(core.evaluate('y = double(4)')).toMatchObject({ callRecords: [{ fn: 'double', result: 8 }] });
    expect(core.evaluate('1 + 1')).not.toHaveProperty('callRecords');
  });

  it('a faulting line carries no records (the outcome is a fault)', () => {
    const core = coreWith({ median: MEDIAN });
    expect(core.evaluate('median([])')).toMatchObject({ kind: 'fault' });
  });
});
