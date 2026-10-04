/**
 * Where candidate bodies come from: the local generation service (live) or a recorded session (replay).
 * Wire format: see the comment above `ServiceHealth` in src/types.ts.
 */
import type {
  GenerateError,
  GenerateErrorCode,
  GenerateRequest,
  GenerateResult,
  Generator,
  ProgressLine,
  RecordedAttempt,
  RecordedSession,
  Recording,
  ServiceHealth,
  ServiceStatus,
} from '../types';

type FetchFn = typeof fetch;

export class GenerationFailure extends Error {
  constructor(public readonly info: GenerateError) {
    super(info.message);
    this.name = 'GenerationFailure';
  }
}

const ERROR_CODES: readonly GenerateErrorCode[] = [
  'codex_missing',
  'not_logged_in',
  'timeout',
  'bad_output',
  'codex_failed',
  'service_unreachable',
  'no_recording',
  'recording_exhausted',
  'aborted',
];

const CHANNELS: readonly ProgressLine['channel'][] = ['stderr', 'event', 'system'];

/** How to get a live generation service running. Shown verbatim when replay has nothing to offer. */
export const RUN_LIVE_FIX: readonly string[] = [
  'git clone <repo> && cd undefined',
  'npm install',
  'npm i -g @openai/codex && codex login',
  'npm run dev',
];

