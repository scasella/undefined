import { describe, expect, it } from 'vitest';
import {
  anim,
  gridPenLeft,
  laneMotion,
  LIVE_TIMING,
  panelMotion,
  passScenario,
  scenarioView,
  scriptLaneView,
  stopScenario,
  suffix,
} from './traceScript';

describe('suffix', () => {
  it('alternates a/b by run parity so a replay restarts every animation', () => {
    expect([0, 1, 2, 3].map(suffix)).toEqual(['a', 'b', 'a', 'b']);
  });
});

describe('anim', () => {
  it('writes the design A() shorthand exactly', () => {
    expect(anim('tk', 'a', 0.12, 2.0583333, 'linear')).toBe('tka 0.12s linear 2.0583333s 1 both');
    expect(anim('fi', 'b', 0.2, 6.7)).toBe('fib 0.2s cubic-bezier(.2,.8,.2,1) 6.7s 1 both');
  });
});

describe('scenario tables (ported from the landing script)', () => {
  it('pass: six lanes, timings and tEnd/tRev as designed', () => {
    expect(passScenario.lanes.map((l) => [l.num, l.kind, l.n, l.start, l.dur, l.st])).toEqual([
      ['01', 'ticks', 1, 2.0, 0.35, 'pass'],
      ['02', 'ticks', 6, 2.45, 0.7, 'pass'],
      ['03', 'ticks', 1, 3.25, 0.35, 'pass'],
      ['04', 'grid', 100, 3.7, 1.4, 'pass'],
      ['05', 'ticks', 2, 5.2, 0.4, 'pass'],
      ['06', 'stress', 12, 5.7, 0.9, 'pass'],
    ]);
    expect(passScenario.tEnd).toBe(6.7);
    expect(passScenario.tRev).toBe(6.9);
    expect(passScenario.lanes.map((l) => l.link ?? null)).toEqual([null, 'ex', 'lock', 'rules', null, null]);
    expect(passScenario.ghost?.map((l) => [l.num, l.st])).toEqual([['01', 'pass'], ['02', 'pass'], ['03', 'fail']]);
  });
  it('stop: lane 04 stops, 05 and 06 never run, tEnd 2.7', () => {
    expect(stopScenario.lanes.map((l) => l.st)).toEqual(['pass', 'pass', 'pass', 'stop', 'wait', 'wait']);
    expect(stopScenario.tEnd).toBe(2.7);
    expect(stopScenario.ghost).toBeNull();
    expect(stopScenario.header.verdict).toBe('Stopped · a question only you can answer');
  });
});

describe('scriptLaneView (end states, design aria)', () => {
  it('pass / stress / fail / stop / wait', () => {
    const [l1, , l3, , , l6] = passScenario.lanes.map(scriptLaneView);
    expect(l1).toMatchObject({ state: 'passed', done: '1/1', word: 'Passed', aria: 'Runs without errors: 1 of 1 passed' });
    expect(l3?.label).toBe('Matches your locked answer · Chef Ravioli Starbright = $2,252.07');
    expect(l6).toMatchObject({ done: '11 of 12 caught', line2: '1 missed', missed: 1, aria: 'Stress test: we broke it 12 small ways on purpose: 11 of 12 caught, 1 missed' });
    const stop = stopScenario.lanes.map(scriptLaneView);
    expect(stop[3]).toMatchObject({
      state: 'stopped',
      line2: 'on made-up table 47 of 100',
      stopAt: 47,
      aria: 'Follows your 2 house rules on 100 made-up tables: stopped on made-up table 47 of 100, a question only you can answer',
    });
    expect(stop[4]).toMatchObject({ state: 'skipped', idle: 'Not run', aria: 'Never changes your data · finishes fast: not run yet' });
    expect(scriptLaneView(passScenario.ghost![2]!)).toMatchObject({ state: 'failed', word: 'Thrown out', aria: 'Matches your locked answer: thrown out' });
  });
  it('scenarioView bundles the props and the landing ghost note', () => {
    const v = scenarioView(passScenario);
    expect(v.lanes).toHaveLength(6);
    expect(v.ghost?.title).toBe('DRAFT 1');
    expect(v.ghost?.note.map((s) => s.text).join('')).toBe(
      "First draft thrown out: it didn't match an answer you locked. Chef Ravioli Starbright: expected $2,252.07, got $2,260.06. The draft counted a refunded order. Checks 04 to 06 never ran: a draft stops at its first failure.",
    );
    expect(v.footer.meta).toBe('Slowed down so you can watch · real run 0.41 s · 6 checks · 1 draft thrown out');
    expect(scenarioView(stopScenario).ghost).toBeNull();
  });
});

