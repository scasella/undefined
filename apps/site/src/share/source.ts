/**
 * Loading a recording someone sent you: from dropped text, from a URL, or from `?recording=<url>` in the page address.
 * Browser-safe (no Node APIs). Every exported function returns a result value; none of them throws.
 */
import { validateRecording } from '../core/generator';
import type { DatasetRef, FunctionSpec, Json, Recording } from '@scasella/undefined-engine/types';

export type ParseResult =
  | {
      ok: true;
      recording: Recording;
      /** False for a recording with no spec in any session (version 1): it replays, but cannot seed an empty program. */
      canSeed: boolean;
    }
  | { ok: false; error: string };

export type FetchResult =
  | { ok: true; recording: Recording; canSeed: boolean }
  | { ok: false; error: string; hint?: string };

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  /** Byte cap on the response body. Default 5 MB. */
  maxBytes?: number;
  /** Whole-request timeout (headers and body). Default 10 s. */
  timeoutMs?: number;
}

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 10_000;

export const CORS_HINT =
  'The server did not let this page read the file (CORS). Raw GitHub (raw.githubusercontent.com) and gist URLs (gist.githubusercontent.com/…/raw) do; otherwise download the file and drop it onto the page.';

const HASH = /^[0-9a-f]{64}$/;

// ───────────────────────── parsing ─────────────────────────

/** Parse and validate the text of a recording file. */
export function parseRecordingText(text: string, opts: { maxChars?: number } = {}): ParseResult {
  try {
    if (typeof text !== 'string') return { ok: false, error: 'The file could not be read as text.' };
    const maxChars = opts.maxChars ?? DEFAULT_MAX_BYTES;
    if (text.length > maxChars) {
      return { ok: false, error: `The file is too large (${formatBytes(text.length)}; the limit is ${formatBytes(maxChars)}).` };
    }
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    if (body.trim() === '') return { ok: false, error: 'The file is empty.' };
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `The file is not JSON (${why}). A recording is a .json file saved by Undefined.` };
    }
    return interpret(raw);
  } catch (e) {
    return { ok: false, error: `The recording could not be read (${e instanceof Error ? e.message : String(e)}).` };
  }
}

function interpret(raw: unknown): ParseResult {
  const wrong = wrongFormat(raw);
  if (wrong) return { ok: false, error: wrong };
  let v: ReturnType<typeof validateRecording>;
  try {
    v = validateRecording(raw);
  } catch (e) {
    return { ok: false, error: `The recording could not be checked (${e instanceof Error ? e.message : String(e)}).` };
  }
  if (!v.ok) return { ok: false, error: `This is not a valid recording: ${v.error}.` };
  return { ok: true, recording: v.recording, canSeed: v.recording.sessions.some((s) => s.spec !== undefined) };
}

/** A plain explanation when the JSON is some other known file (or obviously not a recording); null otherwise. */
function wrongFormat(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') {
    return `The file holds a JSON ${raw === null ? 'null' : typeof raw}, not a recording (a recording is a JSON object with "format": "undefined-recording").`;
  }
  if (Array.isArray(raw)) {
    return 'The file holds a JSON array, not a recording (a recording is a JSON object with "format": "undefined-recording"). If it is a recordings index, open one of the files it lists.';
  }
  const format = (raw as Record<string, unknown>).format;
  if (format === 'undefined-image') {
    return 'This is an exported program image (format "undefined-image"), not a recording. Load it with Import in the program menu; a recording is the file saved with "Save recording".';
  }
  if (format === 'undefined-session-log') {
    return 'This is an exported session log (format "undefined-session-log"), not a recording. Session logs are for reading, not for replay.';
  }
  return null;
}

// ───────────────────────── fetching ─────────────────────────