function abortedFailure(): GenerationFailure {
  return new GenerationFailure({ code: 'aborted', message: 'Generation was cancelled' });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isProgressLine(v: unknown): v is ProgressLine {
  return (
    isRecord(v) &&
    typeof v.t === 'number' &&
    Number.isFinite(v.t) &&
    typeof v.text === 'string' &&
    CHANNELS.includes(v.channel as ProgressLine['channel'])
  );
}

function asGenerateError(v: unknown): GenerateError | null {
  if (!isRecord(v)) return null;
  if (!ERROR_CODES.includes(v.code as GenerateErrorCode) || typeof v.message !== 'string') return null;
  const out: GenerateError = { code: v.code as GenerateErrorCode, message: v.message };
  if (Array.isArray(v.fix) && v.fix.every((s) => typeof s === 'string')) out.fix = [...(v.fix as string[])];
  return out;
}

// ───────────────────────── SSE ─────────────────────────

export interface SSEEvent {
  /** `event:` field; 'message' when absent. */
  event: string;
  /** `data:` lines joined with '\n'. */
  data: string;
  id?: string;
}

/**
 * Incremental text/event-stream parser (WHATWG grammar). Feed decoded text in arbitrary chunks; complete events come
 * out in order. A chunk ending in '\r' is held back because the next chunk may start with the '\n' of a CRLF.
 */
export class SSEParser {
  private buf = '';
  private event = '';
  private data: string[] = [];
  private id: string | undefined;

  push(chunk: string): SSEEvent[] {
    this.buf += chunk;
    const out: SSEEvent[] = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const c = this.buf[i];
      if (c !== '\n' && c !== '\r') continue;
      if (c === '\r' && i === this.buf.length - 1) break; // maybe half of a CRLF
      this.line(this.buf.slice(start, i), out);
      if (c === '\r' && this.buf[i + 1] === '\n') i++;
      start = i + 1;
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /**
   * End of stream. The spec discards an unterminated trailing event; we dispatch it if it has data, because a
   * server that omits the final blank line should not lose its last event (a truncated JSON payload still fails to
   * parse downstream).
   */
  end(): SSEEvent[] {
    const out: SSEEvent[] = [];
    if (this.buf.length > 0) {
      // A held-back lone '\r' is a line terminator; anything else is an unterminated last line.
      this.line(this.buf.endsWith('\r') ? this.buf.slice(0, -1) : this.buf, out);
      this.buf = '';
    }
    this.dispatch(out);
    return out;
  }

  private line(line: string, out: SSEEvent[]): void {
    if (line === '') {
      this.dispatch(out);
      return;
    }
    if (line.startsWith(':')) return; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    // 'retry' and unknown fields are ignored
  }

  private dispatch(out: SSEEvent[]): void {
    if (this.data.length > 0) {
      const ev: SSEEvent = { event: this.event || 'message', data: this.data.join('\n') };
      if (this.id !== undefined) ev.id = this.id;
      out.push(ev);
    }
    this.event = '';
    this.data = [];
  }
}

/** Parse a whole stream given as text chunks. Pure. */
export function parseSSE(chunks: Iterable<string>): SSEEvent[] {
  const p = new SSEParser();
  const out: SSEEvent[] = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.end());
  return out;
}

// ───────────────────────── service probe ─────────────────────────

/** GET ./generate/health. Never throws: anything that is not a well-formed ServiceHealth means 'down'. */
export async function probeService(timeoutMs = 1500, fetchImpl: FetchFn = globalThis.fetch): Promise<ServiceStatus> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl('./generate/health', { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { state: 'down' };
    // A static host answers with index.html or a 404 page: json() throws and we report 'down'.
    const raw: unknown = await res.json();
    if (!isRecord(raw) || typeof raw.ok !== 'boolean') return { state: 'down' };
    const health = raw as unknown as ServiceHealth;
    const extra: Pick<ServiceStatus, 'codexVersion' | 'model' | 'effort'> = {};
    if (typeof health.codexVersion === 'string') extra.codexVersion = health.codexVersion;
    if (typeof health.model === 'string') extra.model = health.model;
    if (typeof health.effort === 'string') extra.effort = health.effort;
    if (health.ok) return { state: 'up', ...extra };
    const problem = asGenerateError(raw.problem) ?? {
      code: 'codex_failed' as const,
      message: 'The generation service is running but reported that codex is not usable',
    };
    return { state: 'degraded', problem, ...extra };
  } catch {
    return { state: 'down' };
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── live ─────────────────────────

export class LiveGenerator implements Generator {
  readonly mode = 'live' as const;
  private readonly fetchImpl: FetchFn;
  private readonly url: string;

  constructor(opts: { fetch?: FetchFn; url?: string } = {}) {
    // Bind lazily so a test or polyfill that replaces globalThis.fetch later is honoured.
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.url = opts.url ?? './generate';
  }

  async generate(
    req: GenerateRequest,
    onProgress: (p: ProgressLine) => void,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    if (signal?.aborted) throw abortedFailure();
    const started = Date.now();

    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ prompt: req.prompt }),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw abortedFailure();
      throw new GenerationFailure({
        code: 'service_unreachable',
        message: `Could not reach the local generation service (${errorText(e)})`,
        fix: ['npm run dev'],
      });
    }

    if (!res.ok || !res.body) {
      let fromBody: GenerateError | null = null;
      try {
        fromBody = asGenerateError(await res.json());
      } catch {
        /* not JSON: a static host or proxy answered */
      }
      if (fromBody) throw new GenerationFailure(fromBody);
      throw new GenerationFailure({
        code: 'service_unreachable',
        message: res.ok
          ? 'The generation service answered without a response stream'
          : `The generation service answered HTTP ${res.status} instead of a generation stream`,
        fix: ['npm run dev'],
      });
    }

    const reader = res.body.getReader();
    // Cancelling the reader on abort makes abort work even with a fetch implementation that ignores the signal.
    const onAbort = (): void => {
      reader.cancel().catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const decoder = new TextDecoder();
    const parser = new SSEParser();
    const progress: ProgressLine[] = [];

    const handle = (ev: SSEEvent): GenerateResult | null => {
      if (ev.event === 'progress') {
        const line = tryJson(ev.data);
        if (isProgressLine(line)) {
          const copy: ProgressLine = { t: line.t, text: line.text, channel: line.channel };
          progress.push(copy);
          onProgress(copy);
        }
        return null;
      }
      if (ev.event === 'error') {
        const err = asGenerateError(tryJson(ev.data));
        throw new GenerationFailure(
          err ?? { code: 'bad_output', message: `The generation service sent a malformed error: ${clip(ev.data)}` },
        );
      }
      if (ev.event === 'result') return toLiveResult(tryJson(ev.data), progress, Date.now() - started);
      return null; // unknown event types are ignored
    };

    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (e) {
          if (signal?.aborted) throw abortedFailure();
          throw new GenerationFailure({
            code: 'bad_output',
            message: `The generation stream broke off (${errorText(e)})`,
          });
        }
        if (signal?.aborted) throw abortedFailure();
        const text = chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
        const events = parser.push(text);
        if (chunk.done) events.push(...parser.end());
        for (const ev of events) {
          const result = handle(ev);
          if (result) return result;
        }
        if (chunk.done) {
          throw new GenerationFailure({
            code: 'bad_output',
            message: 'The generation stream ended without a result',
          });
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      reader.cancel().catch(() => {});
    }
  }
}

function toLiveResult(raw: unknown, progress: ProgressLine[], measuredMs: number): GenerateResult {
  if (!isRecord(raw) || typeof raw.body !== 'string' || typeof raw.notes !== 'string') {
    throw new GenerationFailure({
      code: 'bad_output',
      message: 'The generation service sent a result without string "body" and "notes"',
    });
  }
  return {
    body: raw.body,
    notes: raw.notes,
    model: typeof raw.model === 'string' ? raw.model : '',
    codexVersion: typeof raw.codexVersion === 'string' ? raw.codexVersion : '',
    durationMs: typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs) ? raw.durationMs : measuredMs,
    source: 'live',
    progress:
      Array.isArray(raw.progress) && raw.progress.every(isProgressLine)
        ? raw.progress.map((p) => ({ t: p.t, text: p.text, channel: p.channel }))
        : progress,
  };
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function clip(s: string, n = 120): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ───────────────────────── replay ─────────────────────────

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** setTimeout-based sleep that rejects with an 'aborted' GenerationFailure when the signal fires. */
export const realSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedFailure());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortedFailure());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

