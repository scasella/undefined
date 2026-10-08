/** Pins the landing stage, computed from the real bundledOrders(), to the design's strings (V3-Door-Landing 97-384). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Recording } from '@scasella/undefined-engine/types';
import { bundledOrders } from '../../data/orders';
import { sampleOpeningQuestion } from '../model/questions';
import { sealWords, stressStatus } from '../model/lanes';
import { passScenario, passLanes, SCRIPT_STRESS, stopScenario } from '../model/traceScript';
import {
  buildStage,
  CALC_SOURCE,
  cardHeld,
  cardReleaseMs,
  ghostNote,
  ILLUSTRATION_CAPTION,
  keepsPlaceAtRelease,
  landingStage,
  PASS_META,
  placeCorrection,
  PASS_TIMER,
  RECORDED_DRAFTS_THROWN_OUT,
  RECORDED_STRESS,
  STAGE_QUESTION,
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
      'stress test (caught 11 of 12 deliberate breaks)',
      'never changes your data',
      'finishes fast',
    ]);
    // the stress test's miss is in the list in the live answer's own words; the decisive item (the first: the one the verdict line names) is unchanged
    expect(STAGE_NOT_CHECKED).toEqual([
      'whether orders.csv is the complete export',
      'whether revenue should include tax or shipping',
      'whether this was the right question',
      '1 of 12 deliberate breaks went unnoticed by your checks',
    ]);
    expect(s.checkedAsk).toEqual(['stress test (caught 11 of 12 deliberate breaks)']);
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
  it('pass: no claimed run time, and nothing in the trace repeats the one label (the caption under it)', () => {
    const v = s.views.pass;
    expect(v.footer.meta).toBe(PASS_META);
    expect(PASS_META).toBe('6 checks · 1 draft thrown out');
    expect(v.footer.meta).not.toMatch(/real run|0\.41|illustrat|slowed/i);
    expect(PASS_TIMER).toBe('');
    expect(v.header.right).toBe('');
    // the seal reads what the live trace reads once its stress test has finished (numbers illustrative), after lane 06
    expect(v.header.verdict).toBe('Passed every check · stress test caught 11 of 12 ↓ see the list');
    expect(v.liveText).toBe('Passed every check · stress test caught 11 of 12. Showing the answer.');
    expect(v.draftLabel).toBe('DRAFT 2');
  });

  it('the stage says "illustrative" ONCE (its caption): not in the trace header, the footer, the lanes, the card or the question, in either scenario', () => {
    expect(ILLUSTRATION_CAPTION).toBe('Illustrative playback of the example below, slowed down');
    const strings = (sc: 'pass' | 'stop'): string[] => {
      const v = s.views[sc];
      return [v.header.left, v.header.right, v.header.verdict, v.footer.text, v.footer.meta, v.liveText, v.draftLabel, ...v.lanes.flatMap((l) => [l.label, l.aria, l.done ?? '', l.line2 ?? '']), ...(v.ghost ? v.ghost.note.map((n) => n.text) : [])];
    };
    for (const sc of ['pass', 'stop'] as const) expect(strings(sc).filter((t) => /illustrat/i.test(t)), sc).toEqual([]);
    expect([...s.checked, ...STAGE_NOT_CHECKED].filter((t) => /illustrat/i.test(t))).toEqual([]);
    // the caption is the one place, and the section's heading no longer calls the example "live" (that word already means three things on the page)
    const stage = readFileSync(new URL('./Stage.tsx', import.meta.url), 'utf8');
    expect([...stage.matchAll(/ILLUSTRATION_CAPTION/g)].length).toBe(2); // the import and the one use
    expect(stage).toContain('Example: top customers by revenue');
    expect(stage).not.toMatch(/Live example/);
  });

  it('the question the stage and its trace ask is the sample\'s own question, in the same words', () => {
    expect(STAGE_QUESTION).toBe(sampleOpeningQuestion('orders').text);
    expect(passScenario.header.left).toContain(STAGE_QUESTION);
    expect(stopScenario.header.left).toContain(STAGE_QUESTION);
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

describe('the answer card is held as a compact skeleton and released at the reveal (Stage.tsx owns the state, stageData.ts the rule)', () => {
  it('pass releases at its reveal (6.9 s), stop never releases: the viewer decides', () => {
    expect(cardReleaseMs(s.scenarios.pass)).toBe(6900);
    expect(cardReleaseMs(s.scenarios.pass)).toBe(Math.round(s.scenarios.pass.tRev * 1000));
    expect(cardReleaseMs(s.scenarios.stop)).toBeNull();
  });

  it('held until released in the pass scenario; always held in the stop scenario, whatever the clock says', () => {
    expect(cardHeld(s.scenarios.pass, false)).toBe(true);
    expect(cardHeld(s.scenarios.pass, true)).toBe(false);
    expect(cardHeld(s.scenarios.stop, false)).toBe(true);
    expect(cardHeld(s.scenarios.stop, true)).toBe(true);
  });

  it('the stage wires it: held until released (no CSS delay on a full-height card), every restart is held in the same render, reduced motion starts released, the release keeps the viewer past the stage where they were', () => {
    const stage = readFileSync(new URL('./Stage.tsx', import.meta.url), 'utf8');
    expect(stage).toContain('held={cardHeld(scenario, released)}');
    expect(stage).toContain('reveal={{ delay: 0, run }}'); // the reveal starts at the release, not 6.9 s after a tall card was drawn
    expect(stage).not.toMatch(/delay: scenario\.tRev/);
    expect(stage).toContain('useState<boolean>(reducedMotion)'); // nothing to wait for under reduced motion: released from the start
    // "Run again" and the other scenario are one restart: the run, the scenario and the held card change in one batch (no flash of the tall card)
    const restart = /const restart = \(id: ScenarioId\) => \{([\s\S]*?)\n  \};/.exec(stage)?.[1] ?? '';
    expect(restart).toContain('setRun(');
    expect(restart).toContain('setReleased(reducedMotion())');
    expect(stage).toContain('onClick={() => restart(scen)}');
    expect(stage).toContain('onChange={restart}'); // the toggle is the same restart, not an alias of it
    expect(stage).not.toMatch(/const watch = /);
    // the one jump the release makes is taken out for a viewer who has scrolled past where the card begins (the rule is stageData.ts keepsPlaceAtRelease)
    expect(stage).toContain("window.scrollBy({ top: moved, behavior: 'instant' })");
    expect(stage).not.toMatch(/window\.scrollBy\(0, /); // a fallback without 'instant' would be smooth-scrolled by the page's scroll-behavior and defeat the correction
    expect(stage).toContain('keepsPlaceAtRelease(card.getBoundingClientRect().top)');
    expect(stage).not.toMatch(/getBoundingClientRect\(\)\.bottom/);
    expect(stage).toContain('placeCorrection(was.top, was.el.getBoundingClientRect().top)');
  });

  it('a viewer keeps their place when the start of the card is above the top of the window, and watches it fill when the start is in view', () => {
    // measured at 1440 x 900, with the section under the stage 60, 300 and 600 px down the window (the card sits 325 px above it): -265, -25, +275
    expect(keepsPlaceAtRelease(-265)).toBe(true);
    expect(keepsPlaceAtRelease(-25)).toBe(true);
    expect(keepsPlaceAtRelease(-0.5)).toBe(true);
    expect(keepsPlaceAtRelease(0)).toBe(false);
    expect(keepsPlaceAtRelease(275)).toBe(false);
    // a phone, reading the agreement under the card with the card's bottom edge in view: the card's top is far above the window
    expect(keepsPlaceAtRelease(-225)).toBe(true);
    // the first version's rule was "the card's bottom is above the window" (top + 301 <= 0): the viewers at -265 and -25 were not corrected and saw 873 px go
    const oldRule = (top: number): boolean => top + 301 <= 0;
    expect([oldRule(-265), oldRule(-25)]).toEqual([false, false]);
    expect([keepsPlaceAtRelease(-265), keepsPlaceAtRelease(-25)]).toEqual([true, true]);
  });

  it('the correction is how far the line under the card moved, and nothing under a pixel', () => {
    expect(placeCorrection(60, 933)).toBe(873);
    expect(placeCorrection(300, 1173)).toBe(873);
    expect(placeCorrection(100, 1546)).toBe(1446);
    expect(placeCorrection(300, 300)).toBe(0);
    expect(placeCorrection(300, 300.4)).toBe(0);
    expect(placeCorrection(300, 299.2)).toBe(0);
    expect(placeCorrection(300, 200)).toBe(-100);
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

/** The real replay engine, in-process (the bundled agreement recording), the way core/engine.test.ts builds it; `done` tears it down. */
async function realReplayEngine(extra: { mutation?: { idleMs?: number; quietMs?: number; timeBoxMs?: number } } = {}) {
  const recording = JSON.parse(readFileSync(new URL('../../../public/recordings/orders-agreement.json', import.meta.url), 'utf8')) as Recording;
  const [{ createEngine }, { ReplayGenerator }, { warmUp }, { executeGates }, { Runtime }, { createDispatcher }, { _useBackend, memoryBackend }] = await Promise.all([
    import('../../core/engine'),
    import('../../core/generator'),
    import('@scasella/undefined-engine/gates/compile'),
    import('@scasella/undefined-engine/sandbox/gateExecutor'),
    import('../../sandbox/runtime'),
    import('../../sandbox/replCore'),
    import('../../core/store'),
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
    ...extra,
  });
  return {
    engine,
    done: () => {
      engine.dispose();
      _useBackend(null);
    },
  };
}

