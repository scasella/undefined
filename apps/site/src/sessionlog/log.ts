/**
 * The opt-in LOCAL session log: a short, structured diary of what happened in this browser (inputs, outcomes,
 * declines, which gate decided, commits, pins, rollbacks, spec edits, datasets, errors). Off by default. Stored in
 * IndexedDB in its own database ('undefined-session-log'), exportable as JSON by the user, and never transmitted:
 * this module has no network code at all (a test greps for it).
 *
 * Every exported function and every method returns normally: storage failures degrade to an in-memory backend.
 * Entries are small by construction: a headline plus a bounded `detail` (which gate decided, a headline), never
 * dataset rows and never prompts.
 */
import type { Json } from '@scasella/undefined-engine/types';

export const SESSION_LOG_KINDS = [
  'input',
  'outcome',
  'decline',
  'gate',
  'commit',
  'pin',
  'rollback',
  'spec-edit',
  'dataset',
  'error',
  'note',
] as const;
export type SessionLogKind = (typeof SESSION_LOG_KINDS)[number];

export interface SessionLogEntry {
  t: number;
  session: string;
  kind: SessionLogKind;
  input?: string;
  fn?: string;
  summary: string;
  detail?: Json;
}

export type SessionLogStatus = 'memory' | 'indexeddb' | 'failed';

/** Storage behind the log. Entries come back oldest first. */
export interface LogBackend {
  readonly kind: 'memory' | 'indexeddb';
  add(entry: SessionLogEntry): Promise<void>;
  all(): Promise<SessionLogEntry[]>;
  count(): Promise<number>;
  /** Remove the `n` oldest entries. */
  deleteOldest(n: number): Promise<void>;
  clear(): Promise<void>;
}

