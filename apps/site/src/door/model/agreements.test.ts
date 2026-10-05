/**
 * Proves the seeded agreement with the REAL compile gate and the REAL gate executor (as examples.test.ts does): a
 * correct body passes every check, and each wrong body is thrown out by the check whose words describe its mistake.
 *
 * Pins are decoded exactly as the engine's decodePins does (dataset argument → the bound rows, expected →
 * decodeValue). Property headlines carry a seed-dependent shrunk counterexample, so for the house rules only the
 * rejecting gate and the check's name are asserted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatasetRef, FunctionSpec, GateId, GateResult } from '@scasella/undefined-engine/types';
import { GATE_ORDER } from '@scasella/undefined-engine/types';
import { compileCandidate, transpileUserCode, warmUp } from '@scasella/undefined-engine/gates/compile';
import { executeGates, type ExecGateInput } from '@scasella/undefined-engine/sandbox/gateExecutor';
import { evalMasked } from '@scasella/undefined-engine/sandbox/mask';
import { decodeValue } from '@scasella/undefined-engine/shared/serialize';
import { gateSeed, hashesFor } from '@scasella/undefined-engine/shared/hash';
import { listTestNames } from '@scasella/undefined-engine/shared/specInfo';
import { buildDataset } from '../../data/dataset';
import { parseCsv } from '../../data/csv';
import { coerceCsvRows } from '../../data/infer';
import { BUNDLED_ORDERS_CSV } from '../../data/orders';
import { AGREEMENT_FN, HOUSE_RULES, lockedTop5, MADE_UP_TABLES, SEEDED_PINNED_AT, seedAgreement } from './agreements';

// exactly what the engine binds for the orders sample
const rows = coerceCsvRows(parseCsv(BUNDLED_ORDERS_CSV()).rows).rows;
let dataset: DatasetRef;
let spec: FunctionSpec;

interface Verdict {
  gates: GateResult[];
  rejectedBy?: GateId;
  headline?: string;
  /** name of the rejecting check (first diagnostic) */
  check?: string;
  js: string | null;
}

function userJs(src: string): string {
  const out = transpileUserCode(src);
  expect(out.error, `spec source does not transpile: ${out.error}`).toBeUndefined();
  return out.js;
}

/** engine.ts decodePins: dataset args resolved to the stored rows by hash, expected decoded. */
function decodePins(s: FunctionSpec): NonNullable<ExecGateInput['pinned']> {
  return (s.pins ?? []).map((pin) => ({
    label: pin.label,
    args: pin.args.map((a) => {
      if (a.kind === 'dataset') {
        expect(a.hash).toBe(dataset.hash);
        return rows;
      }
      return decodeValue(a.encoded);
    }),
    expected: decodeValue(pin.expected),
  }));
}

async function runGates(s: FunctionSpec, body: string): Promise<Verdict> {
  const compiled = await compileCandidate(s, body);
  if (compiled.gate.status === 'fail' || compiled.js === null) {
    return { gates: [compiled.gate], rejectedBy: 'compile', headline: compiled.gate.headline, js: null };
  }
  const { specHash, testsHash } = await hashesFor(s);
  const pinned = decodePins(s);
  const input: ExecGateInput = {
    name: s.name,
    js: compiled.js,
    testsJs: userJs(s.tests),
    propertiesJs: userJs(s.properties),
    budgetMs: s.budgetMs,
    seed: gateSeed(specHash, testsHash),
    callArgs: [rows],
    ...(pinned.length ? { pinned } : {}),
  };
  const exec = executeGates(input, { phase: () => {}, enter: () => {}, leave: () => {} });
  const gates = [compiled.gate, ...exec];
  const failed = gates.find((g) => g.status === 'fail');
  const d = failed?.diagnostics[0];
  return { gates, rejectedBy: failed?.gate, headline: failed?.headline, check: d && 'name' in d ? String(d.name) : undefined, js: compiled.js };
}

const statuses = (gs: GateResult[]): string[] => gs.map((g) => `${g.gate}:${g.status}`);
const withoutPins = (s: FunctionSpec): FunctionSpec => {
  const { pins: _pins, ...rest } = s;
  return rest;
};
const printed: string[] = [];

// ───────── bodies ─────────

const SORT = `.map(([customer, revenue]) => ({ customer, revenue: Math.round(revenue * 100) / 100 }))
  .sort((a, b) => b.revenue - a.revenue || (a.customer < b.customer ? -1 : a.customer > b.customer ? 1 : 0))
  .slice(0, 5);`;

