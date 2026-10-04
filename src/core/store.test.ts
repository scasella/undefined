import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashesFor } from '../shared/hash';
import type { Artifact, Candidate, FunctionSpec, GateResult, Image, Revision } from '../types';
import { emptyProgram, initialRevision, isLive, isStale, newRevision, rollbackRevision, withArtifact, withSpec } from './program';
import {
  _useBackend,
  appendRevision,
  clearAll,
  loadPersisted,
  memoryBackend,
  resilientBackend,
  reverify,
  saveFlags,
  saveLiveEnv,
  toImage,
  validateImage,
  type Backend,
} from './store';

const spec: FunctionSpec = {
  name: 'median',
  params: [{ name: 'numbers', type: 'number[]' }],
  returns: 'number',
  doc: 'Median of a non-empty list.',
  tests: 'test("odd", () => eq(median([3, 1, 2]), 2));',
  properties: 'property("bounded", [fc.array(fc.integer(), { minLength: 1 })], (xs) => true);',
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'example',
  exampleId: 'median',
};

function gates(rejectedBy?: 'properties'): GateResult[] {
  return [
    { gate: 'compile', status: 'pass', ms: 40, summary: 'compiled', diagnostics: [] },
    { gate: 'tests', status: 'pass', ms: 3, summary: '1/1 tests passed', diagnostics: [], counts: { passed: 1, total: 1 } },
    rejectedBy
      ? {
          gate: 'properties',
          status: 'fail',
          ms: 12,
          summary: '1 property failed',
          headline: 'Rejected: median([1, 2]) returned 1, expected 1.5',
          diagnostics: [
            {
              kind: 'property',
              name: 'bounded',
              call: 'median([1, 2])',
              counterexample: '[[1, 2]]',
              expected: '1.5',
              actual: '1',
              shrinks: 4,
              runs: 17,
              seed: -12345,
            },
          ],
        }
      : { gate: 'properties', status: 'pass', ms: 9, summary: '1/1 properties held', diagnostics: [] },
    rejectedBy
      ? { gate: 'invariants', status: 'skipped', ms: 0, summary: '', note: 'not reached', diagnostics: [] }
      : { gate: 'invariants', status: 'pass', ms: 5, summary: 'pure, bounded', diagnostics: [] },
  ];
}

async function buildHistory(): Promise<Revision[]> {
  const r1 = initialRevision(emptyProgram());
  const p = await withSpec(emptyProgram(), spec);
  const r2 = newRevision([r1], { kind: 'spec-edit', title: 'median spec', fn: 'median', program: p, env: {} });
  const h = await hashesFor(spec);
  const candidates: Candidate[] = [
    { id: 'a1', attempt: 1, body: 'return xs[0];', notes: 'naive', source: 'live', generationMs: 900, gates: gates('properties'), verdict: 'rejected', rejectedBy: 'properties', headline: 'Rejected: median([1, 2]) returned 1, expected 1.5' },
    { id: 'a2', attempt: 2, body: 'return 1.5;', notes: 'sorted', source: 'live', generationMs: 800, gates: gates(), verdict: 'accepted' },
  ];
  const artifact: Artifact = {
    body: 'return 1.5;',
    source: 'function median(numbers: number[]): number {\nreturn 1.5;\n}',
    js: 'function median(numbers) {\nreturn 1.5;\n}',
    returnType: 'number',
    ...h,
    model: 'gpt-5-codex',
    codexVersion: '0.50.0',
    committedAt: 1_760_000_000_000,
    candidates,
    revision: 3,
  };
  const r3 = newRevision([r1, r2], {
    kind: 'commit',
    title: 'median certified — attempt 2 of 3 (rejected by properties first)',
    fn: 'median',
    program: withArtifact(p, 'median', artifact),
    env: { xs: [1, 2], big: { $t: 'bigint', v: '10' } },
  });
  const r4 = rollbackRevision([r1, r2, r3], 2);
  return [r1, r2, r3, r4];
}

/** export → JSON text → parse, as an import would see it. */
async function exported(): Promise<any> {
  const history = await buildHistory();
  return JSON.parse(JSON.stringify(toImage(history, 3)));
}

