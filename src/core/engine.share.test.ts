/**
 * Sharing a session and loading someone else's, and the opt-in local session log, end to end in Node with the REAL
 * compiler, gate executor, REPL core and store (memory backend). A scripted generator stands in for the live model;
 * the replay side is the REAL ReplayGenerator over real recordings (the shipped median recording among them).
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, GateResult, GenerateRequest, GenerateResult, Generator, ProgressLine, Recording, ServiceStatus } from '../types';
import { warmUp } from '../gates/compile';
import { executeGates } from '../sandbox/gateExecutor';
import type { ExecGateInput } from '../sandbox/gateRunner';
import { Runtime, type RuntimeWorkerLike } from '../sandbox/runtime';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from '../sandbox/replCore';
import { EXAMPLES } from '../examples';
import { CORS_HINT } from '../share/source';
import { createSessionLog, memoryBackend as logMemory, type SessionLog } from '../sessionlog/log';
import { createEngine, RECORDING_WARNING, type EngineDeps, type EngineExample, type EngineHandle } from './engine';
import { GenerationFailure, ReplayGenerator, validateRecording } from './generator';
import { _useBackend, memoryBackend } from './store';

// ───────────────────────── harness ─────────────────────────

class ScriptedGenerator implements Generator {
  readonly requests: GenerateRequest[] = [];
  constructor(
    readonly mode: 'live' | 'replay',
    private readonly script: Record<string, string[]>,
  ) {}
  async generate(req: GenerateRequest, onProgress: (p: ProgressLine) => void): Promise<GenerateResult> {
    this.requests.push(req);
    const body = this.script[req.fn]?.shift();
    if (body === undefined) throw new GenerationFailure({ code: 'recording_exhausted', message: `script for ${req.fn} is exhausted` });
    const line: ProgressLine = { t: 1, text: 'drafting', channel: 'event' };
    onProgress(line);
    return { body, notes: 'scripted', model: 'test-model', codexVersion: '0.0.1', durationMs: 3, source: this.mode, progress: [line] };
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

const realExec = (input: ExecGateInput, onGate?: (r: GateResult) => void): Promise<GateResult[]> =>
  Promise.resolve(executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) }));

const engines: EngineHandle[] = [];
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

const UP: ServiceStatus = { state: 'up', model: 'test-model', codexVersion: '0.0.1', effort: 'medium' };
const DOWN: ServiceStatus = { state: 'down' };

function setup(
  opts: {
    service?: ServiceStatus;
    script?: Record<string, string[]>;
    examples?: EngineExample[];
    bundled?: Recording[];
    log?: SessionLog;
    deps?: Partial<EngineDeps>;
  } = {},
) {
  // every engine gets its own (empty) persisted store, as a different browser would
  _useBackend(memoryBackend());
  const service = opts.service ?? UP;
  const gen = new ScriptedGenerator('live', opts.script ?? {});
  let clock = Date.UTC(2026, 9, 4, 9, 0, 0);
  const engine = createEngine({
    examples: opts.examples ?? [],
    probeService: async () => service,
    createLiveGenerator: () => gen,
    loadRecordings: async () => opts.bundled ?? [],
    createReplayGenerator: (recs) => new ReplayGenerator(recs, { maxMs: 0 }),
    createRuntime: () => new Runtime({ callBudgetMs: 10_000, workerFactory: () => new InProcessWorker() }),
    execGates: realExec,
    now: () => (clock += 1000),
    sleep: async () => {},
    pacing: { typeCharMs: 0, gateDwellMs: 0, replayMaxMs: 0 },
    inputMemory: { load: () => null, save: () => {} },
    mutation: { idleMs: 3_600_000, quietMs: 0, timeBoxMs: 120_000 },
    createSessionLog: () => opts.log ?? createSessionLog({ backend: logMemory(), storage: memStorage() }),
    location: () => null,
    ...opts.deps,
  });
  engines.push(engine);
  const s = (): EngineState => engine.state.value;
  const run = async (text: string) => {
    engine.setInput(text);
    await engine.submit();
  };
  return { engine, gen, s, run };
}

function memStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

async function until(cond: () => boolean, ms = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await tick();
  }
}

/** Verdict of every attempt of the last grow: what the gates decided, independent of who wrote the candidate. */
const verdicts = (s: EngineState) =>
  s.generation!.attempts.map((a) => ({ body: a.candidate!.body, verdict: a.candidate!.verdict, rejectedBy: a.candidate!.rejectedBy, headline: a.candidate!.headline }));

