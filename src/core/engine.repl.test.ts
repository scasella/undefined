/**
 * A usable REPL (docs/COMPOSE-DESIGN.md §B): multi-statement lines, destructuring, and statement-level resume after a
 * grow. REAL compiler, REAL gate executor, REAL REPL core and Runtime (in-process worker); only the model is scripted.
 * REPL variables are the side-effect counters: a statement that ran twice shows in its counter.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, EvalOutcome, FunctionSpec, GenerateRequest, GenerateResult, Generator, ProgressLine, ReplEntry } from '../types';
import { warmUp } from '../gates/compile';
import { executeGates } from '../sandbox/gateExecutor';
import { Runtime, type RuntimeWorkerLike } from '../sandbox/runtime';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from '../sandbox/replCore';
import { calledByInfo, createEngine, rerunText, type EngineDeps, type EngineHandle, type RuntimeLike } from './engine';
import { GenerationFailure } from './generator';
import { dependencyStatus } from '../compose/graph';
import { REFUSE } from '../shared/replSplit';
import { _useBackend, memoryBackend } from './store';

class ScriptedGenerator implements Generator {
  readonly requests: GenerateRequest[] = [];
  readonly mode = 'live' as const;
  constructor(private readonly script: Record<string, string[]>) {}
  push(fn: string, ...bodies: string[]): void {
    (this.script[fn] ??= []).push(...bodies);
  }
  async generate(req: GenerateRequest, onProgress: (p: ProgressLine) => void): Promise<GenerateResult> {
    this.requests.push(req);
    const body = this.script[req.fn]?.shift();
    if (body === undefined) throw new GenerationFailure({ code: 'recording_exhausted', message: `script for ${req.fn} is exhausted` });
    const line: ProgressLine = { t: 1, text: 'drafting', channel: 'event' };
    onProgress(line);
    return { body, notes: 'scripted', model: 'test-model', codexVersion: '0.0.1', durationMs: 3, source: 'live', progress: [line] };
  }
}

class InProcessWorker implements RuntimeWorkerLike {
  private terminated = false;
  private listener: ((m: RuntimeMessage) => void) | null = null;
  private readonly dispatch = createDispatcher((m) =>
    queueMicrotask(() => {
      if (!this.terminated) this.listener?.(m);
    }),
  );
  postMessage(req: RuntimeRequest): void {
    setTimeout(() => {
      if (!this.terminated) this.dispatch(req);
    }, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
  onMessage(cb: (m: RuntimeMessage) => void): void {
    this.listener = cb;
  }
  onError(): void {}
}

/** Every evaluate request the engine made: [text, mode]. */
type Evaluated = Array<[string, 'stmt' | undefined, number]>;

const engines: EngineHandle[] = [];

function setup(script: Record<string, string[]> = {}, opts: { deps?: Partial<EngineDeps>; intercept?: (text: string) => EvalOutcome | null } = {}) {
  const gen = new ScriptedGenerator(script);
  const evaluated: Evaluated = [];
  let clock = Date.UTC(2026, 9, 5, 9, 0, 0);
  const createRuntime = (): RuntimeLike => {
    const rt = new Runtime({ callBudgetMs: 10_000, workerFactory: () => new InProcessWorker() });
    const evaluate = rt.evaluate.bind(rt);
    // records the exact call (the number of arguments too: a one-unit line is sent exactly as before)
    rt.evaluate = (text: string, ...rest: Array<{ mode?: 'expr' | 'stmt' }>) => {
      evaluated.push([text, rest[0]?.mode === 'stmt' ? 'stmt' : undefined, 1 + rest.length]);
      const fake = opts.intercept?.(text);
      if (fake) return Promise.resolve(fake);
      return evaluate(text, ...rest);
    };
    return rt;
  };
  const engine = createEngine({
    examples: [],
    probeService: async () => ({ state: 'up', model: 'test-model', codexVersion: '0.0.1' }),
    createLiveGenerator: () => gen,
    createReplayGenerator: () => gen,
    loadRecordings: async () => [],
    createRuntime,
    execGates: (input, onGate) => Promise.resolve(executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) })),
    now: () => (clock += 1000),
    sleep: async () => {},
    pacing: { typeCharMs: 0, gateDwellMs: 0, replayMaxMs: 0 },
    inputMemory: { load: () => null, save: () => undefined },
    mutation: { idleMs: 1_000_000, quietMs: 1_000_000 },
    ...opts.deps,
  });
  engines.push(engine);
  const s = (): EngineState => engine.state.value;
  const run = async (text: string): Promise<ReplEntry[]> => {
    const before = s().repl.length;
    engine.setInput(text);
    await engine.submit();
    return s().repl.slice(before);
  };
  return { engine, gen, s, run, evaluated };
}

