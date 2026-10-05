/** Pins the landing stage, computed from the real bundledOrders(), to the design's strings (V3-Door-Landing 97-384). */
import { describe, expect, it } from 'vitest';
import { bundledOrders } from '../../data/orders';
import { passScenario, passLanes, stopScenario } from '../model/traceScript';
import {
  buildStage,
  CALC_SOURCE,
  ghostNote,
  landingStage,
  PASS_META,
  settleSeconds,
  STAGE_ASSUMPTIONS,
  STAGE_NOT_CHECKED,
  stageScenario,
} from './stageData';

const rows = bundledOrders();
const s = buildStage(rows);

describe('stage figures (computed, not typed in)', () => {
  it('locks Chef Ravioli Starbright at $2,252.07', () => {
    expect(s.lock.name).toBe('Chef Ravioli Starbright');
    expect(s.lock.amount).toBe('$2,252.07');
  });

  it('answer card: the Fig. 1 caption, the lead and places 2 to 5', () => {
    const a = s.answer;
    expect(a.kind).toBe('ranked');
    expect(a.fig).toBe('Fig. 1 · Top 5 customers by revenue · paid orders only, each order number once · orders.csv · 332 rows · Version 3');
    expect(a.title).toBe('Top 5 customers by revenue');
    expect(a.lead).toEqual({ name: 'Chef Ravioli Starbright', num: '$2,252.07', unit: '', long: false });
    expect(a.rest.map((r) => [r.rank, r.name, r.amt, r.pct])).toEqual([
      ['02', 'Grommet & Gasket LLC', '$2,148.72', Number(((2148.72 / 2252.07) * 100).toFixed(1))],
      ['03', 'Puddlesworth Inc', '$2,114.13', Number(((2114.13 / 2252.07) * 100).toFixed(1))],
      ['04', 'Thistlewhump Bakery', '$1,909.90', Number(((1909.9 / 2252.07) * 100).toFixed(1))],
      ['05', 'Kettlewhistle Farms', '$1,870.33', Number(((1870.33 / 2252.07) * 100).toFixed(1))],
    ]);
    expect(a.places).toBe(5);
    expect(a.hiddenRows).toBe(0);
  });

  it('ghost note: the thrown-out first draft, verbatim', () => {
    const text = ghostNote(rows).map((x) => x.text).join('');
    expect(text).toBe(
      "First draft thrown out: it didn't match an answer you locked. Chef Ravioli Starbright: expected $2,252.07, got $2,260.06. The draft counted a refunded order. Checks 04 to 06 never ran: a draft stops at its first failure.",
    );
    expect(ghostNote(rows).filter((x) => x.mono).map((x) => x.text)).toEqual(['$2,252.07', '$2,260.06']);
    expect(s.views.pass.ghost?.note).toEqual(ghostNote(rows));
    expect(s.views.stop.ghost).toBeNull();
  });

  it('lane 03 carries the computed lock in both scenarios', () => {
    for (const id of ['pass', 'stop'] as const) {
      const l = s.scenarios[id].lanes.find((x) => x.num === '03')!;
      expect(l.label).toBe('Matches your locked answer · Chef Ravioli Starbright = $2,252.07');
      expect(s.views[id].lanes[2]!.label).toBe(l.label);
    }
  });

  it('checked / not checked lists', () => {
    expect(s.checked).toEqual([
      'your 6 examples',
      'your locked answer (Chef Ravioli Starbright = $2,252.07)',
      'your 2 house rules on 100 made-up tables',
      '12-way stress test (11 caught)',
      'never changes your data',
      'finishes fast',
    ]);
    expect(STAGE_NOT_CHECKED).toEqual(['whether orders.csv is the complete export', 'whether revenue should include tax or shipping', 'whether this was the right question']);
    expect(STAGE_ASSUMPTIONS.items.map((a) => a.text)).toEqual([
      'Revenue = quantity × unit price, after discount.',
      'Top 5 by revenue. Ties are listed in alphabetical order.',
      'Customers are grouped by name exactly as written in the file.',
    ]);
  });

  it('agreement rail: the computed lock, 6 · 1 · 2', () => {
    const g = s.agreement;
    expect(g.counts).toBe('6 examples · 1 locked answer · 2 house rules');
    expect(g.locks[0]).toMatchObject({ label: 'Chef Ravioli Starbright', value: '$2,252.07', t: 'Chef Ravioli Starbright = $2,252.07' });
    expect(g.illustrative).toBe(true);
  });

  it('landingStage() is computed once', () => {
    expect(landingStage()).toBe(landingStage());
  });
});

describe('the playback is labelled an illustration', () => {
  it('pass: no claimed run time; meta says illustrative', () => {
    const v = s.views.pass;
    expect(v.footer.meta).toBe(PASS_META);
    expect(v.footer.meta).not.toMatch(/real run|0\.41/);
    expect(v.header.right).not.toMatch(/\d/);
    expect(v.header.verdict).toBe('Passed every check ↓ see the list');
    expect(v.draftLabel).toBe('DRAFT 2');
  });

  it('stop: keeps the design copy (it is true)', () => {
    const v = s.views.stop;
    expect(v.footer.meta).toBe('Nothing is shown until you decide');
    expect(v.header.right).toBe('paused · waiting on you');
    expect(v.draftLabel).toBe('DRAFT 1');
  });

  it('stageScenario never mutates the shared script', () => {
    const before = JSON.stringify(passScenario);
    stageScenario(passScenario, 'X = $1.00');
    expect(JSON.stringify(passScenario)).toBe(before);
    expect(passLanes[2]!.label).toBe(passScenario.lanes[2]!.label);
  });

  it('keeps the design timings', () => {
    expect(s.scenarios.pass.tEnd).toBe(6.7);
    expect(s.scenarios.pass.tRev).toBe(6.9);
    expect(s.scenarios.stop.tEnd).toBe(2.7);
    expect(s.scenarios.pass.lanes.map((l) => [l.start, l.dur])).toEqual(passScenario.lanes.map((l) => [l.start, l.dur]));
    expect(s.scenarios.stop.lanes.map((l) => [l.start, l.dur, l.st])).toEqual(stopScenario.lanes.map((l) => [l.start, l.dur, l.st]));
  });
});

describe('settleSeconds', () => {
  it('pass settles after the last answer row lands; stop after the mini question', () => {
    expect(settleSeconds(s.scenarios.pass)).toBeCloseTo(6.9 + 0.22 + 0.18 + 0.3, 5);
    expect(settleSeconds(s.scenarios.stop)).toBeCloseTo(3.04, 5);
  });
});

describe('calculation source', () => {
  it('is the design code, holding both house rules', () => {
    expect(CALC_SOURCE.split('\n')[0]).toBe('// Top customers by revenue · Version 3');
    expect(CALC_SOURCE).toContain('if (r.status !== "paid") continue;   // your rule: paid orders only');
    expect(CALC_SOURCE).toContain('.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))');
    expect(CALC_SOURCE.trimEnd().endsWith('}')).toBe(true);
  });
});
