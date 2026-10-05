import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCsv, sniffDelimiter } from './csv';

describe('parseCsv basics', () => {
  it('parses a simple file into string rows keyed by header', () => {
    const r = parseCsv('id,name\n1,Ada\n2,Grace\n');
    expect(r.headers).toEqual(['id', 'name']);
    expect(r.rows).toEqual([
      { id: '1', name: 'Ada' },
      { id: '2', name: 'Grace' },
    ]);
    expect(r.delimiter).toBe(',');
    expect(r.warnings).toEqual([]);
  });

  it('handles quoted fields, escaped quotes, embedded delimiters and newlines', () => {
    const text = 'a,b,c\n"x, y","say ""hi""","line1\nline2"\n"","plain",""""\n';
    const r = parseCsv(text);
    expect(r.rows).toEqual([
      { a: 'x, y', b: 'say "hi"', c: 'line1\nline2' },
      { a: '', b: 'plain', c: '"' },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('keeps CRLF inside quotes and accepts CRLF, LF and CR record ends', () => {
    expect(parseCsv('a,b\r\n1,"x\r\ny"\r\n2,z\r\n').rows).toEqual([
      { a: '1', b: 'x\r\ny' },
      { a: '2', b: 'z' },
    ]);
    expect(parseCsv('a,b\r1,2\r3,4').rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
    expect(parseCsv('a,b\n1,2\r\n3,4\r5,6').rows).toHaveLength(3);
  });

  it('drops a UTF-8 BOM', () => {
    const r = parseCsv('﻿id,name\n1,x');
    expect(r.headers).toEqual(['id', 'name']);
    expect(r.rows).toEqual([{ id: '1', name: 'x' }]);
  });

  it('keeps quotes inside unquoted fields literally and never trims values', () => {
    expect(parseCsv('a,b\n5" pipe, x \n').rows).toEqual([{ a: '5" pipe', b: ' x ' }]);
  });

  it('works without a trailing newline and with a trailing delimiter', () => {
    expect(parseCsv('a,b\n1,2').rows).toEqual([{ a: '1', b: '2' }]);
    expect(parseCsv('a,b\n1,').rows).toEqual([{ a: '1', b: '' }]);
  });
});

describe('delimiter sniffing', () => {
  it.each([
    [',', 'a,b,c\n1,2,3\n4,5,6'],
    [';', 'a;b;c\n1,5;2,5;3\n4;5;6'],
    ['\t', 'a\tb\n1, 2\t3\n4\t5'],
    ['|', 'a|b|c\nx, y|2|3\n4|5|6'],
  ])('picks %j by consistency', (d, text) => {
    expect(sniffDelimiter(text)).toBe(d);
    expect(parseCsv(text).delimiter).toBe(d);
  });

  it('prefers the consistent delimiter over the more frequent one', () => {
    // commas appear more often but vary per line; semicolons are exactly 2 per line
    const text = 'name;notes;n\nA;a,b,c,d;1\nB;x;2\nC;p,q;3';
    expect(sniffDelimiter(text)).toBe(';');
    expect(parseCsv(text).rows[0]).toEqual({ name: 'A', notes: 'a,b,c,d', n: '1' });
  });

  it('ignores delimiters inside quotes', () => {
    expect(sniffDelimiter('"a;b;c",d\n"x;y;z",w\n"1;2;3",q')).toBe(',');
  });

  it('only looks at the first 20 records', () => {
    const head = Array.from({ length: 20 }, (_, i) => `${i};x`).join('\n');
    const tail = Array.from({ length: 100 }, () => 'p,q,r').join('\n');
    expect(sniffDelimiter(`${head}\n${tail}`)).toBe(';');
  });

  it('falls back to comma for a single column, and honours an explicit delimiter', () => {
    expect(parseCsv('name\nAda\nGrace').delimiter).toBe(',');
    expect(parseCsv('name\nAda\nGrace').rows).toEqual([{ name: 'Ada' }, { name: 'Grace' }]);
    const r = parseCsv('a;b\n1;2', { delimiter: ',' });
    expect(r.delimiter).toBe(',');
    expect(r.rows).toEqual([{ 'a;b': '1;2' }]);
  });

  it('rejects an unusable explicit delimiter with a warning and sniffs instead', () => {
    const r = parseCsv('a;b\n1;2', { delimiter: '"' });
    expect(r.delimiter).toBe(';');
    expect(r.warnings[0]).toMatch(/Ignored delimiter/);
  });
});

describe('headers', () => {
  it('de-duplicates as a, a_2, a_3', () => {
    expect(parseCsv('a,a,a,b\n1,2,3,4').headers).toEqual(['a', 'a_2', 'a_3', 'b']);
  });

  it('never collides with a real header named like a suffix', () => {
    const r = parseCsv('a,a,a_2\n1,2,3');
    expect(r.headers).toEqual(['a', 'a_3', 'a_2']);
    expect(r.rows[0]).toEqual({ a: '1', a_3: '2', a_2: '3' });
  });

  it('names blank headers col_N by position, avoiding real names', () => {
    expect(parseCsv('id,,name, \n1,2,3,4').headers).toEqual(['id', 'col_2', 'name', 'col_4']);
    expect(parseCsv('col_2,\n1,2').headers).toEqual(['col_2', 'col_2_2']);
  });

  it('trims header names', () => {
    expect(parseCsv(' id , name \n1,2').headers).toEqual(['id', 'name']);
  });

  it('keeps a __proto__ header as an own property', () => {
    const r = parseCsv('__proto__,b\nx,y');
    expect(Object.keys(r.rows[0]!)).toEqual(['__proto__', 'b']);
    expect(Object.getPrototypeOf(r.rows[0])).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(r.rows[0], '__proto__')?.value).toBe('x');
  });
});

describe('ragged rows and blank lines', () => {
  it('pads short rows with empty strings', () => {
    const r = parseCsv('a,b,c\n1\n1,2');
    expect(r.rows).toEqual([
      { a: '1', b: '', c: '' },
      { a: '1', b: '2', c: '' },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('keeps long rows under extra col_N columns, with a warning, and pads every row to the same keys', () => {
    const r = parseCsv('a,b\n1,2,3,4\n5,6');
    expect(r.headers).toEqual(['a', 'b', 'col_3', 'col_4']);
    expect(r.rows).toEqual([
      { a: '1', b: '2', col_3: '3', col_4: '4' },
      { a: '5', b: '6', col_3: '', col_4: '' },
    ]);
    expect(r.warnings).toEqual([
      'Row on line 2 has 4 values but the header has 2 columns; the extra values were kept as extra columns.',
    ]);
  });

  it('caps long-row warnings', () => {
    const text = 'a\n' + Array.from({ length: 9 }, () => '1,2').join('\n');
    const r = parseCsv(text);
    expect(r.warnings).toHaveLength(6);
    expect(r.warnings[5]).toBe('…and 4 more rows with too many values.');
  });

  it('ignores trailing blank lines silently and skips interior ones with a warning', () => {
    expect(parseCsv('a,b\n1,2\n\n\n  \r\n').warnings).toEqual([]);
    expect(parseCsv('a,b\n1,2\n\n\n  \r\n').rows).toHaveLength(1);
    const r = parseCsv('\n\na,b\n1,2\n\n3,4\n');
    expect(r.headers).toEqual(['a', 'b']);
    expect(r.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
    expect(r.warnings).toEqual(['Skipped 1 blank line between rows.']);
  });

  it('in a single-column file an interior blank line is an empty value', () => {
    expect(parseCsv('name\nAda\n\nGrace\n\n').rows).toEqual([{ name: 'Ada' }, { name: '' }, { name: 'Grace' }]);
  });

  it('a quoted empty field is not a blank line', () => {
    expect(parseCsv('a,b\n""\n1,2').rows).toEqual([
      { a: '', b: '' },
      { a: '1', b: '2' },
    ]);
  });
});

describe('malformed input', () => {
  it('an unterminated quote is a warning, and the field runs to the end', () => {
    const r = parseCsv('a,b\n1,"oops\n2,3\n');
    expect(r.rows).toEqual([{ a: '1', b: 'oops\n2,3\n' }]);
    expect(r.warnings).toEqual(['Unterminated quote starting on line 2: the rest of the input was read as one value.']);
  });

  it('text after a closing quote is kept, with a warning', () => {
    const r = parseCsv('a,b\n"ab"c,d');
    expect(r.rows).toEqual([{ a: 'abc', b: 'd' }]);
    expect(r.warnings[0]).toMatch(/after a closing quote/);
  });

  it('empty and whitespace-only input', () => {
    for (const t of ['', '\n\n', '   ', '﻿']) {
      const r = parseCsv(t);
      expect(r.rows).toEqual([]);
      expect(r.headers).toEqual([]);
      expect(r.warnings).toEqual(['The input is empty.']);
    }
  });

  it('header only → no rows', () => {
    expect(parseCsv('a,b,c\n')).toEqual({ rows: [], headers: ['a', 'b', 'c'], delimiter: ',', warnings: [] });
  });

  it('never throws, and every row has exactly the headers as keys (property)', () => {
    const csvish = fc.string({ unit: fc.constantFrom('a', 'b', ',', ';', '\t', '|', '"', '\n', '\r', ' ', 'é', '😀') });
    fc.assert(
      fc.property(fc.oneof(fc.string(), csvish), (text) => {
        const r = parseCsv(text);
        expect(new Set(r.headers).size).toBe(r.headers.length);
        for (const row of r.rows) expect(Object.keys(row)).toEqual(r.headers);
        for (const row of r.rows) for (const v of Object.values(row)) expect(typeof v).toBe('string');
      }),
      { numRuns: 500, seed: 42 },
    );
  });

  it('round-trips well-formed quoted CSV (property)', () => {
    const cell = fc.string({ unit: fc.constantFrom('x', ',', '"', '\n', '\r\n', ' ', ';') });
    const table = fc.integer({ min: 1, max: 4 }).chain((w) =>
      fc.tuple(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,4}$/), { minLength: w, maxLength: w }), fc.array(fc.array(cell, { minLength: w, maxLength: w }), { maxLength: 5 })),
    );
    fc.assert(
      fc.property(table, ([headers, body]) => {
        const q = (s: string): string => `"${s.replace(/"/g, '""')}"`;
        const text = [headers.join(','), ...body.map((r) => r.map(q).join(','))].join('\r\n');
        const r = parseCsv(text, { delimiter: ',' });
        expect(r.headers).toEqual(headers);
        expect(r.rows.map((row) => headers.map((h) => row[h]))).toEqual(body);
      }),
      { numRuns: 300, seed: 7 },
    );
  });
});