/** Paid only, each order number once (first row), discount, cents, alphabetical ties, top 5. Never touches `rows`. */
const GOOD = `const seen = new Set<number>();
const totals = new Map<string, number>();
for (const r of rows) {
  if (seen.has(r.id)) continue;
  seen.add(r.id);
  if (r.status !== 'paid') continue;
  totals.set(r.customer, (totals.get(r.customer) ?? 0) + r.quantity * r.unitPrice * (1 - (r.discount ?? 0)));
}
return [...totals]
  ${SORT}`;

/** Same contract, written differently: filter, then dedupe, localeCompare ties. */
const GOOD_2 = `const firstRows = rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i);
const totals: Record<string, number> = {};
for (const r of firstRows.filter((r) => r.status === 'paid')) {
  totals[r.customer] = (totals[r.customer] ?? 0) + r.quantity * r.unitPrice * (1 - (r.discount ?? 0));
}
return Object.entries(totals)
  .map(([customer, revenue]) => ({ customer, revenue: Math.round(revenue * 100) / 100 }))
  .sort((a, b) => b.revenue - a.revenue || a.customer.localeCompare(b.customer))
  .slice(0, 5);`;

const loop = (opts: { paid?: string; once?: boolean; line?: string; key?: string }) => `const seen = new Set<number>();
const totals = new Map<string, number>();
for (const r of rows) {
  ${opts.once === false ? '' : 'if (seen.has(r.id)) continue;\n  seen.add(r.id);'}
  ${opts.paid ?? "if (r.status !== 'paid') continue;"}
  const key = ${opts.key ?? 'r.customer'};
  totals.set(key, (totals.get(key) ?? 0) + ${opts.line ?? 'r.quantity * r.unitPrice * (1 - (r.discount ?? 0))'});
}`;

const BAD: Array<{ id: string; body: string; rejectedBy: GateId; check: string; withoutPins?: { rejectedBy: GateId; check: string } }> = [
  {
    id: 'counts refunded orders',
    body: `${loop({ paid: '' })}
return [...totals]
  ${SORT}`,
    rejectedBy: 'tests',
    check: `pinned: ${AGREEMENT_FN}(orders)`,
    withoutPins: { rejectedBy: 'properties', check: HOUSE_RULES[0]!.name },
  },
  {
    id: 'counts pending orders (skips refunds only)',
    body: `${loop({ paid: "if (r.status === 'refunded') continue;" })}
return [...totals]
  ${SORT}`,
    rejectedBy: 'tests',
    check: `pinned: ${AGREEMENT_FN}(orders)`,
    withoutPins: { rejectedBy: 'properties', check: HOUSE_RULES[0]!.name },
  },
  {
    id: 'double-counts repeated order numbers',
    body: `${loop({ once: false })}
return [...totals]
  ${SORT}`,
    rejectedBy: 'tests',
    check: `pinned: ${AGREEMENT_FN}(orders)`,
    withoutPins: { rejectedBy: 'properties', check: HOUSE_RULES[1]!.name },
  },
  {
    id: 'ignores discounts',
    body: `${loop({ line: 'r.quantity * r.unitPrice' })}
return [...totals]
  ${SORT}`,
    rejectedBy: 'tests',
    check: 'A 25% discount on 4 × $5.00 gives $15.00',
  },
  {
    id: 'wrong tie order (keeps file order)',
    body: `${loop({})}
return [...totals]
  .map(([customer, revenue]) => ({ customer, revenue: Math.round(revenue * 100) / 100 }))
  .sort((a, b) => b.revenue - a.revenue)
  .slice(0, 5);`,
    rejectedBy: 'tests',
    check: 'Two customers tied at $50.00 are listed A to Z',
  },
  {
    id: 'top 4 instead of 5',
    body: `${loop({})}
return [...totals]
  .map(([customer, revenue]) => ({ customer, revenue: Math.round(revenue * 100) / 100 }))
  .sort((a, b) => b.revenue - a.revenue || (a.customer < b.customer ? -1 : a.customer > b.customer ? 1 : 0))
  .slice(0, 4);`,
    rejectedBy: 'tests',
    check: 'Seven customers: only the top 5 come back',
  },
  {
    id: 'one line per customer and country',
    body: `${loop({ key: "r.customer + '|' + r.country" })}
return [...totals]
  .map(([key, revenue]) => ({ customer: key.split('|')[0]!, revenue: Math.round(revenue * 100) / 100 }))
  .sort((a, b) => b.revenue - a.revenue || (a.customer < b.customer ? -1 : a.customer > b.customer ? 1 : 0))
  .slice(0, 5);`,
    rejectedBy: 'tests',
    check: 'One customer in two countries is one line',
  },
  {
    id: 'every row counted (the AI\'s first assumption)',
    body: `${loop({ paid: '', once: false })}
return [...totals]
  ${SORT}`,
    rejectedBy: 'tests',
    check: `pinned: ${AGREEMENT_FN}(orders)`,
  },
];

