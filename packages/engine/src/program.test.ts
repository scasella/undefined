import { describe, expect, it } from 'vitest';
import { hashesFor } from './shared/hash';
import * as P from './program';
import type { Artifact, Candidate, FunctionSpec, GateId, Program } from './types';
import {
  describeCommit,
  emptyProgram,
  initialRevision,
  isLive,
  isStale,
  jsFunctions,
  newRevision,
  recordFor,
  revisionLabel,
  rollbackRevision,
  summarize,
  withArtifact,
  withoutFunction,
  withSpec,
} from './program';

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

const medianSpec: FunctionSpec = {
  name: 'median',
  params: [{ name: 'numbers', type: 'number[]' }],
  returns: 'number',
  doc: 'Median of a non-empty list.',
  tests: 'test("odd", () => eq(median([3, 1, 2]), 2));',
  properties: '',
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'example',
  exampleId: 'median',
};

async function artifactFor(spec: FunctionSpec, revision = 2): Promise<Artifact> {
  const h = await hashesFor(spec);
  return {
    body: 'return 0;',
    source: `function ${spec.name}() { return 0; }`,
    js: `function ${spec.name}() { return 0; }`,
    returnType: 'number',
    ...h,
    model: 'gpt-test',
    codexVersion: '0.0.0',
    committedAt: 1_700_000_000_000,
    candidates: [],
    revision,
  };
}

function candidate(attempt: number, verdict: Candidate['verdict'], rejectedBy?: GateId): Candidate {
  return { id: `c${attempt}`, attempt, body: '', notes: '', source: 'replay', generationMs: 1, gates: [], verdict, rejectedBy };
}

async function programWithLiveMedian(): Promise<Program> {
  const p = await withSpec(emptyProgram(), medianSpec);
  return withArtifact(p, 'median', await artifactFor(medianSpec));
}

describe('records and staleness', () => {
  it('recordFor computes the shared hashes and defaults artifact to null', async () => {
    const rec = await recordFor(medianSpec);
    expect(rec).toEqual({ spec: medianSpec, ...(await hashesFor(medianSpec)), artifact: null });
    expect(isStale(rec)).toBe(false);
    expect(isLive(rec)).toBe(false);
  });

  it('an artifact certified for the current hashes is live', async () => {
    const rec = await recordFor(medianSpec, await artifactFor(medianSpec));
    expect(isStale(rec)).toBe(false);
    expect(isLive(rec)).toBe(true);
  });

  it('a doc edit (specHash) or a tests edit (testsHash) makes the artifact stale', async () => {
    const a = await artifactFor(medianSpec);
    const docEdit = await recordFor({ ...medianSpec, doc: 'changed' }, a);
    const testEdit = await recordFor({ ...medianSpec, properties: 'property("p", [], () => true);' }, a);
    for (const rec of [docEdit, testEdit]) {
      expect(isStale(rec)).toBe(true);
      expect(isLive(rec)).toBe(false);
    }
  });

  it('editing maxAttempts/origin does not invalidate the artifact', async () => {
    const rec = await recordFor({ ...medianSpec, maxAttempts: 9, origin: 'user' }, await artifactFor(medianSpec));
    expect(isLive(rec)).toBe(true);
  });
});

