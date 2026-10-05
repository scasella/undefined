/**
 * Persistence of the program image (IndexedDB) plus image export/import validation.
 *
 * All storage goes through a tiny Backend interface. The default backend is IndexedDB; when IndexedDB is
 * missing, fails to open, or errors later (private windows, blocked storage), the store silently degrades to
 * an in-memory backend for the rest of the session. No exported storage function ever throws.
 */
import { hashesFor } from '@scasella/undefined-engine/shared/hash';
import {
  arr,
  bad,
  int,
  Invalid,
  isJson,
  isObject,
  key,
  num,
  obj,
  oneOf,
  opt,
  optStr,
  readDecisions,
  str,
  vPins,
  vSpec,
  type Obj,
} from '@scasella/undefined-engine/spec/validate';
import type {
  Artifact,
  Candidate,
  DatasetRef,
  Decision,
  Diagnostic,
  Evidence,
  FunctionRecord,
  FunctionSpec,
  GateResult,
  Image,
  Json,
  Outcome,
  Pin,
  Program,
  Revision,
} from '@scasella/undefined-engine/types';

export interface Persisted {
  image: Image;
  /** `sendSamples` (absent = never chosen: the default applies) is whether sample rows go to Codex in live mode. */
  flags: { takeawayShown: boolean; openerDismissed: boolean; sendSamples?: boolean; start?: 'examples' | 'data' };
  liveEnv: Record<string, Json>;
  /** Dataset rows, encoded, content-addressed (also inside `image.datasets`). */
  datasets: Record<string, Json>;
  /** Datasets unbound on load because their rows were not stored (see loadStored). */
  repaired?: string[];
}

// ───────────────────────── backends ─────────────────────────

/**
 * One atomic write: revisions to put, kv entries to set, and kv entries to MERGE into (`mergeKv[key]` is shallow-merged
 * into the object stored under `key`, read and written in the same transaction, so a concurrent writer's keys are
 * kept rather than dropped).
 */
export interface WriteBatch {
  revisions?: Revision[];
  kv?: Record<string, unknown>;
  mergeKv?: Record<string, Record<string, unknown>>;
}

function merged(stored: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  return { ...base, ...patch };
}

export interface Backend {
  readAll(): Promise<{ revisions: Revision[]; kv: Record<string, unknown> }>;
  write(batch: WriteBatch): Promise<void>;
  clear(): Promise<void>;
}

export function memoryBackend(): Backend {
  const revisions = new Map<number, Revision>();
  const kv = new Map<string, unknown>();
  return {
    async readAll() {
      return {
        revisions: [...revisions.values()].sort((a, b) => a.id - b.id).map((r) => structuredClone(r)),
        kv: structuredClone(Object.fromEntries(kv)),
      };
    },
    async write(batch) {
      // Clone on the way in so later mutation by a caller cannot reach stored data (as with IndexedDB).
      for (const r of batch.revisions ?? []) revisions.set(r.id, structuredClone(r));
      for (const [k, v] of Object.entries(batch.kv ?? {})) kv.set(k, structuredClone(v));
      for (const [k, patch] of Object.entries(batch.mergeKv ?? {})) kv.set(k, structuredClone(merged(kv.get(k), patch)));
    },
    async clear() {
      revisions.clear();
      kv.clear();
    },
  };
}

const DB_NAME = 'undefined-image';
const DB_VERSION = 1;
const OPEN_TIMEOUT_MS = 3000;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Opens the database; rejects on error, on a blocked upgrade, or when opening hangs past the timeout. */
export function openIdbBackend(factory: IDBFactory): Promise<Backend> {
  return new Promise<IDBDatabase>((resolve, rejectOpen) => {
    let gaveUp = false;
    const reject = (e: unknown): void => {
      gaveUp = true;
      rejectOpen(e);
    };
    const timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), OPEN_TIMEOUT_MS);
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('revisions')) db.createObjectStore('revisions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      if (gaveUp) req.result.close(); // opened after a timeout/block: we already fell back to memory
      else resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error ?? new Error('IndexedDB open failed'));
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('IndexedDB open blocked'));
    };
  }).then((db) => ({
    async readAll() {
      const tx = db.transaction(['revisions', 'kv'], 'readonly');
      const revStore = tx.objectStore('revisions');
      const kvStore = tx.objectStore('kv');
      const [revisions, keys, values] = await Promise.all([
        request(revStore.getAll() as IDBRequest<Revision[]>),
        request(kvStore.getAllKeys()),
        request(kvStore.getAll()),
      ]);
      const kv: Record<string, unknown> = {};
      keys.forEach((k, i) => (kv[String(k)] = values[i]));
      return { revisions: revisions.sort((a, b) => a.id - b.id), kv };
    },
    async write(batch) {
      const tx = db.transaction(['revisions', 'kv'], 'readwrite');
      const finished = done(tx);
      for (const r of batch.revisions ?? []) tx.objectStore('revisions').put(r);
      for (const [k, v] of Object.entries(batch.kv ?? {})) tx.objectStore('kv').put(v, k);
      for (const [k, patch] of Object.entries(batch.mergeKv ?? {})) {
        // read-modify-write inside this one readwrite transaction: no other tab can write in between
        const store = tx.objectStore('kv');
        const got = store.get(k);
        got.onsuccess = () => store.put(merged(got.result, patch), k);
      }
      await finished;
    },
    async clear() {
      const tx = db.transaction(['revisions', 'kv'], 'readwrite');
      const finished = done(tx);
      tx.objectStore('revisions').clear();
      tx.objectStore('kv').clear();
      await finished;
    },
  }));
}