describe('validateImage', () => {
  it('accepts a real round trip and returns an equal image', async () => {
    const history = await buildHistory();
    const image = toImage(history, 3);
    const res = validateImage(JSON.parse(JSON.stringify(image)));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.image).toEqual(image);
  });

  it('normalises a missing artifact to null and drops unknown fields', async () => {
    const raw = await exported();
    delete raw.revisions[1].program.functions.median.artifact;
    raw.revisions[1].junk = 1;
    const res = validateImage(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.image.revisions[1]!.program.functions.median!.artifact).toBeNull();
    expect('junk' in res.image.revisions[1]!).toBe(false);
  });

  const corruptions: Array<[string, (raw: any) => void, string]> = [
    ['not an object', () => {}, 'image must be an object'],
    ['wrong format', (r) => (r.format = 'zip'), 'format must be "undefined-image"'],
    ['wrong version', (r) => (r.version = 2), 'version must be 1'],
    ['exportedAt', (r) => (r.exportedAt = 5), 'exportedAt must be a string'],
    ['head type', (r) => (r.head = '3'), 'head must be a number'],
    ['head missing from revisions', (r) => (r.head = 9), 'head must be the id of a revision (got 9)'],
    ['revisions not an array', (r) => (r.revisions = {}), 'revisions must be an array'],
    ['empty revisions', (r) => (r.revisions = []), 'revisions must not be empty'],
    ['ids not increasing', (r) => (r.revisions[2].id = 2), 'revisions[2].id must be greater than the previous id 2 (got 2)'],
    ['bad kind', (r) => (r.revisions[0].kind = 'merge'), 'revisions[0].kind must be one of init, commit, spec-edit, rollback, import, example, delete'],
    ['budgetMs', (r) => (r.revisions[2].program.functions.median.spec.budgetMs = '1500'), 'revisions[2].program.functions.median.spec.budgetMs must be a number'],
    ['returns', (r) => (r.revisions[1].program.functions.median.spec.returns = 3), 'revisions[1].program.functions.median.spec.returns must be a string'],
    ['param type', (r) => (r.revisions[1].program.functions.median.spec.params[0].type = null), 'revisions[1].program.functions.median.spec.params[0].type must be a string'],
    ['functions missing', (r) => delete r.revisions[0].program.functions, 'revisions[0].program.functions must be an object'],
    ['spec name vs key', (r) => (r.revisions[1].program.functions.median.spec.name = 'mean'), 'revisions[1].program.functions.median.spec.name must equal its key "median"'],
    ['artifact provenance', (r) => delete r.revisions[2].program.functions.median.artifact.codexVersion, 'revisions[2].program.functions.median.artifact.codexVersion must be a string'],
    ['candidate verdict', (r) => (r.revisions[2].program.functions.median.artifact.candidates[0].verdict = 'meh'), 'revisions[2].program.functions.median.artifact.candidates[0].verdict must be one of accepted, rejected, aborted'],
    ['diagnostic', (r) => delete r.revisions[2].program.functions.median.artifact.candidates[0].gates[2].diagnostics[0].seed, 'revisions[2].program.functions.median.artifact.candidates[0].gates[2].diagnostics[0].seed must be a number'],
    ['env not a record', (r) => (r.revisions[2].env = [1]), 'revisions[2].env must be an object'],
    ['rollback without source', (r) => delete r.revisions[3].restoredFrom, 'revisions[3].restoredFrom must be a number'],
    ['rollback to a later revision', (r) => (r.revisions[3].restoredFrom = 4), 'revisions[3].restoredFrom must refer to an earlier revision (got 4)'],
    ['record hash', (r) => (r.revisions[1].program.functions.median.specHash = null), 'revisions[1].program.functions.median.specHash must be a string'],
  ];

  it.each(corruptions)('rejects: %s', async (_label, corrupt, error) => {
    const raw = _label === 'not an object' ? 'hello' : await exported();
    corrupt(raw);
    expect(validateImage(raw)).toEqual({ ok: false, error });
  });

  it('uses bracket paths for non-identifier function names', async () => {
    const raw = await exported();
    const fns = raw.revisions[1].program.functions;
    fns['my fn'] = { ...fns.median, spec: { ...fns.median.spec, name: 'my fn', doc: 1 } };
    expect(validateImage(raw)).toEqual({
      ok: false,
      error: 'revisions[1].program.functions["my fn"].spec.doc must be a string',
    });
  });
});