beforeAll(async () => {
  await warmUp();
}, 60_000);
beforeEach(() => _useBackend(memoryBackend()));
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  _useBackend(null);
});

const SHIPPED = JSON.parse(readFileSync(new URL('../../public/recordings/median.json', import.meta.url), 'utf8')) as Recording;
const MEDIAN = EXAMPLES.find((e) => e.id === 'median')!;
const MEDIAN_EX: EngineExample = { ...MEDIAN, spec: MEDIAN.spec! };
const CALL = 'median([3, 1, 4, 2])';

// ───────────────────────── share ─────────────────────────

describe('share a session', () => {
  it('round trip: a REPLAYED session is exported, loaded into a fresh empty program, and replays with identical verdicts', async () => {
    // A: the static site (no service), replaying the shipped recording
    const a = setup({ service: DOWN, examples: [MEDIAN_EX], bundled: [SHIPPED] });
    await a.engine.init();
    expect(a.s().mode).toBe('replay');
    await a.run(CALL);
    expect(a.s().generation!.phase).toBe('committed');
    const before = verdicts(a.s());
    expect(before.length).toBeGreaterThan(1);
    expect(before[0]!.verdict).toBe('rejected');

    const rec = a.engine.exportRecording()!;
    expect(rec.title).toBe('Replayed session: median');
    // the recording's own provenance, never this browser's (nothing here is live)
    expect(rec).toMatchObject({ model: SHIPPED.model, codexVersion: SHIPPED.codexVersion, effort: SHIPPED.effort });
    expect(rec.sessions).toHaveLength(1);
    expect(rec.sessions[0]!.attempts).toEqual(SHIPPED.sessions[0]!.attempts.slice(0, before.length));
    expect(rec.sessions[0]!.calls).toEqual([CALL]);
    expect(rec.sessions[0]!.spec).toEqual(MEDIAN.spec);
    const text = JSON.stringify(rec, null, 2);
    expect(validateRecording(JSON.parse(text)).ok).toBe(true);

    // B: a stranger with an empty program and a live service whose model would fail: only recorded candidates may run
    const b = setup({ service: UP, examples: [] });
    await b.engine.init();
    expect(Object.keys(b.s().program.functions)).toEqual([]);
    const preview = await b.engine.previewRecording({ text, source: 'undefined-session.json' });
    expect(preview).toMatchObject({ ok: true, canSeed: true, replayable: 1, calls: [CALL], warning: RECORDING_WARNING });
    expect(preview.ok && preview.functions).toEqual([{ name: 'median', tests: expect.any(Number), properties: expect.any(Number), status: 'new' }]);
    expect(b.s().revisions).toHaveLength(1); // previewing changes nothing

    await b.engine.loadRecording({ text, source: 'undefined-session.json' });
    const rev = b.s().revisions[b.s().revisions.length - 1]!;
    expect(b.s().revisions).toHaveLength(2);
    expect(rev).toMatchObject({ kind: 'import', title: 'Loaded recording: Replayed session: median' });
    expect(b.s().program.functions.median!.spec).toEqual(MEDIAN.spec);
    expect(b.s().loadedRecording).toEqual({ title: 'Replayed session: median', source: 'undefined-session.json', calls: [CALL], dismissed: false });
    expect(b.s().replInput).toBe(CALL); // pre-typed, not run
    expect(b.s().generation).toBeNull();

    await b.engine.submit();
    expect(b.gen.requests).toHaveLength(0);
    expect(b.s().generation!.mode).toBe('replay');
    expect(b.s().generation!.attempts.every((x) => x.candidate!.source === 'replay')).toBe(true);
    expect(verdicts(b.s())).toEqual(before);
    expect(b.s().generation!.phase).toBe('committed');
  }, 60_000);

  it('a loaded recording is preferred for the hashes it holds while the live service is up; anything else goes live', async () => {
    const { engine, gen, s, run } = setup({ service: UP, examples: [MEDIAN_EX], script: { median: ['return 0;'], double: ['return arg0 * 2;'] } });
    await engine.init();
    expect(s().mode).toBe('live');
    const preview = await engine.previewRecording({ text: JSON.stringify(SHIPPED), source: 'median.json' });
    // the example spec is already there and identical: nothing to add, only candidates to register
    expect(preview.ok && preview.functions).toEqual([{ name: 'median', tests: expect.any(Number), properties: expect.any(Number), status: 'same' }]);
    await engine.loadRecording({ text: JSON.stringify(SHIPPED), source: 'median.json' });
    expect(s().revisions).toHaveLength(1); // nothing changed in the program, so no empty revision
    expect(s().loadedRecording?.source).toBe('median.json');

    await run(CALL);
    expect(gen.requests.map((r) => r.fn)).toEqual([]);
    const first = s().generation!.attempts[0]!.candidate!;
    expect(first.source).toBe('replay');
    expect(first.body).toBe(SHIPPED.sessions[0]!.attempts[0]!.body);
    expect(first.prompt).toBe(SHIPPED.sessions[0]!.attempts[0]!.prompt);

    await run('double(21)');
    expect(gen.requests.map((r) => r.fn)).toEqual(['double']);
    expect(s().generation!.attempts[0]!.candidate!.source).toBe('live');

    // the export credits each session to whoever wrote it
    const rec = engine.exportRecording()!;
    expect(rec.title).toBe('Session: median, double (live and replayed)');
    const [median, double] = rec.sessions;
    expect(rec.model).toBe(SHIPPED.model);
    expect(median!.model).toBeUndefined();
    expect(double).toMatchObject({ model: 'test-model', codexVersion: '0.0.1', effort: 'medium' });
    expect(validateRecording(JSON.parse(JSON.stringify(rec))).ok).toBe(true);
  }, 60_000);

  it('a recording with a dataset binds the rows to their variable name and its call replays over them', async () => {
    const a = setup({ service: UP, script: { sumTotal: ['return arg0.reduce((s, r) => s + r.total, 0);'] } });
    await a.engine.init();
    await a.engine.loadDataset({ text: 'id,total\n1,10\n2,20\n3,12', name: 'rows' });
    await a.run('sumTotal(rows)');
    expect(a.s().repl.some((e) => e.kind === 'output' && e.value === '42')).toBe(true);
    const rec = a.engine.exportRecording()!;
    expect(rec.sessions[0]!.datasetRefs?.map((r) => r.name)).toEqual(['rows']);

    const b = setup({ service: UP });
    await b.engine.init();
    const preview = await b.engine.previewRecording({ text: JSON.stringify(rec) });
    expect(preview.ok && preview.datasets).toEqual([{ name: 'rows', rows: 3, columns: 2 }]);
    await b.engine.loadRecording({ text: JSON.stringify(rec) });
    expect(b.s().revisions).toHaveLength(2);
    expect(b.s().datasets.map((d) => [d.name, d.rowCount, d.hash])).toEqual([['rows', 3, rec.sessions[0]!.datasetRefs![0]!.hash]]);
    expect(b.s().env.rows).toBeDefined();
    expect(b.s().replInput).toBe('sumTotal(rows)');
    await b.engine.submit();
    expect(b.gen.requests).toHaveLength(0);
    expect(b.s().repl.some((e) => e.kind === 'output' && e.value === '42')).toBe(true);
  }, 60_000);

  it('hostile or invalid recordings change nothing (and never crash the engine)', async () => {
    const { engine, s } = setup({ service: UP, examples: [MEDIAN_EX] });
    await engine.init();
    const snapshot = () => JSON.stringify({ r: s().revisions, p: s().program, d: s().datasets, i: s().replInput, l: s().loadedRecording ?? null });
    const start = snapshot();

    const tamperedSpec = structuredClone(SHIPPED);
    tamperedSpec.sessions = [tamperedSpec.sessions[0]!];
    tamperedSpec.sessions[0]!.spec!.tests = 'test("sneaky", () => eq(1, 1));'; // hashes no longer match
    const badName = structuredClone(SHIPPED);
    badName.sessions = [{ ...badName.sessions[0]!, fn: 'constructor', spec: { ...badName.sessions[0]!.spec!, name: 'constructor' } }];
    const v1Unknown: Recording = { ...structuredClone(SHIPPED), version: 1, sessions: [{ fn: 'zzz', specHash: 'a'.repeat(64), testsHash: 'b'.repeat(64), label: 'x', attempts: SHIPPED.sessions[0]!.attempts }] };
    const inputs = [
      'not json at all',
      '[]',
      'null',
      JSON.stringify({ format: 'undefined-image', version: 1, revisions: [] }),
      JSON.stringify({ ...SHIPPED, sessions: [{ ...SHIPPED.sessions[0], attempts: [] }] }),
      JSON.stringify({ ...SHIPPED, sessions: [{ ...SHIPPED.sessions[0], datasets: { PROTO: [] } }] }).replace('"PROTO"', '"__proto__"'),
      JSON.stringify({ ...SHIPPED, sessions: 'nope' }),
      JSON.stringify(tamperedSpec),
      JSON.stringify(badName),
      JSON.stringify(v1Unknown),
      '{"format":"undefined-recording","version":2,"id":1}',
    ];
    for (const text of inputs) {
      const p = await engine.previewRecording({ text });
      expect(p.ok === false || !!p.blocked, text.slice(0, 60)).toBe(true);
      await engine.loadRecording({ text });
      expect(snapshot()).toBe(start);
      expect(s().notice?.tone).toBe('error');
    }
    const tampered = await engine.previewRecording({ text: JSON.stringify(tamperedSpec) });
    expect(tampered.ok && tampered.skipped[0]).toMatch(/does not match the hashes/);
    const v1 = await engine.previewRecording({ text: JSON.stringify(v1Unknown) });
    expect(v1.ok && v1.blocked).toMatch(/older recording/);
  }, 60_000);

  it('a dataset whose rows do not match their hash is never bound', async () => {
    const a = setup({ service: UP, script: { count: ['return arg0.length;'] } });
    await a.engine.init();
    await a.engine.loadDataset({ text: 'v\n1\n2', name: 'rows' });
    await a.run('count(rows)');
    const rec = a.engine.exportRecording()!;
    const hash = rec.sessions[0]!.datasetRefs![0]!.hash;
    rec.sessions[0]!.datasets![hash] = [{ v: 666 }]; // swapped rows under the same claimed hash

    const b = setup({ service: UP });
    await b.engine.init();
    const p = await b.engine.previewRecording({ text: JSON.stringify(rec) });
    expect(p.ok && p.skipped.some((x) => /do not match their hash/.test(x))).toBe(true);
    expect(p.ok && p.datasets).toEqual([]);
    await b.engine.loadRecording({ text: JSON.stringify(rec) });
    expect(b.s().datasets).toEqual([]);
  }, 60_000);

  it('a v1 recording (hashes only) replays when the matching spec already exists', async () => {
    const v1: Recording = {
      ...structuredClone(SHIPPED),
      version: 1,
      sessions: SHIPPED.sessions.map(({ fn, specHash, testsHash, label, attempts }) => ({ fn, specHash, testsHash, label, attempts })),
    };
    const { engine, gen, s, run } = setup({ service: UP, examples: [MEDIAN_EX] });
    await engine.init();
    const p = await engine.previewRecording({ text: JSON.stringify(v1) });
    expect(p).toMatchObject({ ok: true, canSeed: false, replayable: 1, calls: [MEDIAN.call] });
    await engine.loadRecording({ text: JSON.stringify(v1) });
    expect(s().revisions).toHaveLength(1);
    await run(s().replInput);
    expect(gen.requests).toHaveLength(0);
    expect(s().generation!.attempts[0]!.candidate!.source).toBe('replay');
  }, 60_000);

  it('?recording=<url> at boot: fetches that URL only, offers it, loads nothing until asked; Load re-uses the fetch', async () => {
    const url = 'https://gist.githubusercontent.com/someone/abc/raw/session.json';
    const calls: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify(SHIPPED), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const { engine, gen, s } = setup({
      service: UP,
      deps: { fetchRecording: fakeFetch, location: () => ({ search: `?recording=${encodeURIComponent(url)}`, hash: '' }) },
    });
    await engine.init();
    await until(() => s().recordingOffer !== undefined);
    expect(calls).toEqual([url]);
    const offer = s().recordingOffer!;
    expect(offer).toMatchObject({ url, source: 'gist.githubusercontent.com', preview: { ok: true, canSeed: true } });
    expect(s().revisions).toHaveLength(1);
    expect(s().loadedRecording).toBeUndefined();
    expect(gen.requests).toHaveLength(0);

    await engine.loadRecording({ url: offer.url, source: offer.source });
    expect(calls).toHaveLength(1);
    expect(s().recordingOffer).toBeUndefined();
    expect(s().loadedRecording).toMatchObject({ source: 'gist.githubusercontent.com', calls: [CALL] });
    expect(s().revisions[1]).toMatchObject({ kind: 'import' });
  }, 60_000);

  it('?recording= that fails to load offers the error and the CORS hint; no param means no request at all', async () => {
    const blocked = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const a = setup({ deps: { fetchRecording: blocked, location: () => ({ search: '?recording=https%3A%2F%2Fexample.com%2Fr.json', hash: '' }) } });
    await a.engine.init();
    await until(() => a.s().recordingOffer !== undefined);
    expect(a.s().recordingOffer!.preview).toMatchObject({ ok: false, hint: CORS_HINT });
    a.engine.dismissRecordingOffer();
    expect(a.s().recordingOffer).toBeUndefined();

    const notFound = (async () => new Response('nope', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch;
    const c = setup({ deps: { fetchRecording: notFound, location: () => ({ search: '?recording=https%3A%2F%2Fexample.com%2Fr.json', hash: '' }) } });
    await c.engine.init();
    await until(() => c.s().recordingOffer !== undefined);
    expect(c.s().recordingOffer!.preview).toMatchObject({ ok: false, error: expect.stringMatching(/404/), hint: CORS_HINT });

    let n = 0;
    const counting = (async () => {
      n++;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const b = setup({ deps: { fetchRecording: counting, location: () => ({ search: '?fixture=x', hash: '' }) } });
    await b.engine.init();
    await tick(50);
    expect(n).toBe(0);
    expect(b.s().recordingOffer).toBeUndefined();
  }, 30_000);

  it('the recording banner can be dismissed; Enter after a recorded call pre-types the next one', async () => {
    const rec = structuredClone(SHIPPED);
    rec.sessions[0]!.calls = [CALL, 'median([5, 5, 1])'];
    const { engine, s } = setup({ service: DOWN, examples: [] });
    await engine.init();
    await engine.loadRecording({ text: JSON.stringify(rec), source: 'r.json' });
    expect(s().replInput).toBe(CALL);
    await engine.submit();
    expect(s().replInput).toBe('median([5, 5, 1])');
    engine.dismissRecordingBanner();
    expect(s().loadedRecording?.dismissed).toBe(true);
  }, 60_000);
});

// ───────────────────────── session log ─────────────────────────

describe('local session log', () => {
  const CELL = 'Zanzibar-7731';

  it('off (the default): nothing is written', async () => {
    const log = createSessionLog({ backend: logMemory(), storage: memStorage() });
    const { engine, s, run } = setup({ service: DOWN, examples: [MEDIAN_EX], bundled: [SHIPPED], log });
    await engine.init();
    expect(s().sessionLog).toEqual({ enabled: false, count: 0, status: 'memory' });
    await engine.loadDataset({ text: `name\n${CELL}`, name: 'people' });
    await run(CALL);
    await tick(20);
    expect(await log.count()).toBe(0);
    expect(s().sessionLog!.count).toBe(0);
  }, 60_000);

  it('on: inputs, outcomes, the deciding gate and its headline, commits, datasets (no prompts, no rows); export and clear', async () => {
    const log = createSessionLog({ backend: logMemory(), storage: memStorage() });
    const { engine, s, run } = setup({ service: DOWN, examples: [MEDIAN_EX], bundled: [SHIPPED], log });
    await engine.init();
    await engine.setSessionLogEnabled(true);
    expect(s().sessionLog!.enabled).toBe(true);
    await engine.loadDataset({ text: `name,n\n${CELL},1\nother,2`, name: 'people' });
    await run(CALL);
    await run('nope(');
    await until(() => s().sessionLog!.count >= 6);

    const json = await engine.exportSessionLog();
    const out = JSON.parse(json) as { format: string; entries: Array<{ kind: string; summary: string; input?: string; fn?: string; detail?: Record<string, unknown> }> };
    expect(out.format).toBe('undefined-session-log');
    const kinds = out.entries.map((e) => e.kind);
    for (const k of ['note', 'dataset', 'input', 'outcome', 'gate', 'commit']) expect(kinds).toContain(k);
    expect(out.entries.find((e) => e.kind === 'input')!.input).toBe(CALL);
    const gate = out.entries.find((e) => e.kind === 'gate')!;
    expect(gate).toMatchObject({ fn: 'median', detail: { gate: expect.any(String), attempt: 1, source: 'replay' } });
    expect(gate.summary).toMatch(/^Rejected: /);
    expect(out.entries.find((e) => e.kind === 'dataset')!.detail).toEqual({ name: 'people', rows: 2, columns: 2 });
    expect(out.entries.some((e) => e.kind === 'outcome' && /error: SyntaxError/.test(e.summary))).toBe(true);
    // never the prompt, never a row
    expect(json).not.toContain('HARD RULES');
    expect(json).not.toContain(CELL);
    expect(s().sessionLog!.count).toBe(out.entries.length);

    // off keeps the entries; clear removes them
    await engine.setSessionLogEnabled(false);
    const kept = s().sessionLog!.count;
    expect(kept).toBeGreaterThan(0);
    await run('[1, 2].length');
    await tick(20);
    expect(s().sessionLog!.count).toBe(kept);
    await engine.clearSessionLog();
    expect(s().sessionLog!.count).toBe(0);
    expect(await log.count()).toBe(0);
  }, 60_000);
});