describe('laneMotion (the design mk)', () => {
  it('ticks: cells tick at start + dur·(i+.5)/n, pen sweeps, count fades in at the end', () => {
    const lane = passScenario.lanes[1]!;
    const m = laneMotion(scriptLaneView(lane), lane, 'a');
    expect(m.cells).toHaveLength(6);
    expect(m.cells[0]).toBe(anim('tk', 'a', 0.12, 2.45 + 0.7 * (0.5 / 6), 'linear'));
    expect(m.pen).toBe(anim('sw', 'a', 0.7, 2.45, 'linear'));
    expect(m.li).toBe(anim('lg', 'a', 0.7, 2.45, 'linear'));
    expect(m.wait).toBe(anim('fo', 'a', 0.05, 2.45, 'linear'));
    expect(m.strip).toBe(anim('ct', 'a', 0.7, 2.45, 'steps(6,end)'));
    expect(m.done).toBe(anim('fi', 'a', 0.15, 2.45 + 0.7));
    expect(m.strike).toBeUndefined();
  });
  it('grid: 100 cells at i/n, stepped pen', () => {
    const lane = passScenario.lanes[3]!;
    const m = laneMotion(scriptLaneView(lane), lane, 'b');
    expect(m.cells[10]).toBe(anim('tk', 'b', 0.12, 3.7 + 1.4 * 0.1, 'linear'));
    expect(m.pen).toBe(anim('sg', 'b', 1.4, 3.7, 'steps(100,end)'));
  });
  it('stress: the missed cell fades in instead of ticking', () => {
    const lane = passScenario.lanes[5]!;
    const m = laneMotion(scriptLaneView(lane), lane, 'a');
    expect(m.cells[11]?.startsWith('fia ')).toBe(true);
    expect(m.cells[10]?.startsWith('tka ')).toBe(true);
  });
  it('stop: grid divisor 47, amber cell at 47, cells after stay still, sp + jt pen, ak + dg', () => {
    const lane = stopScenario.lanes[3]!;
    const m = laneMotion(scriptLaneView(lane), lane, 'a');
    const end = 2.0 + 0.66;
    expect(m.cells[46]).toBe(anim('fi', 'a', 0.2, end));
    expect(m.cells[47]).toBeUndefined();
    expect(m.cells[1]).toBe(anim('tk', 'a', 0.12, 2.0 + 0.66 * (1 / 47), 'linear'));
    expect(m.pen).toBe(`${anim('sp', 'a', 0.66, 2.0, 'steps(47,end)')},${anim('jt', 'a', 0.12, end, 'steps(2,end)')}`);
    expect(m.li).toBe(`${anim('lg', 'a', 0.66, 2.0, 'linear')},${anim('ak', 'a', 0.2, end)}`);
    expect(m.ask).toBe(anim('dg', 'a', 0.6, end));
    expect(m.steps).toBe(47);
  });
  it('fail: cells stamp, strike draws after the end, no running counter', () => {
    const lane = passScenario.ghost![2]!;
    const m = laneMotion(scriptLaneView(lane), lane, 'a');
    expect(m.cells[0]).toBe(anim('st', 'a', 0.18, 1.1));
    expect(m.strike).toBe(anim('sl', 'a', 0.3, 1.1 + 0.1));
    expect(m.run).toBeUndefined();
  });
  it('a lane that did not run, or has no timing, does not move', () => {
    const wait = stopScenario.lanes[4]!;
    expect(laneMotion(scriptLaneView(wait), wait, 'a').pen).toBeUndefined();
    expect(laneMotion(scriptLaneView(passScenario.lanes[0]!), null, 'a').cells).toEqual([undefined]);
    expect(laneMotion(scriptLaneView(passScenario.lanes[0]!), LIVE_TIMING, 'a').pen).toBe(anim('sw', 'a', 0.35, 0, 'linear'));
  });
});

describe('panelMotion + gridPenLeft', () => {
  it('header swap, timer and seal at tEnd; ghost fades at 1.5 s, note at 1.3 s', () => {
    const p = panelMotion(6.7, 'a', { seal: true, ghost: true });
    expect(p.hdrLeft).toBe(anim('fo', 'a', 0.2, 6.7));
    expect(p.timerRunning).toBe(anim('on', 'a', 6.7, 0, 'linear'));
    expect(p.seal).toBe(anim('sl', 'a', 0.4, 6.7));
    expect(p.ghost).toBe(anim('gh', 'a', 0.24, 1.5));
    expect(p.ghostNote).toBe(anim('fi', 'a', 0.2, 1.3));
    expect(panelMotion(2.7, 'b', { seal: false, ghost: false }).seal).toBeUndefined();
  });
  it('table 47 sits at the design 93.3%', () => {
    expect(gridPenLeft(47)).toBe('93.3%');
  });
});
