import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { DatasetRef, FunctionSpec, GenerateRequest, GenerateResult, ProgressLine, Recording } from '../types';
import {
  GenerationFailure,
  LiveGenerator,
  RecordingSink,
  ReplayGenerator,
  RUN_LIVE_FIX,
  SSEParser,
  createGenerator,
  loadBundledRecordings,
  parseSSE,
  probeService,
  recordedPrompt,
  validateRecording,
  type SSEEvent,
  type Sleep,
} from './generator';

afterEach(() => {
  vi.restoreAllMocks();
});

// ───────────────────────── helpers ─────────────────────────

const enc = new TextEncoder();

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A fetch that answers with a stream of the given byte chunks. `hang` keeps the stream open after the chunks. */
function streamFetch(chunks: Array<string | Uint8Array>, opts: { hang?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (const c of chunks) ctrl.enqueue(typeof c === 'string' ? enc.encode(c) : c);
        if (!opts.hang) ctrl.close();
      },
    });
    return new Response(body, { status: opts.status ?? 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function jsonFetch(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const route = routes[String(url)];
    if (!route) return new Response('<!doctype html><title>404</title>', { status: 404 });
    return route();
  }) as typeof fetch;
}

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  fn: 'median',
  specHash: 'aaa',
  testsHash: 'bbb',
  attempt: 0,
  prompt: 'write median',
  ...over,
});

async function failureOf(p: Promise<unknown>): Promise<GenerationFailure> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GenerationFailure);
    return e as GenerationFailure;
  }
  throw new Error('expected a GenerationFailure, but the promise resolved');
}

function recording(over: Partial<Recording> = {}): Recording {
  return {
    format: 'undefined-recording',
    version: 1,
    id: 'rec-1',
    title: 'median demo',
    recordedAt: '2026-10-01T12:00:00.000Z',
    model: 'gpt-x',
    codexVersion: '0.9.0',
    effort: 'low',
    sessions: [
      {
        fn: 'median',
        specHash: 'aaa',
        testsHash: 'bbb',
        label: 'median — original spec',
        attempts: [
          {
            prompt: 'p0',
            body: 'return 0;',
            notes: 'first try',
            durationMs: 4000,
            progress: [
              { t: 0, text: 'starting', channel: 'system' },
              { t: 1000, text: 'thinking', channel: 'stderr' },
              { t: 3000, text: 'done', channel: 'event' },
            ],
          },
          { prompt: 'p1', body: 'return 1;', notes: 'second', durationMs: 200, progress: [] },
        ],
      },
    ],
    ...over,
  };
}

/** Fake sleep that records requested delays and resolves immediately. */
function fakeSleep(): { sleep: Sleep; waits: number[] } {
  const waits: number[] = [];
  return { waits, sleep: async (ms) => void waits.push(ms) };
}

// ───────────────────────── SSE parser ─────────────────────────

