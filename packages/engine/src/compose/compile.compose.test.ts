/**
 * The compile gate with other functions in scope (docs/COMPOSE-DESIGN.md §A2), with the real TypeScript compiler.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { FunctionSpec } from '../types';
import { ambientText, compileCandidate, warmUp } from '../gates/compile';
import { buildSource } from '../gates/source';
import type { OtherFunction } from './graph';

const ALL: FunctionSpec = {
  name: 'slugifyAll',
  params: [{ name: 'titles', type: 'string[]' }],
  returns: 'string[]',
  doc: '',
  tests: '',
  properties: '',
  budgetMs: 1000,
  maxAttempts: 3,
  origin: 'user',
};
const SLUGIFY: OtherFunction = { name: 'slugify', decl: 'function slugify(title: string): string', doc: 'Turns a title into a URL slug.', types: [] };
const COUNT: OtherFunction = { name: 'countWords', decl: 'function countWords(text: string): number', doc: '', types: [] };

beforeAll(async () => {
  await warmUp();
}, 60_000);

describe('compile with other functions declared', () => {
  it('a body calling a declared function compiles; the dependency is found; the source is unchanged', async () => {
    const body = 'return titles.map((t) => slugify(t));';
    const out = await compileCandidate(ALL, body, { others: [SLUGIFY, COUNT] });
    expect(out.gate.status).toBe('pass');
    expect(out.deps).toEqual(['slugify']);
    expect(out.source).toBe(buildSource(ALL, body).source);
    expect(out.js).toContain('titles.map((t) => slugify(t))');
    expect(out.ambient).toEqual({ visible: ['slugify', 'countWords'], dropped: [] });
  });

  it('counts uses as a value, shorthand properties and typeof; not strings, comments, property names or local shadows', async () => {
    const asValue = await compileCandidate(ALL, 'return titles.map(slugify);', { others: [SLUGIFY, COUNT] });
    expect(asValue.deps).toEqual(['slugify']);
    const shorthand = await compileCandidate({ ...ALL, returns: null }, 'const o = { slugify }; return o;', { others: [SLUGIFY] });
    expect(shorthand.deps).toEqual(['slugify']);
    const notReally = await compileCandidate(
      ALL,
      '// slugify(x)\nconst o = { slugify: 1, countWords: "slugify" };\nreturn titles.map((t) => t + o.slugify + o.countWords);',
      { others: [SLUGIFY, COUNT] },
    );
    expect(notReally.gate.status).toBe('pass');
    expect(notReally.deps).toEqual([]);
    const shadow = await compileCandidate(ALL, 'const slugify = (s: string) => s;\nreturn titles.map(slugify);', { others: [SLUGIFY] });
    expect(shadow.gate.status).toBe('pass');
    expect(shadow.deps).toEqual([]);
  });

  it('without others: no ambient, no deps, and a call to the name is tsc\'s TS2304', async () => {
    const out = await compileCandidate(ALL, 'return titles.map(slugify);');
    expect(out.deps).toEqual([]);
    expect(out.ambient).toBeUndefined();
    expect(out.gate.diagnostics[0]).toMatchObject({ code: 2304, message: "Cannot find name 'slugify'." });
  });

  it('a call to a program function that may not be called says why, first, at the call', async () => {
    const out = await compileCandidate(ALL, 'const x = 1;\nreturn titles.map((t) => slugify(t));', {
      others: [COUNT],
      unavailable: [{ name: 'slugify', why: 'slugify is out of date (its spec changed after it was certified), so it cannot be called until it is regrown' }],
    });
    expect(out.gate.status).toBe('fail');
    expect(out.gate.headline).toBe(
      'Rejected: line 2: slugifyAll cannot call slugify: slugify is out of date (its spec changed after it was certified), so it cannot be called until it is regrown.',
    );
    expect(out.gate.diagnostics[0]).toMatchObject({ code: 0, line: 2 });
    expect(out.gate.diagnostics[1]).toMatchObject({ code: 2304 });
  });

  it('wrong use of a declared function is an ordinary type error on the body line', async () => {
    const out = await compileCandidate(ALL, 'return titles.map((t) => slugify(t.length));', { others: [SLUGIFY] });
    expect(out.gate.status).toBe('fail');
    expect(out.gate.diagnostics[0]).toMatchObject({ code: 2345, line: 1 });
  });

  it('shares type declarations through the ambient file; the caller\'s own identical declaration is not repeated', async () => {
    const ROW = 'type Row = { customer: string; total: number }';
    const total: OtherFunction = { name: 'totalOf', decl: 'function totalOf(rows: Row[]): number', doc: '', types: [{ name: 'Row', text: ROW }] };
    const caller: FunctionSpec = { ...ALL, name: 'avg', params: [{ name: 'rows', type: 'Row[]' }], returns: 'number', typeDecls: ROW };
    const out = await compileCandidate(caller, 'return rows.length === 0 ? 0 : totalOf(rows) / rows.length;', { others: [{ ...total, types: [] }] });
    expect(out.gate.status).toBe('pass');
    expect(out.deps).toEqual(['totalOf']);
    // using only a type that another function declares makes that function a dependency
    const typed = await compileCandidate({ ...ALL, returns: null }, 'const r: Row = { customer: "a", total: 1 }; return r;', { others: [total] });
    expect(typed.gate.status).toBe('pass');
    expect(typed.deps).toEqual(['totalOf']);
  });

  it('drops a declaration that does not compile on its own, and a name that is a standard global', async () => {
    const broken: OtherFunction = { name: 'weird', decl: 'function weird(x: Missing): string', doc: '', types: [] };
    const global: OtherFunction = { name: 'escape', decl: 'function escape(s: string): string', doc: '', types: [] };
    const out = await compileCandidate(ALL, 'return titles.map((t) => weird(t));', { others: [SLUGIFY, broken, global] });
    expect(out.ambient!.visible).toEqual(['slugify']);
    expect(out.ambient!.dropped.map((d) => d.name)).toEqual(['escape', 'weird']);
    expect(out.gate.headline).toBe("Rejected: line 1: slugifyAll cannot call weird: weird's declaration does not compile on its own (its signature or types use something not declared).");
  });

  it('ambientText: types once, then one declare line each', () => {
    const t = { name: 'Row', text: 'type Row = { a: number }' };
    expect(ambientText([{ ...SLUGIFY, types: [t] }, { ...COUNT, types: [t] }])).toBe(
      '// Other generated functions this body may call (declarations only).\ntype Row = { a: number }\ndeclare function slugify(title: string): string;\ndeclare function countWords(text: string): number;\n',
    );
  });

  it('the emitted JS of a body that calls nothing is byte-identical with or without others declared', async () => {
    const body = 'return titles.map((t) => t.toLowerCase());';
    const plain = await compileCandidate(ALL, body);
    const withOthers = await compileCandidate(ALL, body, { others: [SLUGIFY, COUNT] });
    expect(withOthers.js).toBe(plain.js);
    expect(withOthers.source).toBe(plain.source);
    expect(withOthers.returnType).toBe(plain.returnType);
  });
});
