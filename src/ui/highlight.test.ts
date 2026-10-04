import { describe, expect, it } from 'vitest';
import { markRange, tokenize, tokenLines } from './highlight';

const kinds = (src: string) => tokenize(src).filter((t) => t.kind !== 'ws').map((t) => [t.kind, t.text]);

describe('tokenize', () => {
  it('classifies keywords, types, identifiers, numbers and punctuation', () => {
    expect(kinds('const n: number = xs.length / 2;')).toEqual([
      ['kw', 'const'],
      ['ident', 'n'],
      ['punc', ':'],
      ['type', 'number'],
      ['punc', '='],
      ['ident', 'xs'],
      ['punc', '.'],
      ['ident', 'length'],
      ['punc', '/'],
      ['num', '2'],
      ['punc', ';'],
    ]);
  });

  it('recognises numeric forms', () => {
    for (const n of ['1.5', '0xff', '10n', '1e-3', '.5', '1_000']) {
      expect(kinds(n)).toEqual([['num', n]]);
    }
  });

  it('keeps strings with escapes and template literals whole', () => {
    expect(kinds(`"a\\"b" + 'c' + \`x\${y}\``)).toEqual([
      ['str', '"a\\"b"'],
      ['punc', '+'],
      ['str', "'c'"],
      ['punc', '+'],
      ['str', '`x${y}`'],
    ]);
  });

  it('handles line and block comments', () => {
    expect(kinds('a // hi\n/* b */ c')).toEqual([
      ['ident', 'a'],
      ['com', '// hi'],
      ['com', '/* b */'],
      ['ident', 'c'],
    ]);
  });

  it('tolerates truncated input from the typewriter', () => {
    expect(kinds('return "unterm')).toEqual([
      ['kw', 'return'],
      ['str', '"unterm'],
    ]);
    expect(kinds('/* open comment')).toEqual([['com', '/* open comment']]);
    expect(kinds('x = `tmpl\nmore')).toEqual([
      ['ident', 'x'],
      ['punc', '='],
      ['str', '`tmpl\nmore'],
    ]);
  });

  it('is lossless: tokens concatenate back to the source', () => {
    const src = 'if (a < b) {\n  return [a, b]; // ok\n}\n';
    expect(tokenize(src).map((t) => t.text).join('')).toBe(src);
  });
});

describe('tokenLines', () => {
  it('splits multi-line tokens across lines', () => {
    const lines = tokenLines('a /* x\ny */ b\nc');
    expect(lines).toHaveLength(3);
    expect(lines[0].map((t) => t.text).join('')).toBe('a /* x');
    expect(lines[1].map((t) => t.text).join('')).toBe('y */ b');
    expect(lines[1][0].kind).toBe('com');
    expect(lines[2]).toEqual([{ kind: 'ident', text: 'c' }]);
  });

  it('keeps empty lines', () => {
    expect(tokenLines('a\n\nb')).toHaveLength(3);
    expect(tokenLines('')).toEqual([[]]);
  });
});

describe('markRange', () => {
  const line = tokenLines('const result: number = "even";')[0];
  const marked = (m: ReturnType<typeof markRange>) => m.filter((t) => t.marked).map((t) => t.text).join('');

  it('marks exactly the 1-based [col, endCol) span, splitting tokens', () => {
    const m = markRange(line, 7, 13);
    expect(marked(m)).toBe('result');
    expect(m.map((t) => t.text).join('')).toBe('const result: number = "even";');
    expect(marked(markRange(line, 9, 11))).toBe('su');
  });

  it('marks a single character for an empty span', () => {
    expect(marked(markRange(line, 1, 1))).toBe('c');
  });

  it('ignores spans past the end of the line', () => {
    expect(marked(markRange(line, 100, 104))).toBe('');
  });
});