describe('SSE parsing', () => {
  it('parses events, multi-line data, comments, ids and the default event type', () => {
    const text =
      ': keep-alive\n' +
      'event: progress\ndata: {"a":1}\n\n' +
      'data: line one\ndata: line two\nid: 7\n\n' +
      'event: result\ndata:no-space\ndata:  two spaces\n\n';
    expect(parseSSE([text])).toEqual<SSEEvent[]>([
      { event: 'progress', data: '{"a":1}' },
      { event: 'message', data: 'line one\nline two', id: '7' },
      // the last event id persists across events, as in the WHATWG spec
      { event: 'result', data: 'no-space\n two spaces', id: '7' },
    ]);
  });

  it('handles CRLF and CR line endings, including a CR at the end of a chunk', () => {
    expect(parseSSE(['event: a\r', '\ndata: 1\r', '\r', 'event: b\rdata: 2\r\r'])).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('drops events without data and resets the event name after dispatch', () => {
    expect(parseSSE(['event: lonely\n\ndata: x\n\n'])).toEqual([{ event: 'message', data: 'x' }]);
  });

  it('dispatches an unterminated trailing event at end of stream, keeps an empty data line', () => {
    expect(parseSSE(['event: result\ndata: {"b":1}'])).toEqual([{ event: 'result', data: '{"b":1}' }]);
    expect(parseSSE(['data\ndata: x\n\n'])).toEqual([{ event: 'message', data: '\nx' }]);
  });

  it('emits events incrementally as soon as they are complete', () => {
    const p = new SSEParser();
    expect(p.push('event: progress\nda')).toEqual([]);
    expect(p.push('ta: 1\n')).toEqual([]);
    expect(p.push('\nevent: re')).toEqual([{ event: 'progress', data: '1' }]);
    expect(p.end()).toEqual([]);
  });

  it('property: splitting a stream at arbitrary points never changes the events', () => {
    const word = fc.string({ unit: fc.constantFrom('a', 'b', ' ', ':', '{', '"', 'é', '😀'), maxLength: 8 });
    const eol = fc.constantFrom('\n', '\r\n', '\r');
    const fieldLine = fc.oneof(
      fc.tuple(fc.constantFrom('event', 'data', 'id', 'retry', 'x'), word).map(([f, v]) => `${f}: ${v}`),
      word.map((w) => `:${w}`), // comment
      fc.constant('data'),
    );
    const block = fc.tuple(fc.array(fc.tuple(fieldLine, eol), { maxLength: 5 }), eol).map(
      ([lines, end]) => lines.map(([l, e]) => l + e).join('') + end,
    );
    fc.assert(
      fc.property(fc.array(block, { maxLength: 6 }), fc.array(fc.nat(), { maxLength: 8 }), (blocks, cutsRaw) => {
        const text = blocks.join('');
        const cuts = [...new Set(cutsRaw.map((c) => (text.length ? c % (text.length + 1) : 0)))].sort((a, b) => a - b);
        const chunks: string[] = [];
        let prev = 0;
        for (const c of cuts) {
          chunks.push(text.slice(prev, c));
          prev = c;
        }
        chunks.push(text.slice(prev));
        expect(parseSSE(chunks)).toEqual(parseSSE([text]));
        // and one character at a time
        expect(parseSSE([...text.split('')])).toEqual(parseSSE([text]));
      }),
      { numRuns: 300, seed: 42 },
    );
  });
});

// ───────────────────────── probeService ─────────────────────────

describe('probeService', () => {
  it('reports up with version, model and effort', async () => {
    const f = jsonFetch({
      './generate/health': () => json({ ok: true, codexVersion: '0.9.0', model: 'gpt-x', effort: 'low' }),
    });
    expect(await probeService(500, f)).toEqual({ state: 'up', codexVersion: '0.9.0', model: 'gpt-x', effort: 'low' });
  });

  it('reports degraded with the service problem', async () => {
    const problem = { code: 'not_logged_in', message: 'codex is not logged in', fix: ['codex login'] };
    const f = jsonFetch({ './generate/health': () => json({ ok: false, model: 'gpt-x', effort: 'low', problem }) });
    expect(await probeService(500, f)).toEqual({ state: 'degraded', problem, model: 'gpt-x', effort: 'low' });
  });

  it('reports degraded with a synthesized problem when ok:false carries none', async () => {
    const f = jsonFetch({ './generate/health': () => json({ ok: false, model: 'm', effort: 'low' }) });
    const s = await probeService(500, f);
    expect(s.state).toBe('degraded');
    expect(s.problem?.code).toBe('codex_failed');
  });

  it('reports down for network errors, non-2xx, HTML fallbacks and wrong JSON', async () => {
    const throwing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await probeService(500, throwing)).toEqual({ state: 'down' });
    expect(await probeService(500, jsonFetch({}))).toEqual({ state: 'down' });
    const html = jsonFetch({
      './generate/health': () => new Response('<!doctype html><div id="app"></div>', { status: 200 }),
    });
    expect(await probeService(500, html)).toEqual({ state: 'down' });
    expect(await probeService(500, jsonFetch({ './generate/health': () => json({ up: true }) }))).toEqual({
      state: 'down',
    });
    expect(await probeService(500, jsonFetch({ './generate/health': () => json({ ok: true }, 503) }))).toEqual({
      state: 'down',
    });
  });

  it('times out a hanging service as down', async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      })) as typeof fetch;
    expect(await probeService(20, hanging)).toEqual({ state: 'down' });
  });
});

// ───────────────────────── LiveGenerator ─────────────────────────