/** Fetch and validate a recording from a URL (github.com blob and gist page URLs are first turned into raw URLs). */
export async function fetchRecording(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const target = normalizeShareUrl(typeof url === 'string' ? url : '');
    const bad = checkUrl(target);
    if (bad) return { ok: false, error: bad };

    const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) return { ok: false, error: 'This browser cannot load files from the network; download the file and drop it onto the page.' };
    const maxBytes = positive(opts.maxBytes, DEFAULT_MAX_BYTES);
    const timeoutMs = positive(opts.timeoutMs, DEFAULT_TIMEOUT_MS);

    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          controller?.abort();
        } catch {
          /* ignore */
        }
        reject(new TimeoutSignal());
      }, timeoutMs);
    });
    timeout.catch(() => undefined);

    const host = hostOf(target);
    try {
      const res = await Promise.race([fetchImpl(target, { signal: controller?.signal, credentials: 'omit', redirect: 'follow' }), timeout]);
      if (!res.ok) {
        const status = `${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
        const extra = res.status === 404 ? ' Check the link; for a private repository or gist, download the file and drop it onto the page.' : '';
        return { ok: false, error: `The server answered ${status} for ${host}.${extra}` };
      }
      const declared = Number(res.headers?.get?.('content-length') ?? NaN);
      if (Number.isFinite(declared) && declared > maxBytes) {
        cancel(res);
        return { ok: false, error: tooLarge(declared, maxBytes) };
      }
      const text = await Promise.race([readCapped(res, maxBytes), timeout]);
      if (text === null) return { ok: false, error: tooLarge(null, maxBytes) };
      const parsed = parseRecordingText(text, { maxChars: Number.MAX_SAFE_INTEGER });
      if (!parsed.ok) {
        const ct = res.headers?.get?.('content-type') ?? '';
        if (/text\/html/i.test(ct) && /not JSON/.test(parsed.error)) {
          return {
            ok: false,
            error: `${host} sent a web page, not the recording file.`,
            hint: 'Use the raw file URL (on GitHub, the "Raw" button), not the page that shows it.',
          };
        }
        return { ok: false, error: parsed.error };
      }
      return parsed;
    } catch (e) {
      if (timedOut || e instanceof TimeoutSignal) {
        return { ok: false, error: `${host} did not send the recording within ${timeoutMs < 1000 ? `${Math.round(timeoutMs)} ms` : `${Math.round(timeoutMs / 100) / 10} s`}.` };
      }
      if (isAbort(e)) return { ok: false, error: 'Loading the recording was cancelled.' };
      if (e instanceof TypeError) {
        return { ok: false, error: `The recording at ${host} could not be loaded: the request was blocked or the network failed.`, hint: CORS_HINT };
      }
      return { ok: false, error: `The recording at ${host} could not be loaded (${e instanceof Error ? e.message : String(e)}).` };
    }
  } catch (e) {
    return { ok: false, error: `The recording could not be loaded (${e instanceof Error ? e.message : String(e)}).` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

class TimeoutSignal extends Error {}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

function positive(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

function tooLarge(bytes: number | null, max: number): string {
  return bytes === null
    ? `The recording is larger than the ${formatBytes(max)} limit.`
    : `The recording is too large (${formatBytes(bytes)}; the limit is ${formatBytes(max)}).`;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
  if (n >= 1024) return `${Math.round((n / 1024) * 10) / 10} KB`;
  return `${n} bytes`;
}

function cancel(res: Response): void {
  try {
    void res.body?.cancel().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/** The body as text, or null when it exceeds maxBytes (counted in bytes, while streaming). */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await res.text();
    return new TextEncoder().encode(text).length > maxBytes ? null : text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        /* ignore */
      }
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** null when the URL may be fetched, otherwise a plain reason. */
function checkUrl(url: string): string | null {
  if (url.trim() === '') return 'No recording URL was given.';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `"${clip(url, 80)}" is not a web address. Give a full https:// link to a recording .json file.`;
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && DEV_HOSTS.has(u.hostname)) return null;
  if (u.protocol === 'http:') return `Only https:// links can be loaded (got http://${u.host}). Plain http is allowed only for localhost during development.`;
  return `Only https:// links can be loaded (got a ${u.protocol.replace(/:$/, '')}: link).`;
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * github.com/<user>/<repo>/blob/<ref>/<path>  →  https://raw.githubusercontent.com/<user>/<repo>/<ref>/<path>
 * gist.github.com/<user>/<id>                 →  https://gist.githubusercontent.com/<user>/<id>/raw
 * Anything else is returned unchanged (trimmed).
 */
export function normalizeShareUrl(url: string): string {
  try {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    let u: URL;
    try {
      u = new URL(trimmed);
    } catch {
      return trimmed;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return trimmed;
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter((p) => p !== '');
    if ((host === 'github.com' || host === 'www.github.com') && parts.length >= 5 && parts[2] === 'blob') {
      const [user, repo, , ...rest] = parts;
      return `https://raw.githubusercontent.com/${user}/${repo}/${rest.join('/')}`;
    }
    if (host === 'gist.github.com' && parts.length === 2 && /^[0-9a-f]+$/i.test(parts[1])) {
      return `https://gist.githubusercontent.com/${parts[0]}/${parts[1]}/raw`;
    }
    return trimmed;
  } catch {
    return typeof url === 'string' ? url : '';
  }
}

// ───────────────────────── page address ─────────────────────────

/** The URL in `?recording=<url-encoded url>` (or `#recording=…`), or null when absent, empty or not an http(s) URL. */
export function recordingParamFromLocation(search: string, hash: string): string | null {
  for (const part of [search, hash]) {
    const value = readParam(part);
    if (value !== null) return value;
  }
  return null;
}

function readParam(part: string): string | null {
  try {
    if (typeof part !== 'string' || part === '') return null;
    const raw = part.replace(/^[?#]/, '');
    // Our own links escape '+' as %2B, so a literal '+' here was typed by hand and means '+' (not a space).
    const params = new URLSearchParams(raw.replace(/\+/g, '%2B'));
    const value = params.get('recording');
    if (value === null) return null;
    const v = value.trim();
    if (v === '' || v.length > 4096) return null;
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return v;
  } catch {
    return null;
  }
}

/** `<base>?recording=<encoded>`; replaces an existing `recording` parameter and drops the base's #fragment. */
export function shareLink(baseUrl: string, recordingUrl: string): string {
  const encoded = encodeURIComponent(recordingUrl);
  try {
    const u = new URL(baseUrl);
    u.hash = '';
    const kept = u.search
      .replace(/^\?/, '')
      .split('&')
      .filter((kv) => kv !== '' && kv.split('=')[0] !== 'recording');
    u.search = '';
    return `${u.toString()}?${[...kept, `recording=${encoded}`].join('&')}`;
  } catch {
    const base = String(baseUrl).split('#')[0];
    return `${base}${base.includes('?') ? '&' : '?'}recording=${encoded}`;
  }
}

// ───────────────────────── seeding ─────────────────────────

export interface Seed {
  /** Per function, the spec of its first session that has one. */
  specs: FunctionSpec[];
  /** Dataset rows by content hash, merged across sessions (first wins). */
  datasets: Record<string, Json>;
  /** Dataset bindings, deduplicated by variable name (first wins). */
  datasetRefs: DatasetRef[];
  /** REPL inputs from every session, in session order, without repeats. */
  calls: string[];
  summary: string;
  canSeed: boolean;
}

/** What a recording would put into an empty program. Never throws. */
export function seedFromRecording(rec: Recording): Seed {
  const specs: FunctionSpec[] = [];
  const firstKey = new Map<string, string>();
  const variants = new Set<string>();
  const datasets: Record<string, Json> = {};
  const datasetRefs: DatasetRef[] = [];
  const refNames = new Set<string>();
  const calls: string[] = [];
  const seenCalls = new Set<string>();
  const fnOrder: string[] = [];

  const sessions = Array.isArray(rec?.sessions) ? rec.sessions : [];
  for (const s of sessions) {
    if (!s || typeof s.fn !== 'string') continue;
    if (!fnOrder.includes(s.fn)) fnOrder.push(s.fn);
    if (s.spec) {
      const key = `${s.specHash}\u0000${s.testsHash}`;
      const first = firstKey.get(s.fn);
      if (first === undefined) {
        firstKey.set(s.fn, key);
        specs.push(s.spec);
      } else if (first !== key) {
        variants.add(`${s.fn}\u0000${key}`);
      }
    }
    for (const c of s.calls ?? []) {
      if (typeof c === 'string' && !seenCalls.has(c)) {
        seenCalls.add(c);
        calls.push(c);
      }
    }
    for (const [hash, rows] of Object.entries(s.datasets ?? {})) {
      // Only content hashes become keys: a key like "__proto__" can never be written.
      if (HASH.test(hash) && !Object.prototype.hasOwnProperty.call(datasets, hash)) datasets[hash] = rows;
    }
    for (const ref of s.datasetRefs ?? []) {
      if (ref && !refNames.has(ref.name) && Object.prototype.hasOwnProperty.call(datasets, ref.hash)) {
        refNames.add(ref.name);
        datasetRefs.push(ref);
      }
    }
  }

  const canSeed = specs.length > 0;
  return { specs, datasets, datasetRefs, calls, summary: summarize(rec, specs, fnOrder, variants.size, calls.length, Object.keys(datasets).length, canSeed), canSeed };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function summarize(
  rec: Recording,
  specs: FunctionSpec[],
  fnOrder: string[],
  variantCount: number,
  callCount: number,
  datasetCount: number,
  canSeed: boolean,
): string {
  const names = (canSeed ? specs.map((s) => s.name) : fnOrder).slice();
  const shown = names.length > 6 ? `${names.slice(0, 6).join(', ')}, …` : names.join(', ');
  const parts = [`${plural(names.length, 'function')}${names.length ? ` (${shown})` : ''}`];
  if (variantCount > 0) parts.push(`${plural(variantCount, 'later spec variant')} not loaded`);
  if (datasetCount > 0) parts.push(plural(datasetCount, 'dataset'));
  parts.push(plural(callCount, 'call'));
  const model = rec?.model ? rec.model : 'an unknown model';
  const via = rec?.codexVersion ? ` via Codex ${rec.codexVersion}` : '';
  let on = '';
  const t = Date.parse(rec?.recordedAt ?? '');
  if (!Number.isNaN(t)) on = ` on ${new Date(t).toISOString().slice(0, 10)}`;
  const head = `${parts.join(', ')}, recorded with ${model}${via}${on}`;
  return canSeed
    ? `${head}; the gates will run live in your browser.`
    : `${head}; this older recording does not carry its specs, so it can only replay functions whose specs you already have.`;
}
