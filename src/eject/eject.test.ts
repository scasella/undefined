import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import * as fc from 'fast-check';
import { specExample } from '../examples';
import { hashesFor } from '../shared/hash';
import { encodeValue } from '../shared/serialize';
import { deepEqual } from '../sandbox/testApi';
import type { Artifact, FunctionRecord, FunctionSpec, Json, Pin } from '../types';
import { declaredNames, ejectBlocker, ejectFiles, ejectZip, exportedDecls } from './eject';
import { tsLiteral, tsRowsLiteral } from './literal';
import { unzipStore } from './zip';

const NOW = Date.UTC(2026, 9, 4, 12);

function artifact(spec: FunctionSpec, body: string, hashes: { specHash: string; testsHash: string }, extra: Partial<Artifact> = {}): Artifact {
  return {
    body,
    source: '',
    js: '',
    returnType: spec.returns ?? 'unknown',
    ...hashes,
    model: 'test-model',
    codexVersion: '1.2.3',
    committedAt: NOW - 1000,
    candidates: [
      { id: 'c1', attempt: 1, body: 'return 0;', notes: 'first try', source: 'live', generationMs: 10, gates: [], verdict: 'rejected', rejectedBy: 'tests', headline: 'Rejected: nope' },
      { id: 'c2', attempt: 2, body, notes: 'second', source: 'live', generationMs: 12, gates: [], verdict: 'accepted', prompt: 'PROMPT' },
    ],
    revision: 7,
    evidence: { compiled: true, unitTests: 1, pinnedTests: 0, properties: [{ name: 'p', runs: 100 }], sampledCalls: 3 },
    ...extra,
  };
}

async function record(spec: FunctionSpec, body: string, extra: Partial<Artifact> = {}): Promise<FunctionRecord> {
  const hashes = await hashesFor(spec);
  return { spec, ...hashes, artifact: artifact(spec, body, hashes, extra) };
}

function transpile(src: string): string {
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

function load(js: string, modules: Record<string, unknown>): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  const req = (id: string): unknown => {
    if (!(id in modules)) throw new Error(`unexpected import ${id}`);
    return modules[id];
  };
  new Function('exports', 'require', js)(exports, req);
  return exports;
}