describe('LiveGenerator', () => {
  const progress1: ProgressLine = { t: 10, text: 'reading prompt', channel: 'stderr' };
  const progress2: ProgressLine = { t: 900, text: 'turn complete', channel: 'event' };
  const result = {
    body: 'return numbers.length;',
    notes: 'counts',
    model: 'gpt-x',
    codexVersion: '0.9.0',
    durationMs: 1234,
    source: 'live',
    progress: [progress1, progress2],
  };

  it('POSTs the prompt, reports progress and resolves with the result across odd chunk boundaries', async () => {
    const whole = enc.encode(': hello\n\n' + sse('progress', progress1) + sse('progress', progress2) + sse('result', result));
    // split every 7 bytes, which also splits multi-byte characters if any; then add one with a split 'é'
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < whole.length; i += 7) chunks.push(whole.slice(i, i + 7));
    const { fetchImpl, calls } = streamFetch(chunks);
    const seen: ProgressLine[] = [];
    const out = await new LiveGenerator({ fetch: fetchImpl }).generate(req(), (p) => seen.push(p));
    expect(out).toEqual(result);
    expect(seen).toEqual([progress1, progress2]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('./generate');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ prompt: 'write median' });
  });

  it('decodes a multi-byte character split across byte chunks', async () => {
    const bytes = enc.encode(sse('result', { body: 'return "é😀";', notes: 'ü' }));
    const at = bytes.indexOf(0xf0) + 2; // in the middle of the 4-byte emoji
    const { fetchImpl } = streamFetch([bytes.slice(0, at), bytes.slice(at)]);
    const out = await new LiveGenerator({ fetch: fetchImpl }).generate(req(), () => {});
    expect(out.body).toBe('return "é😀";');
    expect(out.notes).toBe('ü');
    expect(out.source).toBe('live');
    expect(out.model).toBe('');
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects with the service error event', async () => {
    const err = { code: 'not_logged_in', message: 'Run codex login', fix: ['codex login'] };
    const { fetchImpl } = streamFetch([sse('progress', progress1), sse('error', err)]);
    const f = await failureOf(new LiveGenerator({ fetch: fetchImpl }).generate(req(), () => {}));
    expect(f.info).toEqual(err);
    expect(f.message).toBe('Run codex login');
  });

  it('rejects a malformed result or error as bad_output', async () => {
    const bad = streamFetch([sse('result', { body: 1, notes: 'x' })]);
    expect((await failureOf(new LiveGenerator({ fetch: bad.fetchImpl }).generate(req(), () => {}))).info.code).toBe(
      'bad_output',
    );
    const badErr = streamFetch([sse('error', { code: 'nope', message: 'x' })]);
    expect(
      (await failureOf(new LiveGenerator({ fetch: badErr.fetchImpl }).generate(req(), () => {}))).info.code,
    ).toBe('bad_output');
  });

  it('a stream that ends without a result is bad_output (including a truncated result)', async () => {
    const truncated = sse('result', result).slice(0, 40);
    const { fetchImpl } = streamFetch([sse('progress', progress1), truncated]);
    const seen: ProgressLine[] = [];
    const f = await failureOf(new LiveGenerator({ fetch: fetchImpl }).generate(req(), (p) => seen.push(p)));
    expect(f.info.code).toBe('bad_output');
    expect(seen).toEqual([progress1]);
  });

  it('fetch failure is service_unreachable with the fix', async () => {
    const throwing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const f = await failureOf(new LiveGenerator({ fetch: throwing }).generate(req(), () => {}));
    expect(f.info.code).toBe('service_unreachable');
    expect(f.info.fix).toEqual(['npm run dev']);
  });

  it('non-2xx is service_unreachable unless the body is a GenerateError', async () => {
    const html = streamFetch(['<html>not found</html>'], { status: 404 });
    const f = await failureOf(new LiveGenerator({ fetch: html.fetchImpl }).generate(req(), () => {}));
    expect(f.info.code).toBe('service_unreachable');
    expect(f.info.message).toContain('404');
    const typed = streamFetch([JSON.stringify({ code: 'codex_missing', message: 'install codex' })], { status: 503 });
    const g = await failureOf(new LiveGenerator({ fetch: typed.fetchImpl }).generate(req(), () => {}));
    expect(g.info).toEqual({ code: 'codex_missing', message: 'install codex' });
  });

  it('abort mid-stream rejects with aborted even if fetch ignores the signal', async () => {
    const { fetchImpl } = streamFetch([sse('progress', progress1)], { hang: true });
    const ctrl = new AbortController();
    const p = new LiveGenerator({ fetch: fetchImpl }).generate(req(), () => ctrl.abort(), ctrl.signal);
    const f = await failureOf(p);
    expect(f.info.code).toBe('aborted');
  });

  it('abort before fetch, and abort that makes fetch reject, are both aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { fetchImpl, calls } = streamFetch([]);
    expect((await failureOf(new LiveGenerator({ fetch: fetchImpl }).generate(req(), () => {}, ctrl.signal))).info.code).toBe(
      'aborted',
    );
    expect(calls).toHaveLength(0);

    const ctrl2 = new AbortController();
    const rejecting = ((_u: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      })) as typeof fetch;
    const p = new LiveGenerator({ fetch: rejecting }).generate(req(), () => {}, ctrl2.signal);
    ctrl2.abort();
    expect((await failureOf(p)).info.code).toBe('aborted');
  });
});