export interface SessionLog {
  isEnabled(): boolean;
  setEnabled(on: boolean): Promise<void>;
  /** A no-op while the log is off. */
  append(e: Omit<SessionLogEntry, 't' | 'session'>): Promise<void>;
  list(): Promise<SessionLogEntry[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
  exportJson(): Promise<string>;
  status(): SessionLogStatus;
  /** This page load's session id. */
  readonly session: string;
}

export interface SessionLogExport {
  format: 'undefined-session-log';
  version: 1;
  exportedAt: string;
  entries: SessionLogEntry[];
}

export const SESSION_LOG_DB = 'undefined-session-log';
export const SESSION_LOG_STORE = 'entries';
export const SESSION_LOG_FLAG = 'undefined.sessionlog';
export const MAX_ENTRIES = 5000;
export const MAX_SUMMARY = 300;
export const MAX_INPUT = 1000;
export const MAX_FN = 200;
export const MAX_DETAIL_BYTES = 2048;
const OPEN_TIMEOUT_MS = 5000;

// ───────────────────────── entry normalisation ─────────────────────────

function clipText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

function isKind(k: unknown): k is SessionLogKind {
  return typeof k === 'string' && (SESSION_LOG_KINDS as readonly string[]).includes(k);
}

/**
 * Bounded copy of a detail value: plain JSON of at most MAX_DETAIL_BYTES (UTF-8). Anything larger, or anything that is
 * not JSON, becomes a marker object `{ "$truncated": true, "bytes": n, "preview": "…" }` that itself fits the limit.
 */
export function boundDetail(detail: unknown): Json | undefined {
  if (detail === undefined) return undefined;
  let text: string | undefined;
  try {
    text = JSON.stringify(detail);
  } catch {
    text = undefined;
  }
  if (text === undefined) return { $truncated: true, bytes: 0, preview: 'not JSON' };
  const bytes = utf8Length(text);
  if (bytes <= MAX_DETAIL_BYTES) {
    try {
      return JSON.parse(text) as Json;
    } catch {
      return { $truncated: true, bytes, preview: 'not JSON' };
    }
  }
  let keep = Math.min(text.length, MAX_DETAIL_BYTES - 100);
  for (;;) {
    const marker: Json = { $truncated: true, bytes, preview: `${text.slice(0, keep)}…` };
    if (utf8Length(JSON.stringify(marker)) <= MAX_DETAIL_BYTES || keep === 0) return marker;
    keep = Math.max(0, Math.floor(keep * 0.8));
  }
}

function normalizeEntry(e: Partial<SessionLogEntry> & Record<string, unknown>, t: number, session: string): SessionLogEntry {
  const kind: SessionLogKind = isKind(e.kind) ? e.kind : 'note';
  const rawSummary = typeof e.summary === 'string' ? e.summary : String(e.summary ?? '');
  const summary = isKind(e.kind) ? rawSummary : `[${clipText(String(e.kind), 40)}] ${rawSummary}`;
  const out: SessionLogEntry = { t, session, kind, summary: clipText(summary, MAX_SUMMARY) };
  if (typeof e.input === 'string') out.input = clipText(e.input, MAX_INPUT);
  if (typeof e.fn === 'string') out.fn = clipText(e.fn, MAX_FN);
  const detail = boundDetail(e.detail);
  if (detail !== undefined) out.detail = detail;
  return out;
}

// ───────────────────────── backends ─────────────────────────

/** Entries in this page's memory only (lost on reload). */
export function memoryBackend(): LogBackend {
  let entries: SessionLogEntry[] = [];
  return {
    kind: 'memory',
    async add(entry) {
      entries.push(structuredCloneJson(entry));
    },
    async all() {
      return entries.map(structuredCloneJson);
    },
    async count() {
      return entries.length;
    },
    async deleteOldest(n) {
      if (n > 0) entries = entries.slice(n);
    },
    async clear() {
      entries = [];
    },
  };
}

function structuredCloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Entries in IndexedDB, database 'undefined-session-log', store 'entries' (auto-increment keys, so key order is
 * insertion order). The database is opened lazily on first use; a missing factory or a failed/blocked open rejects,
 * and the session log then falls back to memory.
 */
export function idbBackend(factory: IDBFactory | null | undefined): LogBackend {
  let opening: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (!opening) {
      opening = new Promise<IDBDatabase>((resolve, reject) => {
        if (!factory || typeof factory.open !== 'function') {
          reject(new Error('IndexedDB is not available'));
          return;
        }
        const timer = setTimeout(() => reject(new Error('IndexedDB did not open in time')), OPEN_TIMEOUT_MS);
        const finish = (fn: () => void) => {
          clearTimeout(timer);
          fn();
        };
        try {
          const r = factory.open(SESSION_LOG_DB, 1);
          r.onupgradeneeded = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains(SESSION_LOG_STORE)) db.createObjectStore(SESSION_LOG_STORE, { autoIncrement: true });
          };
          r.onsuccess = () => finish(() => resolve(r.result));
          r.onerror = () => finish(() => reject(r.error ?? new Error('IndexedDB open failed')));
          r.onblocked = () => finish(() => reject(new Error('IndexedDB open was blocked')));
        } catch (e) {
          finish(() => reject(e));
        }
      });
      opening.catch(() => {
        opening = null;
      });
    }
    return opening;
  };

  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> => {
    const db = await open();
    const tx = db.transaction(SESSION_LOG_STORE, mode);
    const finished = done(tx);
    finished.catch(() => undefined);
    const result = await work(tx.objectStore(SESSION_LOG_STORE));
    await finished;
    return result;
  };

  return {
    kind: 'indexeddb',
    add: (entry) => run('readwrite', async (s) => void (await req(s.add(entry)))),
    all: () => run('readonly', (s) => req(s.getAll() as IDBRequest<SessionLogEntry[]>)),
    count: () => run('readonly', (s) => req(s.count())),
    deleteOldest: (n) =>
      n <= 0
        ? Promise.resolve()
        : run(
            'readwrite',
            (s) =>
              new Promise<void>((resolve, reject) => {
                let left = n;
                const c = s.openCursor();
                c.onerror = () => reject(c.error ?? new Error('IndexedDB cursor failed'));
                c.onsuccess = () => {
                  const cursor = c.result;
                  if (!cursor || left <= 0) {
                    resolve();
                    return;
                  }
                  cursor.delete();
                  left--;
                  cursor.continue();
                };
              }),
          ),
    clear: () => run('readwrite', async (s) => void (await req(s.clear()))),
  };
}

// ───────────────────────── the log ─────────────────────────

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface SessionLogDeps {
  backend?: LogBackend;
  storage?: FlagStorage;
  now?: () => number;
  newId?: () => string;
}

function defaultStorage(): FlagStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function defaultBackend(): LogBackend {
  try {
    const factory = typeof indexedDB === 'undefined' ? undefined : indexedDB;
    return factory ? idbBackend(factory) : memoryBackend();
  } catch {
    return memoryBackend();
  }
}