describe('the recorded run\'s stress test is what the landing says it is (the real engine, not a typed number)', () => {
  it('replays the bundled recording, lets the stress test finish: 12 deliberate breaks, 8 caught, 4 missed, the first draft accepted (RECORDED_STRESS)', async () => {
    const [{ seedAgreement }, { sampleFile }, { checkFactsFrom }, { sealOf }] = await Promise.all([
      import('../model/agreements'),
      import('../model/samples'),
      import('../model/assumptions'),
      import('../start/derive'),
    ]);
    // the stress test's own time box is wall-clock (engine mutation/run.ts): a slow machine must not turn this into "ran out of time"
    const { engine, done } = await realReplayEngine({ mutation: { idleMs: 0, quietMs: 0, timeBoxMs: 600_000 } });
    try {
      await engine.init();
      const f = sampleFile('orders');
      await engine.loadDataset({ text: f.text(), filename: f.filename, name: f.datasetName, source: 'bundled' });
      const ref = engine.state.value.datasets.find((d) => d.name === f.datasetName)!;
      const seed = seedAgreement('orders', 'top', ref)!;
      await engine.upsertSpec(seed.spec);
      engine.setInput(`${seed.spec.name}(${f.datasetName})`);
      await engine.submit();
      const fn = seed.spec.name;
      const committed = engine.state.value;
      // first draft accepted: one attempt, nothing thrown out (the landing's illustration throws one out to show what a rejection looks like)
      expect(committed.generation?.phase).toBe('committed');
      expect(committed.generation?.attempts.map((a) => a.status)).toHaveLength(1 + RECORDED_DRAFTS_THROWN_OUT);
      // the page lets the engine's lazy check run when idle; the engine's own entry point runs the same check now
      await engine.runMutation(fn);
      const st = engine.state.value;
      const artifact = st.program.functions[fn]?.artifact;
      expect(artifact?.revision).toBe(STAGE_VERSION);
      const report = artifact?.evidence?.mutation;
      expect(report?.skipped).toBeUndefined();
      // what the first-run pages read: Artifact.evidence.mutation -> checkFactsFrom -> stressStatus -> the seal
      const facts = checkFactsFrom({ artifact, spec: st.program.functions[fn]?.spec, question: sampleOpeningQuestion('orders').text, mutation: st.mutation });
      expect(facts.stress).toEqual(RECORDED_STRESS);
      expect(stressStatus({ expected: true, report })).toEqual(RECORDED_STRESS);
      expect(sealOf(facts)?.text).toBe('Passed every check · stress test caught 8 of 12');
      expect(sealOf(facts)?.text).toBe(sealWords({ stress: RECORDED_STRESS, ran: 5, of: 6 }));
    } finally {
      done();
    }
  }, 240_000);

  it('the illustration keeps its own, different numbers (11 of 12, labelled), so the two can never be mistaken for one another', () => {
    expect(RECORDED_STRESS).toEqual({ kind: 'done', total: 12, caught: 8, missed: 4 });
    expect(SCRIPT_STRESS).toMatchObject({ kind: 'done', total: 12, caught: 11, missed: 1 });
    expect(RECORDED_STRESS).not.toEqual(SCRIPT_STRESS);
    expect(s.views.pass.ghost).not.toBeNull(); // the illustration throws one draft out; the recorded run threw none
  });
});