// ───────────────────────── ReplayGenerator ─────────────────────────

describe('ReplayGenerator', () => {
  it('plays the recorded attempt with scaled timing', async () => {
    const { sleep, waits } = fakeSleep();
    const gen = new ReplayGenerator([recording()], { maxMs: 2000, sleep });
    const seen: ProgressLine[] = [];
    const out = await gen.generate(req(), (p) => seen.push(p));
    // duration 4000 → scale 0.5: lines at 0, 500, 1500, end at 2000
    expect(waits).toEqual([500, 1000, 500]);
    expect(seen.map((p) => [p.t, p.text, p.channel])).toEqual([
      [0, 'starting', 'system'],
      [500, 'thinking', 'stderr'],
      [1500, 'done', 'event'],
    ]);
    expect(out).toEqual<GenerateResult>({
      body: 'return 0;',
      notes: 'first try',
      model: 'gpt-x',
      codexVersion: '0.9.0',
      durationMs: 2000,
      source: 'replay',
      progress: seen,
    });
  });

  it('never slows a recording down beyond real time', async () => {
    const { sleep, waits } = fakeSleep();
    const out = await new ReplayGenerator([recording()], { maxMs: 60_000, sleep }).generate(req(), () => {});
    expect(waits).toEqual([1000, 2000, 1000]);
    expect(out.durationMs).toBe(4000);
  });

  it('uses the attempt index and finds the session by hashes across recordings', async () => {
    const { sleep } = fakeSleep();
    const other = recording({
      id: 'rec-2',
      model: 'other-model',
      sessions: [{ ...recording().sessions[0], specHash: 'ccc', attempts: [{ ...recording().sessions[0].attempts[0], body: 'return 2;' }] }],
    });
    const gen = new ReplayGenerator([recording(), other], { maxMs: 10, sleep });
    expect((await gen.generate(req({ attempt: 1 }), () => {})).body).toBe('return 1;');
    const fromOther = await gen.generate(req({ specHash: 'ccc' }), () => {});
    expect(fromOther.body).toBe('return 2;');
    expect(fromOther.model).toBe('other-model');
  });

  it('no session → no_recording with the run-live fix', async () => {
    const gen = new ReplayGenerator([recording()], { maxMs: 10, sleep: fakeSleep().sleep });
    for (const r of [req({ testsHash: 'zzz' }), req({ fn: 'mean' }), req({ specHash: 'x' })]) {
      const f = await failureOf(gen.generate(r, () => {}));
      expect(f.info.code).toBe('no_recording');
      expect(f.info.message).toBe('No recorded session for this spec in replay mode');
      expect(f.info.fix).toEqual([
        'git clone <repo> && cd undefined',
        'npm install',
        'npm i -g @openai/codex && codex login',
        'npm run dev',
      ]);
    }
    expect(RUN_LIVE_FIX).toHaveLength(4);
  });

  it('attempt beyond the recording → recording_exhausted', async () => {
    const gen = new ReplayGenerator([recording()], { maxMs: 10, sleep: fakeSleep().sleep });
    const f = await failureOf(gen.generate(req({ attempt: 2 }), () => {}));
    expect(f.info.code).toBe('recording_exhausted');
    expect(f.info.fix).toEqual([...RUN_LIVE_FIX]);
  });

  it('is abortable mid-playback with the real sleep', async () => {
    const gen = new ReplayGenerator([recording()], { maxMs: 10_000 });
    const ctrl = new AbortController();
    const seen: ProgressLine[] = [];
    const p = gen.generate(req(), (l) => {
      seen.push(l);
      ctrl.abort();
    }, ctrl.signal);
    const started = Date.now();
    expect((await failureOf(p)).info.code).toBe('aborted');
    expect(Date.now() - started).toBeLessThan(500);
    expect(seen).toHaveLength(1);
  });

  it('real sleep actually waits the scaled time', async () => {
    const gen = new ReplayGenerator([recording()], { maxMs: 40 });
    const started = Date.now();
    const out = await gen.generate(req(), () => {});
    expect(out.durationMs).toBe(40);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });
});

