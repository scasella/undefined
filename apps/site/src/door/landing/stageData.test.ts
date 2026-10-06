/** Pins the landing stage, computed from the real bundledOrders(), to the design's strings (V3-Door-Landing 97-384). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Recording } from '@scasella/undefined-engine/types';
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
  STAGE_SEAL,
  STAGE_VERSION,
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
    expect(a.fig).toBe('Fig. 1 · Top 5 customers by revenue · paid orders only, each order number once · orders.csv · 332 rows · Version 4');
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
    // the stress test's miss is in the list in the live answer's own words; the decisive line (the first) is unchanged
    expect(STAGE_NOT_CHECKED).toEqual([
      'whether orders.csv is the complete export',
      'whether revenue should include tax or shipping',
      'whether this was the right question',
      '1 of 12 deliberate breaks went unnoticed by your checks',
    ]);
    expect(s.checkedAsk).toEqual(['12-way stress test (11 caught)']);
    expect(STAGE_SEAL).toEqual({ text: 'Passed every check · stress test caught 11 of 12', ran: 5, of: 6, complete: true });
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
    // the seal reads what the live trace reads once its stress test has finished (numbers illustrative), after lane 06
    expect(v.header.verdict).toBe('Passed every check · stress test caught 11 of 12 ↓ see the list');
    expect(v.liveText).toBe('Passed every check · stress test caught 11 of 12. Showing the answer.');
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
    expect(CALC_SOURCE.split('\n')[0]).toBe('// Top customers by revenue · Version 4');
    expect(CALC_SOURCE.split('\n')[0]).toContain(`Version ${STAGE_VERSION}`);
    expect(CALC_SOURCE).toContain('if (r.status !== "paid") continue;   // your rule: paid orders only');
    expect(CALC_SOURCE).toContain('.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))');
    expect(CALC_SOURCE.trimEnd().endsWith('}')).toBe(true);
  });
});

describe('the example version is the one a real replay run commits', () => {
  it('replays the bundled recording through the real engine: the first answer is committed as STAGE_VERSION', async () => {
    const recording = JSON.parse(readFileSync(new URL('../../../public/recordings/orders-agreement.json', import.meta.url), 'utf8')) as Recording;
    const [{ createEngine }, { ReplayGenerator }, { warmUp }, { executeGates }, { Runtime }, { createDispatcher }, { _useBackend, memoryBackend }, { seedAgreement }, { sampleFile }] =
      await Promise.all([
        import('../../core/engine'),
        import('../../core/generator'),
        import('@scasella/undefined-engine/gates/compile'),
        import('@scasella/undefined-engine/sandbox/gateExecutor'),
        import('../../sandbox/runtime'),
        import('../../sandbox/replCore'),
        import('../../core/store'),
        import('../model/agreements'),
        import('../model/samples'),
      ]);
    await warmUp();
    _useBackend(memoryBackend());
    // the real replCore, in-process, delivered asynchronously like a Worker (as core/engine.test.ts does)
    const workerFactory = () => {
      let terminated = false;
      let listener: ((m: never) => void) | null = null;
      const dispatch = createDispatcher((m) => queueMicrotask(() => !terminated && listener?.(m as never)));
      return {
        postMessage: (req: never) => void setTimeout(() => !terminated && dispatch(req), 0),
        terminate: () => void (terminated = true),
        onMessage: (cb: (m: never) => void) => void (listener = cb),
        onError: () => undefined,
      };
    };
    let clock = Date.UTC(2026, 9, 5, 9, 0, 0);
    const memory = { last: null as string | null };
    const engine = createEngine({
      probeService: async () => ({ state: 'down' }),
      loadRecordings: async () => [recording],
      createReplayGenerator: (recs) => new ReplayGenerator(recs, { maxMs: 0 }),
      createRuntime: () => new Runtime({ callBudgetMs: 10_000, workerFactory: workerFactory as never }),
      execGates: (input, onGate) => Promise.resolve(executeGates(input, { phase() {}, enter() {}, leave() {}, ...(onGate ? { gate: onGate } : {}) })),
      now: () => (clock += 1000),
      sleep: async () => {},
      pacing: { typeCharMs: 0, gateDwellMs: 0, replayMaxMs: 0 },
      inputMemory: { load: () => memory.last, save: (t) => void (memory.last = t) },
      location: () => null,
    });
    try {
      await engine.init();
      expect(engine.state.value.mode).toBe('replay');
      // what the page does for "Top 5 customers by revenue" on the orders sample: bind it as `rows`, install the agreement, ask
      const f = sampleFile('orders');
      await engine.loadDataset({ text: f.text(), filename: f.filename, name: f.datasetName, source: 'bundled' });
      const ref = engine.state.value.datasets.find((d) => d.name === f.datasetName)!;
      const seed = seedAgreement('orders', 'top', ref)!;
      await engine.upsertSpec(seed.spec);
      engine.setInput(`${seed.spec.name}(${f.datasetName})`);
      await engine.submit();
      const st = engine.state.value;
      expect(st.generation?.phase).toBe('committed');
      const version = st.program.functions[seed.spec.name]?.artifact?.revision;
      expect(version).toBe(STAGE_VERSION);
      // and it is what the answer card's caption would read
      expect(st.revisions.map((r) => r.kind)).toEqual(['init', 'dataset', 'spec-edit', 'commit']);
    } finally {
      engine.dispose();
      _useBackend(null);
    }
  }, 120_000);
});
