import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Json } from '../types';
import { decodeValue } from '../shared/serialize';
import { MASKED_NAMES } from '../sandbox/mask';
import { DATASET_LIMITS, buildDataset, canonicalJson, utf8Length, validateVariableName, type BuildDatasetResult } from './dataset';
import { bundledOrders } from './orders';

function ok(r: BuildDatasetResult): Extract<BuildDatasetResult, { ref: unknown }> {
  if ('error' in r) throw new Error(`${r.error}: ${r.message}`);
  return r;
}

describe('canonicalJson', () => {
  it('sorts keys at every depth and has no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [{ d: null, c: 'x' }], '': true })).toBe('{"":true,"a":[{"c":"x","d":null}],"b":1}');
  });
  it('key order does not change the text', () => {
    expect(canonicalJson({ a: 1, b: { y: 2, x: 3 } })).toBe(canonicalJson({ b: { x: 3, y: 2 }, a: 1 }));
  });
});

describe('buildDataset', () => {
  const rows = [
    { id: 1, customer: 'Zorblat Industries', total: 12.5, coupon: 'Ä' },
    { id: 2, customer: 'Mx. Pemberwick', total: 3 },
  ];

  it('builds the ref: hash of canonical encoded rows, UTF-8 bytes, inferred type', async () => {
    const r = ok(await buildDataset('rows', rows, { source: 'paste' }));
    const canonical = canonicalJson(r.encoded);
    expect(r.ref).toEqual({
      name: 'rows',
      hash: createHash('sha256').update(canonical, 'utf8').digest('hex'),
      typeName: 'Row',
      typeDecl: 'type Row = { id: number; customer: string; total: number; coupon?: string }',
      rowCount: 2,
      columns: [
        { name: 'id', type: 'number' },
        { name: 'customer', type: 'string' },
        { name: 'total', type: 'number' },
        { name: 'coupon', type: 'string | undefined' },
      ],
      source: 'paste',
      bytes: Buffer.byteLength(canonical, 'utf8'),
    });
    expect(r.ref.bytes).toBe(canonical.length + 1); // 'Ä' is 2 UTF-8 bytes
    expect(decodeValue(r.encoded)).toEqual(rows);
    expect('filename' in r.ref).toBe(false);
  });

  it('is content-addressed: key order and name do not change the hash; content does', async () => {
    const a = ok(await buildDataset('rows', rows, { source: 'paste' }));
    const reordered = rows.map((r) => Object.fromEntries(Object.entries(r).reverse()));
    const b = ok(await buildDataset('orders', reordered, { source: 'file', filename: 'o.csv', typeName: 'Order' }));
    expect(b.ref.hash).toBe(a.ref.hash);
    expect(b.ref.bytes).toBe(a.ref.bytes);
    expect(b.ref.filename).toBe('o.csv');
    expect(b.ref.typeDecl.startsWith('type Order = {')).toBe(true);
    const c = ok(await buildDataset('rows', [{ ...rows[0]!, total: 12.51 }, rows[1]!], { source: 'paste' }));
    expect(c.ref.hash).not.toBe(a.ref.hash);
  });

  it('encodes non-JSON values via encodeValue (round-trips)', async () => {
    const r = ok(await buildDataset('rows', [{ n: NaN, big: 10n, u: undefined, $t: 'x' }], { source: 'paste' }));
    expect(decodeValue(r.encoded)).toEqual([{ n: NaN, big: 10n, u: undefined, $t: 'x' }]);
  });

  it('bundled orders fit under the caps', async () => {
    const r = ok(await buildDataset('rows', bundledOrders(), { source: 'bundled' }));
    expect(r.ref.rowCount).toBe(332);
    expect(r.ref.bytes).toBeLessThan(DATASET_LIMITS.maxBytes);
  });

  it('rejects more than 20,000 rows with the numbers in the message', async () => {
    const many = Array.from({ length: 20_001 }, (_, i) => ({ i }));
    const r = await buildDataset('rows', many, { source: 'paste' });
    expect(r).toEqual({
      error: 'too-large',
      message:
        'That is 20,001 rows; the limit is 20,000. Trim it (for example keep the first 20,000 rows, or filter it before pasting) and import again.',
    });
    expect('ref' in ok(await buildDataset('rows', many.slice(0, 20_000), { source: 'paste' }))).toBe(true);
  });

  it('rejects more than 1,000,000 encoded bytes with the numbers in the message', async () => {
    const big = Array.from({ length: 1000 }, (_, i) => ({ i, s: 'x'.repeat(1000) }));
    const r = await buildDataset('rows', big, { source: 'paste' });
    if (!('error' in r)) throw new Error('expected too-large');
    expect(r.error).toBe('too-large');
    const bytes = utf8Length(canonicalJson(JSON.parse(JSON.stringify(big)) as Json));
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(r.message).toBe(
      `The 1,000 rows take ${bytes.toLocaleString('en-US')} bytes; the limit is 1,000,000 bytes. Trim it (drop columns or rows you don't need) and import again.`,
    );
  });

  it('accepts exactly the byte limit', async () => {
    // [{"s":"…"}] = 10 bytes of structure
    const exact = [{ s: 'x'.repeat(DATASET_LIMITS.maxBytes - 10) }];
    const r = ok(await buildDataset('rows', exact, { source: 'paste' }));
    expect(r.ref.bytes).toBe(DATASET_LIMITS.maxBytes);
    const over = await buildDataset('rows', [{ s: 'x'.repeat(DATASET_LIMITS.maxBytes - 9) }], { source: 'paste' });
    expect('error' in over && over.error).toBe('too-large');
  });

  it('rejects a bad variable name before doing any work', async () => {
    expect(await buildDataset('let', rows, { source: 'paste' })).toEqual({
      error: 'bad-name',
      message: '"let" is a reserved word in JavaScript; pick another name, e.g. rows.',
    });
  });
});

