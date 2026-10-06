import { describe, expect, it } from 'vitest';
import { columnNote, lookalikeNote, textLookalikes, type NoteColumn } from './columnNotes';
import { describeColumns } from './samples';
import { bundledOrders } from '../../data/orders';
import { bundledSales } from '../../data/sales';
import { parseCsv } from '../../data/csv';
import { coerceCsvRows, inferDataset } from '../../data/infer';

const text = (name: string, values: unknown[]): NoteColumn => ({ name, type: 'Text', values });
const kinds = (cols: NoteColumn[]) => textLookalikes(cols).map((l) => `${l.name}:${l.kind}`);

describe('textLookalikes: numbers with separators', () => {
  it('finds a European amount column', () => {
    expect(kinds([text('Net Amt (USD)', ['1.234,50', '980,00', '12.000,10'])])).toEqual(['Net Amt (USD):number']);
  });
  it('finds US thousands, spaced thousands, currency signs and brackets', () => {
    expect(kinds([text('a', ['1,234.50', '12,345,678', '5'])])).toEqual(['a:number']);
    expect(kinds([text('b', ['1 234,50', '980,10'])])).toEqual(['b:number']);
    expect(kinds([text('c', ['$1,234.50', '$ 12.00', '$-5'])])).toEqual(['c:number']);
    expect(kinds([text('d', ['1.234,50 €', '10 €'])])).toEqual(['d:number']);
    expect(kinds([text('e', ['USD 1,234.50', 'USD 5'])])).toEqual(['e:number']);
    expect(kinds([text('f', ['(1,234.50)', '12'])])).toEqual(['f:number']);
  });
  it('lets plain numbers sit among the amounts, and ignores empty cells', () => {
    expect(kinds([text('Net', ['1.234,50', '', '980', null, '  '])])).toEqual(['Net:number']);
  });
  it('does not call ids, codes, phone numbers or words numbers', () => {
    expect(kinds([text('id', ['INV1001', 'INV1002'])])).toEqual([]);
    expect(kinds([text('zip', ['007', '008'])])).toEqual([]);
    expect(kinds([text('phone', ['+15551234567', '+15551230000'])])).toEqual([]);
    expect(kinds([text('ip', ['192.168.1.1', '10.0.0.7'])])).toEqual([]);
    expect(kinds([text('name', ['Puddlesworth Inc', '1,234.50'])])).toEqual([]);
    expect(kinds([text('version', ['1.2.3', '2.0.1'])])).toEqual([]);
  });
  it('needs one value that is not plain (a column of plain numbers is already a Number)', () => {
    expect(kinds([text('n', ['12', '13.5'])])).toEqual([]);
  });
});

describe('textLookalikes: percents', () => {
  it('finds a percent column, plain numbers allowed among them', () => {
    expect(kinds([text('Tax %', ['19%', '7 %', '0%'])])).toEqual(['Tax %:percent']);
    expect(kinds([text('Tax %', ['19%', '7'])])).toEqual(['Tax %:percent']);
    expect(kinds([text('Disc', ['12,5%', '-3.5%'])])).toEqual(['Disc:percent']);
  });
  it('does not call a column with a stray word a percent column', () => {
    expect(kinds([text('Tax', ['19%', 'exempt'])])).toEqual([]);
  });
});

describe('textLookalikes: dates', () => {
  it('finds day-first, month-first and dotted dates in any order of fields', () => {
    expect(kinds([text('Posting Date', ['31/01/2024', '01/02/2024'])])).toEqual(['Posting Date:date']);
    expect(kinds([text('d', ['01/31/2024', '02/01/2024'])])).toEqual(['d:date']);
    expect(kinds([text('d', ['31.01.2024', '1.2.2024'])])).toEqual(['d:date']);
    expect(kinds([text('d', ['31-01-24', '02-03-24'])])).toEqual(['d:date']);
    expect(kinds([text('d', ['31/01/2024 14:05', '01/02/2024 09:00:10'])])).toEqual(['d:date']);
  });
  it('finds year-first slashes and month names', () => {
    expect(kinds([text('d', ['2024/01/31', '2024.02.01'])])).toEqual(['d:date']);
    expect(kinds([text('d', ['31 Jan 2024', '1 Feb 2024'])])).toEqual(['d:date']);
    expect(kinds([text('d', ['31-Jan-24', '01-Feb-24'])])).toEqual(['d:date']);
    expect(kinds([text('d', ['Jan 31, 2024', 'February 1, 2024'])])).toEqual(['d:date']);
  });
  it('counts year-first ISO dates among the others, since a mixed column is Text', () => {
    expect(kinds([text('d', ['2024-01-31', '31/01/2024'])])).toEqual(['d:date']);
  });
  it('rejects impossible dates, two-digit dotted years and mixed columns', () => {
    expect(kinds([text('d', ['31/31/2024'])])).toEqual([]);
    expect(kinds([text('d', ['0/5/2024'])])).toEqual([]);
    expect(kinds([text('d', ['1.2.10', '3.4.11'])])).toEqual([]);
    expect(kinds([text('d', ['31/01/2024', 'n/a'])])).toEqual([]);
    expect(kinds([text('d', ['31/01/2024', '1.234,50'])])).toEqual([]);
  });
});