describe('program operations', () => {
  it('withSpec adds a spec without touching the input program', async () => {
    const p0 = deepFreeze(emptyProgram());
    const p1 = await withSpec(p0, medianSpec);
    expect(p0.functions).toEqual({});
    expect(Object.keys(p1.functions)).toEqual(['median']);
    expect(p1.functions.median!.artifact).toBeNull();
  });

  it('withSpec replacing a spec keeps the artifact object, which goes stale', async () => {
    const p1 = deepFreeze(await programWithLiveMedian());
    const art = p1.functions.median!.artifact;
    const p2 = await withSpec(p1, { ...medianSpec, doc: 'Median; throws RangeError on empty input.' });
    expect(p2.functions.median!.artifact).toBe(art);
    expect(isStale(p2.functions.median!)).toBe(true);
    expect(isLive(p1.functions.median!)).toBe(true);
    expect(jsFunctions(p2)).toEqual({});
  });

  it('withArtifact attaches immutably and throws for an unknown function', async () => {
    const p1 = deepFreeze(await withSpec(emptyProgram(), medianSpec));
    const a = await artifactFor(medianSpec);
    const p2 = withArtifact(p1, 'median', a);
    expect(p1.functions.median!.artifact).toBeNull();
    expect(p2.functions.median!.artifact).toBe(a);
    expect(() => withArtifact(p1, 'mode', a)).toThrow(/no function named mode/);
  });

  it('withoutFunction removes one function and leaves the input intact', async () => {
    const p1 = deepFreeze(await withSpec(await programWithLiveMedian(), { ...medianSpec, name: 'mean' }));
    const p2 = withoutFunction(p1, 'median');
    expect(Object.keys(p2.functions)).toEqual(['mean']);
    expect(Object.keys(p1.functions).sort()).toEqual(['mean', 'median']);
    expect(withoutFunction(p1, 'absent').functions).toEqual(p1.functions);
  });

  it('jsFunctions returns live artifacts only, with the spec budget', async () => {
    let p = await programWithLiveMedian();
    p = await withSpec(p, { ...medianSpec, name: 'mean' }); // no artifact
    const staleSpec = { ...medianSpec, name: 'mode' };
    p = await withSpec(p, staleSpec);
    p = withArtifact(p, 'mode', await artifactFor(staleSpec));
    p = await withSpec(p, { ...staleSpec, tests: '' }); // now stale
    expect(jsFunctions(deepFreeze(p))).toEqual({ median: { js: 'function median() { return 0; }', budgetMs: 1500 } });
  });

  it('summarize counts functions and live artifacts', async () => {
    expect(summarize(emptyProgram())).toEqual({ fns: 0, artifacts: 0 });
    const p = await withSpec(await programWithLiveMedian(), { ...medianSpec, name: 'mean' });
    expect(summarize(p)).toEqual({ fns: 2, artifacts: 1 });
    const stale = await withSpec(p, { ...medianSpec, doc: 'x' });
    expect(summarize(stale)).toEqual({ fns: 2, artifacts: 0 });
  });
});

describe('revisions', () => {
  it('initialRevision is r1 "Initial image" with empty env', () => {
    const p = emptyProgram();
    const r = initialRevision(p);
    expect(r).toMatchObject({ id: 1, kind: 'init', title: 'Initial image', env: {}, program: p });
    expect(typeof r.at).toBe('number');
  });

  it('newRevision numbers from the last revision and defaults at to now', () => {
    const history = deepFreeze([initialRevision(emptyProgram())]);
    const before = Date.now();
    const r2 = newRevision(history, { kind: 'commit', title: 't', program: emptyProgram(), env: { x: 1 } });
    expect(r2.id).toBe(2);
    expect(r2.at).toBeGreaterThanOrEqual(before);
    expect(r2.env).toEqual({ x: 1 });
    expect(history).toHaveLength(1);
    const r3 = newRevision([...history, r2], { kind: 'spec-edit', title: 't', program: emptyProgram(), env: {}, at: 42 });
    expect(r3).toMatchObject({ id: 3, at: 42 });
    expect(newRevision([], { kind: 'init', title: 't', program: emptyProgram(), env: {} }).id).toBe(1);
  });

  it('rollbackRevision creates a new head with deep copies of the target', async () => {
    const r1 = initialRevision(emptyProgram());
    const r2 = newRevision([r1], { kind: 'commit', title: 'c', fn: 'median', program: await programWithLiveMedian(), env: { xs: [1, 2, 3] } });
    const r3 = newRevision([r1, r2], { kind: 'spec-edit', title: 'e', program: emptyProgram(), env: {} });
    const history = deepFreeze([r1, r2, r3]);

    const back = rollbackRevision(history, 2);
    expect(back).toMatchObject({ id: 4, kind: 'rollback', title: 'Rolled back to r2', restoredFrom: 2 });
    expect(back.fn).toBeUndefined();
    expect(back.program).toEqual(r2.program);
    expect(back.env).toEqual(r2.env);
    expect(back.program).not.toBe(r2.program);
    expect(back.program.functions.median!.artifact).not.toBe(r2.program.functions.median!.artifact);
    // the copy is independent (and unfrozen) while the frozen original is unchanged
    (back.env.xs as number[]).push(4);
    back.program.functions.median!.spec.doc = 'changed';
    expect(r2.env.xs).toEqual([1, 2, 3]);
    expect(r2.program.functions.median!.spec.doc).toBe(medianSpec.doc);
    expect(history).toHaveLength(3);
  });

  it('rollbackRevision throws a clear error for an unknown target', () => {
    const history = [initialRevision(emptyProgram())];
    expect(() => rollbackRevision(history, 7)).toThrow('cannot roll back: no revision r7');
  });

  it('revisionLabel', () => {
    expect(revisionLabel(initialRevision(emptyProgram()))).toBe('r1');
    expect(revisionLabel({ id: 12 })).toBe('r12');
    expect(revisionLabel(3)).toBe('r3');
  });
});