function sessionKey(fn: string, specHash: string, testsHash: string): string {
  return `${fn}\u0000${specHash}\u0000${testsHash}`;
}

export class ReplayGenerator implements Generator {
  readonly mode = 'replay' as const;
  private readonly sessions = new Map<string, { session: RecordedSession; recording: Recording }>();
  private readonly maxMs: number;
  private readonly sleep: Sleep;

  /** When several recordings contain the same fn+specHash+testsHash, the first one in `recordings` wins. */
  constructor(recordings: Recording[], opts: { maxMs: number; sleep?: Sleep }) {
    for (const recording of recordings) {
      for (const session of recording.sessions) {
        const key = sessionKey(session.fn, session.specHash, session.testsHash);
        if (!this.sessions.has(key)) this.sessions.set(key, { session, recording });
      }
    }
    this.maxMs = Math.max(0, opts.maxMs);
    this.sleep = opts.sleep ?? realSleep;
  }

  async generate(
    req: GenerateRequest,
    onProgress: (p: ProgressLine) => void,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    if (signal?.aborted) throw abortedFailure();
    const found = this.sessions.get(sessionKey(req.fn, req.specHash, req.testsHash));
    if (!found) {
      throw new GenerationFailure({
        code: 'no_recording',
        message: 'No recorded session for this spec in replay mode',
        fix: [...RUN_LIVE_FIX],
      });
    }
    const { session, recording } = found;
    const attempt = session.attempts[req.attempt];
    if (!attempt) {
      const n = session.attempts.length;
      throw new GenerationFailure({
        code: 'recording_exhausted',
        message: `The recorded session for ${req.fn} has ${n} attempt${n === 1 ? '' : 's'}; attempt ${req.attempt + 1} was never recorded`,
        fix: [...RUN_LIVE_FIX],
      });
    }

    const lines = attempt.progress.map((p, i) => ({ p, i })).sort((a, b) => a.p.t - b.p.t || a.i - b.i);
    const total = Math.max(attempt.durationMs, lines.length ? lines[lines.length - 1].p.t : 0, 0);
    // Recordings longer than maxMs are compressed into it; shorter ones play at their recorded pace.
    const scale = total > 0 ? Math.min(1, this.maxMs / total) : 0;

    const emitted: ProgressLine[] = [];
    let waited = 0;
    const waitUntil = async (target: number): Promise<void> => {
      const delta = target - waited;
      if (delta > 0) {
        await this.sleep(delta, signal);
        waited = target;
      }
      if (signal?.aborted) throw abortedFailure();
    };

    for (const { p } of lines) {
      const at = Math.max(0, p.t) * scale;
      await waitUntil(at);
      const line: ProgressLine = { t: Math.round(at), text: p.text, channel: p.channel };
      emitted.push(line);
      onProgress(line);
    }
    await waitUntil(total * scale);

    return {
      body: attempt.body,
      notes: attempt.notes,
      model: recording.model,
      codexVersion: recording.codexVersion,
      durationMs: Math.round(waited),
      source: 'replay',
      progress: emitted,
    };
  }
}