describe('textLookalikes: what it leaves alone', () => {
  it('reads only Text columns', () => {
    const cols: NoteColumn[] = [
      { name: 'Number', type: 'Number', values: ['1,234.50'] },
      { name: 'Date', type: 'Date', values: ['31/01/2024'] },
    ];
    expect(textLookalikes(cols)).toEqual([]);
  });
  it('needs a value to look at, and strings only', () => {
    expect(kinds([text('empty', ['', null, undefined])])).toEqual([]);
    expect(kinds([text('none', [])])).toEqual([]);
    expect(kinds([text('bool', [true, false])])).toEqual([]);
    expect(kinds([text('mixed', ['1.234,50', 5])])).toEqual([]);
  });
  it('keeps column order', () => {
    expect(kinds([text('b', ['1,000']), text('a', ['x']), text('c', ['5%'])])).toEqual(['b:number', 'c:percent']);
  });
});

describe('lookalikeNote', () => {
  it('says nothing when there is nothing to say', () => {
    expect(lookalikeNote([])).toBeNull();
  });
  it('names the columns and what to export, in plain words', () => {
    expect(
      lookalikeNote([
        { name: 'Net Amt (USD)', kind: 'number' },
        { name: 'Tax %', kind: 'percent' },
      ]),
    ).toBe(
      "Read as text, so questions about totals can't use them as they are: Net Amt (USD), Tax %. Export numbers as plain digits, like 1234.50 or 19, with no thousands separators, currency signs or % signs.",
    );
    expect(lookalikeNote([{ name: 'Net', kind: 'number' }])).toContain('Export numbers as plain digits, like 1234.50, with no thousands separators or currency signs.');
    expect(lookalikeNote([{ name: 'Tax %', kind: 'percent' }])).toContain('Export percents as plain numbers, like 19, with no % sign.');
  });
  it('speaks of dates for a date column, and of one column as it', () => {
    expect(lookalikeNote([{ name: 'Posting Date', kind: 'date' }])).toBe(
      "Read as text, so questions about dates can't use it as they are: Posting Date. Export dates as year-month-day, like 2024-01-31.",
    );
  });
  it('speaks of totals or dates when both are there, and counts the names past four', () => {
    const note = lookalikeNote(['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => ({ name: n, kind: i === 0 ? ('date' as const) : ('number' as const) })));
    expect(note).toContain('questions about totals or dates');
    expect(note).toContain(': a, b, c, d and 2 more.');
  });
  it("never uses the product's engine words", () => {
    const note = lookalikeNote([
      { name: 'a', kind: 'number' },
      { name: 'b', kind: 'percent' },
      { name: 'c', kind: 'date' },
    ])!;
    expect(note).not.toMatch(/\b(gate|spec|property|fuzz|mutant|revision|pin)\b/i);
  });
});

describe('columnNote on a whole file', () => {
  const finance = [
    'Net Amt (USD),Posting Date,Tax %,Vendor',
    '"1.234,50",31/01/2024,19%,Puddlesworth Inc',
    '"980,00",01/02/2024,7%,Kettlewhistle Farms',
    '"12.000,10",15/02/2024,19%,Brambleskate Ltd',
  ].join('\n');
  const rowsOf = (csv: string) => coerceCsvRows(parseCsv(csv).rows).rows;

  it('finds the three columns of a finance export, typed Text by the page itself', () => {
    const rows = rowsOf(finance);
    const ds = inferDataset(rows);
    const cols = describeColumns(ds.columns, rows);
    expect(cols.map((c) => c.type)).toEqual(['Text', 'Text', 'Text', 'Text']);
    expect(columnNote(cols, rows)).toBe(
      "Read as text, so questions about totals or dates can't use them as they are: Net Amt (USD), Posting Date, Tax %. Export numbers as plain digits, like 1234.50 or 19, with no thousands separators, currency signs or % signs. Export dates as year-month-day, like 2024-01-31.",
    );
  });
  it('says nothing about the two sample files', () => {
    for (const rows of [bundledOrders(), bundledSales()]) {
      expect(columnNote(describeColumns(inferDataset(rows).columns, rows), rows)).toBeNull();
    }
  });
});