function defaultId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* not a secure context */
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Create the log. Call once per page load: the session id is fixed for the log's lifetime. */
export function createSessionLog(deps: SessionLogDeps = {}): SessionLog {
  const storage = deps.storage ?? defaultStorage();
  const now = deps.now ?? (() => Date.now());
  let session: string;
  try {
    session = String(deps.newId ? deps.newId() : defaultId());
  } catch {
    session = defaultId();
  }

  let enabled = false;
  try {
    enabled = storage?.getItem(SESSION_LOG_FLAG) === '1';
  } catch {
    enabled = false;
  }

  let backend: LogBackend = deps.backend ?? defaultBackend();
  let status: SessionLogStatus = backend.kind;

  /** Run `op` on the backend; on failure switch to memory (once) and retry there. */
  const use = async <T>(op: (b: LogBackend) => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await op(backend);
    } catch {
      if (status !== 'failed') {
        backend = memoryBackend();
        status = 'failed';
      }
      try {
        return await op(backend);
      } catch {
        return fallback;
      }
    }
  };

  // Serialise every operation so appends keep their order and the cap stays exact.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  const now_ = (): number => {
    try {
      const t = now();
      return typeof t === 'number' && Number.isFinite(t) ? t : Date.now();
    } catch {
      return Date.now();
    }
  };

  const list = (): Promise<SessionLogEntry[]> => serial(() => use((b) => b.all(), [] as SessionLogEntry[]));

  return {
    session,
    isEnabled: () => enabled,
    status: () => status,
    async setEnabled(on) {
      enabled = on === true;
      try {
        storage?.setItem(SESSION_LOG_FLAG, enabled ? '1' : '0');
      } catch {
        /* the flag simply does not persist */
      }
    },
    async append(e) {
      if (!enabled) return;
      try {
        if (!e || typeof e !== 'object') return;
        const entry = normalizeEntry(e as Partial<SessionLogEntry> & Record<string, unknown>, now_(), session);
        await serial(() =>
          use(async (b) => {
            await b.add(entry);
            const n = await b.count();
            if (n > MAX_ENTRIES) await b.deleteOldest(n - MAX_ENTRIES);
          }, undefined),
        );
      } catch {
        /* never throws */
      }
    },
    async list() {
      try {
        return await list();
      } catch {
        return [];
      }
    },
    async count() {
      try {
        return await serial(() => use((b) => b.count(), 0));
      } catch {
        return 0;
      }
    },
    async clear() {
      try {
        await serial(() => use((b) => b.clear(), undefined));
      } catch {
        /* never throws */
      }
    },
    async exportJson() {
      let entries: SessionLogEntry[] = [];
      try {
        entries = await list();
      } catch {
        entries = [];
      }
      const out: SessionLogExport = { format: 'undefined-session-log', version: 1, exportedAt: new Date(now_()).toISOString(), entries };
      try {
        return JSON.stringify(out, null, 2);
      } catch {
        return JSON.stringify({ ...out, entries: [] }, null, 2);
      }
    },
  };
}

// ───────────────────────── re-import ─────────────────────────

export type SessionLogValidation = { ok: true; entries: SessionLogEntry[] } | { ok: false; error: string };

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'string') return `string ${JSON.stringify(clipText(v, 40))}`;
  if (typeof v === 'number') return `number ${v}`;
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Check an exported session log (the parsed object or its JSON text). Entries are copied field by field (unknown
 * fields dropped) and bounded like live entries; an export with more than MAX_ENTRIES keeps the newest.
 */
export function validateSessionLog(raw: unknown): SessionLogValidation {
  try {
    let v = raw;
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v.charCodeAt(0) === 0xfeff ? v.slice(1) : v);
      } catch (e) {
        return { ok: false, error: `The file is not JSON (${e instanceof Error ? e.message : String(e)}).` };
      }
    }
    if (!isPlainObject(v)) return { ok: false, error: `A session log must be a JSON object (got ${describe(v)}).` };
    if (v.format !== 'undefined-session-log') {
      const what =
        v.format === 'undefined-recording' ? ' This is a recording.' : v.format === 'undefined-image' ? ' This is a program image.' : '';
      return { ok: false, error: `format must be "undefined-session-log" (got ${describe(v.format)}).${what}` };
    }
    if (v.version !== 1) return { ok: false, error: `version must be 1 (got ${describe(v.version)}).` };
    if (!Array.isArray(v.entries)) return { ok: false, error: `entries must be an array (got ${describe(v.entries)}).` };
    const src = v.entries.length > MAX_ENTRIES ? v.entries.slice(v.entries.length - MAX_ENTRIES) : v.entries;
    const offset = v.entries.length - src.length;
    const entries: SessionLogEntry[] = [];
    for (let i = 0; i < src.length; i++) {
      const e = src[i];
      const p = `entries[${i + offset}]`;
      if (!isPlainObject(e)) return { ok: false, error: `${p} must be an object (got ${describe(e)}).` };
      if (typeof e.t !== 'number' || !Number.isFinite(e.t)) return { ok: false, error: `${p}.t must be a finite number (got ${describe(e.t)}).` };
      if (typeof e.session !== 'string') return { ok: false, error: `${p}.session must be a string (got ${describe(e.session)}).` };
      if (!isKind(e.kind)) {
        return { ok: false, error: `${p}.kind must be one of ${SESSION_LOG_KINDS.map((k) => `"${k}"`).join(', ')} (got ${describe(e.kind)}).` };
      }
      if (typeof e.summary !== 'string') return { ok: false, error: `${p}.summary must be a string (got ${describe(e.summary)}).` };
      for (const k of ['input', 'fn'] as const) {
        if (e[k] !== undefined && typeof e[k] !== 'string') return { ok: false, error: `${p}.${k} must be a string when present (got ${describe(e[k])}).` };
      }
      entries.push(normalizeEntry(e as Partial<SessionLogEntry> & Record<string, unknown>, e.t, clipText(e.session, 200)));
    }
    return { ok: true, entries };
  } catch (e) {
    return { ok: false, error: `The session log could not be read (${e instanceof Error ? e.message : String(e)}).` };
  }
}