// ───────────────────────── validateRecording / loading ─────────────────────────

describe('validateRecording', () => {
  it('accepts a good recording and survives a JSON round trip', () => {
    const v = validateRecording(JSON.parse(JSON.stringify(recording())));
    expect(v).toEqual({ ok: true, recording: recording() });
  });

  const cases: Array<[string, (r: Record<string, any>) => void, string]> = [
    ['format', (r) => (r.format = 'undefined-image'), 'format must be "undefined-recording"'],
    ['version', (r) => (r.version = 4), 'version must be 1, 2 or 3 (got number 4)'],
    ['v2 field in a v1 file', (r) => (r.sessions[0].calls = ['median([1])']), 'sessions[0].calls is a version 2 field'],
    ['model', (r) => delete r.model, 'model must be a string (got undefined)'],
    ['recordedAt', (r) => (r.recordedAt = 'yesterday'), 'recordedAt must be an ISO date'],
    ['sessions', (r) => (r.sessions = {}), 'sessions must be an array (got object)'],
    ['session object', (r) => (r.sessions[0] = null), 'sessions[0] must be an object (got null)'],
    ['session fn', (r) => (r.sessions[0].fn = 3), 'sessions[0].fn must be a string (got number 3)'],
    ['empty attempts', (r) => (r.sessions[0].attempts = []), 'sessions[0].attempts must contain at least one attempt'],
    ['attempt body', (r) => delete r.sessions[0].attempts[1].body, 'sessions[0].attempts[1].body must be a string'],
    ['duration', (r) => (r.sessions[0].attempts[0].durationMs = -1), 'sessions[0].attempts[0].durationMs must be a finite'],
    [
      'channel',
      (r) => (r.sessions[0].attempts[0].progress[2].channel = 'stdout'),
      'sessions[0].attempts[0].progress[2].channel must be one of "stderr", "event", "system" (got string "stdout")',
    ],
    ['progress t', (r) => (r.sessions[0].attempts[0].progress[1].t = 'x'), 'sessions[0].attempts[0].progress[1].t must be'],
  ];
  it.each(cases)('rejects a bad %s with a precise error', (_name, mutate, expected) => {
    const raw = JSON.parse(JSON.stringify(recording()));
    mutate(raw);
    const v = validateRecording(raw);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain(expected);
  });

  it('rejects non-objects', () => {
    for (const raw of [null, 'x', [], 42]) expect(validateRecording(raw).ok).toBe(false);
  });
});

// ───────────────────────── recording v2 ─────────────────────────

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

/** A spec with every optional field populated, so a silently dropped field shows up in the round trip. */
const FULL_SPEC: FunctionSpec = {
  name: 'median',
  params: [{ name: 'numbers', type: 'number[]' }],
  returns: 'number',
  doc: 'The median.',
  tests: 'test("odd", () => eq(median([3, 1, 2]), 2));',
  properties: '',
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'example',
  exampleId: 'median',
  typeDecls: 'type Row = { total: number }',
  pins: [
    {
      id: 'p1',
      label: 'median(rows)',
      args: [
        { kind: 'dataset', name: 'rows', hash: H1 },
        { kind: 'value', encoded: { $t: 'bigint', v: '1' } },
      ],
      expected: 2,
      pinnedAt: 1,
    },
  ],
};

const REF: DatasetRef = {
  name: 'rows',
  hash: H1,
  typeName: 'Row',
  typeDecl: 'type Row = { total: number }',
  rowCount: 2,
  columns: [{ name: 'total', type: 'number' }],
  source: 'paste',
  bytes: 40,
};

