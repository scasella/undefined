/**
 * Hash stability of the shipped examples and recordings (docs/DECIDE-DESIGN.md §1.3, §5.2).
 *
 * The literals below were captured from the build BEFORE decisions existed. A spec with no decisions (field absent,
 * or an empty list) must hash byte-identically to them, and every shipped recording's sessions must still hash to the
 * keys their candidates were recorded under, or replay breaks.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateSeed, hashesFor } from '@scasella/undefined-engine/shared/hash';
import { EXAMPLES } from '../examples';
import type { FunctionSpec, Recording } from '@scasella/undefined-engine/types';

const BASELINE: Record<string, { specHash: string; testsHash: string }> = {
  median: {
    specHash: '9d21d9cd048e1f37bd1b66a8272fed6d43125c400567e0b85843f4900a6a24a2',
    testsHash: '881ef16eef654298b4037ca2d4f9f3a1e40e1c8ea969a0d66565a58c221a5d8d',
  },
  slugify: {
    specHash: '2d848df5ebee80255d492e05ca463020f33c5e5ba80e92f1dee45d7aedb4d21d',
    testsHash: 'cf8bd1662e3e2c361e4b75d6bff4f5e3b3c5d8409402b511881502be3fd912c5',
  },
  fibonacci: {
    specHash: 'e924f6c85db985bfcb1600fb51a4ceee134da6c758a15e6f6f8aeaa49cc374cf',
    testsHash: 'd137719dcacdc53d681b95f2a45185c8b05acb2c0f375007d96dea81ee3044aa',
  },
};

/**
 * Every session of every shipped recording: fn, specHash, testsHash, as captured before decisions existed.
 * orders-agreement.json was recorded live later (2026-10-06); its spec carries no decisions either, so its keys are
 * pinned the same way.
 */
const RECORDED: Record<string, Array<[string, string, string]>> = {
  'fibonacci.json': [
    ['fibonacci', 'e924f6c85db985bfcb1600fb51a4ceee134da6c758a15e6f6f8aeaa49cc374cf', 'd137719dcacdc53d681b95f2a45185c8b05acb2c0f375007d96dea81ee3044aa'],
    ['fibonacci', '47aaf0816654f88d08c00b11459334869a55ee9958e07fe855634a40ec85f9e4', 'e34d5f4fab234e8fb65f020f15ed28c52c6688f335a5afdc98bd82dec25dc49a'],
  ],
  'median.json': [
    ['median', '9d21d9cd048e1f37bd1b66a8272fed6d43125c400567e0b85843f4900a6a24a2', '881ef16eef654298b4037ca2d4f9f3a1e40e1c8ea969a0d66565a58c221a5d8d'],
    ['median', '9cb6dee85e922117e424b73fc68c981a06635f09ecb183bb51a6398da04dff41', 'dd56ea479a256ac251195581954e02a2852f75e54298ea00ffa3fc034a1dd0f5'],
  ],
  'orders-draft.json': [
    ['revenueByCountry', '3f1f18c06cd6118585582af3f902839b878f9ac0dad7d4e0c855303f138e638b', '94851f5cc3215c391442855a364cf332a9994495afab291063cba83148a41118'],
  ],
  'orders-agreement.json': [
    ['topCustomersByRevenue', 'd6e81acb638ab7a2017497ebe43a5d95980709238c4f83d1e1dbd3b39a7e746c', '5c934788236ad017fe4438b4a7ab60e62ef68d038382d8787dc35c5372b3d025'],
  ],
  'orders.json': [
    ['topCustomersByRevenue', '0dde492c94d5235dee52fc81ffcc959cc8cb6743d38c939d53e22317ac937257', '439083f38956ba51ece90631552c6ea23c5c29570d3d5710e408e77e01ba7375'],
    ['topCustomersByRevenue', '70ac5a53e0542e00963707a1a0f6d806955592f4b8c79d158393331c34506d3d', '439083f38956ba51ece90631552c6ea23c5c29570d3d5710e408e77e01ba7375'],
  ],
  'slugify.json': [
    ['slugify', '2d848df5ebee80255d492e05ca463020f33c5e5ba80e92f1dee45d7aedb4d21d', 'cf8bd1662e3e2c361e4b75d6bff4f5e3b3c5d8409402b511881502be3fd912c5'],
    ['slugify', '91917d16f54a4c9d75e5a6aada5aa454d14344939dd9dc51eb64d4bd66ed32fc', 'fdffdadbb2ba14a4d80c9a67ec5c1031a93a4473885c08f8eb6bf3f6bbb9d52c'],
  ],
};

const DIR = join(import.meta.dirname, '..', '..', 'public', 'recordings');

describe('hash stability: zero decisions hash exactly as before', () => {
  for (const [id, expected] of Object.entries(BASELINE)) {
    it(`${id}: the example spec hashes to the captured values, with or without an empty decisions list`, async () => {
      const spec = EXAMPLES.find((e) => e.id === id)!.spec!;
      expect(spec.decisions).toBeUndefined();
      expect(await hashesFor(spec)).toEqual(expected);
      expect(await hashesFor({ ...spec, decisions: [] } as FunctionSpec)).toEqual(expected);
      expect(gateSeed(expected.specHash, expected.testsHash)).toBe(gateSeed((await hashesFor(spec)).specHash, (await hashesFor(spec)).testsHash));
    });
  }

  it('the shipped recordings are the ones captured, and each session spec hashes to its recorded key', async () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
    expect(files).toEqual(Object.keys(RECORDED).sort());
    for (const f of files) {
      const rec = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Recording;
      expect(rec.version, `${f} stays a version 2 recording`).toBe(2);
      expect(rec.sessions.map((s) => [s.fn, s.specHash, s.testsHash]), f).toEqual(RECORDED[f]);
      for (const s of rec.sessions) {
        expect(s.spec, `${f}: ${s.label}`).toBeDefined();
        expect((s.spec as FunctionSpec).decisions).toBeUndefined();
        expect(await hashesFor(s.spec!), `${f}: ${s.label}`).toEqual({ specHash: s.specHash, testsHash: s.testsHash });
      }
    }
  });

  it('each example opens on the first session of its recording', async () => {
    for (const id of Object.keys(BASELINE)) {
      const rec = JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')) as Recording;
      const s0 = rec.sessions[0]!;
      expect({ specHash: s0.specHash, testsHash: s0.testsHash }).toEqual(BASELINE[id]);
    }
  });
});