const outputs = (entries: ReplEntry[]) => entries.filter((e): e is Extract<ReplEntry, { kind: 'output' }> => e.kind === 'output');
const errors = (entries: ReplEntry[]) => entries.filter((e): e is Extract<ReplEntry, { kind: 'error' }> => e.kind === 'error' && e.message !== '' && !/ is not defined$/.test(e.message));
const texts = (entries: ReplEntry[]) => entries.filter((e) => e.kind !== 'input').map((e) => (e.kind === 'info' ? e.text : e.kind === 'error' ? `${e.name}: ${e.message}` : e.kind === 'output' ? `=> ${e.value}` : '')).join('\n');

const DOUBLE = 'return arg0 * 2;';
const TRIPLE = 'return arg0 * 3;';

beforeAll(async () => {
  await warmUp();
}, 60_000);
beforeEach(() => _useBackend(memoryBackend()));
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  _useBackend(null);
});

describe('REPL: one-unit lines are sent exactly as before', () => {
  it('a single expression or binding goes to the runtime whole, with one argument (no parser)', async () => {
    const { engine, run, evaluated } = setup({ double: [DOUBLE] });
    await engine.init();
    const grew = await run('double(21)');
    expect(outputs(grew)[0]!.value).toBe('42');
    // the undefined call, then the same line again once double exists
    expect(evaluated).toEqual([['double(21)', undefined, 1], ['double(21)', undefined, 1]]);
    evaluated.length = 0;
    await run('const x = double(2);');
    await run('y = x + 1');
    await run('{ a: 1 }');
    expect(evaluated.map((e) => e[0])).toEqual(['const x = double(2);', 'y = x + 1', '{ a: 1 }']);
    expect(evaluated.every((e) => e[2] === 1)).toBe(true);
  });

  it('`x = 1, y = 2` is a comma expression: x is 1, y is 2', async () => {
    const { engine, run, s } = setup();
    await engine.init();
    const out = await run('x = 1, y = 2');
    expect(outputs(out)[0]!.value).toBe('2');
    expect(s().env).toMatchObject({ x: '1', y: '2' });
  });
});