function v2Recording(): Recording {
  const base = recording();
  return {
    ...base,
    version: 2,
    sessions: [
      {
        ...base.sessions[0]!,
        spec: FULL_SPEC,
        calls: ['median([3, 1, 4, 2])', 'median(rows)'],
        datasets: { [H1]: [{ total: 1 }, { total: 3 }] },
        datasetRefs: [REF],
      },
    ],
  };
}

describe('recording v2', () => {
  it('accepts v1 without the new fields, and v2 with every new field, losslessly', () => {
    expect(validateRecording(JSON.parse(JSON.stringify(recording())))).toEqual({ ok: true, recording: recording() });
    const v = validateRecording(JSON.parse(JSON.stringify(v2Recording())));
    expect(v).toEqual({ ok: true, recording: v2Recording() });
  });

  it('accepts a v2 session that carries none of the new fields (each is optional)', () => {
    const raw = { ...recording(), version: 2 };
    expect(validateRecording(JSON.parse(JSON.stringify(raw))).ok).toBe(true);
  });

  const cases: Array<[string, (r: Record<string, any>) => void, string]> = [
    ['spec not an object', (r) => (r.sessions[0].spec = 'median'), 'sessions[0].spec must be an object'],
    ['spec name ≠ fn', (r) => (r.sessions[0].spec.name = 'mean'), 'sessions[0].spec.name must equal the session\'s fn "median"'],
    ['spec name not an identifier', (r) => (r.sessions[0].spec.name = 'a b'), 'sessions[0].spec.name must be a JavaScript identifier'],
    ['spec param', (r) => (r.sessions[0].spec.params[0].type = 1), 'sessions[0].spec.params[0].type must be a string'],
    ['spec returns', (r) => (r.sessions[0].spec.returns = 5), 'sessions[0].spec.returns must be a string'],
    ['spec budget', (r) => (r.sessions[0].spec.budgetMs = 0), 'sessions[0].spec.budgetMs must be at least 1'],
    ['spec attempts', (r) => (r.sessions[0].spec.maxAttempts = 1.5), 'sessions[0].spec.maxAttempts must be an integer >= 1'],
    ['spec origin', (r) => (r.sessions[0].spec.origin = 'model'), 'sessions[0].spec.origin must be one of'],
    ['spec missing tests', (r) => delete r.sessions[0].spec.tests, 'sessions[0].spec.tests must be a string'],
    ['spec typeDecls', (r) => (r.sessions[0].spec.typeDecls = 3), 'sessions[0].spec.typeDecls must be a string'],
    ['pin arg kind', (r) => (r.sessions[0].spec.pins[0].args[0].kind = 'file'), 'sessions[0].spec.pins[0].args[0].kind must be one of'],
    ['pin dataset hash', (r) => (r.sessions[0].spec.pins[0].args[0].hash = 'xyz'), 'sessions[0].spec.pins[0].args[0].hash must be a lowercase hex'],
    ['pin value missing', (r) => delete r.sessions[0].spec.pins[0].args[1].encoded, 'sessions[0].spec.pins[0].args[1].encoded must be plain JSON'],
    ['calls not an array', (r) => (r.sessions[0].calls = 'median(1)'), 'sessions[0].calls must be an array'],
    ['call not a string', (r) => (r.sessions[0].calls[1] = 7), 'sessions[0].calls[1] must be a non-empty string'],
    ['empty call', (r) => (r.sessions[0].calls[0] = '  '), 'sessions[0].calls[0] must be a non-empty string'],
    ['repeated call', (r) => r.sessions[0].calls.push('median(rows)'), 'sessions[0].calls must not repeat a call'],
    ['datasets not an object', (r) => (r.sessions[0].datasets = []), 'sessions[0].datasets must be an object'],
    ['dataset key', (r) => (r.sessions[0].datasets = { nothash: [] }), 'sessions[0].datasets keys must be lowercase hex'],
    ['dataset rows', (r) => (r.sessions[0].datasets[H1] = [{ total: Infinity }]), 'must be plain JSON'],
    ['ref without its dataset', (r) => (r.sessions[0].datasetRefs[0].hash = H2), 'sessions[0].datasetRefs[0].hash must name a dataset stored in'],
    ['refs without datasets', (r) => delete r.sessions[0].datasets, 'sessions[0].datasetRefs[0].hash must name a dataset stored in'],
    ['ref name', (r) => (r.sessions[0].datasetRefs[0].name = '1rows'), 'sessions[0].datasetRefs[0].name must be a JavaScript identifier'],
    ['ref rowCount', (r) => (r.sessions[0].datasetRefs[0].rowCount = -1), 'sessions[0].datasetRefs[0].rowCount must be an integer >= 0'],
    ['ref source', (r) => (r.sessions[0].datasetRefs[0].source = 'web'), 'sessions[0].datasetRefs[0].source must be one of'],
    ['ref column', (r) => (r.sessions[0].datasetRefs[0].columns[0] = { name: 'total' }), 'sessions[0].datasetRefs[0].columns[0].type must be a string'],
  ];
  it.each(cases)('rejects a bad %s with a precise error', (_name, mutate, expected) => {
    const raw = JSON.parse(JSON.stringify(v2Recording()));
    if (raw.sessions[0].datasets === undefined) raw.sessions[0].datasets = {};
    mutate(raw);
    const v = validateRecording(raw);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain(expected);
  });

  it('a v2 recording replays exactly like a v1 one', async () => {
    const gen = new ReplayGenerator([v2Recording()], { maxMs: 0 });
    expect((await gen.generate(req({ attempt: 1 }), () => {})).body).toBe(recording().sessions[0]!.attempts[1]!.body);
  });

  it('recordedPrompt finds the prompt really sent for a replayed attempt (first recording wins)', () => {
    const other = { ...recording(), sessions: [{ ...recording().sessions[0]!, attempts: [{ ...recording().sessions[0]!.attempts[0]!, prompt: 'later' }] }] };
    expect(recordedPrompt([recording(), other], req())).toBe('p0');
    expect(recordedPrompt([recording()], req({ attempt: 9 }))).toBeUndefined();
    expect(recordedPrompt([recording()], req({ specHash: 'zzz' }))).toBeUndefined();
  });
});

