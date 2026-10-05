import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FunctionSpec } from '../types';
import { gateSeed, hashesFor, sha256Hex, specHash, testsHash } from './hash';

const base: FunctionSpec = {
  name: 'median',
  params: [{ name: 'numbers', type: 'number[]' }],
  returns: 'number',
  doc: 'The median of a non-empty list.',
  tests: 'test("one", () => eq(median([1]), 1));',
  properties: '',
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'example',
  exampleId: 'median',
};

describe('sha256Hex', () => {
  it('matches known vectors', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes the UTF-8 bytes (agrees with node:crypto)', async () => {
    for (const s of ['Crème Brûlée', '😀', 'a\u0000b']) {
      expect(await sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
});

describe('specHash / testsHash', () => {
  it('ignore retry budget and provenance', async () => {
    const h = await hashesFor(base);
    const variants: FunctionSpec[] = [
      { ...base, maxAttempts: 9 },
      { ...base, origin: 'user' },
      { ...base, exampleId: undefined },
      { ...base, params: [{ name: 'numbers', type: 'number[]', extra: 1 } as FunctionSpec['params'][number]] },
    ];
    for (const v of variants) expect(await hashesFor(v)).toEqual(h);
  });

  it('specHash covers name, params, returns, doc, budgetMs — and testsHash does not', async () => {
    const h = await hashesFor(base);
    const variants: FunctionSpec[] = [
      { ...base, name: 'mean' },
      { ...base, params: [{ name: 'xs', type: 'number[]' }] },
      { ...base, params: [{ name: 'numbers', type: 'readonly number[]' }] },
      { ...base, params: [] },
      { ...base, returns: null },
      { ...base, returns: 'number | null' },
      { ...base, doc: base.doc + ' ' },
      { ...base, budgetMs: 1501 },
    ];
    const seen = new Set([h.specHash]);
    for (const v of variants) {
      const hv = await hashesFor(v);
      expect(hv.testsHash).toBe(h.testsHash);
      expect(seen.has(hv.specHash)).toBe(false);
      seen.add(hv.specHash);
    }
  });

  it('testsHash covers tests and properties — and specHash does not', async () => {
    const h = await hashesFor(base);
    for (const v of [{ ...base, tests: '' }, { ...base, properties: 'property("p", [], () => true);' }]) {
      const hv = await hashesFor(v);
      expect(hv.specHash).toBe(h.specHash);
      expect(hv.testsHash).not.toBe(h.testsHash);
    }
    // moving text between tests and properties is a different spec
    expect(await testsHash({ ...base, tests: 'a', properties: '' })).not.toBe(await testsHash({ ...base, tests: '', properties: 'a' }));
  });

  it('is exactly sha256 of the documented JSON', async () => {
    expect(await specHash(base)).toBe(
      await sha256Hex(JSON.stringify(['median', [['numbers', 'number[]']], 'number', base.doc, 1500])),
    );
    expect(await testsHash(base)).toBe(await sha256Hex(JSON.stringify([base.tests, ''])));
  });
});

describe('typeDecls and pins', () => {
  // Frozen from the implementation BEFORE typeDecls existed: these must never change.
  it('a spec without typeDecls hashes exactly as before (frozen values)', async () => {
    expect(await hashesFor(base)).toEqual({
      specHash: 'd0115347a595cef2d2876f879ca67bcd4d84ef37ecbbd6e9cd7e19f8afecfa54',
      testsHash: '017e660283124a7fc1247f1c4a3db635b32c903471478d2cbfdba75a828481cc',
    });
    const callSpec: FunctionSpec = { ...base, returns: null, params: [{ name: 'arg0', type: 'Row[]' }], doc: '', tests: '', budgetMs: 1000 };
    const frozen = {
      specHash: '5fbaece3a14deb2dea24775553ac308a499ca49e83de3a335fd63c712e9a9753',
      testsHash: '439083f38956ba51ece90631552c6ea23c5c29570d3d5710e408e77e01ba7375',
    };
    expect(await hashesFor(callSpec)).toEqual(frozen);
    // an empty typeDecls is the same as none
    expect(await hashesFor({ ...callSpec, typeDecls: '' })).toEqual(frozen);
  });

  it('a non-empty typeDecls changes specHash only', async () => {
    const h = await hashesFor(base);
    const a = await hashesFor({ ...base, typeDecls: 'type Row = { a: number }' });
    const b = await hashesFor({ ...base, typeDecls: 'type Row = { a: string }' });
    expect(a.testsHash).toBe(h.testsHash);
    expect(a.specHash).not.toBe(h.specHash);
    expect(b.specHash).not.toBe(a.specHash);
    expect(a.specHash).toBe(
      await sha256Hex(JSON.stringify(['median', [['numbers', 'number[]']], 'number', base.doc, 1500, 'type Row = { a: number }'])),
    );
  });

  it('pins are outside both hashes', async () => {
    const h = await hashesFor(base);
    const pinned: FunctionSpec = {
      ...base,
      pins: [{ id: 'p1', label: 'median([1, 2])', args: [{ kind: 'value', encoded: [1, 2] }], expected: 1.5, pinnedAt: 1 }],
    };
    expect(await hashesFor(pinned)).toEqual(h);
  });
});

describe('gateSeed', () => {
  it('xors the first 32 bits into an int32', () => {
    expect(gateSeed('00000001' + 'f'.repeat(56), '00000003' + '0'.repeat(56))).toBe(2);
    expect(gateSeed('ffffffff', '00000000')).toBe(-1);
    expect(gateSeed('80000000', '00000000')).toBe(-2147483648);
  });

  it('is deterministic for real hashes', async () => {
    const { specHash: s, testsHash: t } = await hashesFor(base);
    const seed = gateSeed(s, t);
    expect(seed | 0).toBe(seed);
    expect(gateSeed(s, t)).toBe(seed);
  });
});