describe('REPL: several statements', () => {
  it('runs each statement once; the result is the last statement\'s value', async () => {
    const { engine, run, s, evaluated } = setup();
    await engine.init();
    const out = await run('n = 0; n = n + 1; n * 10');
    expect(texts(out)).toBe('=> 10');
    expect(s().env).toMatchObject({ n: '1' });
    expect(evaluated.map((e) => e[0])).toEqual(['n = 0', 'n = n + 1', 'n * 10']);
  });

  it('after a grow, only the statement that called the function runs again: earlier statements never do', async () => {
    const { engine, run, s, gen, evaluated } = setup({ double: [DOUBLE] });
    await engine.init();
    const out = await run('n = 0; n = n + 1; double(21)');
    expect(outputs(out).map((o) => o.value)).toEqual(['42']);
    expect(s().env).toMatchObject({ n: '1' });
    expect(gen.requests.map((r) => r.fn)).toEqual(['double']);
    expect(evaluated.map((e) => e[0])).toEqual(['n = 0', 'n = n + 1', 'double(21)', 'double(21)']);
    expect(texts(out)).toContain('Re-ran statement 3 of 3 from its start; statements 1–2 were not run again.');
    expect(texts(out)).toContain(rerunText(2, 3));
    expect(outputs(out)[0]!.label).toBe('generated');
  });

  it('a side effect earlier in the SAME statement runs again (the documented limit)', async () => {
    const { engine, run, s } = setup({ double: [DOUBLE] });
    await engine.init();
    await run('n = 0; (n = n + 1, double(21))');
    expect(s().env).toMatchObject({ n: '2' });
  });

  it('grows undefined functions in different statements in order, each once; statements between them run once', async () => {
    const { engine, run, s, gen } = setup({ double: [DOUBLE], triple: [TRIPLE] });
    await engine.init();
    const out = await run('k = 0; a = double(2); k = k + 1; b = triple(a); k = k + 1; [k, a, b]');
    expect(outputs(out).map((o) => o.value)).toEqual(['[2, 4, 12]']);
    expect(gen.requests.map((r) => r.fn)).toEqual(['double', 'triple']);
    expect(s().env).toMatchObject({ k: '2', a: '4', b: '12' });
    expect(texts(out)).toContain(rerunText(1, 6));
    expect(texts(out)).toContain(rerunText(3, 6));
  });

  it('two undefined functions in one statement grow innermost first, re-running that statement after each', async () => {
    const { engine, run, s, gen } = setup({ double: [DOUBLE], triple: [TRIPLE] });
    await engine.init();
    const out = await run('n = 0; (n = n + 1, double(triple(1)))');
    expect(outputs(out).map((o) => o.value)).toEqual(['6']);
    expect(gen.requests.map((r) => r.fn)).toEqual(['triple', 'double']);
    expect(s().env).toMatchObject({ n: '3' });
  });

  it('a loop statement re-runs from its start after a grow, and its assignments reach REPL variables', async () => {
    const { engine, run, s } = setup({ double: [DOUBLE] });
    await engine.init();
    const out = await run('total = 0; for (const x of [1, 2, 3]) total += double(x); total');
    expect(outputs(out).map((o) => o.value)).toEqual(['12']);
    expect(s().env).toMatchObject({ total: '12' });
    expect(s().env).not.toHaveProperty('x');
  });

  it('a trailing statement shows undefined; if/else and blocks run for their effect', async () => {
    const { engine, run, s, evaluated } = setup();
    await engine.init();
    const out = await run('x = 5; if (x > 3) { big = true } else { big = false }');
    expect(texts(out)).toBe('=> undefined');
    expect(s().env).toMatchObject({ big: 'true' });
    expect(evaluated.at(-1)).toEqual(['if (x > 3) { big = true } else { big = false }', 'stmt', 2]);
  });

  it('an error stops the line: later statements do not run, and the message names the statement', async () => {
    const { engine, run, s } = setup();
    await engine.init();
    const out = await run('a = 1; b = nope + 1; c = 3');
    expect(errors(out).map((e) => `${e.name}: ${e.message}`)).toEqual(['ReferenceError: nope is not defined (statement 2 of 3)']);
    expect(s().env).toMatchObject({ a: '1' });
    expect(s().env).not.toHaveProperty('b');
    expect(s().env).not.toHaveProperty('c');
  });

  it('a fault in statement 3 of 4 names it; a retry regrows and resumes at statement 3 (statements 1–2 never re-run)', async () => {
    const { engine, run, s, gen, evaluated } = setup({
      inv: ['if (arg0 === 0) throw new Error("zero"); return 1 / arg0;', 'return arg0 === 0 ? 0 : 1 / arg0;'],
    });
    await engine.init();
    await run('inv(2)');
    evaluated.length = 0;
    const out = await run('c = 0; c = c + 1; r = inv(0); d = 1');
    const err = errors(out)[0]!;
    expect(`${err.name}: ${err.message}`).toBe('Error: inv(0) threw Error: zero (statement 3 of 4)');
    expect(s().env).toMatchObject({ c: '1' });
    expect(s().env).not.toHaveProperty('d');

    const before = s().repl.length;
    await engine.invokeRestart(err.id, 'retry');
    const after = s().repl.slice(before);
    expect(gen.requests.map((r) => r.fn)).toEqual(['inv', 'inv']);
    expect(s().env).toMatchObject({ c: '1', r: '0', d: '1' });
    expect(evaluated.map((e) => e[0])).toEqual(['c = 0', 'c = c + 1', 'r = inv(0)', 'r = inv(0)', 'd = 1']);
    expect(texts(after)).toContain(rerunText(2, 4));
    expect(outputs(after).map((o) => o.value)).toEqual(['1']);
  });

  it('a timeout in statement 2 says the program was restored to before it; later statements do not run', async () => {
    const { engine, run, s } = setup(
      { double: [DOUBLE] },
      { intercept: (text) => (text === 'slow = double(1)' ? { kind: 'timeout', ms: 1500, fn: 'double', call: 'double(1)' } : null) },
    );
    await engine.init();
    await run('double(1)');
    const out = await run('a = 1; slow = double(1); c = 3');
    const err = errors(out)[0]!;
    expect(err.name).toBe('TimeoutError');
    expect(err.message).toMatch(/^double\(1\) exceeded \d+ ms and was terminated; the program was restored to before statement 2 \(statement 2 of 3\)$/);
    expect(s().env).toMatchObject({ a: '1' });
    expect(s().env).not.toHaveProperty('c');
  });

  it('a grow that fails offers a retry that resumes at the failing statement', async () => {
    const { engine, run, s, gen } = setup({ double: [] });
    await engine.init();
    const out = await run('m = 0; m = m + 1; v = double(4); w = v + 1');
    const err = out.filter((e): e is Extract<ReplEntry, { kind: 'error' }> => e.kind === 'error' && e.name === 'GenerationFailed').at(-1)!;
    expect(err).toBeDefined();
    expect(s().env).toMatchObject({ m: '1' });
    gen.push('double', DOUBLE);
    await engine.invokeRestart(err.id, 'retry');
    expect(s().env).toMatchObject({ m: '1', v: '8', w: '9' });
  });
});