/** Runs an ejected folder in-process: the function module, then the test file with a collecting stand-in for vitest. */
function runEjected(files: Array<{ path: string; text: string }>, name: string): Array<{ name: string; error?: string; todo?: boolean; skipped?: boolean }> {
  const fnFile = files.find((f) => f.path === `${name}.ts`)!;
  const testFileText = files.find((f) => f.path === `${name}.test.ts`)!.text;
  const mod = load(transpile(fnFile.text), {});
  const cases: Array<{ name: string; body: () => void; todo?: boolean; skipped?: boolean }> = [];
  const itFn = Object.assign((n: string, body: () => void) => cases.push({ name: n, body }), {
    todo: (n: string) => cases.push({ name: n, body: () => {}, todo: true }),
    skip: (n: string) => cases.push({ name: n, body: () => {}, skipped: true }),
  });
  const vitest = { it: itFn, describe: (_n: string, body: () => void) => body() };
  load(transpile(testFileText), { vitest, 'fast-check': fc, [`./${name}`]: mod });
  return cases.map((c) => {
    try {
      c.body();
      return { name: c.name, ...(c.todo ? { todo: true } : {}), ...(c.skipped ? { skipped: true } : {}) };
    } catch (e) {
      return { name: c.name, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

function evalLiteral(lit: string): unknown {
  return new Function(transpile(`return ${lit};`).replace(/^"use strict";\s*/, '').replace(/export \{\};\s*$/, ''))();
}

describe('tsLiteral', () => {
  const values: unknown[] = [
    0,
    -0,
    NaN,
    -Infinity,
    1.5e-7,
    12345678901234567890n,
    -3n,
    'line\nbreak "quoted"   é',
    undefined,
    null,
    [1, , 3],
    [1, ,],
    { a: 1, 'b c': [true, false], __proto__x: 2, '0': 'zero', nested: { deep: [new Date(0)] } },
    new Map<unknown, unknown>([[1, 'one'], ['k', { v: [1n] }]]),
    new Set([1, 'a', null]),
    new Date(NaN),
    Array.from({ length: 30 }, (_, i) => ({ id: i, name: `row ${i}`, value: i * 1.25 })),
  ];
  it.each(values.map((v) => [v]))('round-trips %o through source', (v) => {
    const lit = tsLiteral(encodeValue(v));
    expect(deepEqual(evalLiteral(lit), v), lit).toBe(true);
  });

  it('keeps a __proto__ key an own property', () => {
    const obj = JSON.parse('{"__proto__": {"x": 1}}') as Record<string, unknown>;
    const back = evalLiteral(tsLiteral(encodeValue(obj))) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(back, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
  });

  it('writes a value the app could not keep as undefined with a note', () => {
    const lit = tsLiteral({ $t: 'unserializable', show: '[Function f */]' });
    expect(lit).toMatch(/^undefined \/\* not kept by Undefined: \[Function f \*\\\/\] \*\/$/);
    expect(evalLiteral(lit)).toBeUndefined();
  });

  it('lays out long values one element per line, and rows one per line', () => {
    const rows = encodeValue(Array.from({ length: 3 }, (_, i) => ({ id: i, text: 'x'.repeat(60) })));
    expect(tsLiteral(rows).split('\n')).toHaveLength(5); // [, three rows, ]
  });
});

describe('typeDecls helpers', () => {
  it('exports top-level declarations and lists their names', () => {
    const decls = 'type Row = { id: number }\ninterface Opts {\n  x: number;\n}\nexport type Done = 1\nenum E { A }';
    expect(exportedDecls(decls)).toBe('export type Row = { id: number }\nexport interface Opts {\n  x: number;\n}\nexport type Done = 1\nexport enum E { A }');
    expect(declaredNames(decls)).toEqual([
      { name: 'Row', typeOnly: true },
      { name: 'Opts', typeOnly: true },
      { name: 'Done', typeOnly: true },
      { name: 'E', typeOnly: false },
    ]);
  });
});

describe('ejectFiles', () => {
  const median = specExample('median');

  it('refuses what cannot be ejected', async () => {
    const rec = await record(median.spec, median.goodBodies[0]!);
    expect(ejectBlocker(undefined)).toBe('no such function');
    expect(ejectBlocker({ ...rec, artifact: null })).toBe('nothing is committed yet');
    expect(ejectBlocker({ ...rec, testsHash: 'changed' })).toMatch(/out of date/);
    expect(() => ejectFiles({ functions: [], now: NOW })).toThrow(/no function/);
    expect(() => ejectFiles({ functions: [rec, rec], now: NOW })).toThrow(/listed twice/);
    expect(() => ejectFiles({ functions: [{ ...rec, specHash: 'x' }], now: NOW })).toThrow(/out of date/);
  });

  it('writes the four files, and the zip holds them in a folder', async () => {
    const rec = await record(median.spec, median.goodBodies[0]!);
    const r = ejectFiles({ functions: [rec], now: NOW, revisions: [{ id: 7, at: NOW - 900, kind: 'commit', title: 'median certified — attempt 2 of 3', detail: '2 candidates' }] });
    expect(r.files.map((f) => f.path)).toEqual(['median.ts', 'median.test.ts', 'provenance.json', 'README.md']);
    const fnFile = r.files[0]!.text;
    expect(fnFile).toContain(' * Returns the median of a list of numbers.');
    expect(fnFile).toContain(`export function median(numbers: number[]): number {\n${median.goodBodies[0]}\n}\n`);

    const prov = JSON.parse(r.files[2]!.text);
    expect(prov).toMatchObject({
      format: 'undefined-eject',
      function: 'median',
      specHash: rec.specHash,
      testsHash: rec.testsHash,
      model: 'test-model',
      codexVersion: '1.2.3',
      revision: { id: 7, title: 'median certified — attempt 2 of 3', detail: '2 candidates' },
      evidenceLine: 'Compiled. 1 unit test. 1 property, 100 runs. 3 calls replayed for purity. Mutation check: not run yet.',
      mutation: null,
    });
    expect(prov.candidates.map((c: { verdict: string }) => c.verdict)).toEqual(['rejected', 'accepted']);
    expect(prov.candidates[0]).toMatchObject({ rejectedBy: 'tests', headline: 'Rejected: nope' });
    expect(prov.candidates[1].prompt).toBe('PROMPT');
    expect(r.files[3]!.text.split('\n').filter((l) => l.trim() !== '')).toHaveLength(2); // heading + one paragraph

    const zip = ejectZip({ functions: [rec], now: NOW });
    expect(zip.filename).toBe('median-eject.zip');
    expect(unzipStore(zip.bytes).map((e) => e.name)).toEqual(r.files.map((f) => `median-eject/${f.path}`));
  });

  it('the ejected tests pass on a good body and fail with the spec-was-silent note where the doc is silent', async () => {
    const good = await record(median.spec, median.goodBodies[0]!);
    const ok = runEjected(ejectFiles({ functions: [good], now: NOW }).files, 'median');
    expect(ok.filter((c) => c.error)).toEqual([]);
    expect(ok).toHaveLength(7);

    const throwsOnEmpty = median.badBodies.find((b) => b.silentOn)!.body;
    const bad = await record(median.spec, throwsOnEmpty);
    const res = runEjected(ejectFiles({ functions: [bad], now: NOW }).files, 'median');
    const failed = res.filter((c) => c.error);
    expect(failed.map((c) => c.name)).toEqual(['agrees with a sort-based reference']);
    expect(failed[0]!.error).toContain('Counterexample: [[]]');
    expect(failed[0]!.error).toContain("[spec was silent] The spec didn't say what the median of nothing is");

    // a real mistake caught by the same property carries no such note (`when` holds only for [])
    const stringSort = await record(median.spec, median.badBodies[0]!.body);
    const res2 = runEjected(ejectFiles({ functions: [stringSort], now: NOW }).files, 'median');
    const ref = res2.find((c) => c.name === 'agrees with a sort-based reference')!;
    expect(ref.error).toBeDefined();
    expect(ref.error).not.toContain('spec was silent');
  });

  it('a failing unit test with a marker says so; others do not', async () => {
    const slug = specExample('slugify');
    const bad = await record(slug.spec, slug.badBodies[0]!.body);
    const res = runEjected(ejectFiles({ functions: [bad], now: NOW }).files, 'slugify');
    const special = res.find((c) => c.name === 'special letters')!;
    expect(special.error).toMatch(/^expected "strasse", got "stra-e"\n\[spec was silent\] The spec didn't say how to spell letters outside a–z/);
  });

  it('pins become tests with their arguments and dataset rows as literals', async () => {
    const rows = [
      { customer: 'b', total: 2 },
      { customer: 'a', total: 5 },
    ];
    const hash = 'ab'.repeat(32);
    const spec: FunctionSpec = {
      name: 'best',
      params: [{ name: 'arg0', type: 'Row[]' }, { name: 'arg1', type: 'number' }],
      returns: null,
      doc: '',
      tests: '',
      properties: '',
      budgetMs: 1000,
      maxAttempts: 3,
      origin: 'call',
      typeDecls: 'type Row = { customer: string; total: number }',
    };
    const pins: Pin[] = [
      { id: 'p1', label: 'best(rows, 1)', args: [{ kind: 'dataset', name: 'rows', hash }, { kind: 'value', encoded: 1 }], expected: encodeValue(['a']), pinnedAt: NOW },
      { id: 'p2', label: 'best(other, 1)', args: [{ kind: 'dataset', name: 'other', hash: 'cd'.repeat(32) }, { kind: 'value', encoded: 1 }], expected: [], pinnedAt: NOW },
    ];
    const body = 'return [...arg0].sort((x, y) => y.total - x.total).slice(0, arg1).map((r) => r.customer);';
    const rec = await record({ ...spec, pins }, body, { returnType: 'string[]' });
    const files = ejectFiles({ functions: [rec], datasets: { [hash]: encodeValue(rows) as Json }, now: NOW }).files;
    const fnFile = files[0]!.text;
    expect(fnFile).toContain('export type Row = { customer: string; total: number }');
    expect(fnFile).toContain('export function best(arg0: Row[], arg1: number): string[] {');
    expect(fnFile).toContain('(The spec has no doc: this function was grown from a call alone.)');
    const testText = files[1]!.text;
    expect(testText).toContain("import { best, type Row } from './best';");
    expect(testText).toContain(`const __uDATASET_${hash.slice(0, 12)}: unknown[] = [\n  { customer: "b", total: 2 },\n  { customer: "a", total: 5 },\n];`);
    const res = runEjected(files, 'best');
    expect(res).toEqual([{ name: 'pinned: best(rows, 1)' }, { name: 'pinned: best(other, 1)', skipped: true }]);

    const wrong = await record({ ...spec, pins: [pins[0]!] }, 'return arg0.slice(0, arg1).map((r) => r.customer);', { returnType: 'string[]' });
    const res2 = runEjected(ejectFiles({ functions: [wrong], datasets: { [hash]: encodeValue(rows) as Json }, now: NOW }).files, 'best');
    expect(res2[0]!.error).toBe('best(rows, 1) returned ["b"], expected ["a"]');
  });

  it('a spec with no checks gets a todo placeholder, and a function named like an API keeps its name', async () => {
    const spec: FunctionSpec = { name: 'eq', params: [{ name: 'a', type: 'number' }], returns: 'number', doc: 'Doubles.', tests: "test('doubles', () => { if (eq(2) !== 4) throw new Error('no'); });", properties: '', budgetMs: 1000, maxAttempts: 3, origin: 'user' };
    const rec = await record(spec, 'return a * 2;');
    const files = ejectFiles({ functions: [rec], now: NOW }).files;
    expect(files[1]!.text).not.toMatch(/^function eq\(/m);
    expect(runEjected(files, 'eq')).toEqual([{ name: 'doubles' }]);

    const none = await record({ ...spec, name: 'twice', tests: '' }, 'return a * 2;');
    expect(runEjected(ejectFiles({ functions: [none], now: NOW }).files, 'twice')).toEqual([{ name: 'twice: no tests yet', todo: true }]);
  });

  it('the generated files are valid TypeScript (strict type-checking runs in npm run check:eject)', async () => {
    for (const id of ['median', 'slugify', 'fibonacci']) {
      const ex = specExample(id);
      const rec = await record(ex.spec, ex.goodBodies[0]!);
      const files = ejectFiles({ functions: [rec], now: NOW }).files;
      for (const f of files.filter((x) => x.path.endsWith('.ts'))) {
        const out = ts.transpileModule(f.text, { reportDiagnostics: true, compilerOptions: { strict: true, target: ts.ScriptTarget.ES2022 } });
        expect(out.diagnostics ?? [], `${id}/${f.path}`).toEqual([]);
      }
    }
  });
});

describe('tsRowsLiteral', () => {
  it('rows layout puts each row on its own line', () => {
    const lit = tsRowsLiteral(encodeValue([{ a: 1 }, { a: 2 }]));
    expect(lit).toBe('[\n  { a: 1 },\n  { a: 2 },\n]');
    fc.assert(fc.property(fc.array(fc.record({ n: fc.integer(), s: fc.string() })), (xs) => deepEqual(evalLiteral(tsRowsLiteral(encodeValue(xs))), xs)));
  });
});