// ───────── tests ─────────

beforeAll(async () => {
  await warmUp();
  const built = await buildDataset('orders', rows, { source: 'bundled', filename: 'orders.csv' });
  if (!('ref' in built)) throw new Error(built.message);
  dataset = built.ref;
  spec = seedAgreement('orders', 'top', dataset)!.spec;
}, 60_000);

afterAll(() => {
  console.log(`\nSeeded agreement rejection headlines:\n${printed.join('\n')}\n`);
});

describe('seedAgreement', () => {
  it('exists only for orders.csv · top customers by revenue', () => {
    expect(seedAgreement('orders', 'top', dataset)).not.toBeNull();
    for (const [s, q] of [['orders', 'status'], ['orders', 'country'], ['sales', 'top'], ['sales', 'region'], [null, 'top']] as const) {
      expect(seedAgreement(s, q, dataset), `${s}/${q}`).toBeNull();
    }
    // a file without the columns it needs gets none
    expect(seedAgreement('orders', 'top', { ...dataset, columns: dataset.columns.filter((c) => c.name !== 'discount') })).toBeNull();
  });

  it('is a well-formed spec over the bound dataset type, deterministic (no clock)', async () => {
    const a = seedAgreement('orders', 'top', dataset)!;
    expect(a.spec).toMatchObject({
      name: AGREEMENT_FN,
      params: [{ name: 'rows', type: 'Row[]' }],
      returns: 'Array<{ customer: string; revenue: number }>',
      origin: 'user',
      typeDecls: dataset.typeDecl,
      maxAttempts: 3,
    });
    expect(a.pins).toBe(a.spec.pins);
    expect(a.pins).toHaveLength(1);
    expect(a.pins[0]).toMatchObject({ label: 'topCustomersByRevenue(orders)', args: [{ kind: 'dataset', name: 'orders', hash: dataset.hash }], pinnedAt: SEEDED_PINNED_AT });
    expect(decodeValue(a.pins[0]!.expected)).toEqual(lockedTop5());
    expect(lockedTop5()).toEqual([
      { customer: 'Chef Ravioli Starbright', revenue: 2252.07 },
      { customer: 'Grommet & Gasket LLC', revenue: 2148.72 },
      { customer: 'Puddlesworth Inc', revenue: 2114.13 },
      { customer: 'Thistlewhump Bakery', revenue: 1909.9 },
      { customer: 'Kettlewhistle Farms', revenue: 1870.33 },
    ]);
    const again = seedAgreement('orders', 'top', dataset)!;
    expect(again).toEqual(a);
    expect(await hashesFor(again.spec)).toEqual(await hashesFor(a.spec));
    expect(a.spec.doc).toContain('"paid"');
    expect(a.spec.doc).toContain('quantity × unitPrice × (1 − discount)');
    expect(a.spec.doc).toContain('only its first row counts');
    expect(a.spec.doc).toContain('alphabetical');
  });

  it('6 examples and 2 house rules, named in the design\'s words; 100 made-up tables each', () => {
    expect(listTestNames(spec.tests)).toEqual([
      'One order of 2 × $10.00 gives $20.00',
      'A 25% discount on 4 × $5.00 gives $15.00',
      'Two customers tied at $50.00 are listed A to Z',
      'Seven customers: only the top 5 come back',
      'An empty file gives an empty list',
      'One customer in two countries is one line',
    ]);
    expect(listTestNames(spec.properties)).toEqual(['Revenue counts paid orders only', 'Each order number is counted once']);
    expect(MADE_UP_TABLES).toBe(100);
    expect(spec.properties.match(/numRuns: 100/g)).toHaveLength(2);
  });

  it('the summary the rail shows', () => {
    const { summary } = seedAgreement('orders', 'top', dataset)!;
    expect(summary.countLine).toBe('6 examples · 1 locked answer · 2 house rules');
    expect(summary.tables).toBe(100);
    expect(summary.examples.map((e) => `${e.name} | ${e.note}`)).toEqual([
      'One order of 2 × $10.00 gives $20.00 | made-up · 1 row · you · 4 Oct 2026',
      'A 25% discount on 4 × $5.00 gives $15.00 | made-up · 1 row · you · 4 Oct 2026',
      'Two customers tied at $50.00 are listed A to Z | made-up · 2 rows · you · 4 Oct 2026',
      'Seven customers: only the top 5 come back | made-up · 7 rows · you · 4 Oct 2026',
      'An empty file gives an empty list | made-up · 0 rows · you · 4 Oct 2026',
      'One customer in two countries is one line | made-up · 2 rows · you · 4 Oct 2026',
    ]);
    expect(summary.locked).toHaveLength(1);
    expect(summary.locked[0]).toMatchObject({
      name: 'Chef Ravioli Starbright = $2,252.07',
      note: 'Locked · you · 5 Oct 2026',
      amount: '$2,252.07',
      call: 'topCustomersByRevenue(orders)',
    });
    expect(summary.houseRules.map((h) => `${h.name} | ${h.note}`)).toEqual([
      "Revenue counts paid orders only | you · 5 Oct 2026 · Why: refunds and pending orders aren't revenue yet",
      'Each order number is counted once | you · 5 Oct 2026 · Why: the export repeats some orders',
    ]);
  });
});