// ───────────────────────── recording validation / loading ─────────────────────────

export type RecordingValidation = { ok: true; recording: Recording } | { ok: false; error: string };

/** Strict structural validation of a recording file. Unknown extra fields are dropped from the returned copy. */
export function validateRecording(raw: unknown): RecordingValidation {
  try {
    return { ok: true, recording: readRecording(raw) };
  } catch (e) {
    if (e instanceof RecordingShapeError) return { ok: false, error: e.message };
    throw e;
  }
}

class RecordingShapeError extends Error {}

function fail(path: string, what: string): never {
  throw new RecordingShapeError(`${path} ${what}`);
}

function str(o: Record<string, unknown>, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string') fail(`${path}${key}`, `must be a string (got ${describe(v)})`);
  return v;
}

function num(o: Record<string, unknown>, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    fail(`${path}${key}`, `must be a finite non-negative number (got ${describe(v)})`);
  }
  return v;
}

function arr(o: Record<string, unknown>, key: string, path: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) fail(`${path}${key}`, `must be an array (got ${describe(v)})`);
  return v;
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) fail(path || 'recording', `must be an object (got ${describe(v)})`);
  return v;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'string') return `string ${JSON.stringify(clip(v, 40))}`;
  if (typeof v === 'number') return `number ${v}`;
  return typeof v;
}

function readRecording(raw: unknown): Recording {
  const o = obj(raw, '');
  if (o.format !== 'undefined-recording') fail('format', `must be "undefined-recording" (got ${describe(o.format)})`);
  if (o.version !== 1) fail('version', `must be 1 (got ${describe(o.version)})`);
  const recordedAt = str(o, 'recordedAt', '');
  if (Number.isNaN(Date.parse(recordedAt))) fail('recordedAt', `must be an ISO date (got ${describe(recordedAt)})`);
  return {
    format: 'undefined-recording',
    version: 1,
    id: str(o, 'id', ''),
    title: str(o, 'title', ''),
    recordedAt,
    model: str(o, 'model', ''),
    codexVersion: str(o, 'codexVersion', ''),
    effort: str(o, 'effort', ''),
    sessions: arr(o, 'sessions', '').map((s, i) => readSession(s, `sessions[${i}]`)),
  };
}

function readSession(raw: unknown, path: string): RecordedSession {
  const o = obj(raw, path);
  const p = `${path}.`;
  const attempts = arr(o, 'attempts', p).map((a, i) => readAttempt(a, `${path}.attempts[${i}]`));
  if (attempts.length === 0) fail(`${path}.attempts`, 'must contain at least one attempt');
  return {
    fn: str(o, 'fn', p),
    specHash: str(o, 'specHash', p),
    testsHash: str(o, 'testsHash', p),
    label: str(o, 'label', p),
    attempts,
  };
}

function readAttempt(raw: unknown, path: string): RecordedAttempt {
  const o = obj(raw, path);
  const p = `${path}.`;
  return {
    prompt: str(o, 'prompt', p),
    body: str(o, 'body', p),
    notes: str(o, 'notes', p),
    durationMs: num(o, 'durationMs', p),
    progress: arr(o, 'progress', p).map((l, i) => readProgress(l, `${path}.progress[${i}]`)),
  };
}

function readProgress(raw: unknown, path: string): ProgressLine {
  const o = obj(raw, path);
  const p = `${path}.`;
  const channel = o.channel;
  if (!CHANNELS.includes(channel as ProgressLine['channel'])) {
    fail(`${path}.channel`, `must be one of "stderr", "event", "system" (got ${describe(channel)})`);
  }
  return { t: num(o, 't', p), text: str(o, 'text', p), channel: channel as ProgressLine['channel'] };
}

const SAFE_NAME = /^[\w.-]+\.json$/;

/**
 * Recordings shipped with the static build: ./recordings/index.json is a JSON array of file names in the same
 * directory. Invalid files are skipped with a console warning. Never throws; any index failure yields [].
 */