describe('describeCommit', () => {
  it('first attempt', () => {
    expect(describeCommit('median', [candidate(1, 'accepted')], 3)).toBe('median certified — first attempt');
  });

  it('one rejection, with and without the budget', () => {
    const cs = [candidate(1, 'rejected', 'properties'), candidate(2, 'accepted')];
    expect(describeCommit('median', cs, 3)).toBe('median certified — attempt 2 of 3 (rejected by properties first)');
    expect(describeCommit('median', cs)).toBe('median certified — attempt 2 (rejected by properties first)');
  });

  it('several rejections are listed in order; aborted ones are not named', () => {
    const cs = [
      candidate(1, 'rejected', 'compile'),
      candidate(2, 'aborted'),
      candidate(3, 'rejected', 'tests'),
      candidate(4, 'accepted'),
    ];
    expect(describeCommit('slugify', cs, 4)).toBe('slugify certified — attempt 4 of 4 (rejected by compile, then tests)');
    expect(describeCommit('f', [candidate(1, 'aborted'), candidate(2, 'accepted')])).toBe('f certified — attempt 2');
  });

  it('no candidates', () => {
    expect(describeCommit('median', [])).toBe('median certified');
  });
});

describe('datasets and pins on a program', () => {
  const [ws, ep, ir] = [P.withSpec, P.emptyProgram, P.initialRevision];
  const { withDataset, withoutDataset, withPins, datasetHashes, referencedDatasets } = P;
  const ref = { name: 'rows', hash: 'h1', typeName: 'Row', typeDecl: 'type Row = {}', rowCount: 0, columns: [], source: 'paste' as const, bytes: 2 };
  const base = { name: 'f', params: [], returns: null, doc: '', tests: '', properties: '', budgetMs: 1000, maxAttempts: 3, origin: 'call' as const };

  it('withDataset / withoutDataset, and spec operations keep the datasets', async () => {
    const p = withDataset(ep(), ref);
    expect(p.datasets).toEqual({ rows: ref });
    const q = await ws(p, base);
    expect(q.datasets).toEqual({ rows: ref });
    expect(withoutDataset(q, 'rows').datasets).toBeUndefined();
    expect(withoutDataset(q, 'rows').functions.f).toBeDefined();
  });

  it('withPins changes only the spec\'s pins (hashes untouched) and collects pin dataset hashes', async () => {
    const q = await ws(withDataset(ep(), ref), base);
    const pin = { id: 'p1', label: 'f(other)', args: [{ kind: 'dataset' as const, name: 'other', hash: 'h2' }], expected: 1, pinnedAt: 0 };
    const pinned = withPins(q, 'f', [pin]);
    expect(pinned.functions.f!.spec.pins).toEqual([pin]);
    expect(pinned.functions.f!.specHash).toBe(q.functions.f!.specHash);
    expect(withPins(pinned, 'f', []).functions.f!.spec.pins).toBeUndefined();
    expect([...datasetHashes(pinned)].sort()).toEqual(['h1', 'h2']);
    expect([...referencedDatasets([ir(ep()), { ...ir(pinned), id: 2 }])].sort()).toEqual(['h1', 'h2']);
    expect(() => withPins(q, 'nope', [])).toThrow(/no function named nope/);
  });
});
