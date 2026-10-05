import { describe, expect, it } from 'vitest';
import {
  binaryProblem,
  dataFileProblem,
  datasetNameFromFile,
  MAX_DERIVED_NAME,
  delimiterHint,
  freshSuggestions,
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
    expect(dataFileProblem({ name: 'Q3.xlsx', size: 10 })).toBe('Q3.xlsx is a spreadsheet file; export it as CSV.');
  });

  it('names a dataset after its file: camelCase, never rows, never a taken name', () => {
    expect(datasetNameFromFile('sales.csv')).toBe('sales');
    expect(datasetNameFromFile('Sales Q3 2024.csv')).toBe('salesQ32024');
    expect(datasetNameFromFile('customer_orders.final.json')).toBe('customerOrdersFinal');
    expect(datasetNameFromFile('ORDERS.CSV')).toBe('orders');
    expect(datasetNameFromFile('2024-sales.tsv')).toBe('data2024Sales');
    expect(datasetNameFromFile('données.csv')).toBe('donnees');
    expect(datasetNameFromFile('/tmp/x/métriques-été.jsonl')).toBe('metriquesEte');
    expect(datasetNameFromFile('---.csv')).toBe('data');
    expect(datasetNameFromFile('日本.csv')).toBe('data');
    expect(datasetNameFromFile(undefined)).toBe('data');
    expect(datasetNameFromFile('class.csv')).toBe('classData');
    expect(datasetNameFromFile('rows.csv')).toBe('rows2');
    expect(datasetNameFromFile('sales.csv', ['sales', 'sales2'])).toBe('sales3');
    expect(datasetNameFromFile(undefined, ['data'])).toBe('data2');
    expect(datasetNameFromFile('median.csv', ['median'])).toBe('median2');
    for (const f of ['rows.csv', 'Rows.json', 'ROWS.tsv', undefined, '', '.csv']) expect(datasetNameFromFile(f)).not.toBe('rows');
  });

  it('spots binary text: any NUL, or more than 1% replacement characters in the first 4 kB', () => {
    expect(binaryProblem('a.csv', 'a,b\n1,2\n')).toBeNull();
    expect(binaryProblem('a.csv', '')).toBeNull();
    expect(binaryProblem('a.csv', 'Caf\uFFFD,1\n' + 'x'.repeat(400))).toBeNull();
    expect(binaryProblem('book.csv', 'PK\u0003\u0004\u0000\u0000')).toBe('book.csv looks binary; export it as CSV.');
    expect(binaryProblem('img.txt', '\uFFFD\uFFFDPNG\uFFFD' + 'a'.repeat(100))).toBe('img.txt looks binary; export it as CSV.');
    // only the first 4 kB count
    expect(binaryProblem('late.csv', 'a'.repeat(5000) + '\u0000')).toBeNull();
  });

  it('hints at the delimiter when CSV parsed into one column', () => {
    expect(delimiterHint('a;b;c\n1;2;3', 1)).toBe('Only 1 column found. Is the delimiter ";"?');
    expect(delimiterHint('a:b\n1:2', 1)).toBe('Only 1 column found. Is the delimiter ":"?');
    expect(delimiterHint('name\nAda', 1)).toBe('Only 1 column found.');
    expect(delimiterHint('a;b\n1;2', 2)).toBeNull();
    expect(delimiterHint('[{"a":1}]', 1)).toBeNull();
  });

  it('offers suggestions only for functions that do not exist yet', () => {
    const list = [{ fn: 'countByStatus' }, { fn: 'median' }, { fn: 'averageAmount' }, { fn: 'x' }];
    expect(freshSuggestions(list, { median: {} }).map((s) => s.fn)).toEqual(['countByStatus', 'averageAmount', 'x']);
    expect(freshSuggestions(undefined, {})).toEqual([]);
  });

  it('formats sizes and names datasets', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4321)).toBe('4.3 kB');
    expect(formatBytes(41_000)).toBe('41 kB');
    expect(datasetLine({ name: 'rows', typeName: 'Row', rowCount: 1332 })).toBe('rows · Row[] · 1,332 rows');
    expect(datasetLine({ name: 'one', typeName: 'OneRow', rowCount: 1 })).toBe('one · OneRow[] · 1 row');
    expect(variableName('  ')).toBe('data');
    expect(variableName('', 'sales')).toBe('sales');
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

describe('datasetNameFromFile: hostile file names (review)', () => {
  it('a dotfile keeps its name; a long name is cut at a word; prototype members and page globals are not defaults', () => {
    expect(datasetNameFromFile('.hidden')).toBe('hidden');
    expect(datasetNameFromFile('.hidden.csv')).toBe('hidden');
    expect(datasetNameFromFile('noext')).toBe('noext');
    const long = datasetNameFromFile(`${'quarterly revenue by region and channel '.repeat(8)}.csv`);
    expect(long).toBe('quarterlyRevenueByRegionAnd');
    expect(long.length).toBeLessThanOrEqual(MAX_DERIVED_NAME);
    expect(datasetNameFromFile(`${'a'.repeat(300)}.csv`)).toHaveLength(MAX_DERIVED_NAME);
    for (const f of ['constructor', 'toString', 'hasOwnProperty', 'console', 'module', 'window', 'status']) expect(datasetNameFromFile(`${f}.csv`)).toBe(`${f}Data`);
    expect(datasetNameFromFile('__proto__.csv')).toBe('proto');
    for (const f of ['class', 'eval', 'arguments', 'undefined', 'let', 'await']) expect(datasetNameFromFile(`${f}.json`)).toBe(`${f}Data`);
    expect(datasetNameFromFile('销售.csv')).toBe('data');
    expect(datasetNameFromFile('données 😀.csv')).toBe('donnees');
  });
  it('a name already taken (a function, a dataset or a console variable) gets a number; never rows', () => {
    expect(datasetNameFromFile('xs.csv', ['xs'])).toBe('xs2');
    expect(datasetNameFromFile('median.csv', ['median', 'median2'])).toBe('median3');
    expect(datasetNameFromFile('Rows.csv')).toBe('rows2');
    expect(datasetNameFromFile(undefined, ['data'])).toBe('data2');
  });
});