/**
 * Wraps a primary backend with an in-memory mirror. Every write also lands in the mirror; the first failure of
 * the primary switches all later reads and writes to the mirror for the rest of the session.
 */
export function resilientBackend(primary: Promise<Backend> | Backend): Backend {
  const mirror = memoryBackend();
  let failed = false;
  const fail = (e: unknown): void => {
    if (!failed) console.warn('[store] persistent storage unavailable; keeping state in memory for this session', e);
    failed = true;
  };
  return {
    async readAll() {
      if (!failed) {
        try {
          const data = await (await primary).readAll();
          // Seed the mirror so a later failure does not lose what was already persisted.
          await mirror.clear();
          await mirror.write({ revisions: data.revisions, kv: data.kv });
          return data;
        } catch (e) {
          fail(e);
        }
      }
      return mirror.readAll();
    },
    async write(batch) {
      await mirror.write(batch);
      if (failed) return;
      try {
        await (await primary).write(batch);
      } catch (e) {
        fail(e);
      }
    },
    async clear() {
      await mirror.clear();
      if (failed) return;
      try {
        await (await primary).clear();
      } catch (e) {
        fail(e);
      }
    },
  };
}

function defaultBackend(): Backend {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return memoryBackend();
  let opened: Promise<Backend>;
  try {
    opened = openIdbBackend(factory);
  } catch (e) {
    opened = Promise.reject(e); // some browsers throw synchronously from open() in private mode
  }
  opened.catch(() => {}); // the rejection is observed by resilientBackend on first use
  return resilientBackend(opened);
}

let backend: Backend | null = null;

function current(): Backend {
  backend ??= defaultBackend();
  return backend;
}

/** Test hook: inject a backend (wrap it with resilientBackend for the degrade behaviour); null = default again. */
export function _useBackend(b: Backend | null): void {
  backend = b;
}

async function safely<T>(what: string, fallback: T, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    console.warn(`[store] ${what} failed`, e);
    return fallback;
  }
}

// ───────────────────────── persisted state ─────────────────────────

const K_HEAD = 'head';
const K_FLAGS = 'flags';
const K_ENV = 'liveEnv';
const K_DATASETS = 'datasets';

/** What loadStored found: nothing, a usable image (possibly repaired), or an image that was discarded and why. */
export type LoadOutcome =
  | { kind: 'empty' }
  | { kind: 'ok'; persisted: Persisted }
  | { kind: 'discarded'; reason: string };

/**
 * Drop, from every raw stored revision, each bound dataset whose rows are not stored. Returns the names dropped (sorted,
 * unique); never throws on malformed input (validation reports that).
 */
function unbindMissing(revisions: Revision[], stored: Record<string, Json>): { revisions: Revision[]; dropped: string[] } {
  const dropped = new Set<string>();
  const out = revisions.map((rev) => {
    const r = rev as unknown;
    if (!isObject(r) || !isObject(r.program) || !isObject(r.program.datasets)) return rev;
    const ds = r.program.datasets;
    const keep: Obj = {};
    let changed = false;
    for (const [name, ref] of Object.entries(ds)) {
      if (isObject(ref) && typeof ref.hash === 'string' && !(ref.hash in stored)) {
        dropped.add(name);
        changed = true;
      } else {
        keep[name] = ref;
      }
    }
    return changed ? ({ ...rev, program: { ...rev.program, datasets: keep } } as Revision) : rev;
  });
  return { revisions: out, dropped: [...dropped].sort() };
}