describe('reverify', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round trip: export → JSON → validate → reverify keeps hashes and provenance', async () => {
    const history = await buildHistory();
    const res = validateImage(await exported());
    if (!res.ok) throw new Error(res.error);
    const image = await reverify(res.image);
    expect(image.revisions).toEqual(history);
    const rec = image.revisions[2]!.program.functions.median!;
    expect(isLive(rec)).toBe(true);
    expect(rec.artifact!.candidates.map((c) => c.verdict)).toEqual(['rejected', 'accepted']);
  });

  it('a hand-edited spec goes stale; forged record hashes are not trusted', async () => {
    const raw = await exported();
    const original = raw.revisions[2].program.functions.median;
    const oldArtifactHashes = { s: original.artifact.specHash, t: original.artifact.testsHash };
    original.spec.doc = 'Median, edited by hand.';
    const res = validateImage(raw);
    if (!res.ok) throw new Error(res.error);
    // Before reverify the stored (now wrong) hashes still claim the artifact is live.
    expect(isLive(res.image.revisions[2]!.program.functions.median!)).toBe(true);
    const image = await reverify(res.image);
    const rec = image.revisions[2]!.program.functions.median!;
    expect(isStale(rec)).toBe(true);
    expect(rec.specHash).toBe((await hashesFor(rec.spec)).specHash);
    expect(rec.artifact!.specHash).toBe(oldArtifactHashes.s);
    expect(rec.artifact!.testsHash).toBe(oldArtifactHashes.t);
    // the input image is not mutated
    expect(res.image.revisions[2]!.program.functions.median!.specHash).toBe(oldArtifactHashes.s);
  });
});

