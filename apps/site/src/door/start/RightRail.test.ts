/** seedShown: the "This agreement comes with the demo file." line shows only for the installed, untouched seed. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DatasetRef, FunctionSpec, Program } from '@scasella/undefined-engine/types';
import { buildDataset } from '../../data/dataset';
import { parseCsv } from '../../data/csv';
import { coerceCsvRows } from '../../data/infer';
import { BUNDLED_ORDERS_CSV } from '../../data/orders';
import { emptyAgreement } from '../model/agreement';
import { seedAgreement } from '../model/agreements';
import { agreementFor } from './derive';
import { seedDressed, seedShown } from './RightRail';

let dataset: DatasetRef;
let seed: FunctionSpec;
let summary: NonNullable<ReturnType<typeof seedAgreement>>['summary'];

const EMPTY: Program = { functions: {} } as unknown as Program;
const withFn = (spec: FunctionSpec): Program => ({ ...EMPTY, functions: { [spec.name]: { spec, specHash: 'h', testsHash: 't', artifact: null } } }) as Program;

beforeAll(async () => {
  const rows = coerceCsvRows(parseCsv(BUNDLED_ORDERS_CSV()).rows).rows;
  const built = await buildDataset('orders', rows, { source: 'bundled', filename: 'orders.csv' });
  if (!('ref' in built)) throw new Error(built.message);
  dataset = built.ref;
  const sa = seedAgreement('orders', 'top', dataset)!;
  seed = sa.spec;
  summary = sa.summary;
}, 60_000);

describe('seedShown', () => {
  it('shows for the installed, untouched seed', () => {
    const program = withFn(seed);
    const view = agreementFor(program, seed.name, null, true);
    expect(seedShown({ view, seed, seedState: 'installed', program })).toBe(true);
  });

  it('hides while the seed is only a preview, or failed to install', () => {
    const view = agreementFor(EMPTY, seed.name, seed, true);
    expect(view.seeded).toBe(true);
    for (const seedState of ['none', 'installing', 'failed'] as const) expect(seedShown({ view, seed, seedState, program: EMPTY })).toBe(false);
  });

  it('hides with no seed (own file, other questions, seed off) and for an empty agreement', () => {
    const program = withFn(seed);
    const view = agreementFor(program, seed.name, null, true);
    expect(seedShown({ view, seed: null, seedState: 'installed', program })).toBe(false);
    expect(seedShown({ view: emptyAgreement(), seed, seedState: 'installed', program })).toBe(false);
  });

  it('hides once the locked answer is unlocked', () => {
    const program = withFn({ ...seed, pins: [] });
    const view = agreementFor(program, seed.name, null, true);
    expect(seedShown({ view, seed, seedState: 'installed', program })).toBe(false);
  });

  it('hides once a house rule or example is added', () => {
    const program = withFn({ ...seed, tests: seed.tests + '\ntest("one more", () => {});' });
    const view = agreementFor(program, seed.name, null, true);
    const pristine = agreementFor(withFn(seed), seed.name, null, true);
    expect(view.counts).not.toBe(pristine.counts);
    expect(seedShown({ view, seed, seedState: 'installed', program })).toBe(false);
  });
});

describe('seedDressed', () => {
  it("puts the seed's chips in the design's words, keeping the pin's real meta", () => {
    const view = agreementFor(withFn(seed), seed.name, null, true);
    // the real chip already reads in the design's words (model/agreement.ts pinLead); dressing keeps it
    expect(view.locks[0]!.t).toBe('Chef Ravioli Starbright = $2,252.07');
    const d = seedDressed(view, summary);
    expect(d.seeded).toBe(true);
    expect(d.counts).toBe(view.counts);
    expect(d.locks).toHaveLength(1);
    expect(d.locks[0]!.t).toBe('Chef Ravioli Starbright = $2,252.07');
    expect(d.locks[0]!.p).toBe(view.locks[0]!.p);
    expect(d.rules.map((r) => r.t)).toEqual(['Revenue counts paid orders only', 'Each order number is counted once']);
    for (const r of d.rules) expect(r.p).toMatch(/^you · .* · Why: /);
  });
});