describe('the gates hold the agreement', () => {
  it('accepts correct bodies with zero failures, and they give the locked answer on the real rows', async () => {
    for (const body of [GOOD, GOOD_2]) {
      const v = await runGates(spec, body);
      expect(statuses(v.gates), `${v.headline}\n${body}`).toEqual(GATE_ORDER.map((g) => `${g}:pass`));
      expect(v.gates[1]!.summary).toBe('6 unit tests + 1 pinned passed');
      expect(v.gates[2]!.summary).toMatch(/^2\/2 properties held \(200 runs/);
      const fn = evalMasked<(r: unknown[]) => unknown>(v.js!, AGREEMENT_FN);
      expect(fn(structuredClone(rows))).toEqual(lockedTop5());
    }
  }, 60_000);

  for (const bad of BAD) {
    it(`rejects: ${bad.id}`, async () => {
      const v = await runGates(spec, bad.body);
      expect(v.rejectedBy, `${bad.id}: ${statuses(v.gates).join(' ')} ${v.headline ?? ''}`).toBe(bad.rejectedBy);
      expect(v.check).toBe(bad.check);
      expect(v.headline).toMatch(/^Rejected: /);
      expect(v.gates.filter((g) => g.status === 'fail').map((g) => g.gate)).toEqual([bad.rejectedBy]);
      printed.push(`  ${bad.id.padEnd(44)} ${bad.rejectedBy.padEnd(10)} ${v.headline}`);
      if (bad.withoutPins) {
        const w = await runGates(withoutPins(spec), bad.body);
        expect(w.rejectedBy, `${bad.id} (no locked answer): ${statuses(w.gates).join(' ')}`).toBe(bad.withoutPins.rejectedBy);
        expect(w.check).toBe(bad.withoutPins.check);
        printed.push(`  ${(bad.id + ' (no locked answer)').padEnd(44)} ${w.rejectedBy!.padEnd(10)} ${w.headline}`);
      }
    }, 60_000);
  }

  it("the locked answer catches the AI's first assumption: Puddlesworth Inc $2,599.13 instead of Chef Ravioli Starbright $2,252.07", async () => {
    const everyRow = BAD.find((b) => b.id.startsWith('every row counted'))!;
    const v = await runGates(spec, everyRow.body);
    expect(v.headline).toMatch(/^Rejected: topCustomersByRevenue\(orders\) returned \[\{ customer: "Puddlesworth Inc", revenue: 2599\.13 \}/);
    expect(v.headline).toContain('expected [{ customer: "Chef Ravioli Starbright", revenue: 2252.07 }');
  }, 60_000);

  it('the landing\'s Draft 1 (counts refunded orders) is thrown out by the locked answer: Chef Ravioli Starbright $2,260.06', async () => {
    const draft1 = BAD.find((b) => b.id === 'counts refunded orders')!;
    const v = await runGates(spec, draft1.body);
    expect(v.check).toBe(`pinned: ${AGREEMENT_FN}(orders)`);
    expect(v.headline).toContain('expected [{ customer: "Chef Ravioli Starbright", revenue: 2252.07 }');
    // what the draft actually returned on the real rows (the headline is cut before Chef's line)
    const compiled = await compileCandidate(spec, draft1.body);
    const got = evalMasked<(r: unknown[]) => Array<{ customer: string; revenue: number }>>(compiled.js!, AGREEMENT_FN)(structuredClone(rows));
    expect(got.find((r) => r.customer === 'Chef Ravioli Starbright')).toEqual({ customer: 'Chef Ravioli Starbright', revenue: 2260.06 });
  }, 60_000);
});