describe('REPL: declarations and destructuring', () => {
  it('binds object and array patterns, defaults, rest, holes and several declarators', async () => {
    const { engine, run, s } = setup();
    await engine.init();
    await run('const {a, b = 9, ...rest} = {a: 1, c: 3}; let [x, , y] = [1, 2, 3]');
    await run('let p, q = 2');
    expect(s().env).toMatchObject({ a: '1', b: '9', x: '1', y: '3', q: '2', p: 'undefined' });
    expect(s().env.rest).toMatch(/c: 3/);
  });

  it('`const a = 1, b = 2` binds both (it is not one binding of a comma expression)', async () => {
    const { engine, run, s } = setup();
    await engine.init();
    const out = await run('const a = 1, b = 2');
    expect(s().env).toMatchObject({ a: '1', b: '2' });
    expect(outputs(out)[0]!.value).toBe('2');
  });

  it('a destructuring declaration whose value calls an undefined function grows it, then binds', async () => {
    const { engine, run, s } = setup({ pair: ['return [arg0, arg0 * 2];'] });
    await engine.init();
    await run('n = 0; n = n + 1; const [lo, hi] = pair(5); lo + hi');
    expect(s().env).toMatchObject({ n: '1', lo: '5', hi: '10' });
  });

  it('refuses function and class declarations, top-level return and await, and type annotations', async () => {
    const { engine, run, s } = setup();
    await engine.init();
    const msgs: string[] = [];
    for (const line of ['function f() { return 1 }; f()', 'class A {}; 1', 'return 1', 'x = 1; await x', 'let x: number = 1']) {
      const out = await run(line);
      msgs.push(...errors(out).map((e) => `${e.name}: ${e.message}`));
    }
    expect(msgs).toEqual([
      `SyntaxError: ${REFUSE.function}`,
      `SyntaxError: ${REFUSE.class}`,
      `SyntaxError: ${REFUSE.return}`,
      `SyntaxError: ${REFUSE.await}`,
      `SyntaxError: ${REFUSE.types}`,
    ]);
    // nothing ran
    expect(s().env).toEqual({});
  });

  it('a line the scan misses but the runtime finds to be statements is split and run from its first statement', async () => {
    const { engine, run, s, evaluated } = setup();
    await engine.init();
    // a block with two statements: no top-level `;`, does not start with a keyword
    const out = await run('{ u = 1; v = 2 }');
    expect(texts(out)).toBe('=> undefined');
    expect(s().env).toMatchObject({ u: '1', v: '2' });
    expect(evaluated.map((e) => [e[0], e[1]])).toEqual([['{ u = 1; v = 2 }', undefined], ['{ u = 1; v = 2 }', 'stmt']]);
  });

  it('a syntax error in a multi-statement line names the problem and runs nothing', async () => {
    const { engine, run, s } = setup();
    await engine.init();
    const out = await run('a = 1; b = (2');
    expect(errors(out).map((e) => `${e.name}: ${e.message}`)).toEqual(['SyntaxError: unexpected end of input: a `(` is never closed (missing `)`)']);
    expect(s().env).toEqual({});
  });
});

