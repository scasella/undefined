/**
 * Composition end to end (docs/COMPOSE-DESIGN.md §A): one generated function calling another, with the REAL compile
 * gate (ambient declarations, dependency extraction), the REAL gate executor (linked callees), the REAL REPL core
 * (late-bound callees) and the REAL store. Only the model is scripted.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, FunctionSpec, GenerateRequest, GenerateResult, Generator, ProgressLine, ReplEntry } from '@scasella/undefined-engine/types';
import { warmUp } from '@scasella/undefined-engine/gates/compile';
import { executeGates, type ExecGateInput } from '@scasella/undefined-engine/sandbox/gateExecutor';
import { Runtime, type RuntimeWorkerLike } from '../sandbox/runtime';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from '../sandbox/replCore';
import { buildPrompt } from '../shared/prompt';
import { calledByInfo, createEngine, type EngineDeps, type EngineHandle } from './engine';
import { GenerationFailure } from './generator';
import { isLive, jsFunctions } from '@scasella/undefined-engine/program';
import { _useBackend, memoryBackend, validateImage } from './store';
import { closureHash, dependencyLine, dependencyStatus, implHash } from '@scasella/undefined-engine/compose/graph';

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
const SLUGIFY_GOOD = `return title.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");`;
/** Passes slugify's own (weak) test, but keeps runs of separators: "A  b" → "a--b". */
const SLUGIFY_WEAK = `return title.toLowerCase().split(" ").join("-");`;
/** Another correct slugify (a different body: a different implHash). */
const SLUGIFY_GOOD_2 = `const plain = title.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
return plain.split(/[^a-z0-9]+/).filter((w) => w !== "").join("-");`;

const SLUGIFY_ALL: FunctionSpec = {
  name: 'slugifyAll',
  params: [{ name: 'titles', type: 'string[]' }],
  returns: 'string[]',
  doc: 'Slugs for a list of titles, in order.',
  tests: `test("each", () => eq(slugifyAll(["Hello World", "A  b"]), ["hello-world", "a-b"]));`,
  properties: '',
  budgetMs: 1000,
  maxAttempts: 3,
  origin: 'user',
};
const SLUGIFY_ALL_BODY = 'return titles.map((t) => slugify(t));';

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

const engines: EngineHandle[] = [];

function setup(script: Record<string, string[]> = {}, deps: Partial<EngineDeps> = {}) {
  const gen = new ScriptedGenerator(script);
  const gateInputs: ExecGateInput[] = [];
  let clock = Date.UTC(2026, 9, 5, 9, 0, 0);
  const engine = createEngine({
    examples: [],
    probeService: async () => ({ state: 'up', model: 'test-model', codexVersion: '0.0.1' }),
    createLiveGenerator: () => gen,
    createReplayGenerator: () => gen,
    loadRecordings: async () => [],
    createRuntime: () => new Runtime({ callBudgetMs: 10_000, workerFactory: () => new InProcessWorker() }),
    execGates: (input, onGate) => {
      gateInputs.push(input);
      return Promise.resolve(executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) }));
    },
    now: () => (clock += 1000),
    sleep: async () => {},
    pacing: { typeCharMs: 0, gateDwellMs: 0, replayMaxMs: 0 },
    inputMemory: { load: () => null, save: () => undefined },
    mutation: { idleMs: 1_000_000, quietMs: 1_000_000 },
    ...deps,
  });
  engines.push(engine);
  const s = (): EngineState => engine.state.value;
  const run = async (text: string): Promise<ReplEntry[]> => {
    const before = s().repl.length;
    engine.setInput(text);
    await engine.submit();
    return s().repl.slice(before);
  };
  return { engine, gen, s, run, gateInputs };
}

const outputs = (entries: ReplEntry[]) => entries.filter((e): e is Extract<ReplEntry, { kind: 'output' }> => e.kind === 'output');
const texts = (entries: ReplEntry[]) => entries.map((e) => (e.kind === 'info' ? e.text : e.kind === 'error' ? `${e.name}: ${e.message}` : e.kind === 'output' ? `=> ${e.value}` : '')).join('\n');

