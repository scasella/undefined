import { describe, expect, it } from 'vitest';
import {
  dataFileProblem,
  datasetLine,
  expectedSummary,
  formatBytes,
  formatCell,
  numericColumns,
  pinDatasets,
  pinnedText,
  sendCopy,
  tableNote,
  variableName,
} from './data';

describe('data drawer helpers', () => {
  it('accepts data files by extension and refuses the rest plainly', () => {
    expect(dataFileProblem({ name: 'orders.csv', size: 10 })).toBeNull();
    expect(dataFileProblem({ name: 'x.TSV', size: 10 })).toBeNull();
    expect(dataFileProblem({ name: 'x.jsonl', size: 10 })).toBeNull();
    expect(dataFileProblem({ name: 'photo.png', size: 10 })).toMatch(/not a \.csv/);
    expect(dataFileProblem({ name: 'big.csv', size: 9_000_000 })).toMatch(/9\.0 MB/);
  });

  it('formats sizes and names datasets', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4321)).toBe('4.3 kB');
    expect(formatBytes(41_000)).toBe('41 kB');
    expect(datasetLine({ name: 'rows', typeName: 'Row', rowCount: 1332 })).toBe('rows · Row[] · 1,332 rows');
    expect(datasetLine({ name: 'one', typeName: 'OneRow', rowCount: 1 })).toBe('one · OneRow[] · 1 row');
    expect(variableName('  ')).toBe('rows');
    expect(variableName(' orders ')).toBe('orders');
  });

  it('says what leaves the browser, per mode and choice', () => {
    expect(sendCopy('replay', true, 3)).toEqual({ toggle: null, line: 'Nothing leaves your browser in replay mode.' });
    const on = sendCopy('live', true, 3);
    expect(on.toggle).toBe('Send 3 sample rows to Codex along with the type (off = the type only)');
    expect(on.line).toContain('exactly the 3 rows below');
    expect(sendCopy('live', false, 3).line).toContain('the type only');
    expect(sendCopy('live', true, 3).line).toContain('retry feedback may quote up to 200 characters of your data while sample rows are on');
    expect(sendCopy('live', false, 3).line).toContain('retry feedback withholds anything derived from your data');
  });
});

describe('result tables', () => {
  const t = { columns: ['customer', 'revenue', 'note'], rows: [['"Ada"', '17.5', ''], ['"Cy"', '-3', '"x"']], total: 332 };
  it('notes when rows are cut, and only then', () => {
    expect(tableNote(t)).toBe('showing 2 of 332 rows');
    expect(tableNote({ ...t, total: 2 })).toBeNull();
  });
  it('right-aligns numeric columns only', () => {
    expect(numericColumns(t)).toEqual([false, true, false]);
    expect(numericColumns({ columns: ['n'], rows: [['1n'], ['null'], ['NaN']], total: 3 })).toEqual([true]);
    expect(numericColumns({ columns: ['e'], rows: [[''], ['']], total: 2 })).toEqual([false]);
  });
});

describe('pins', () => {
  it('pinned line, expected summary and dataset names', () => {
    expect(pinnedText('median', 2)).toBe('Pinned ✓ — now a unit test on median (2 pinned)');
    expect(expectedSummary([{ customer: 'Ada', total: 17 }])).toBe('[{ customer: "Ada", total: 17 }]');
    expect(expectedSummary('x'.repeat(200), 10)).toBe('"xxxxxxxx…');
    expect(pinDatasets({ args: [{ kind: 'dataset', name: 'rows', hash: 'h' }, { kind: 'value', encoded: 1 }] })).toEqual(['rows']);
  });
});

describe('formatCell', () => {
  it('rounds a long decimal to at most 4 places and trims trailing zeros', () => {
    expect(formatCell('2260.0574999999994')).toBe('2260.0575');
    expect(formatCell('22.5')).toBe('22.5');
    expect(formatCell('0.10000000000000003')).toBe('0.1');
    expect(formatCell('-3.00001')).toBe('-3');
    expect(formatCell('-0.00001')).toBe('0');
  });
  it('leaves integers, bigints, exponent forms and non-numbers alone', () => {
    for (const c of ['7', '-12', '123n', '1e21', '1.5e-7', 'NaN', 'Infinity', '-Infinity', 'Ada', '']) expect(formatCell(c)).toBe(c);
  });
});