/**
 * The stored image, flags and live env. A stored image whose only problem is bound datasets with no stored rows (e.g.
 * two tabs wrote the same database) is REPAIRED: those bindings are dropped from every revision, the repaired
 * revisions are written back, and their names come back in `persisted.repaired`. Any other validation failure clears
 * the store (a console warning says why) and comes back as `discarded` with the reason, for the UI to say so.
 * Hashes are returned as stored; call reverify() if they must be recomputed.
 */
export function loadStored(): Promise<LoadOutcome> {
  return safely<LoadOutcome>('load', { kind: 'empty' }, async () => {
    const { revisions, kv } = await current().readAll();
    if (revisions.length === 0) return { kind: 'empty' };
    const lastId = revisions[revisions.length - 1]!.id;
    const storedHead = kv[K_HEAD];
    const head =
      typeof storedHead === 'number' && revisions.some((r) => r.id === storedHead) ? storedHead : lastId;
    const storedDatasets = isObject(kv[K_DATASETS]) && Object.values(kv[K_DATASETS]).every(isJson) ? (kv[K_DATASETS] as Record<string, Json>) : {};
    let checked = validateImage(toImage(revisions, head, storedDatasets));
    let repaired: string[] = [];
    if (!checked.ok) {
      const fixed = unbindMissing(revisions, storedDatasets);
      if (fixed.dropped.length > 0) {
        const again = validateImage(toImage(fixed.revisions, head, storedDatasets));
        if (again.ok) {
          console.warn(`[store] stored image repaired: unbound datasets with no stored rows (${fixed.dropped.join(', ')})`);
          checked = again;
          repaired = fixed.dropped;
          // write the repair back, or every later load repairs (and warns) again
          await current().write({ revisions: again.image.revisions });
        }
      }
    }
    if (!checked.ok) {
      // Clear it: otherwise reseeding r1 would overwrite id 1 only and leave the broken rows behind.
      console.warn(`[store] discarding stored image: ${checked.error}`);
      await current().clear();
      return { kind: 'discarded', reason: checked.error };
    }
    const f = isObject(kv[K_FLAGS]) ? kv[K_FLAGS] : {};
    const env = kv[K_ENV];
    return {
      kind: 'ok',
      persisted: {
        image: checked.image,
        flags: {
          takeawayShown: f.takeawayShown === true,
          openerDismissed: f.openerDismissed === true,
          ...(typeof f.sendSamples === 'boolean' ? { sendSamples: f.sendSamples } : {}),
          ...(f.start === 'examples' || f.start === 'data' ? { start: f.start } : {}),
        },
        liveEnv: isObject(env) && Object.values(env).every(isJson) ? (env as Record<string, Json>) : {},
        datasets: checked.image.datasets ?? {},
        ...(repaired.length > 0 ? { repaired } : {}),
      },
    };
  });
}

/** loadStored's image, or null when nothing usable is stored (empty, or discarded: see loadStored). */
export async function loadPersisted(): Promise<Persisted | null> {
  const r = await loadStored();
  return r.kind === 'ok' ? r.persisted : null;
}

export function appendRevision(rev: Revision, head: number): Promise<void> {
  return safely('appendRevision', undefined, () => current().write({ revisions: [rev], kv: { [K_HEAD]: head } }));
}

/**
 * Re-store an existing revision (same id) without touching the head: metadata attached after the fact, such as a
 * mutation report on an artifact's evidence. Evidence is not part of any hash, so nothing is invalidated.
 */
export function updateRevision(rev: Revision): Promise<void> {
  return safely('updateRevision', undefined, () => current().write({ revisions: [rev] }));
}

export function saveFlags(flags: Persisted['flags']): Promise<void> {
  return safely('saveFlags', undefined, () => current().write({ kv: { [K_FLAGS]: flags } }));
}

/**
 * Store dataset rows by hash. MERGES into what is stored (never drops a hash): another tab on the same database may
 * have revisions that refer to rows this tab does not hold. Stored rows only go away with clearAll (reset, import).
 */
export function saveDatasets(datasets: Record<string, Json>): Promise<void> {
  if (Object.keys(datasets).length === 0) return Promise.resolve();
  return safely('saveDatasets', undefined, () => current().write({ mergeKv: { [K_DATASETS]: datasets } }));
}

export function saveLiveEnv(env: Record<string, Json>): Promise<void> {
  return safely('saveLiveEnv', undefined, () => current().write({ kv: { [K_ENV]: env } }));
}