/** slugify committed, then slugifyAll committed calling it. */
async function composed(extra: Record<string, string[]> = {}) {
  const t = setup({ slugify: [SLUGIFY_GOOD], slugifyAll: [SLUGIFY_ALL_BODY], ...extra });
  await t.engine.init();
  await t.engine.upsertSpec(SLUGIFY);
  await t.engine.upsertSpec(SLUGIFY_ALL);
  const first = await t.run('slugify("Hello World")');
  const second = await t.run('slugifyAll(["Hello World", "Crème Brûlée"])');
  return { ...t, first, second };
}

beforeAll(async () => {
  await warmUp();
}, 60_000);
beforeEach(() => _useBackend(memoryBackend()));
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  _useBackend(null);
});

describe('composition: a generated function calls another', () => {
  it('lists certified functions in the prompt, records the dependency, and runs through it', async () => {
    const { s, gen, first, second } = await composed();
    expect(outputs(first)[0]!.value).toBe('"hello-world"');
    expect(outputs(second)[0]!.value).toBe('["hello-world", "creme-brulee"]');

    // slugify grew while slugifyAll had only a spec: nothing to list, the prompt is exactly the composition-free one
    const [p1, p2] = gen.requests;
    expect(p1!.prompt).toBe(buildPrompt({ spec: SLUGIFY, history: [] }));
    expect(p1!.prompt).not.toContain('OTHER FUNCTIONS');
    // slugifyAll's prompt lists slugify, after FUNCTION and before the requirements; HONESTY is untouched
    expect(p2!.prompt).toContain('OTHER FUNCTIONS (already certified in this program; you may call them by name; do not redeclare them)\n- function slugify(title: string): string\n  Turns a title into a URL slug.');
    expect(p2!.prompt.indexOf('OTHER FUNCTIONS')).toBeGreaterThan(p2!.prompt.indexOf('Your body is compiled exactly as:'));
    expect(p2!.prompt.indexOf('OTHER FUNCTIONS')).toBeLessThan(p2!.prompt.indexOf('REQUIREMENTS FOR THE BODY'));
    expect(p2!.prompt).toContain(buildPrompt({ spec: SLUGIFY_ALL, history: [] }).split('\n\n').find((x) => x.startsWith('HONESTY'))!);

    const program = s().program;
    const all = program.functions.slugifyAll!.artifact!;
    const slug = program.functions.slugify!.artifact!;
    expect(all.deps).toEqual({ slugify: { hash: implHash(slug), revision: slug.revision } });
    expect(program.functions.slugify!.artifact!.deps).toBeUndefined();
    expect(dependencyStatus(program, 'slugifyAll').kind).toBe('current');
    expect(dependencyLine(program, 'slugifyAll')).toBe(`Calls slugify (r${slug.revision}); certified with that version.`);
    // the source the model's body was compiled as is unchanged by the ambient declarations
    expect(all.source).toBe('function slugifyAll(titles: string[]): string[]\n{\nreturn titles.map((t) => slugify(t));\n}\n');
    expect(jsFunctions(program).slugifyAll!.deps).toEqual(['slugify']);
  });

  it('gates the dependent through its callees: the gate input carries the closure; a zero-dependency gate input has no deps key', async () => {
    const { gateInputs } = await composed();
    const slugifyRun = gateInputs.find((i) => i.name === 'slugify')!;
    expect('deps' in slugifyRun).toBe(false);
    const allRun = gateInputs.find((i) => i.name === 'slugifyAll')!;
    expect(allRun.deps!.map((d) => d.name)).toEqual(['slugify']);
    expect(allRun.deps![0]!.deps).toEqual([]);
  });

  it('pins only the outer call of a composed line', async () => {
    const { second } = await composed();
    expect(outputs(second)[0]!.pinnable!.fn).toBe('slugifyAll');
  });

  it('runs the mutation check of the dependent with its callee linked and unmutated', async () => {
    const { engine, s, gateInputs } = await composed();
    const before = gateInputs.length;
    await engine.runMutation('slugifyAll');
    const runs = gateInputs.slice(before);
    expect(runs.length).toBeGreaterThan(1);
    for (const r of runs) {
      expect(r.name).toBe('slugifyAll');
      expect(r.deps!.map((d) => d.name)).toEqual(['slugify']);
      expect(r.deps![0]!.js).toBe(s().program.functions.slugify!.artifact!.js);
    }
    expect(s().program.functions.slugifyAll!.artifact!.evidence!.mutation!.total).toBeGreaterThan(0);
  });

  it('refuses a cycle with a message that names it', async () => {
    const { engine, s, run, gen } = await composed();
    // slugify's spec changes, then its regrown body tries to call slugifyAll (which calls slugify)
    gen.push('slugify', 'return slugifyAll([title])[0]!;', SLUGIFY_GOOD);
    await engine.editSpec('slugify', { doc: 'Turns a title into a URL slug (lowercase).' });
    await run('slugify("Hello World")');
    const req = gen.requests.filter((r) => r.fn === 'slugify').at(-2)!;
    // slugifyAll calls slugify: it is not offered, and the cycle is the reason given
    expect(req.prompt).not.toContain('OTHER FUNCTIONS');
    const rejected = s().generation!.attempts[0]!.candidate!;
    expect(rejected.verdict).toBe('rejected');
    expect(rejected.headline).toBe(
      'Rejected: line 1: slugify cannot call slugifyAll: slugifyAll already calls slugify (slugifyAll → slugify): generated functions cannot call each other in a cycle.',
    );
    // the second candidate (not calling it) is committed
    expect(isLive(s().program.functions.slugify!)).toBe(true);
  });

  it('refuses a cycle between two certified functions', async () => {
    const { engine, s, run, gen } = await composed({ titleCase: ['return title.toUpperCase();'] });
    // a third function g is certified; slugify is regrown calling it; then g is regrown calling slugifyAll
    await engine.upsertSpec({ ...SLUGIFY, name: 'shout', doc: 'Upper-cases a title.', tests: `test("up", () => eq(shout("a"), "A"));` });
    gen.push('shout', 'return title.toUpperCase();');
    await run('shout("a")');
    await engine.editSpec('shout', { doc: 'Upper-cases a title (again).' });
    gen.push('shout', 'return slugifyAll([title])[0]!.toUpperCase();');
    await run('shout("a")');
    // allowed: slugifyAll does not call shout
    expect(s().program.functions.shout!.artifact!.deps).toHaveProperty('slugifyAll');
    // now slugify may not call shout: shout → slugifyAll → slugify
    await engine.editSpec('slugify', { doc: 'Turns a title into a URL slug, shouted.' });
    gen.push('slugify', 'return shout(title).toLowerCase();', SLUGIFY_GOOD);
    await run('slugify("Hello World")');
    const headline = s().generation!.attempts[0]!.candidate!.headline!;
    expect(headline).toContain('slugify cannot call shout:');
  });

  it('a waiting dependent grows its callee from the call, with the real arguments, then is re-checked and the line re-runs', async () => {
    const { engine, s, run, gen } = await composed();
    await engine.editSpec('slugify', { doc: 'Turns a title into a URL slug. Accents are dropped.' });
    expect(dependencyStatus(s().program, 'slugifyAll')).toMatchObject({ kind: 'waiting', waitingFor: ['slugify'] });
    expect(dependencyLine(s().program, 'slugifyAll')).toContain('Waiting for slugify');
    // a waiting dependent stays in the runtime (reaching its callee grows it)
    expect(jsFunctions(s().program).slugifyAll).toBeDefined();

    gen.push('slugify', SLUGIFY_GOOD_2);
    const entries = await run('slugifyAll(["Ünïcode Rocks"])');
    expect(texts(entries)).toContain(calledByInfo('slugify', 'slugifyAll'));
    expect(outputs(entries)[0]!.value).toBe('["unicode-rocks"]');
    const p = s().program;
    expect(isLive(p.functions.slugify!)).toBe(true);
    expect(dependencyStatus(p, 'slugifyAll').kind).toBe('current');
    expect(p.functions.slugifyAll!.artifact!.deps!.slugify!.hash).toBe(implHash(p.functions.slugify!.artifact!));
    // re-certified, not regrown: the model was asked for slugify only
    expect(gen.requests.filter((r) => r.fn === 'slugifyAll')).toHaveLength(1);
    const titles = s().revisions.map((r) => r.title);
    expect(titles.some((t) => /^slugifyAll re-certified: slugify changed r\d+ → r\d+; the same body passes with it$/.test(t))).toBe(true);
  });

  it('a dependent that fails with its callee\'s new code is out of date, never runs, and the next call re-checks then regrows it', async () => {
    const { engine, s, run, gen } = await composed();
    await engine.editSpec('slugify', { doc: 'Turns a title into a URL slug (v2).' });
    gen.push('slugify', SLUGIFY_WEAK);
    const regrow = await run('slugify("Hello World")');
    expect(outputs(regrow)[0]!.value).toBe('"hello-world"');
    // the eager re-check of slugifyAll failed: "A  b" now slugs to "a--b"
    expect(texts(regrow)).toContain('slugifyAll is out of date: with the new slugify it fails its checks');
    let p = s().program;
    expect(dependencyStatus(p, 'slugifyAll').kind).toBe('changed');
    expect(dependencyLine(p, 'slugifyAll')).toMatch(/^Out of date: calls slugify, which changed at r\d+ \(certified against r\d+, [0-9a-f]{6}… → [0-9a-f]{6}…\)/);
    expect(jsFunctions(p).slugifyAll).toBeUndefined();
    expect(s().generation).toMatchObject({ fn: 'slugifyAll', kind: 'recheck', phase: 'failed' });

    // the explicit re-check says the same thing and changes nothing
    const revs = s().revisions.length;
    await engine.recheck('slugifyAll');
    expect(s().revisions.length).toBe(revs);
    expect(dependencyStatus(s().program, 'slugifyAll').kind).toBe('changed');

    // calling it: re-check (fails again), then an ordinary regrow, which commits with the new stamp
    gen.push('slugifyAll', 'return titles.map((t) => slugify(t).replace(/-+/g, "-"));');
    const entries = await run('slugifyAll(["A  b"])');
    expect(texts(entries)).toContain('slugifyAll is out of date: a function it calls changed. Re-checking it');
    expect(outputs(entries)[0]!.value).toBe('["a-b"]');
    p = s().program;
    expect(dependencyStatus(p, 'slugifyAll').kind).toBe('current');
    expect(gen.requests.filter((r) => r.fn === 'slugifyAll')).toHaveLength(2);
  });

  it('a revision left out of date stays out of the runtime after a rollback', async () => {
    const { engine, s, run, gen } = await composed();
    await engine.editSpec('slugify', { doc: 'Turns a title into a URL slug (v2).' });
    gen.push('slugify', SLUGIFY_WEAK);
    await run('slugify("Hello World")');
    const outOfDate = s().headRevision;
    await engine.rollback(2);
    await engine.rollback(outOfDate);
    expect(dependencyStatus(s().program, 'slugifyAll').kind).toBe('changed');
    // calling it re-checks rather than running stale composition
    gen.push('slugifyAll', 'return titles.map((t) => slugify(t).replace(/-+/g, "-"));');
    const entries = await run('slugifyAll(["A  b"])');
    expect(texts(entries)).toContain('Re-checking it');
    expect(outputs(entries)[0]!.value).toBe('["a-b"]');
  });

  it('export → import keeps both functions live and the dependency current (image version 3); reload recompiles against the recorded callee', async () => {
    const t = await composed();
    const json = await t.engine.exportImage();
    const image = JSON.parse(json);
    expect(image.version).toBe(3);
    expect(validateImage(image).ok).toBe(true);
    // the same image claiming version 2 is refused: an older build could not link it
    expect(validateImage({ ...image, version: 2 })).toEqual({ ok: false, error: 'version must be 3: a function in the image calls another (a version 3 field)' });

    const u = setup();
    await u.engine.init();
    await u.engine.importImage(json);
    const p = u.s().program;
    expect(isLive(p.functions.slugify!)).toBe(true);
    expect(isLive(p.functions.slugifyAll!)).toBe(true);
    expect(dependencyStatus(p, 'slugifyAll').kind).toBe('current');
    const entries = await u.run('slugifyAll(["Hello World"])');
    expect(outputs(entries)[0]!.value).toBe('["hello-world"]');
    expect(outputs(entries)[0]!.label).toBe('cached artifact');
  });

  it('a reload from storage recompiles the dependent against its callee and keeps it current', async () => {
    await composed();
    const u = setup();
    await u.engine.init();
    expect(u.s().notice).toBeUndefined();
    const p = u.s().program;
    expect(isLive(p.functions.slugify!)).toBe(true);
    expect(isLive(p.functions.slugifyAll!)).toBe(true);
    expect(dependencyStatus(p, 'slugifyAll').kind).toBe('current');
    const entries = await u.run('slugifyAll(["Hello World"])');
    expect(outputs(entries)[0]).toMatchObject({ value: '["hello-world"]', label: 'cached artifact' });
  });

  it('a reload keeps a waiting dependent (its callee\'s spec moved on): compiled against the callee it was certified with', async () => {
    const t = await composed();
    // slugify's spec now returns a number: slugifyAll's body would not compile against that SPEC (string[] expected)
    await t.engine.editSpec('slugify', { returns: 'number' });
    expect(dependencyStatus(t.s().program, 'slugifyAll').kind).toBe('waiting');
    const u = setup();
    await u.engine.init();
    expect(u.s().notice).toBeUndefined();
    const p = u.s().program;
    expect(isLive(p.functions.slugifyAll!)).toBe(true);
    expect(dependencyStatus(p, 'slugifyAll').kind).toBe('waiting');
    expect(jsFunctions(p).slugifyAll).toBeDefined();
  });

  it('a waiting dependent whose callee is regrown with a new signature is re-checked against it (and fails honestly)', async () => {
    const t = await composed();
    await t.engine.editSpec('slugify', { returns: 'number', tests: 'test("len", () => eq(slugify("ab"), 2));' });
    t.gen.push('slugify', 'return title.length;');
    t.gen.push('slugifyAll', 'return titles.map((t) => String(slugify(t)));');
    const entries = await t.run('slugifyAll(["ab"])');
    // slugify regrown; slugifyAll's old body no longer compiles against it, so it is regrown too (its test now fails anyway)
    expect(texts(entries)).toContain('slugifyAll is out of date: with the new slugify it fails its checks');
    expect(t.gen.requests.filter((r) => r.fn === 'slugify').length).toBe(2);
  });

  it('a program without dependencies exports as version 1', async () => {
    const t = setup({ slugify: [SLUGIFY_GOOD] });
    await t.engine.init();
    await t.engine.upsertSpec(SLUGIFY);
    await t.run('slugify("x")');
    expect(JSON.parse(await t.engine.exportImage()).version).toBe(1);
  });

  it('the "type your own" probe of a dependent runs with its callees', async () => {
    const { engine } = await composed();
    const p = await engine.previewExpectation('slugifyAll', 'slugifyAll(["A b"])');
    expect(p).toMatchObject({ ok: true, shown: '["a-b"]' });
  });

  it('a fault inside the callee is reported for the callee, naming the caller', async () => {
    const t = setup({ slugify: ['if (title === "boom") throw new RangeError("no boom"); return title.toLowerCase();'], slugifyAll: [SLUGIFY_ALL_BODY] });
    await t.engine.init();
    await t.engine.upsertSpec({ ...SLUGIFY, tests: '' });
    await t.engine.upsertSpec({ ...SLUGIFY_ALL, tests: '' });
    await t.run('slugify("a")');
    await t.run('slugifyAll(["a"])');
    const entries = await t.run('slugifyAll(["boom"])');
    const err = entries.find((e) => e.kind === 'error')!;
    expect(err).toMatchObject({ name: 'RangeError', message: 'slugify("boom") (called by slugifyAll) threw RangeError: no boom' });
  });
  it('a change two levels down reaches the caller: h regrown, g re-certified with it, f re-checked (and kept out of the runtime when it fails)', async () => {
    const num = (name: string, tests: string): FunctionSpec => ({ name, params: [{ name: 'x', type: 'number' }], returns: 'number', doc: `${name} doc.`, tests, properties: '', budgetMs: 1000, maxAttempts: 1, origin: 'user' });
    const t = setup({ h: ['return x + 1;'], g: ['return h(x) * 2;'], f: ['return g(x) + 1;'] });
    await t.engine.init();
    await t.engine.upsertSpec(num('h', 'test("z", () => eq(h(0), 1));'));
    await t.engine.upsertSpec(num('g', 'test("z", () => eq(g(0), 2));'));
    await t.engine.upsertSpec(num('f', 'test("one", () => eq(f(1), 5));'));
    await t.run('h(0)');
    await t.run('g(0)');
    expect(outputs(await t.run('f(1)'))[0]!.value).toBe('5');
    // a leaf's stamp is its implHash; a caller's stamp of g also covers what g calls
    const before = t.s().program;
    expect(before.functions.g!.artifact!.deps!.h!.hash).toBe(implHash(before.functions.h!.artifact!));
    expect(before.functions.f!.artifact!.deps!.g!.hash).toBe(closureHash(before.functions.g!.artifact!));
    expect(closureHash(before.functions.g!.artifact!)).not.toBe(implHash(before.functions.g!.artifact!));

    // h's spec moves and h is regrown with a body that still passes h's and g's checks, but not f's
    await t.engine.editSpec('h', { doc: 'h doc, changed.' });
    t.gen.push('h', 'return x === 0 ? 1 : x + 2;');
    await t.run('h(0)');
    const p = t.s().program;
    expect(dependencyStatus(p, 'g').kind).toBe('current'); // re-certified: same body, passes with the new h
    expect(dependencyStatus(p, 'f').kind).toBe('changed'); // its closure moved, so it was re-checked, and failed
    expect(jsFunctions(p).f).toBeUndefined();
    // the certified f(1) is 5; f never runs against the closure that gives 7
    t.gen.push('f', 'return g(x) - 1;');
    const r = await t.run('f(1)');
    expect(texts(r)).not.toContain('=> 7');
    expect(outputs(r)[0]!.value).toBe('5');
  });

  it('a re-check that failed while its callee grew is not run (or reported) again when the same line re-runs its statement', async () => {
    const { engine, s, run, gen, gateInputs } = await composed();
    await engine.editSpec('slugify', { doc: 'Turns a title into a URL slug (v2).' });
    // slugifyAll waits; calling it grows slugify (weak: "A  b" → "a--b"), so slugifyAll's eager re-check fails
    gen.push('slugify', SLUGIFY_WEAK);
    gen.push('slugifyAll', 'return titles.map((t) => slugify(t).replace(/-+/g, "-"));');
    const before = gateInputs.length;
    const entries = await run('n = 0; n = n + 1; r = slugifyAll(["A  b"]); [n, r]');
    const failLine = 'slugifyAll is out of date: with the new slugify it fails its checks';
    expect(texts(entries).split(failLine).length - 1).toBe(1);
    expect(texts(entries)).not.toContain('slugifyAll is out of date: a function it calls changed. Re-checking it');
    // gate runs for slugifyAll in this line: the one failed re-check of its committed body, then the regrown draft
    const runs = gateInputs.slice(before).filter((i) => i.name === 'slugifyAll');
    expect(runs).toHaveLength(2);
    expect(runs[0]!.js).toContain('titles.map((t) => slugify(t))');
    expect(outputs(entries).at(-1)!.value).toBe('[1, ["a-b"]]');
    expect(dependencyStatus(s().program, 'slugifyAll').kind).toBe('current');
  });
});