describe('REPL: pins, history and recordings keep whole lines', () => {
  it('pins the last statement\'s call with its real arguments; a line ending in a non-call offers nothing', async () => {
    const { engine, run } = setup({ double: [DOUBLE] });
    await engine.init();
    await run('double(1)');
    const pinned = await run('a = 3; double(a)');
    expect(outputs(pinned)[0]!.pinnable).toMatchObject({ fn: 'double', call: 'double(3)' });
    const none = await run('b = double(a); b + 1');
    expect(outputs(none)[0]!.value).toBe('7');
    expect(outputs(none)[0]!.pinnable).toBeUndefined();
  });

  it('history keeps the whole line', async () => {
    const saved: string[] = [];
    const { engine, run } = setup({}, { deps: { inputMemory: { load: () => null, save: (t) => void saved.push(t) } } });
    await engine.init();
    await run('a = 1; a + 1');
    expect(saved).toEqual(['a = 1; a + 1']);
    expect(engine.state.value.repl.filter((e) => e.kind === 'input').map((e) => (e as { text: string }).text)).toEqual(['a = 1; a + 1']);
  });
});

describe('REPL: an undefined callee reached inside a generated function', () => {
  const SLUGIFY: FunctionSpec = {
    name: 'slugify',
    params: [{ name: 'title', type: 'string' }],
    returns: 'string',
    doc: 'Turns a title into a URL slug.',
    tests: `test("words", () => eq(slugify("Hello World"), "hello-world"));`,
    properties: '',
    budgetMs: 1000,
    maxAttempts: 3,
    origin: 'user',
  };
  const SLUGIFY_ALL: FunctionSpec = {
    ...SLUGIFY,
    name: 'slugifyAll',
    params: [{ name: 'titles', type: 'string[]' }],
    returns: 'string[]',
    doc: 'Slugs for a list of titles, in order.',
    tests: `test("each", () => eq(slugifyAll(["Hello World"]), ["hello-world"]));`,
  };
  const GOOD = 'return title.toLowerCase().split(" ").filter((w) => w !== "").join("-");';
  const GOOD_2 = 'return title.toLowerCase().split(/\\s+/).filter((w) => w !== "").join("-");';

  it('grows the callee with calledBy, re-checks the caller, and re-runs only the statement that called it', async () => {
    const { engine, run, s, gen } = setup({ slugify: [GOOD], slugifyAll: ['return titles.map((t) => slugify(t));'] });
    await engine.init();
    await engine.upsertSpec(SLUGIFY);
    await engine.upsertSpec(SLUGIFY_ALL);
    await run('slugify("Hello World")');
    await run('slugifyAll(["Hello World"])');
    await engine.editSpec('slugify', { doc: 'Turns a title into a URL slug (v2).' });
    expect(dependencyStatus(s().program, 'slugifyAll').kind).toBe('waiting');
    gen.push('slugify', GOOD_2);

    const out = await run('n = 0; n = n + 1; xs = slugifyAll(["A b"]); n = n + 1');
    expect(texts(out)).toContain(calledByInfo('slugify', 'slugifyAll'));
    expect(texts(out)).toContain(rerunText(2, 4));
    expect(s().env).toMatchObject({ n: '2', xs: '["a-b"]' });
    expect(outputs(out).map((o) => o.value)).toEqual(['2']);
    expect(dependencyStatus(s().program, 'slugifyAll').kind).toBe('current');
    expect(gen.requests.filter((r) => r.fn === 'slugifyAll')).toHaveLength(1);
  });
});