export function clearAll(): Promise<void> {
  return safely('clearAll', undefined, () => current().clear());
}

// ───────────────────────── image ─────────────────────────

/**
 * version 2 only when some revision holds decisions: an older build rejects it ("version must be 1") instead of
 * silently dropping the decisions (its validator keeps known fields only) and showing stale artifacts as live.
 */
export function toImage(revisions: Revision[], head: number, datasets?: Record<string, Json>): Image {
  const version = imageHasDeps(revisions) ? 3 : imageHasDecisions(revisions) ? 2 : 1;
  const image: Image = { format: 'undefined-image', version, exportedAt: new Date().toISOString(), head, revisions };
  if (datasets && Object.keys(datasets).length > 0) image.datasets = datasets;
  return image;
}

/**
 * Recompute every record's specHash/testsHash from its spec text. Imported hashes are never trusted: a spec
 * edited by hand gets new record hashes while the artifact keeps its provenance hashes, so it reads as stale.
 */
export async function reverify(image: Image): Promise<Image> {
  const revisions = await Promise.all(
    image.revisions.map(async (rev) => {
      const entries = await Promise.all(
        Object.entries(rev.program.functions).map(
          async ([name, rec]) => [name, { ...rec, ...(await hashesFor(rec.spec)) }] as const,
        ),
      );
      return { ...rev, program: { ...rev.program, functions: Object.fromEntries(entries) } };
    }),
  );
  return { ...image, revisions };
}

// Validation helpers and the spec/decision/pin validators are the engine's (spec/validate.ts), shared with the CLI.
// readDecisions stays importable from here for the site's own readers.
export { readDecisions };

const GATE_IDS = ['compile', 'tests', 'properties', 'invariants'] as const;
const KINDS = ['init', 'commit', 'spec-edit', 'rollback', 'import', 'example', 'delete', 'recertify', 'pin', 'dataset', 'decision'] as const;

/**
 * Whether any artifact calls another generated function (Artifact.deps): such an image is written as version 3, so an
 * older build refuses it rather than loading composed functions it cannot link.
 */
export function imageHasDeps(revisions: readonly Revision[]): boolean {
  return revisions.some((r) => Object.values(r.program.functions).some((f) => f.artifact?.deps !== undefined));
}

/** Whether any revision holds a decision (or is one): such an image is written as version 2. */
export function imageHasDecisions(revisions: readonly Revision[]): boolean {
  return revisions.some((r) => r.kind === 'decision' || Object.values(r.program.functions).some((f) => (f.spec.decisions?.length ?? 0) > 0));
}

function vDiagnostic(v: unknown, path: string): Diagnostic {
  const o = obj(v, path);
  const kind = oneOf(o, 'kind', path, ['compile', 'test', 'property', 'invariant'] as const);
  // Check the fields each kind's renderer relies on; then keep the whole (JSON-safe) object.
  if (kind === 'compile') {
    for (const k of ['code', 'line', 'col', 'endLine', 'endCol']) num(o, k, path);
    str(o, 'message', path);
    str(o, 'snippet', path);
    oneOf(o, 'category', path, ['error', 'warning'] as const);
  } else if (kind === 'test') {
    str(o, 'name', path);
    str(o, 'message', path);
  } else if (kind === 'property') {
    str(o, 'name', path);
    str(o, 'counterexample', path);
    for (const k of ['shrinks', 'runs', 'seed']) num(o, k, path);
  } else {
    oneOf(o, 'invariant', path, ['pure', 'bounded'] as const);
    str(o, 'message', path);
  }
  if (!isJson(o)) bad(path, 'must be plain JSON');
  return structuredClone(o) as unknown as Diagnostic;
}

function vGate(v: unknown, path: string): GateResult {
  const o = obj(v, path);
  let counts: GateResult['counts'];
  if (o.counts !== undefined) {
    const c = obj(o.counts, `${path}.counts`);
    counts = { passed: num(c, 'passed', `${path}.counts`), total: num(c, 'total', `${path}.counts`) };
  }
  return opt(
    {
      gate: oneOf(o, 'gate', path, GATE_IDS),
      status: oneOf(o, 'status', path, ['pending', 'running', 'pass', 'fail', 'skipped'] as const),
      ms: num(o, 'ms', path),
      summary: str(o, 'summary', path),
      diagnostics: arr(o, 'diagnostics', path).map((d, i) => vDiagnostic(d, `${path}.diagnostics[${i}]`)),
    } as GateResult,
    { headline: optStr(o, 'headline', path), note: optStr(o, 'note', path), counts },
  );
}

