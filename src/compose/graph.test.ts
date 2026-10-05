import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Artifact, FunctionRecord, FunctionSpec, Program } from '../types';
import { sha256Sync } from './sha256';
import {
  closureOf,
  dependencyLine,
  dependencyStatus,
  directDependents,
  firstSentence,
  implHash,
  inRuntime,
  isRunnable,
  otherFromArtifact,
  othersFor,
  reachable,
  splitTypeDecls,
  stampDeps,
  topoOrder,
  transitiveDependents,
} from './graph';
import { buildSource } from '../gates/source';
import { jsFunctions } from '../core/program';

describe('sha256Sync', () => {
  it('matches node:crypto on ASCII, Unicode, empty and multi-block inputs', () => {
    for (const s of ['', 'abc', 'Crème Brûlée 🍮', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(64), 'z'.repeat(1000), '\u0000￿']) {
      expect(sha256Sync(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
});

// ───────────────────────── fixtures ─────────────────────────

const spec = (name: string, over: Partial<FunctionSpec> = {}): FunctionSpec => ({
  name,
  params: [{ name: 'x', type: 'string' }],
  returns: 'string',
  doc: `${name} does a thing. More detail here.`,
  tests: '',
  properties: '',
  budgetMs: 1000,
  maxAttempts: 3,
  origin: 'user',
  ...over,
});

function artifact(s: FunctionSpec, body: string, revision: number, over: Partial<Artifact> = {}): Artifact {
  return {
    body,
    source: buildSource(s, body).source,
    js: `function ${s.name}(x) { ${body} }`,
    returnType: s.returns ?? 'string',
    specHash: `s-${s.name}`,
    testsHash: `t-${s.name}`,
    model: 'm',
    codexVersion: '1',
    committedAt: 0,
    candidates: [],
    revision,
    ...over,
  };
}

function rec(s: FunctionSpec, a: Artifact | null): FunctionRecord {
  return { spec: s, specHash: `s-${s.name}`, testsHash: `t-${s.name}`, artifact: a };
}

/** slugify (r2) ← slugifyAll (r3) ← report (r4) */
function chain(): Program {
  const slug = spec('slugify');
  const slugA = artifact(slug, 'return x.toLowerCase();', 2);
  const p: Program = { functions: { slugify: rec(slug, slugA) } };
  const all = spec('slugifyAll', { params: [{ name: 'titles', type: 'string[]' }], returns: 'string[]' });
  p.functions.slugifyAll = rec(all, artifact(all, 'return titles.map(slugify);', 3, { deps: stampDeps(p, ['slugify']) }));
  const report = spec('report');
  p.functions.report = rec(report, artifact(report, 'return slugifyAll([x]).join();', 4, { deps: stampDeps(p, ['slugifyAll']) }));
  return p;
}

const withArtifact = (p: Program, name: string, a: Artifact | null): Program => ({
  ...p,
  functions: { ...p.functions, [name]: { ...p.functions[name]!, artifact: a } },
});

describe('implHash and stamps', () => {
  it('hashes source + return type; stamps carry the callee revision; no list, no stamp', () => {
    const p = chain();
    const a = p.functions.slugify!.artifact!;
    expect(implHash(a)).toBe(sha256Sync(`${a.source}\u0000${a.returnType}`));
    expect(implHash({ ...a, evidence: { compiled: true, unitTests: 9, pinnedTests: 0, properties: [], sampledCalls: 0 } } as Artifact)).toBe(implHash(a));
    expect(implHash({ ...a, returnType: 'number' })).not.toBe(implHash(a));
    expect(stampDeps(p, ['slugify'])).toEqual({ slugify: { hash: implHash(a), revision: 2 } });
    expect(stampDeps(p, [])).toBeUndefined();
    expect(() => stampDeps({ functions: { g: rec(spec('g'), null) } }, ['g'])).toThrow(/no artifact/);
  });
});

describe('dependencyStatus', () => {
  it('none / current', () => {
    const p = chain();
    expect(dependencyStatus(p, 'slugify')).toEqual({ kind: 'none' });
    const st = dependencyStatus(p, 'slugifyAll');
    expect(st.kind).toBe('current');
    expect(isRunnable(p, 'report')).toBe(true);
    expect(dependencyLine(p, 'slugify')).toBeNull();
    expect(dependencyLine(p, 'report')).toBe('Calls slugifyAll (r3); certified with that version.');
  });

  it('changed: a different implementation of a direct callee; the dependent leaves the runtime, its callers wait', () => {
    const base = chain();
    const slug = base.functions.slugify!.spec;
    const p = withArtifact(base, 'slugify', artifact(slug, 'return x.toUpperCase();', 7));
    const st = dependencyStatus(p, 'slugifyAll');
    expect(st.kind).toBe('changed');
    if (st.kind !== 'changed') return;
    expect(st.calls[0]).toMatchObject({ name: 'slugify', state: 'changed', certifiedRevision: 2, nowRevision: 7 });
    expect(inRuntime(p, 'slugifyAll')).toBe(false);
    expect(isRunnable(p, 'slugifyAll')).toBe(false);
    // report's own callee is unchanged, but it is not runnable: it waits for slugifyAll
    expect(dependencyStatus(p, 'report')).toMatchObject({ kind: 'waiting', waitingFor: ['slugifyAll'] });
    expect(inRuntime(p, 'report')).toBe(true);
    expect(Object.keys(jsFunctions(p)).sort()).toEqual(['report', 'slugify']);
    expect(dependencyLine(p, 'slugifyAll')).toMatch(/^Out of date: calls slugify, which changed at r7 \(certified against r2, [0-9a-f]{6}… → [0-9a-f]{6}…\)\. It does not run until it is re-checked/);
  });

  it('a mutation report or a re-certification of the callee changes nothing (same source)', () => {
    const base = chain();
    const a = base.functions.slugify!.artifact!;
    const p = withArtifact(base, 'slugify', { ...a, testsHash: a.testsHash, recertified: [{ at: 1, revision: 9, reason: 'x' }] });
    expect(dependencyStatus(p, 'slugifyAll').kind).toBe('current');
  });

  it('waiting: a callee (directly or further down) has no runnable code', () => {
    const base = chain();
    const p: Program = { functions: { ...base.functions, slugify: { ...base.functions.slugify!, specHash: 'edited' } } };
    expect(dependencyStatus(p, 'slugifyAll')).toMatchObject({ kind: 'waiting', waitingFor: ['slugify'] });
    expect(dependencyStatus(p, 'report')).toMatchObject({ kind: 'waiting', waitingFor: ['slugify'] });
    expect(inRuntime(p, 'slugifyAll')).toBe(true);
    expect(isRunnable(p, 'slugifyAll')).toBe(false);
    expect(jsFunctions(p).slugify).toBeUndefined();
    expect(jsFunctions(p).slugifyAll!.deps).toEqual(['slugify']);
    expect(dependencyLine(p, 'slugifyAll')).toBe(
      "Waiting for slugify (slugify: its spec changed after it was certified). slugifyAll's own code is unchanged; the next call that reaches slugify grows it, then slugifyAll is re-checked with it.",
    );
  });

  it('a function with no artifact, or own-stale, has status none (its own staleness says the rest)', () => {
    const p = chain();
    expect(dependencyStatus({ functions: { ...p.functions, slugifyAll: { ...p.functions.slugifyAll!, testsHash: 'x' } } }, 'slugifyAll')).toEqual({ kind: 'none' });
  });

  it('survives a cycle in recorded deps (an edited image) without looping', () => {
    const p = chain();
    const s = p.functions.slugify!;
    const cyc: Program = { functions: { ...p.functions, slugify: { ...s, artifact: { ...s.artifact!, deps: { report: { hash: implHash(p.functions.report!.artifact!), revision: 4 } } } } } };
    expect(['waiting', 'current']).toContain(dependencyStatus(cyc, 'report').kind);
    expect(topoOrder(cyc, ['report'])).toHaveLength(3);
  });
});

describe('graph walks', () => {
  it('reachable, dependents, topological order, closure', () => {
    const p = chain();
    expect([...reachable(p, 'report')].sort()).toEqual(['slugify', 'slugifyAll']);
    expect(directDependents(p, 'slugify')).toEqual(['slugifyAll']);
    expect(transitiveDependents(p, ['slugify'])).toEqual(['slugifyAll', 'report']);
    expect(topoOrder(p, ['report'])).toEqual(['slugify', 'slugifyAll', 'report']);
    expect(closureOf(p, ['slugifyAll'])).toEqual([
      { name: 'slugify', js: p.functions.slugify!.artifact!.js, deps: [] },
      { name: 'slugifyAll', js: p.functions.slugifyAll!.artifact!.js, deps: ['slugify'] },
    ]);
  });
});

describe('othersFor: what a body may call', () => {
  it('lists runnable functions sorted, with the declaration and the first sentence of the doc', () => {
    const p = chain();
    const c = othersFor(p, spec('newFn'));
    expect(c.others.map((o) => o.name)).toEqual(['report', 'slugify', 'slugifyAll']);
    expect(c.others[1]).toEqual({ name: 'slugify', decl: 'function slugify(x: string): string', doc: 'slugify does a thing.', types: [] });
    expect(c.unavailable).toEqual([]);
  });

  it('excludes itself, a function named like a parameter, and anything that would close a cycle', () => {
    const p = chain();
    const c = othersFor(p, spec('slugify', { params: [{ name: 'report', type: 'string' }] }));
    expect(c.others).toEqual([]);
    expect(c.unavailable).toEqual([
      { name: 'slugifyAll', why: 'slugifyAll already calls slugify (slugifyAll → slugify): generated functions cannot call each other in a cycle' },
    ]);
    const d = othersFor(p, spec('slugify'));
    expect(d.unavailable.find((u) => u.name === 'report')!.why).toBe(
      'report already calls slugify (report → slugifyAll → slugify): generated functions cannot call each other in a cycle',
    );
  });

  it('says why an uncertified, stale, out-of-date or waiting function cannot be called', () => {
    const base = chain();
    const slug = base.functions.slugify!.spec;
    const p: Program = {
      functions: {
        ...withArtifact(base, 'slugify', artifact(slug, 'return x;', 8)).functions,
        draft: rec(spec('draft'), null),
        old: { ...rec(spec('old'), artifact(spec('old'), 'return x;', 5)), specHash: 'edited' },
      },
    };
    const why = Object.fromEntries(othersFor(p, spec('newFn')).unavailable.map((u) => [u.name, u.why]));
    expect(why.draft).toBe('draft has a spec but no certified code yet, so it cannot be called until it has been grown');
    expect(why.old).toBe('old is out of date (its spec changed after it was certified), so it cannot be called until it is regrown');
    expect(why.slugifyAll).toBe('slugifyAll is out of date (slugify changed since it was certified), so it cannot be called until it is re-checked');
    expect(why.report).toBe('report is waiting for slugifyAll, which has no runnable code');
  });

  it('shares identical type declarations once, drops ones the caller already has, refuses a clash', () => {
    const ROW = 'type Row = { customer: string; total: number }';
    const g = spec('top', { params: [{ name: 'rows', type: 'Row[]' }], typeDecls: ROW });
    const h = spec('sum', { params: [{ name: 'rows', type: 'Row[]' }], returns: 'number', typeDecls: ROW });
    const k = spec('zclash', { params: [{ name: 'rows', type: 'Row[]' }], typeDecls: 'type Row = { id: number }' });
    const p: Program = {
      functions: { top: rec(g, artifact(g, 'return "";', 2)), sum: rec(h, artifact(h, 'return 0;', 3)), zclash: rec(k, artifact(k, 'return "";', 4)) },
    };
    const fresh = othersFor(p, spec('caller'));
    expect(fresh.others.map((o) => [o.name, o.types.map((t) => t.name)])).toEqual([
      ['sum', ['Row']],
      ['top', []],
    ]);
    expect(fresh.unavailable).toEqual([{ name: 'zclash', why: "zclash's types clash with those of another callable function (both declare Row, differently)" }]);
    const mine = othersFor(p, spec('caller', { typeDecls: ROW }));
    expect(mine.others.map((o) => o.types.length)).toEqual([0, 0]);
    expect(mine.unavailable[0]!.why).toBe("zclash's types clash with this function's (both declare Row, differently)");
  });

  it('writes an inferred return type into the declaration; an unknown one is unavailable', () => {
    const g = spec('pairUp', { returns: null });
    const p: Program = { functions: { pairUp: rec(g, artifact(g, 'return [x, x];', 2, { returnType: 'string[]' })) } };
    expect(othersFor(p, spec('f')).others[0]!.decl).toBe('function pairUp(x: string): string[]');
    const q: Program = { functions: { pairUp: rec(g, artifact(g, 'return [x, x];', 2, { returnType: '' })) } };
    expect(othersFor(q, spec('f')).unavailable[0]!.why).toBe("pairUp's return type is not known");
  });
});

describe('text helpers', () => {
  it('splitTypeDecls by declaration', () => {
    expect(splitTypeDecls('type A = { a: number }\ninterface B {\n  b: string;\n}\ntype C = A | B')).toEqual([
      { name: 'A', text: 'type A = { a: number }' },
      { name: 'B', text: 'interface B {\n  b: string;\n}' },
      { name: 'C', text: 'type C = A | B' },
    ]);
    expect(splitTypeDecls(undefined)).toEqual([]);
  });

  it('firstSentence: one line, first sentence, capped, (no doc)', () => {
    expect(firstSentence('Turns a title\ninto a slug. Then more.')).toBe('Turns a title into a slug.');
    expect(firstSentence('')).toBe('(no doc)');
    expect(firstSentence('x'.repeat(300))).toHaveLength(160);
  });

  it('otherFromArtifact reads the certified declaration back from the artifact', () => {
    const s = spec('top', { params: [{ name: 'rows', type: 'Row[]' }], returns: null, typeDecls: 'type Row = { a: number }' });
    const a = artifact(s, 'return rows.length;', 3, { returnType: 'number' });
    expect(otherFromArtifact('top', a)).toEqual({ name: 'top', decl: 'function top(rows: Row[]): number', doc: '', types: [{ name: 'Row', text: 'type Row = { a: number }' }] });
    expect(otherFromArtifact('top', a, 'type Row = { a: number }')!.types).toEqual([]);
    const declared = spec('d', { returns: 'string' });
    expect(otherFromArtifact('d', artifact(declared, 'return x;', 1))!.decl).toBe('function d(x: string): string');
    expect(otherFromArtifact('missing', a)).toBeNull();
  });
});
