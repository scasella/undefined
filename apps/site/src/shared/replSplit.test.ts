import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { needsSplit, REFUSE, splitStatements, topLevel, unclosed } from './replSplit';

const split = (line: string) => splitStatements(ts, line);

describe('needsSplit: the fast path keeps one-unit lines on the pre-Phase-3 path', () => {
  it.each([
    'median([3, 1, 4, 2])',
    'x = 1',
    'x = 1;',
    'const x = f(1, 2)',
    'let s = "a;b"',
    'x = `a;${b}`',
    'f(() => { a; b })',
    '{ a: 1 }',
    '[1, 2].map((x) => x * 2)',
    'x = 1, y = 2',
    'doThing(1)',
    'iffy(1)',
    '',
  ])('%s → one unit', (line) => expect(needsSplit(line)).toBe(false));

  it.each([
    'a = 1; b = 2',
    'const {a, b} = o',
    'const [a] = o',
    'const a = 1, b = 2',
    'let x',
    'if (a) b()',
    'for (const x of xs) f(x)',
    'while (false) {}',
    'do {} while (false)',
    'try { f() } catch {}',
    'switch (x) {}',
    'function f() {}',
    'class A {}',
    'return 1',
    'throw new Error("x")',
  ])('%s → parser', (line) => expect(needsSplit(line)).toBe(true));
});

describe('topLevel / unclosed', () => {
  it('ignores separators inside strings, comments and brackets', () => {
    expect(topLevel('f(a, b); "x;y" /* ; */ [1, 2], c')).toEqual({ semis: [7], commas: [29] });
  });
  it('names the bracket left open', () => {
    expect(unclosed('f([1, 2')).toBe('a `[` is never closed (missing `]`)');
    expect(unclosed('f(1)')).toBeNull();
  });
});

describe('splitStatements', () => {
  it('expression statements are expr units; empty statements are skipped', () => {
    expect(split('a = 1;; f(a); ')).toEqual({ ok: true, units: [{ kind: 'expr', text: 'a = 1' }, { kind: 'expr', text: 'f(a)' }] });
  });

  it('declarations become one assignment unit per declarator', () => {
    expect(split('const a = f(1), {b, c: d = 2, ...e} = o; let [x, , y] = xs; var z')).toEqual({
      ok: true,
      units: [
        { kind: 'expr', text: 'a = (f(1)\n)' },
        { kind: 'expr', text: '({b, c: d = 2, ...e} = (o\n))' },
        { kind: 'expr', text: '([x, , y] = (xs\n))' },
        { kind: 'expr', text: 'z = void 0' },
      ],
    });
  });

  it('control flow is a stmt unit, as written', () => {
    expect(split('if (a) { b() } else c(); for (let i = 0; i < 3; i++) t += i')).toEqual({
      ok: true,
      units: [
        { kind: 'stmt', text: 'if (a) { b() } else c();' },
        { kind: 'stmt', text: 'for (let i = 0; i < 3; i++) t += i' },
      ],
    });
  });

  it('refuses what the REPL cannot do, with a plain message', () => {
    expect(split('function f() {}')).toEqual({ ok: false, message: REFUSE.function });
    expect(split('class A {}')).toEqual({ ok: false, message: REFUSE.class });
    expect(split('import x from "y"')).toEqual({ ok: false, message: REFUSE.module });
    expect(split('export const a = 1')).toEqual({ ok: false, message: REFUSE.module });
    expect(split('return 1')).toEqual({ ok: false, message: REFUSE.return });
    expect(split('a = 1; await f()')).toEqual({ ok: false, message: REFUSE.await });
    expect(split('for await (const x of xs) {}')).toEqual({ ok: false, message: REFUSE.await });
    expect(split('let x: number = 1')).toEqual({ ok: false, message: REFUSE.types });
    expect(split('let {a}')).toEqual({ ok: false, message: REFUSE.pattern });
  });

  it('await inside a function is not top-level', () => {
    expect(split('g = async () => await 1; 2').ok).toBe(true);
  });

  it('a parse error is a SyntaxError message; an open bracket says which', () => {
    expect(split('a = 1; b = (2')).toEqual({ ok: false, message: 'unexpected end of input: a `(` is never closed (missing `)`)' });
    const r = split('a = 1; b = 2 3');
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(/expected \(column \d+\)$/);
  });
});
