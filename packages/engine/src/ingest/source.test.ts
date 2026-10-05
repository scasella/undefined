import { describe, expect, it } from 'vitest';
import { buildSource } from '../gates/source';
import { extractFunctions } from './source';

const one = async (text: string) => {
  const r = await extractFunctions(text, 'f.ts');
  return { ...r, f: r.functions[0]! };
};
const messages = async (text: string) => (await extractFunctions(text, 'f.ts')).issues.map((i) => i.message);

describe('extractFunctions: what the wrapper can express', () => {
  it('reads an exported function declaration: params verbatim, return type, JSDoc, body byte for byte', async () => {
    const body = '  const sorted = [...numbers].sort((a, b) => a - b);\n\n  return sorted[0] ?? NaN;';
    const text = `/**\n * Returns the smallest number.\n * @param numbers any list\n */\nexport function smallest(numbers: Array<{ v: number }>[], k: number): number {\n${body}\n}\n`;
    const { f, issues } = await one(text);
    expect(issues).toEqual([]);
    expect(f).toMatchObject({
      name: 'smallest',
      line: 5,
      bodyLine: 6,
      params: [
        { name: 'numbers', type: 'Array<{ v: number }>[]' },
        { name: 'k', type: 'number' },
      ],
      returns: 'number',
      doc: 'Returns the smallest number.\n@param numbers any list',
      typeDecls: '',
      expressionBody: false,
      callees: [],
    });
    expect(f.body).toBe(body);
  });

  it('round-trips a body written as `{\\n<body>\\n}` exactly, so the compile source is the site\'s', async () => {
    const spec = { name: 'g', params: [{ name: 'x', type: 'number' }], returns: null, doc: '', tests: '', properties: '', budgetMs: 1000, maxAttempts: 1, origin: 'user' as const };
    const body = 'if (x > 0) {\n    return x;\n}\nreturn -x; // trailing comment';
    const { f } = await one(`export function g(x: number) {\n${body}\n}\n`);
    expect(f.body).toBe(body);
    expect(f.returns).toBeNull();
    expect(buildSource({ ...spec, params: f.params, returns: f.returns }, f.body)).toEqual(buildSource(spec, body));
  });

  it('reads const arrow and function-expression exports; an expression body becomes `return <expr>;`', async () => {
    const r = await extractFunctions(
      'export const double = (n: number): number => n * 2;\nexport const triple = function (n: number): number {\n  return n * 3;\n};\n',
      'f.ts',
    );
    expect(r.issues).toEqual([]);
    expect(r.functions.map((f) => [f.name, f.body, f.expressionBody])).toEqual([
      ['double', 'return n * 2;', true],
      ['triple', '  return n * 3;', false],
    ]);
  });

  it('carries the type declarations it uses, transitively and in file order, without `export`', async () => {
    const text = [
      'type Unused = { z: 1 };',
      'export type Money = number;',
      'export interface Row { customer: string; total: Money }',
      'export function top(rows: Row[]): string {',
      '  return rows[0]!.customer;',
      '}',
    ].join('\n');
    const { f, issues } = await one(text);
    expect(issues).toEqual([]);
    expect(f.typeDecls).toBe('type Money = number;\ninterface Row { customer: string; total: Money }');
  });

  it('finds same-file exported callees (not itself, not a local that shadows a module name)', async () => {
    const text = [
      'export function inc(n: number): number { return n + 1; }',
      'export function fact(n: number): number { return n <= 1 ? 1 : n * fact(n - 1); }',
      'export function twice(n: number): number { const inc2 = (x: number) => x; return inc(inc(inc2(n))); }',
    ].join('\n');
    const r = await extractFunctions(text, 'f.ts');
    expect(r.issues).toEqual([]);
    expect(Object.fromEntries(r.functions.map((f) => [f.name, f.callees]))).toEqual({ inc: [], fact: [], twice: ['inc'] });
  });

  it('lets a local declaration shadow a module-scope name', async () => {
    const r = await extractFunctions('const LIMIT = 3;\nexport function f(n: number): number { const LIMIT = 5; return Math.min(n, LIMIT); }', 'f.ts');
    expect(r.issues).toEqual([]);
  });
});

describe('extractFunctions: loud refusals (could not run, never a rejection)', () => {
  it.each([
    ['export function f<T>(x: T): T { return x; }', 'f has type parameters; FunctionSpec has no generics'],
    ['export async function f(x: number): Promise<number> { return x; }', 'f is async; the gates run synchronous functions'],
    ['export function* f(x: number) { yield x; }', 'f is a generator; the gates run plain functions'],
    ['export function f(x?: number): number { return 1; }', 'f has an optional parameter (x?)'],
    ['export function f(x: number = 1): number { return x; }', 'f has a default value for x'],
    ['export function f(...xs: number[]): number { return 1; }', 'f has a rest parameter (...xs)'],
    ['export function f({ a }: { a: number }): number { return a; }', 'f has a destructured parameter; give it a name and a type'],
    ['export function f(x): number { return 1; }', 'f parameter x has no type annotation'],
  ])('%s', async (text, message) => {
    expect(await messages(text)).toEqual([message]);
  });

  it('refuses overloads, default exports, let exports and export lists', async () => {
    expect(await messages('export function f(x: number): number;\nexport function f(x: any): any { return x; }')).toEqual(['f has overload signatures; FunctionSpec describes one signature']);
    expect(await messages('export default function (x: number) { return x; }')).toEqual(['a default export has no name to certify it under; export it by name']);
    expect(await messages('export let f = (x: number) => x;')).toEqual([
      'f is declared with let/var; only const function exports are certified (a reassignable export is not one function)',
    ]);
    expect(await messages('function f(x: number) { return x; }\nexport { f };')).toEqual(['export lists and re-exports are not followed; export each function where it is declared']);
  });

  it('refuses module-scope dependencies other than types and exported functions, naming them', async () => {
    const text = [
      "import { STOP } from './words';",
      'const SEP = "-";',
      'function helper(s: string): string { return s; }',
      'class K {}',
      'export function slug(s: string): string { return helper(s).split(SEP).filter((w) => !STOP.has(w)).join() + String(new K()); }',
    ].join('\n');
    const r = await extractFunctions(text, 'f.ts');
    expect(r.functions).toEqual([]);
    expect(r.issues.map((i) => [i.line, i.fn, i.message])).toEqual([
      [5, 'slug', 'slug uses helper from module scope (a function that is not exported); the gates certify self-contained functions'],
      [5, 'slug', 'slug uses SEP from module scope (a module-scope variable); the gates certify self-contained functions'],
      [5, 'slug', "slug uses STOP, imported from './words'; the gates certify self-contained functions (type-only imports are not followed yet)"],
      [5, 'slug', 'slug uses K from module scope (a class); the gates certify self-contained functions'],
    ]);
  });

  it('reports a file that does not parse', async () => {
    const r = await extractFunctions('export function f(x: number { return x; }', 'f.ts');
    expect(r.functions).toEqual([]);
    expect(r.issues[0]!.message).toMatch(/^does not parse: /);
  });
});