export async function loadBundledRecordings(fetchImpl: FetchFn = globalThis.fetch): Promise<Recording[]> {
  let names: string[];
  try {
    const res = await fetchImpl('./recordings/index.json');
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    if (!Array.isArray(raw) || !raw.every((n) => typeof n === 'string')) {
      console.warn('recordings/index.json must be a JSON array of file names; ignoring it');
      return [];
    }
    names = raw as string[];
  } catch {
    return [];
  }

  const loaded = await Promise.all(
    names.map(async (name): Promise<Recording | null> => {
      if (!SAFE_NAME.test(name) || name.includes('..')) {
        console.warn(`recordings: skipping ${JSON.stringify(name)}: not a plain .json file name`);
        return null;
      }
      try {
        const res = await fetchImpl(`./recordings/${name}`);
        if (!res.ok) {
          console.warn(`recordings: skipping ${name}: HTTP ${res.status}`);
          return null;
        }
        const v = validateRecording(await res.json());
        if (!v.ok) {
          console.warn(`recordings: skipping ${name}: ${v.error}`);
          return null;
        }
        return v.recording;
      } catch (e) {
        console.warn(`recordings: skipping ${name}: ${errorText(e)}`);
        return null;
      }
    }),
  );
  return loaded.filter((r): r is Recording => r !== null);
}

// ───────────────────────── recording sink ─────────────────────────

/** Collects everything generated live this session so it can be exported as a Recording. */
export class RecordingSink {
  private readonly sessions = new Map<string, RecordedSession>();
  private first: { model: string; codexVersion: string } | null = null;
  private readonly effort: string;
  private readonly now: () => Date;

  constructor(opts: { effort?: string; now?: () => Date } = {}) {
    this.effort = opts.effort ?? 'low';
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Record one live result. Attempt 0 starts a fresh session for its fn+specHash+testsHash (replacing an older one);
   * later attempts append. Replay results, and attempts that would leave a gap in the session, are ignored because
   * replay indexes attempts by position.
   */
  add(req: GenerateRequest, result: GenerateResult, label: string): void {
    if (result.source !== 'live') return;
    const key = sessionKey(req.fn, req.specHash, req.testsHash);
    const attempt: RecordedAttempt = {
      prompt: req.prompt,
      body: result.body,
      notes: result.notes,
      durationMs: Math.max(0, result.durationMs),
      progress: result.progress.map((p) => ({ t: Math.max(0, p.t), text: p.text, channel: p.channel })),
    };
    const existing = this.sessions.get(key);
    if (req.attempt === 0) {
      this.sessions.delete(key); // re-insert so session order follows when it was (re)generated
      this.sessions.set(key, { fn: req.fn, specHash: req.specHash, testsHash: req.testsHash, label, attempts: [attempt] });
    } else if (existing && req.attempt === existing.attempts.length) {
      existing.attempts.push(attempt);
    } else if (existing && req.attempt < existing.attempts.length) {
      existing.attempts[req.attempt] = attempt;
    } else {
      console.warn(`RecordingSink: ignoring attempt ${req.attempt} of ${req.fn}: earlier attempts were not recorded`);
      return;
    }
    this.first ??= { model: result.model, codexVersion: result.codexVersion };
  }

  get size(): number {
    return this.sessions.size;
  }

  toRecording(meta: { id: string; title: string }): Recording | null {
    if (this.sessions.size === 0 || !this.first) return null;
    return {
      format: 'undefined-recording',
      version: 1,
      id: meta.id,
      title: meta.title,
      recordedAt: this.now().toISOString(),
      model: this.first.model,
      codexVersion: this.first.codexVersion,
      effort: this.effort,
      sessions: [...this.sessions.values()].map((s) => ({
        ...s,
        attempts: s.attempts.map((a) => ({ ...a, progress: a.progress.map((p) => ({ ...p })) })),
      })),
    };
  }
}

// ───────────────────────── factory ─────────────────────────

export function createGenerator(opts: { mode: 'live' | 'replay'; recordings: Recording[]; replayMaxMs: number }): Generator {
  return opts.mode === 'live'
    ? new LiveGenerator()
    : new ReplayGenerator(opts.recordings, { maxMs: opts.replayMaxMs });
}