describe('loadBundledRecordings', () => {
  it('loads valid files and skips invalid ones with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = jsonFetch({
      './recordings/index.json': () => json(['good.json', 'bad.json', 'missing.json', '../escape.json']),
      './recordings/good.json': () => json(recording()),
      './recordings/bad.json': () => json({ ...recording(), version: 4 }),
    });
    const recs = await loadBundledRecordings(f);
    expect(recs).toEqual([recording()]);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('bad.json: version must be 1');
  });

  it('returns [] on any index failure and never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadBundledRecordings(jsonFetch({}))).toEqual([]);
    expect(
      await loadBundledRecordings(jsonFetch({ './recordings/index.json': () => new Response('<html>', { status: 200 }) })),
    ).toEqual([]);
    expect(await loadBundledRecordings(jsonFetch({ './recordings/index.json': () => json({ files: [] }) }))).toEqual([]);
    const throwing = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    expect(await loadBundledRecordings(throwing)).toEqual([]);
  });
});

// ───────────────────────── RecordingSink ─────────────────────────

describe('RecordingSink', () => {
  const live = (body: string, over: Partial<GenerateResult> = {}): GenerateResult => ({
    body,
    notes: `notes for ${body}`,
    model: 'gpt-x',
    codexVersion: '0.9.0',
    durationMs: 300,
    source: 'live',
    progress: [{ t: 100, text: 'working', channel: 'stderr' }],
    ...over,
  });

  it('is null when nothing live was recorded', () => {
    const sink = new RecordingSink();
    expect(sink.toRecording({ id: 'x', title: 'x' })).toBeNull();
    sink.add(req(), { ...live('a'), source: 'replay' }, 'label');
    expect(sink.toRecording({ id: 'x', title: 'x' })).toBeNull();
  });

  it('groups attempts, replaces a session on a new attempt 0, and round-trips through validate + replay', async () => {
    const sink = new RecordingSink({ effort: 'medium', now: () => new Date('2026-10-04T10:00:00Z') });
    sink.add(req({ prompt: 'old' }), live('stale'), 'median — old');
    sink.add(req({ prompt: 'p0' }), live('return 0;'), 'median — original spec');
    sink.add(req({ attempt: 1, prompt: 'p1' }), live('return 1;', { model: 'ignored' }), 'median — original spec');
    sink.add(req({ fn: 'slug', attempt: 0, prompt: 'ps' }), live('return "";'), 'slug');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sink.add(req({ fn: 'gap', attempt: 1 }), live('nope'), 'gap'); // no attempt 0 recorded
    expect(warn).toHaveBeenCalledOnce();

    const rec = sink.toRecording({ id: 'session-1', title: 'my session' });
    expect(rec).not.toBeNull();
    expect(rec!.model).toBe('gpt-x');
    expect(rec!.effort).toBe('medium');
    expect(rec!.recordedAt).toBe('2026-10-04T10:00:00.000Z');
    expect(rec!.sessions.map((s) => [s.fn, s.label, s.attempts.map((a) => a.prompt)])).toEqual([
      ['median', 'median — original spec', ['p0', 'p1']],
      ['slug', 'slug', ['ps']],
    ]);

    const v = validateRecording(JSON.parse(JSON.stringify(rec)));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const gen = new ReplayGenerator([v.recording], { maxMs: 50, sleep: fakeSleep().sleep });
    const second = await gen.generate(req({ attempt: 1 }), () => {});
    expect(second.body).toBe('return 1;');
    expect(second.notes).toBe('notes for return 1;');
    expect(second.progress.map((p) => p.text)).toEqual(['working']);
  });

  it('v2: keeps the spec, the triggering calls (deduped, in order, carried over a regeneration) and datasets', () => {
    const sink = new RecordingSink({ now: () => new Date('2026-10-04T10:00:00Z') });
    sink.add(req({ prompt: 'p0' }), live('a'), 'median', { spec: FULL_SPEC, call: 'median([1, 2])' });
    sink.add(req({ attempt: 1, prompt: 'p1' }), live('b'), 'median', { spec: FULL_SPEC, call: 'median([1, 2])' });
    // the same spec grown again later from another input: a fresh session that still lists the first input
    sink.add(req({ prompt: 'q0' }), live('c'), 'median', { spec: FULL_SPEC, call: 'xs = [5]; median(xs)' });
    sink.add(req({ fn: 'slug', prompt: 'ps' }), live('d'), 'slug', {
      call: 'median(rows)',
      datasets: { [H1]: [{ total: 1 }, { total: 3 }] },
      datasetRefs: [REF],
    });
    const rec = sink.toRecording({ id: 'i', title: 't' })!;
    expect(rec.version).toBe(2);
    const [median, slug] = rec.sessions;
    expect(median!.attempts.map((a) => a.prompt)).toEqual(['q0']);
    expect(median!.spec).toEqual(FULL_SPEC);
    expect(median!.calls).toEqual(['median([1, 2])', 'xs = [5]; median(xs)']);
    expect(slug!.spec).toBeUndefined();
    expect(slug!.datasetRefs).toEqual([REF]);

    // the spec is a copy, and the export survives JSON + strict validation unchanged
    const v = validateRecording(JSON.parse(JSON.stringify(rec)));
    expect(v).toEqual({ ok: true, recording: rec });
  });

  it('stays version 1 when no v2 field was given', () => {
    const sink = new RecordingSink();
    sink.add(req(), live('a'), 'l');
    sink.add(req({ attempt: 1 }), live('b'), 'l', {});
    expect(sink.toRecording({ id: 'i', title: 't' })!.version).toBe(1);
  });

  it('defaults effort to low and returns an independent copy', () => {
    const sink = new RecordingSink();
    sink.add(req(), live('a'), 'l');
    const rec = sink.toRecording({ id: 'i', title: 't' })!;
    expect(rec.effort).toBe('low');
    rec.sessions[0].attempts[0].body = 'mutated';
    expect(sink.toRecording({ id: 'i', title: 't' })!.sessions[0].attempts[0].body).toBe('a');
  });
});

describe('createGenerator', () => {
  it('builds the generator for the mode', async () => {
    expect(createGenerator({ mode: 'live', recordings: [], replayMaxMs: 0 })).toBeInstanceOf(LiveGenerator);
    const g = createGenerator({ mode: 'replay', recordings: [recording()], replayMaxMs: 0 });
    expect(g).toBeInstanceOf(ReplayGenerator);
    expect(g.mode).toBe('replay');
    const out = await g.generate(req({ attempt: 1 }), () => {});
    expect(out.durationMs).toBe(0);
  });
});