function vCandidate(v: unknown, path: string): Candidate {
  const o = obj(v, path);
  return opt(
    {
      id: str(o, 'id', path),
      attempt: int(o, 'attempt', path, 1),
      body: str(o, 'body', path),
      notes: str(o, 'notes', path),
      source: oneOf(o, 'source', path, ['live', 'replay'] as const),
      generationMs: num(o, 'generationMs', path),
      gates: arr(o, 'gates', path).map((g, i) => vGate(g, `${path}.gates[${i}]`)),
      verdict: oneOf(o, 'verdict', path, ['accepted', 'rejected', 'aborted'] as const),
    } as Candidate,
    {
      rejectedBy: o.rejectedBy === undefined ? undefined : oneOf(o, 'rejectedBy', path, GATE_IDS),
      headline: optStr(o, 'headline', path),
      prompt: optStr(o, 'prompt', path),
    },
  );
}

function vArtifact(v: unknown, path: string): Artifact | null {
  if (v === undefined || v === null) return null;
  const o = obj(v, path);
  return {
    body: str(o, 'body', path),
    source: str(o, 'source', path),
    js: str(o, 'js', path),
    returnType: str(o, 'returnType', path),
    specHash: str(o, 'specHash', path),
    testsHash: str(o, 'testsHash', path),
    model: str(o, 'model', path),
    codexVersion: str(o, 'codexVersion', path),
    committedAt: num(o, 'committedAt', path),
    candidates: arr(o, 'candidates', path).map((c, i) => vCandidate(c, `${path}.candidates[${i}]`)),
    revision: int(o, 'revision', path, 1),
    ...(o.evidence === undefined ? {} : { evidence: vJsonObject(o.evidence, `${path}.evidence`) as unknown as Evidence }),
    ...(o.recertified === undefined ? {} : { recertified: vJsonArray(o.recertified, `${path}.recertified`) as unknown as NonNullable<Artifact['recertified']> }),
    ...(o.deps === undefined ? {} : { deps: vDeps(o.deps, `${path}.deps`) }),
  };
}