describe('validateVariableName', () => {
  it.each(['rows', 'orders2024', '_x', '$', 'camelCase', 'Row', 'data'])('%j is fine', (n) => {
    expect(validateVariableName(n)).toBeNull();
  });

  it('explains each kind of bad name precisely', () => {
    expect(validateVariableName('')).toBe('A variable name is required, e.g. rows.');
    expect(validateVariableName('2rows')).toBe('"2rows" starts with a digit; a variable name must start with a letter, _ or $.');
    expect(validateVariableName('my rows')).toBe('"my rows" contains " "; a variable name may only use letters, digits, _ and $ (ASCII).');
    expect(validateVariableName('a-b')).toBe('"a-b" contains "-"; a variable name may only use letters, digits, _ and $ (ASCII).');
    expect(validateVariableName('café')).toBe('"café" contains "é"; a variable name may only use letters, digits, _ and $ (ASCII).');
    expect(validateVariableName('class')).toBe('"class" is a reserved word in JavaScript; pick another name, e.g. rows.');
    expect(validateVariableName('undefined')).toBe('"undefined" is a built-in global; binding data to it would break code that relies on it.');
    expect(validateVariableName('fetch')).toBe(
      '"fetch" is masked inside generated functions (it is a purity trap), so data bound to it could not be read there.',
    );
  });

  it.each(['let', 'static', 'yield', 'await', 'enum', 'implements', 'arguments', 'null', 'true', 'this', 'import'])(
    'reserved: %j',
    (n) => {
      expect(validateVariableName(n)).toMatch(/reserved word/);
    },
  );

  it.each(['undefined', 'NaN', 'Infinity', 'eval', 'Function'])('special global: %j', (n) => {
    expect(validateVariableName(n)).toMatch(/built-in global/);
  });

  it('rejects every masked name', () => {
    expect(MASKED_NAMES.length).toBeGreaterThan(5);
    for (const n of MASKED_NAMES) expect(validateVariableName(n)).not.toBeNull();
    expect(validateVariableName('Math')).toMatch(/masked/);
    expect(validateVariableName('Date')).toMatch(/masked/);
  });
});
