/**
 * Ejecting a function with the functions it calls (docs/COMPOSE-DESIGN.md §A7). The folder is run in-process with a
 * collecting stand-in for vitest (scripts/eject-check.mjs runs a composed fixture for real, in a fresh project).
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import * as fc from 'fast-check';
import type { Artifact, FunctionRecord, FunctionSpec, Program } from '../types';
import { hashesFor } from '../shared/hash';
import { buildSource } from '../gates/source';
import { ejectBlockerIn, ejectClosure, ejectFiles } from '../eject/eject';
import { implHash, stampDeps } from './graph';

const NOW = Date.UTC(2026, 9, 5, 12);
const SLUGIFY: FunctionSpec = {
  name: 'slugify',
  params: [{ name: 'title', type: 'string' }],
  returns: 'string',
  doc: 'Turns a title into a URL slug.',
  tests: 'test("words", () => eq(slugify("Hello World"), "hello-world"));',
  properties: '',
  budgetMs: 1000,
  maxAttempts: 3,
  origin: 'user',
};
const ALL: FunctionSpec = {
  ...SLUGIFY,
  name: 'slugifyAll',
  params: [{ name: 'titles', type: 'string[]' }],
  returns: 'string[]',
  doc: 'Slugs for a list of titles.',
  tests: 'test("each", () => eq(slugifyAll(["Hello World", "A b"]), ["hello-world", "a-b"]));',
  properties: 'property("same length", [fc.array(fc.string())], (xs) => slugifyAll(xs).length === xs.length);',
};

async function rec(spec: FunctionSpec, body: string, revision: number, deps?: Artifact['deps']): Promise<FunctionRecord> {
  const h = await hashesFor(spec);
  const artifact: Artifact = {
    body,
    source: buildSource(spec, body).source,
    js: '',
    returnType: spec.returns!,
    ...h,
    model: 'test-model',
    codexVersion: '1.2.3',
    committedAt: NOW - 1000,
    candidates: [],
    revision,
    ...(deps ? { deps } : {}),
  };
  return { spec, ...h, artifact };
}

async function program(): Promise<Program> {
  const p: Program = { functions: { slugify: await rec(SLUGIFY, 'return title.toLowerCase().split(" ").join("-");', 2) } };
  p.functions.slugifyAll = await rec(ALL, 'return titles.map(slugify);', 3, stampDeps(p, ['slugify']));
  return p;
}

const transpile = (src: string): string => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(js: string, modules: Record<string, unknown>): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  new Function('exports', 'require', js)(exports, (id: string) => {
    if (!(id in modules)) throw new Error(`unexpected import ${id}`);
    return modules[id];
  });
  return exports;
}

describe('eject a function with what it calls', () => {
  it('one .ts + .test.ts per function, imports between them, a closure provenance and README', async () => {
    const p = await program();
    expect(ejectBlockerIn(p, 'slugifyAll')).toBeNull();
    const closure = ejectClosure(p, 'slugifyAll');
    expect(closure.map((r) => r.spec.name)).toEqual(['slugifyAll', 'slugify']);
    const { folder, files } = ejectFiles({ functions: closure, now: NOW });
    expect(folder).toBe('slugifyAll-eject');
    expect(files.map((f) => f.path)).toEqual(['slugifyAll.ts', 'slugifyAll.test.ts', 'slugify.ts', 'slugify.test.ts', 'provenance.json', 'README.md']);
    const text = (path: string) => files.find((f) => f.path === path)!.text;
    expect(text('slugifyAll.ts').startsWith("import { slugify } from './slugify';\n\n/**")).toBe(true);
    expect(text('slugify.ts')).not.toContain('import');
    const prov = JSON.parse(text('provenance.json'));
    expect(prov).toMatchObject({ format: 'undefined-eject', version: 2, root: 'slugifyAll' });
    expect(prov.graph).toEqual({ slugifyAll: { slugify: { hash: implHash(p.functions.slugify!.artifact!), revision: 2 } }, slugify: {} });
    expect(Object.keys(prov.functions)).toEqual(['slugifyAll', 'slugify']);
    expect(prov.functions.slugify.version).toBe(1);
    expect(text('README.md')).toContain('`slugifyAll.ts` (certified at r3; calls `slugify`)');

    // the folder runs: each test file against its function, which calls the real callee
    const slug = load(transpile(text('slugify.ts')), {});
    const all = load(transpile(text('slugifyAll.ts')), { './slugify': slug });
    const results: Array<{ name: string; error?: string }> = [];
    for (const [fn, mod] of [['slugify', slug], ['slugifyAll', all]] as const) {
      const cases: Array<{ name: string; body: () => void }> = [];
      const it_ = Object.assign((n: string, body: () => void) => cases.push({ name: n, body }), { skip: () => {}, todo: () => {} });
      load(transpile(text(`${fn}.test.ts`)), { vitest: { it: it_, describe: (_: string, b: () => void) => b() }, 'fast-check': fc, [`./${fn}`]: mod });
      for (const c of cases) {
        try {
          c.body();
          results.push({ name: `${fn}: ${c.name}` });
        } catch (e) {
          results.push({ name: `${fn}: ${c.name}`, error: String(e) });
        }
      }
    }
    expect(results).toEqual([{ name: 'slugify: words' }, { name: 'slugifyAll: each' }, { name: 'slugifyAll: same length' }]);
  });

  it('imports a type the caller only got from its callee', async () => {
    const ROW = 'type Row = { total: number }';
    const sum = { ...SLUGIFY, name: 'sumOf', params: [{ name: 'rows', type: 'Row[]' }], returns: 'number', typeDecls: ROW, tests: '' };
    const p: Program = { functions: { sumOf: await rec(sum, 'return rows.reduce((a, r) => a + r.total, 0);', 2) } };
    const avg = { ...SLUGIFY, name: 'avgOf', params: [{ name: 'xs', type: 'number[]' }], returns: 'number', tests: '' };
    p.functions.avgOf = await rec(avg, 'const rows: Row[] = xs.map((total) => ({ total }));\nreturn sumOf(rows) / xs.length;', 3, stampDeps(p, ['sumOf']));
    const { files } = ejectFiles({ functions: ejectClosure(p, 'avgOf'), now: NOW });
    expect(files[0]!.text.startsWith("import { sumOf, type Row } from './sumOf';")).toBe(true);
  });

  it('a single function that calls nothing ejects exactly as before (provenance version 1)', async () => {
    const p = await program();
    const { files } = ejectFiles({ functions: ejectClosure(p, 'slugify'), now: NOW });
    expect(files.map((f) => f.path)).toEqual(['slugify.ts', 'slugify.test.ts', 'provenance.json', 'README.md']);
    expect(JSON.parse(files[2]!.text).version).toBe(1);
  });

  it('refuses an incomplete, mismatched or padded closure', async () => {
    const p = await program();
    expect(() => ejectFiles({ functions: [p.functions.slugifyAll!], now: NOW })).toThrow('eject: slugifyAll calls slugify, which is not included');
    const other = await rec(SLUGIFY, 'return title;', 9);
    expect(() => ejectFiles({ functions: [p.functions.slugifyAll!, other], now: NOW })).toThrow('eject: slugifyAll was certified against a different slugify (r2)');
    expect(() => ejectFiles({ functions: [p.functions.slugify!, p.functions.slugifyAll!], now: NOW })).toThrow('eject: slugifyAll is not called by slugify');
  });

  it('says why a closure cannot be ejected while a callee changed or is missing', async () => {
    const p = await program();
    const changed: Program = { functions: { ...p.functions, slugify: await rec(SLUGIFY, 'return title;', 9) } };
    expect(ejectBlockerIn(changed, 'slugifyAll')).toMatch(/^Out of date: calls slugify, which changed at r9/);
    const waiting: Program = { functions: { ...p.functions, slugify: { ...p.functions.slugify!, specHash: 'edited' } } };
    expect(ejectBlockerIn(waiting, 'slugifyAll')).toBe('slugify, which slugifyAll calls, cannot be ejected (the committed function is out of date: its spec or checks changed after it was certified)');
  });
});
