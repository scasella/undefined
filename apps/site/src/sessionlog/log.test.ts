import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boundDetail,
  createSessionLog,
  idbBackend,
  MAX_DETAIL_BYTES,
  MAX_ENTRIES,
  memoryBackend,
  SESSION_LOG_DB,
  SESSION_LOG_FLAG,
  validateSessionLog,
  type LogBackend,
  type SessionLogEntry,
} from './log';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

function setup(opts: { on?: boolean; backend?: LogBackend } = {}) {
  let t = 1000;
  const storage = fakeStorage(opts.on ? { [SESSION_LOG_FLAG]: '1' } : {});
  const log = createSessionLog({ backend: opts.backend ?? memoryBackend(), storage, now: () => t++, newId: () => 'sess-1' });
  return { log, storage };
}

function failingBackend(kind: 'memory' | 'indexeddb' = 'indexeddb'): LogBackend {
  const boom = () => Promise.reject(new Error('disk on fire'));
  return { kind, add: boom, all: boom, count: boom, deleteOldest: boom, clear: boom };
}

describe('session log: opt-in', () => {
  it('is off by default and append is a no-op while off', async () => {
    const { log, storage } = setup();
    expect(log.isEnabled()).toBe(false);
    await log.append({ kind: 'input', input: 'median([1,2])', summary: 'typed a call' });
    expect(await log.count()).toBe(0);
    expect(await log.list()).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it('persists the flag in localStorage and reads it back', async () => {
    const { log, storage } = setup();
    await log.setEnabled(true);
    expect(storage.data.get(SESSION_LOG_FLAG)).toBe('1');
    const again = createSessionLog({ backend: memoryBackend(), storage });
    expect(again.isEnabled()).toBe(true);
    await log.setEnabled(false);
    expect(createSessionLog({ backend: memoryBackend(), storage }).isEnabled()).toBe(false);
  });

  it('round-trips enable / append / list / export / clear', async () => {
    const { log } = setup();
    await log.setEnabled(true);
    await log.append({ kind: 'input', input: 'median([3,1,2])', summary: 'call' });
    await log.append({ kind: 'gate', fn: 'median', summary: 'rejected by tests', detail: { gate: 'tests', headline: 'median([1,2]) expected 1.5' } });
    await log.append({ kind: 'commit', fn: 'median', summary: 'committed median' });
    const entries = await log.list();
    expect(entries).toEqual([
      { t: 1000, session: 'sess-1', kind: 'input', input: 'median([3,1,2])', summary: 'call' },
      { t: 1001, session: 'sess-1', kind: 'gate', fn: 'median', summary: 'rejected by tests', detail: { gate: 'tests', headline: 'median([1,2]) expected 1.5' } },
      { t: 1002, session: 'sess-1', kind: 'commit', fn: 'median', summary: 'committed median' },
    ]);
    expect(log.session).toBe('sess-1');

    const exported = JSON.parse(await log.exportJson());
    expect(exported).toMatchObject({ format: 'undefined-session-log', version: 1, entries });
    expect(typeof exported.exportedAt).toBe('string');
    expect(validateSessionLog(exported)).toEqual({ ok: true, entries });
    expect(validateSessionLog(await log.exportJson())).toEqual({ ok: true, entries });

    // Turning it off keeps what is there until clear().
    await log.setEnabled(false);
    await log.append({ kind: 'note', summary: 'ignored' });
    expect(await log.count()).toBe(3);
    await log.clear();
    expect(await log.count()).toBe(0);
  });

  it('gives each log a session id (crypto or fallback)', () => {
    const a = createSessionLog({ backend: memoryBackend(), storage: fakeStorage() });
    const b = createSessionLog({ backend: memoryBackend(), storage: fakeStorage() });
    expect(a.session).not.toBe('');
    expect(a.session).not.toBe(b.session);
    const c = createSessionLog({
      backend: memoryBackend(),
      storage: fakeStorage(),
      newId: () => {
        throw new Error('no');
      },
    });
    expect(c.session).not.toBe('');
  });

  it('keeps appends in order when they are not awaited', async () => {
    const { log } = setup({ on: true });
    await Promise.all(Array.from({ length: 50 }, (_, i) => log.append({ kind: 'note', summary: `n${i}` })));
    expect((await log.list()).map((e) => e.summary)).toEqual(Array.from({ length: 50 }, (_, i) => `n${i}`));
  });
});

describe('session log: caps', () => {
  it(`keeps at most ${MAX_ENTRIES} entries, dropping the oldest`, async () => {
    const { log } = setup({ on: true });
    for (let i = 0; i < MAX_ENTRIES + 25; i++) await log.append({ kind: 'note', summary: `n${i}` });
    expect(await log.count()).toBe(MAX_ENTRIES);
    const entries = await log.list();
    expect(entries[0].summary).toBe('n25');
    expect(entries[entries.length - 1].summary).toBe(`n${MAX_ENTRIES + 24}`);
  });

  it('truncates summary, input and fn', async () => {
    const { log } = setup({ on: true });
    await log.append({ kind: 'input', summary: 'x'.repeat(1000), input: 'y'.repeat(5000), fn: 'z'.repeat(500) });
    const [e] = await log.list();
    expect(e.summary).toHaveLength(300);
    expect(e.summary.endsWith('…')).toBe(true);
    expect(e.input!.length).toBe(1000);
    expect(e.fn!.length).toBe(200);
  });

  it('truncates a large detail to a marker that fits 2 KB', async () => {
    const { log } = setup({ on: true });
    await log.append({ kind: 'outcome', summary: 's', detail: { rows: Array.from({ length: 1000 }, (_, i) => ({ i, name: `é${i}` })) } });
    const [e] = await log.list();
    const d = e.detail as Record<string, unknown>;
    expect(d.$truncated).toBe(true);
    expect(d.bytes).toBeGreaterThan(MAX_DETAIL_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(d)).length).toBeLessThanOrEqual(MAX_DETAIL_BYTES);
    // Multi-byte text: still within the byte limit.
    const wide = boundDetail('😀'.repeat(3000)) as Record<string, unknown>;
    expect(new TextEncoder().encode(JSON.stringify(wide)).length).toBeLessThanOrEqual(MAX_DETAIL_BYTES);
    // Small detail passes through, detached from the caller's object.
    const small = { gate: 'compile' };
    expect(boundDetail(small)).toEqual(small);
    expect(boundDetail(small)).not.toBe(small);
  });

  it('turns non-JSON detail and unknown kinds into safe entries', async () => {
    const { log } = setup({ on: true });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await log.append({ kind: 'error', summary: 'cyclic', detail: cyclic as never });
    await log.append({ kind: 'error', summary: 'bigint', detail: 10n as never });
    await log.append({ kind: 'bogus' as never, summary: 'odd kind' });
    await log.append(null as never);
    const entries = await log.list();
    expect(entries.map((e) => e.detail)).toEqual([{ $truncated: true, bytes: 0, preview: 'not JSON' }, { $truncated: true, bytes: 0, preview: 'not JSON' }, undefined]);
    expect(entries[2]).toMatchObject({ kind: 'note', summary: '[bogus] odd kind' });
  });
});

describe('session log: failure never throws', () => {
  it('degrades a failing backend to memory and reports "failed"', async () => {
    const { log } = setup({ on: true, backend: failingBackend() });
    expect(log.status()).toBe('indexeddb');
    await expect(log.append({ kind: 'note', summary: 'a' })).resolves.toBeUndefined();
    expect(log.status()).toBe('failed');
    await log.append({ kind: 'note', summary: 'b' });
    expect((await log.list()).map((e) => e.summary)).toEqual(['a', 'b']);
    await expect(log.clear()).resolves.toBeUndefined();
    expect(await log.count()).toBe(0);
  });

  it('never throws even when reads fail first', async () => {
    const { log } = setup({ backend: failingBackend() });
    await expect(log.list()).resolves.toEqual([]);
    await expect(log.count()).resolves.toBe(0);
    await expect(log.exportJson()).resolves.toContain('"undefined-session-log"');
    expect(log.status()).toBe('failed');
  });

  it('survives storage that throws and a clock that throws', async () => {
    const storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const log = createSessionLog({
      backend: memoryBackend(),
      storage,
      now: () => {
        throw new Error('clock');
      },
    });
    expect(log.isEnabled()).toBe(false);
    await expect(log.setEnabled(true)).resolves.toBeUndefined();
    expect(log.isEnabled()).toBe(true);
    await log.append({ kind: 'note', summary: 'x' });
    expect((await log.list())[0].t).toBeGreaterThan(0);
  });

  it('uses memory when there is no IndexedDB and no localStorage (node)', async () => {
    const log = createSessionLog();
    expect(log.status()).toBe('memory');
    expect(log.isEnabled()).toBe(false);
    await log.setEnabled(true);
    await log.append({ kind: 'note', summary: 'x' });
    expect(await log.count()).toBe(1);
  });

  it('idbBackend without a factory, or with one that fails to open, degrades', async () => {
    const none = createSessionLog({ backend: idbBackend(undefined), storage: fakeStorage({ [SESSION_LOG_FLAG]: '1' }) });
    await none.append({ kind: 'note', summary: 'x' });
    expect(none.status()).toBe('failed');
    expect(await none.count()).toBe(1);

    const throwing = { open: () => { throw new Error('denied'); } } as unknown as IDBFactory;
    const t = createSessionLog({ backend: idbBackend(throwing), storage: fakeStorage({ [SESSION_LOG_FLAG]: '1' }) });
    await t.append({ kind: 'note', summary: 'x' });
    expect(t.status()).toBe('failed');

    const erroring = {
      open: () => {
        const r: Record<string, unknown> = { error: new Error('nope') };
        queueMicrotask(() => (r.onerror as () => void)());
        return r;
      },
    } as unknown as IDBFactory;
    const e = createSessionLog({ backend: idbBackend(erroring), storage: fakeStorage({ [SESSION_LOG_FLAG]: '1' }) });
    await e.append({ kind: 'note', summary: 'x' });
    expect(e.status()).toBe('failed');
    expect((await e.list()).map((x) => x.summary)).toEqual(['x']);
  });
});

// ───────────────────────── a minimal fake IndexedDB (only what idbBackend uses) ─────────────────────────

function fakeIndexedDB() {
  const dbs = new Map<string, Map<string, Map<number, unknown>>>();
  const opened: string[] = [];
  let nextKey = 1;
  const later = (f: () => void) => queueMicrotask(f);

  function request<T>(compute: () => T, tx?: { pending: number; settle: () => void }) {
    const r: Record<string, unknown> = {};
    if (tx) tx.pending++;
    later(() => {
      r.result = compute();
      (r.onsuccess as (() => void) | undefined)?.();
      if (tx) {
        tx.pending--;
        tx.settle();
      }
    });
    return r;
  }

  function database(name: string) {
    const stores = dbs.get(name)!;
    return {
      objectStoreNames: { contains: (s: string) => stores.has(s) },
      createObjectStore: (s: string) => void stores.set(s, new Map()),
      transaction(storeName: string) {
        const rows = stores.get(storeName)!;
        const tx: Record<string, unknown> & { pending: number; settle: () => void } = {
          pending: 0,
          settle() {
            later(() => {
              if (tx.pending === 0) (tx.oncomplete as (() => void) | undefined)?.();
            });
          },
          objectStore: () => ({
            add: (v: unknown) => request(() => void rows.set(nextKey++, structuredClone(v)), tx),
            getAll: () => request(() => [...rows.keys()].sort((a, b) => a - b).map((k) => structuredClone(rows.get(k))), tx),
            count: () => request(() => rows.size, tx),
            clear: () => request(() => void rows.clear(), tx),
            openCursor: () => {
              const keys = [...rows.keys()].sort((a, b) => a - b);
              let i = 0;
              const r: Record<string, unknown> = {};
              const step = () => {
                tx.pending++;
                later(() => {
                  const key = keys[i];
                  r.result =
                    key === undefined
                      ? null
                      : {
                          delete: () => void rows.delete(key),
                          continue: () => {
                            i++;
                            step();
                          },
                        };
                  (r.onsuccess as () => void)();
                  tx.pending--;
                  tx.settle();
                });
              };
              step();
              return r;
            },
          }),
        };
        return tx;
      },
    };
  }

  const factory = {
    open(name: string) {
      opened.push(name);
      const r: Record<string, unknown> = {};
      later(() => {
        const fresh = !dbs.has(name);
        if (fresh) dbs.set(name, new Map());
        r.result = database(name);
        if (fresh) (r.onupgradeneeded as (() => void) | undefined)?.();
        (r.onsuccess as () => void)();
      });
      return r;
    },
  };
  return { factory: factory as unknown as IDBFactory, opened, dbs };
}

describe('idbBackend (against a fake IndexedDB)', () => {
  it('stores entries in its own database, in order, and survives a "reload"', async () => {
    const idb = fakeIndexedDB();
    const storage = fakeStorage();
    const log = createSessionLog({ backend: idbBackend(idb.factory), storage, newId: () => 'one' });
    expect(log.status()).toBe('indexeddb');
    await log.setEnabled(true);
    for (let i = 0; i < 5; i++) await log.append({ kind: 'note', summary: `n${i}` });
    expect(log.status()).toBe('indexeddb');
    expect(idb.opened).toEqual([SESSION_LOG_DB]);
    expect(await log.count()).toBe(5);

    const reloaded = createSessionLog({ backend: idbBackend(idb.factory), storage, newId: () => 'two' });
    expect(reloaded.isEnabled()).toBe(true);
    await reloaded.append({ kind: 'note', summary: 'after reload' });
    const entries = await reloaded.list();
    expect(entries.map((e) => `${e.session}:${e.summary}`)).toEqual(['one:n0', 'one:n1', 'one:n2', 'one:n3', 'one:n4', 'two:after reload']);
    await reloaded.clear();
    expect(await log.count()).toBe(0);
  });

  it('deleteOldest removes exactly the oldest n', async () => {
    const idb = fakeIndexedDB();
    const b = idbBackend(idb.factory);
    const mk = (i: number): SessionLogEntry => ({ t: i, session: 's', kind: 'note', summary: `n${i}` });
    for (let i = 0; i < 6; i++) await b.add(mk(i));
    await b.deleteOldest(4);
    expect((await b.all()).map((e) => e.summary)).toEqual(['n4', 'n5']);
    await b.deleteOldest(0);
    expect(await b.count()).toBe(2);
  });
});

// ───────────────────────── validation ─────────────────────────

describe('validateSessionLog', () => {
  const good = { format: 'undefined-session-log', version: 1, exportedAt: '2026-10-04T00:00:00Z', entries: [{ t: 1, session: 's', kind: 'note', summary: 'x', extra: 'dropped' }] };

  it('accepts a good export and drops unknown fields', () => {
    expect(validateSessionLog(good)).toEqual({ ok: true, entries: [{ t: 1, session: 's', kind: 'note', summary: 'x' }] });
  });

  it.each([
    ['not json', '{', /not JSON/],
    ['an array', [], /must be a JSON object \(got array\)/],
    ['a recording', { format: 'undefined-recording' }, /This is a recording/],
    ['an image', { format: 'undefined-image' }, /program image/],
    ['wrong version', { ...good, version: 2 }, /version must be 1 \(got number 2\)/],
    ['no entries', { ...good, entries: null }, /entries must be an array \(got null\)/],
    ['bad entry', { ...good, entries: [5] }, /entries\[0\] must be an object/],
    ['bad t', { ...good, entries: [{ ...good.entries[0], t: 'x' }] }, /entries\[0\]\.t must be a finite number/],
    ['bad kind', { ...good, entries: [{ ...good.entries[0], kind: 'telemetry' }] }, /entries\[0\]\.kind must be one of "input"/],
    ['bad summary', { ...good, entries: [{ ...good.entries[0], summary: 3 }] }, /entries\[0\]\.summary must be a string/],
    ['bad input', { ...good, entries: [{ ...good.entries[0], input: {} }] }, /entries\[0\]\.input must be a string/],
  ])('rejects %s', (_name, raw, re) => {
    const r = validateSessionLog(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(re);
  });

  it('bounds oversized entries and keeps only the newest when there are too many', () => {
    const many = { ...good, entries: Array.from({ length: MAX_ENTRIES + 3 }, (_, i) => ({ t: i, session: 's', kind: 'note', summary: 'y'.repeat(i === MAX_ENTRIES + 2 ? 999 : 1) })) };
    const r = validateSessionLog(many);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(MAX_ENTRIES);
    expect(r.entries[0].t).toBe(3);
    expect(r.entries[r.entries.length - 1].summary).toHaveLength(300);
  });

  it('does not let "__proto__" pollute', () => {
    const text = '{"format":"undefined-session-log","version":1,"exportedAt":"x","__proto__":{"polluted":1},"entries":[{"t":1,"session":"s","kind":"note","summary":"x","__proto__":{"polluted":2},"detail":{"__proto__":{"polluted":3}}}]}';
    const r = validateSessionLog(text);
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (r.ok) expect(Object.getPrototypeOf(r.entries[0])).toBe(Object.prototype);
  });
});

// ───────────────────────── no network ─────────────────────────

describe('no network use', () => {
  it('the session log source never references a network API', () => {
    const dir = import.meta.dirname;
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/\bfetch\b|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|navigator\.|importScripts|from ['"]\.\.\/share/);
    }
  });
});