describe('the example version is the one a real replay run commits', () => {
  it('replays the bundled recording through the real engine: the first answer is committed as STAGE_VERSION', async () => {
    const [{ seedAgreement }, { sampleFile }, { versionNote }] = await Promise.all([import('../model/agreements'), import('../model/samples'), import('../model/answer')]);
    const { engine, done } = await realReplayEngine();
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
      // the saved step that installed the demo's agreement names the answer's own function, which is how the note knows it is the demo's
      expect(st.revisions[2]).toMatchObject({ kind: 'spec-edit', fn: seed.spec.name });
      expect(versionNote(st.revisions, version ?? null, seed.spec.name)).toBe(
        "Versions 1 to 3 were the starting point, the file and the demo's agreement; this is the first answer.",
      );
    } finally {
      done();
    }
  }, 120_000);

  it('a question the viewer typed is saved before the first answer: the real engine names ITS function on that save, and the note claims nothing', async () => {
    const [{ seedAgreement }, { sampleFile }, { versionNote }, { customQuestion, customSpec }] = await Promise.all([
      import('../model/agreements'),
      import('../model/samples'),
      import('../model/answer'),
      import('../model/questions'),
    ]);
    const { engine, done } = await realReplayEngine();
    try {
      await engine.init();
      const f = sampleFile('orders');
      await engine.loadDataset({ text: f.text(), filename: f.filename, name: f.datasetName, source: 'bundled' });
      const ref = engine.state.value.datasets.find((d) => d.name === f.datasetName)!;
      const seed = seedAgreement('orders', 'top', ref)!;
      // the page installs the demo's agreement when the sample binds, then saves a typed question's own spec when it is asked
      await engine.upsertSpec(seed.spec);
      const typed = customQuestion('How many orders were refunded?', ref)!;
      await engine.upsertSpec(customSpec(typed, ref));
      // then the viewer asks the recorded question
      engine.setInput(`${seed.spec.name}(${f.datasetName})`);
      await engine.submit();
      const st = engine.state.value;
      expect(st.generation?.phase).toBe('committed');
      const version = st.program.functions[seed.spec.name]?.artifact?.revision ?? null;
      expect(version).toBe(STAGE_VERSION + 1);
      expect(st.revisions.map((r) => [r.kind, r.fn ?? null])).toEqual([
        ['init', null],
        ['dataset', null],
        ['spec-edit', seed.spec.name],
        ['spec-edit', typed.fn],
        ['commit', seed.spec.name],
      ]);
      // Version 4 is the viewer's own save: "the demo's agreement" would be false of it, so nothing is said
      expect(versionNote(st.revisions, version, seed.spec.name)).toBeNull();
    } finally {
      done();
    }
  }, 120_000);
});