describe('rerunText', () => {
  it('names the statement and says the earlier ones did not run again', () => {
    expect(rerunText(0, 3)).toBe('Re-ran statement 1 of 3 from its start.');
    expect(rerunText(1, 3)).toBe('Re-ran statement 2 of 3 from its start; statement 1 was not run again.');
    expect(rerunText(3, 6)).toBe('Re-ran statement 4 of 6 from its start; statements 1–3 were not run again.');
  });
});

describe('REPL: adversarial lines never re-run an earlier statement', () => {
  const counted = async () => {
    const t = setup({ double: [DOUBLE], triple: [TRIPLE] });
    await t.engine.init();
    await t.run('n = 0');
    return t;
  };
  const cases: Array<[string, string, string]> = [
    ['a string holding ;', 'n = n + 1; s = "a;b"; double(n)', '2'],
    ['a template holding ; in ${}', 'n = n + 1; s = `x${";"}y`; double(n)', '2'],
    ['comments holding ;', 'n = n + 1 /* ; */; double(n) // ; trailing', '2'],
    ['a labeled statement', 'n = n + 1; lbl: for (const i of [1]) { break lbl; } double(n)', '2'],
    ['var declared twice', 'var q = n = n + 1; var q = double(q)', '2'],
    ['a destructuring default that calls an undefined function', 'n = n + 1; const { a = double(n) } = {}', '{}'],
    ['a getter that calls an undefined function', 'n = n + 1; o = { get g() { return double(1); } }; o.g', '2'],
    // the fast-path scan misses the `;` here (a regex holding `//` or a quote); the runtime's compile error sends the
    // line to the parser before anything ran
    ['a regex holding // before the first ;', 'n = n + 1, u = "http://x".replace(/^https?:\\/\\//, ""); double(n)', '2'],
    ['a regex holding a quote before the first ;', 'n = n + 1, w = /"/.test("a"); double(n)', '2'],
  ];
  for (const [name, line, value] of cases) {
    it(name, async () => {
      const t = await counted();
      const out = await t.run(line);
      expect(errors(out)).toEqual([]);
      expect(outputs(out).map((o) => o.value)).toEqual([value]);
      expect(t.s().env.n).toBe('1');
    });
  }

  it('an error the code throws is never taken for "nothing ran", even with the statements message', async () => {
    const t = await counted();
    const out = await t.run('n = n + 1, (() => { throw new SyntaxError("a REPL line must be one expression or one binding (x = …); this parses only as statements"); })()');
    expect(errors(out).map((e) => e.name)).toEqual(['SyntaxError']);
    expect(t.s().env.n).toBe('1');
  });

  it('a genuinely broken one-expression line keeps the runtime\'s message', async () => {
    const t = await counted();
    const out = await t.run('median([1, 2');
    expect(errors(out).map((e) => e.message)).toEqual(['unexpected end of input: a `[` is never closed (missing `]`)']);
  });

  it('refuses a return nested in a top-level statement instead of silently ending it', async () => {
    const t = await counted();
    const out = await t.run('n = n + 1; if (n > 0) { return 1 } n = n + 1');
    expect(errors(out).map((e) => e.message)).toEqual([REFUSE.return]);
    expect(t.s().env.n).toBe('0');
  });
});