/** Artifact.deps: identifier keys, each a 64-hex closureHash and a positive integer revision; never empty. */
function vDeps(v: unknown, path: string): NonNullable<Artifact['deps']> {
  const o = obj(v, path);
  const out: NonNullable<Artifact['deps']> = {};
  const names = Object.keys(o);
  if (names.length === 0) bad(path, 'must not be empty (absent when the function calls nothing)');
  for (const name of names) {
    const p = key(path, name);
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) bad(p, 'must be a function name');
    const d = obj(o[name], p);
    const hash = str(d, 'hash', p);
    if (!/^[0-9a-f]{64}$/.test(hash)) bad(`${p}.hash`, 'must be a sha256 hash');
    Object.defineProperty(out, name, { value: { hash, revision: int(d, 'revision', p, 1) }, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function vJsonObject(v: unknown, path: string): Obj {
  const o = obj(v, path);
  if (!isJson(o)) bad(path, 'must be plain JSON');
  return structuredClone(o) as Obj;
}
function vJsonArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) bad(path, 'must be an array');
  if (!isJson(v)) bad(path, 'must be plain JSON');
  return structuredClone(v) as unknown[];
}

function vDatasetRef(v: unknown, path: string): DatasetRef {
  const o = obj(v, path);
  return opt(
    {
      name: str(o, 'name', path),
      hash: str(o, 'hash', path),
      typeName: str(o, 'typeName', path),
      typeDecl: str(o, 'typeDecl', path),
      rowCount: int(o, 'rowCount', path, 0),
      columns: arr(o, 'columns', path).map((c, i) => {
        const co = obj(c, `${path}.columns[${i}]`);
        return { name: str(co, 'name', `${path}.columns[${i}]`), type: str(co, 'type', `${path}.columns[${i}]`) };
      }),
      source: oneOf(o, 'source', path, ['paste', 'file', 'bundled'] as const),
      bytes: int(o, 'bytes', path, 0),
    } as DatasetRef,
    { filename: optStr(o, 'filename', path) },
  );
}

function vProgram(v: unknown, path: string): Program {
  const o = obj(v, path);
  const fns = obj(o.functions, `${path}.functions`);
  const functions: Record<string, FunctionRecord> = {};
  for (const [name, raw] of Object.entries(fns)) {
    const p = key(`${path}.functions`, name);
    const r = obj(raw, p);
    const spec = vSpec(r.spec, `${p}.spec`);
    if (spec.name !== name) bad(`${p}.spec.name`, `must equal its key ${JSON.stringify(name)}`);
    functions[name] = {
      spec,
      specHash: str(r, 'specHash', p),
      testsHash: str(r, 'testsHash', p),
      artifact: vArtifact(r.artifact, `${p}.artifact`),
    };
  }
  const program: Program = { functions };
  if (o.datasets !== undefined) {
    const ds = obj(o.datasets, `${path}.datasets`);
    program.datasets = {};
    for (const [name, raw] of Object.entries(ds)) {
      const p = key(`${path}.datasets`, name);
      const ref = vDatasetRef(raw, p);
      if (ref.name !== name) bad(`${p}.name`, `must equal its key ${JSON.stringify(name)}`);
      program.datasets[name] = ref;
    }
  }
  return program;
}

function vRevision(v: unknown, path: string, earlier: Set<number>): Revision {
  const o = obj(v, path);
  const id = int(o, 'id', path, 1);
  const kind = oneOf(o, 'kind', path, KINDS);
  let restoredFrom: number | undefined;
  if (o.restoredFrom !== undefined || kind === 'rollback') {
    restoredFrom = int(o, 'restoredFrom', path, 1);
    if (!earlier.has(restoredFrom)) bad(`${path}.restoredFrom`, `must refer to an earlier revision (got ${restoredFrom})`);
  }
  const env = obj(o.env, `${path}.env`);
  for (const [k, val] of Object.entries(env)) if (!isJson(val)) bad(key(`${path}.env`, k), 'must be JSON');
  return opt(
    {
      id,
      at: num(o, 'at', path),
      kind,
      title: str(o, 'title', path),
      program: vProgram(o.program, `${path}.program`),
      env: structuredClone(env) as Record<string, Json>,
    } as Revision,
    { detail: optStr(o, 'detail', path), fn: optStr(o, 'fn', path), restoredFrom },
  );
}

/**
 * Structural validation of an untrusted image (e.g. an imported file). Returns a sanitised copy holding only
 * known fields, or the first problem as a path-qualified message. Hashes are NOT checked here; use reverify().
 */
export function validateImage(raw: unknown): { ok: true; image: Image } | { ok: false; error: string } {
  try {
    const o = obj(raw, 'image');
    if (o.format !== 'undefined-image') bad('format', 'must be "undefined-image"');
    if (o.version !== 1 && o.version !== 2 && o.version !== 3) bad('version', 'must be 1, 2 or 3');
    const version = o.version;
    const exportedAt = str(o, 'exportedAt', 'image');
    const head = int(o, 'head', 'image', 1);
    const list = arr(o, 'revisions', 'image');
    if (list.length === 0) bad('revisions', 'must not be empty');
    const seen = new Set<number>();
    let prev = 0;
    const revisions = list.map((r, i) => {
      const rev = vRevision(r, `revisions[${i}]`, seen);
      if (rev.id <= prev) bad(`revisions[${i}].id`, `must be greater than the previous id ${prev} (got ${rev.id})`);
      prev = rev.id;
      seen.add(rev.id);
      return rev;
    });
    if (!seen.has(head)) bad('head', `must be the id of a revision (got ${head})`);
    if (version === 1 && imageHasDecisions(revisions)) bad('version', 'must be 2: the image holds decisions (a version 2 field)');
    if (version !== 3 && imageHasDeps(revisions)) bad('version', 'must be 3: a function in the image calls another (a version 3 field)');
    const image: Image = { format: 'undefined-image', version, exportedAt, head, revisions };
    if (o.datasets !== undefined) {
      const ds = obj(o.datasets, 'datasets');
      image.datasets = {};
      for (const [h, rows] of Object.entries(ds)) {
        if (!/^[0-9a-f]{64}$/.test(h)) bad(key('datasets', h), 'dataset keys must be sha256 hashes');
        if (!Array.isArray(rows) || !isJson(rows)) bad(key('datasets', h), 'must be a JSON array of rows');
        image.datasets[h] = structuredClone(rows) as Json;
      }
    }
    for (const rev of revisions) {
      for (const ref of Object.values(rev.program.datasets ?? {})) {
        if (!image.datasets || !(ref.hash in image.datasets)) bad(`revisions[${rev.id}].program.datasets.${ref.name}`, 'refers to a dataset that is not in the image');
      }
    }
    return { ok: true, image };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message.replace(/^image\./, '') };
    throw e;
  }
}