describe('persistence', () => {
  beforeEach(() => _useBackend(memoryBackend()));
  afterEach(() => _useBackend(null));

  it('loadPersisted is null when empty', async () => {
    expect(await loadPersisted()).toBeNull();
  });

  it('appendRevision / saveFlags / saveLiveEnv round trip', async () => {
    const history = await buildHistory();
    for (const r of history) await appendRevision(r, r.id);
    await appendRevision(history[3]!, 3); // head moved back without a new revision is allowed
    await saveFlags({ takeawayShown: true, openerDismissed: false });
    await saveLiveEnv({ xs: [1, 2, 3] });
    const p = await loadPersisted();
    expect(p).not.toBeNull();
    expect(p!.image.head).toBe(3);
    expect(p!.image.revisions).toEqual(history);
    expect(p!.flags).toEqual({ takeawayShown: true, openerDismissed: false });
    expect(p!.liveEnv).toEqual({ xs: [1, 2, 3] });
  });

  it('defaults flags/env and falls back to the last id for an unknown head', async () => {
    const r1 = initialRevision(emptyProgram());
    await appendRevision(r1, 99);
    const p = await loadPersisted();
    expect(p!.image.head).toBe(1);
    expect(p!.flags).toEqual({ takeawayShown: false, openerDismissed: false });
    expect(p!.liveEnv).toEqual({});
  });

  it('stores copies: mutating a revision after saving does not change what is stored', async () => {
    const r1 = initialRevision(emptyProgram());
    const env: Record<string, any> = { a: 1 };
    await appendRevision({ ...r1, env }, 1);
    env.a = 2;
    expect((await loadPersisted())!.image.revisions[0]!.env).toEqual({ a: 1 });
  });

  it('ignores a stored image that no longer validates', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await appendRevision({ ...initialRevision(emptyProgram()), kind: 'bogus' as never }, 1);
    expect(await loadPersisted()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('discards an invalid stored image so reseeding does not mix in old rows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const history = await buildHistory();
    for (const r of history) await appendRevision(r, r.id);
    await appendRevision({ ...history[1]!, title: 7 as never }, 4);
    expect(await loadPersisted()).toBeNull();
    await appendRevision(initialRevision(emptyProgram()), 1);
    const p = await loadPersisted();
    expect(p!.image.revisions.map((r) => r.id)).toEqual([1]);
    expect(p!.image.head).toBe(1);
    warn.mockRestore();
  });

  it('clearAll empties the store', async () => {
    await appendRevision(initialRevision(emptyProgram()), 1);
    await saveFlags({ takeawayShown: true, openerDismissed: true });
    await clearAll();
    expect(await loadPersisted()).toBeNull();
  });

  it('default backend without IndexedDB (Node) degrades to memory', async () => {
    _useBackend(null);
    expect((globalThis as { indexedDB?: unknown }).indexedDB).toBeUndefined();
    expect(await loadPersisted()).toBeNull();
    await appendRevision(initialRevision(emptyProgram()), 1);
    expect((await loadPersisted())!.image.revisions).toHaveLength(1);
    await clearAll();
  });
});

describe('resilientBackend', () => {
  function flaky(opts: { failOpen?: boolean; failWrite?: boolean }): Backend & { inner: Backend } {
    const inner = memoryBackend();
    return {
      inner,
      readAll: () => (opts.failOpen ? Promise.reject(new Error('blocked')) : inner.readAll()),
      write: (b) => (opts.failWrite ? Promise.reject(new Error('QuotaExceeded')) : inner.write(b)),
      clear: () => inner.clear(),
    };
  }

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => (warn = vi.spyOn(console, 'warn').mockImplementation(() => {})));
  afterEach(() => {
    warn.mockRestore();
    _useBackend(null);
  });

  it('a primary that fails to open: nothing throws, state lives in memory', async () => {
    _useBackend(resilientBackend(Promise.reject(new Error('open failed'))));
    expect(await loadPersisted()).toBeNull();
    await appendRevision(initialRevision(emptyProgram()), 1);
    await saveFlags({ takeawayShown: true, openerDismissed: true });
    const p = await loadPersisted();
    expect(p!.image.revisions).toHaveLength(1);
    expect(p!.flags.takeawayShown).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a primary whose writes start failing keeps already-persisted data plus new writes', async () => {
    const opts = { failWrite: false };
    const primary = flaky(opts);
    _useBackend(resilientBackend(primary));
    const r1 = initialRevision(emptyProgram());
    await appendRevision(r1, 1);
    expect((await loadPersisted())!.image.revisions).toHaveLength(1);
    opts.failWrite = true;
    const r2 = newRevision([r1], { kind: 'commit', title: 't', program: emptyProgram(), env: {} });
    await expect(appendRevision(r2, 2)).resolves.toBeUndefined();
    const p = await loadPersisted();
    expect(p!.image.revisions.map((r) => r.id)).toEqual([1, 2]);
    expect(p!.image.head).toBe(2);
    expect((await primary.inner.readAll()).revisions).toHaveLength(1); // the failed write never reached it
  });

  it('a backend that throws on everything never makes the exported functions throw', async () => {
    const boom = (): Promise<never> => Promise.reject(new Error('boom'));
    _useBackend({ readAll: boom, write: boom, clear: boom });
    await expect(loadPersisted()).resolves.toBeNull();
    await expect(appendRevision(initialRevision(emptyProgram()), 1)).resolves.toBeUndefined();
    await expect(saveFlags({ takeawayShown: false, openerDismissed: false })).resolves.toBeUndefined();
    await expect(saveLiveEnv({})).resolves.toBeUndefined();
    await expect(clearAll()).resolves.toBeUndefined();
  });
});

describe('toImage', () => {
  it('builds a version-1 image', () => {
    const r1 = initialRevision(emptyProgram());
    const img: Image = toImage([r1], 1);
    expect(img).toMatchObject({ format: 'undefined-image', version: 1, head: 1, revisions: [r1] });
    expect(Number.isNaN(Date.parse(img.exportedAt))).toBe(false);
  });
});
