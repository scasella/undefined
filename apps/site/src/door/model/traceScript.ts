/**
 * The landing's scripted check trace (V3-Door-Landing script, the lane builder `mk` and the pass / stop / ghost lane
 * tables), as data plus the motion rules that turn a lane into CSS animation strings. Pure: no DOM.
 *
 * It is an ILLUSTRATION ("Slowed down so you can watch"): the landing plays it, #/start never does (honesty rule 1).
 * The live trace reuses `laneMotion` with a short {start: 0, dur: .35} timing when a real lane turns passed.
 *
 * Keyframe names end in 'a' or 'b' (`suffix(run)`): an identical inline animation does not restart, a renamed one does,
 * so alternating the suffix on every replay restarts the whole trace. CheckTrace.css registers both copies.
 */
import type { LaneKind, LaneLink, LaneView } from './lanes';

export type Sfx = 'a' | 'b';
/** The keyframe-name suffix for replay number `run` (0, 2, 4… → 'a'; 1, 3, 5… → 'b'). */
export const suffix = (run: number): Sfx => (Math.abs(run) % 2 ? 'b' : 'a');

/** The design's ease, --fd-ease. */
export const EASE = 'cubic-bezier(.2,.8,.2,1)';

/** `name+sx dur s ease delay s iter both`, exactly as the design's `A()` helper writes it. */
export function anim(name: string, sx: Sfx, dur: number, delay: number, ease: string = EASE, iter = '1'): string {
  return `${name}${sx} ${dur}s ${ease} ${delay}s ${iter} both`;
}

/** One scripted lane: what it is and when it plays. `st` is how it ends. */
export interface ScriptLane {
  num: string;
  label: string;
  lock?: boolean;
  link?: LaneLink;
  kind: LaneKind;
  /** Cells drawn (and, for ticks/grid, the n of "n/n"). */
  n: number;
  /** Seconds from the start of the run. */
  start: number;
  dur: number;
  st: 'pass' | 'fail' | 'stop' | 'wait';
}

export type ScenarioId = 'pass' | 'stop';

export interface Scenario {
  id: ScenarioId;
  lanes: ScriptLane[];
  /** The faded earlier draft (pass scenario only). */
  ghost: ScriptLane[] | null;
  /** When the checks end: the header swaps, the seal line draws. */
  tEnd: number;
  /** When the answer card is revealed (the stage owner syncs to it). */
  tRev: number;
  /** The label above the lanes. */
  draftName: string;
  header: { left: string; verdict: string; right: string; tone: 'pass' | 'ask' };
  footer: { text: string; meta: string };
  liveText: string;
}

const LOCK_LABEL = 'Matches your locked answer · Chef Ravioli Starbright = $2,252.07';

export const passLanes: readonly ScriptLane[] = [
  { num: '01', label: 'Runs without errors', kind: 'ticks', n: 1, start: 2.0, dur: 0.35, st: 'pass' },
  { num: '02', label: 'Matches your 6 examples', kind: 'ticks', n: 6, start: 2.45, dur: 0.7, st: 'pass', link: 'ex' },
  { num: '03', label: LOCK_LABEL, lock: true, kind: 'ticks', n: 1, start: 3.25, dur: 0.35, st: 'pass', link: 'lock' },
  { num: '04', label: 'Follows your 2 house rules on 100 made-up tables', kind: 'grid', n: 100, start: 3.7, dur: 1.4, st: 'pass', link: 'rules' },
  { num: '05', label: 'Never changes your data · finishes fast', kind: 'ticks', n: 2, start: 5.2, dur: 0.4, st: 'pass' },
  { num: '06', label: 'Stress test: we broke it 12 small ways on purpose', kind: 'stress', n: 12, start: 5.7, dur: 0.9, st: 'pass' },
];

export const stopLanes: readonly ScriptLane[] = [
  { num: '01', label: 'Runs without errors', kind: 'ticks', n: 1, start: 0.3, dur: 0.35, st: 'pass' },
  { num: '02', label: 'Matches your 6 examples', kind: 'ticks', n: 6, start: 0.75, dur: 0.7, st: 'pass', link: 'ex' },
  { num: '03', label: LOCK_LABEL, lock: true, kind: 'ticks', n: 1, start: 1.55, dur: 0.35, st: 'pass', link: 'lock' },
  { num: '04', label: 'Follows your 2 house rules on 100 made-up tables', kind: 'grid', n: 100, start: 2.0, dur: 0.66, st: 'stop', link: 'rules' },
  { num: '05', label: 'Never changes your data · finishes fast', kind: 'ticks', n: 2, start: 0, dur: 0, st: 'wait' },
  { num: '06', label: 'Stress test: we broke it 12 small ways on purpose', kind: 'stress', n: 12, start: 0, dur: 0, st: 'wait' },
];

export const ghostLanes: readonly ScriptLane[] = [
  { num: '01', label: 'Runs without errors', kind: 'ticks', n: 1, start: 0.2, dur: 0.25, st: 'pass' },
  { num: '02', label: 'Matches your 6 examples', kind: 'ticks', n: 6, start: 0.5, dur: 0.45, st: 'pass' },
  { num: '03', label: 'Matches your locked answer', lock: true, kind: 'ticks', n: 1, start: 1.0, dur: 0.1, st: 'fail' },
];

/** In the scripted stop, the made-up table the house rules have no answer for (1-based), and the stress-test miss. */
export const SCRIPT_STOP_AT = 47;
export const SCRIPT_STRESS_CAUGHT = 11;

const TRACE_LEFT = 'CHECK TRACE · {draft} · Top 5 customers by revenue · orders.csv · 332 rows';

export const passScenario: Scenario = {
  id: 'pass',
  lanes: [...passLanes],
  ghost: [...ghostLanes],
  tEnd: 6.7,
  tRev: 6.9,
  draftName: 'DRAFT 2',
  header: { left: TRACE_LEFT.replace('{draft}', 'DRAFT 2'), verdict: 'Passed every check ↓ see the list', right: '0.41 s', tone: 'pass' },
  footer: {
    text: 'Checked against: 6 examples · 1 locked answer · 2 house rules on 100 made-up tables · stress test · your data untouched.',
    meta: 'Slowed down so you can watch · real run 0.41 s · 6 checks · 1 draft thrown out',
  },
  liveText: 'Passed every check. Showing the answer.',
};

export const stopScenario: Scenario = {
  id: 'stop',
  lanes: [...stopLanes],
  ghost: null,
  tEnd: 2.7,
  tRev: 6.9,
  draftName: 'DRAFT 1',
  header: { left: TRACE_LEFT.replace('{draft}', 'DRAFT 1'), verdict: 'Stopped · a question only you can answer', right: 'paused · waiting on you', tone: 'ask' },
  footer: {
    text: "Checked so far: 6 examples · 1 locked answer · 2 house rules on 46 made-up tables. Stopped on table 47: your rules don't say what happens there.",
    meta: 'Nothing is shown until you decide',
  },
  liveText: 'Stopped: a question only you can answer.',
};

export const scenarios: Record<ScenarioId, Scenario> = { pass: passScenario, stop: stopScenario };

/** The ghost note, as text segments (mono = a figure). Landing copy, verbatim. */
export const SCRIPT_GHOST_NOTE: ReadonlyArray<{ text: string; mono?: boolean }> = [
  { text: "First draft thrown out: it didn't match an answer you locked. Chef Ravioli Starbright: expected " },
  { text: '$2,252.07', mono: true },
  { text: ', got ' },
  { text: '$2,260.06', mono: true },
  { text: '. The draft counted a refunded order. Checks 04 to 06 never ran: a draft stops at its first failure.' },
];

// ───────────────────────── script lane → lane view ─────────────────────────

/** The END state of a scripted lane as a LaneView (what the component shows once the animation is over). */
export function scriptLaneView(o: ScriptLane): LaneView {
  const n = o.n;
  const base = { num: o.num, label: o.label, kind: o.kind, cells: n, ...(o.lock ? { lock: true } : {}), ...(o.link ? { link: o.link } : {}) };
  if (o.st === 'wait') return { ...base, state: 'skipped', idle: 'Not run', aria: `${o.label}: not run yet` };
  if (o.st === 'fail') return { ...base, state: 'failed', word: 'Thrown out', glyph: 'fail', aria: `${o.label}: thrown out` };
  if (o.st === 'stop') {
    const line2 = `on made-up table ${SCRIPT_STOP_AT} of ${n}`;
    return {
      ...base,
      state: 'stopped',
      word: 'Stopped',
      glyph: 'ask',
      line2,
      line2Tone: 'ask',
      stopAt: SCRIPT_STOP_AT,
      aria: `${o.label}: stopped ${line2}, a question only you can answer`,
    };
  }
  if (o.kind === 'stress') {
    const missed = n - SCRIPT_STRESS_CAUGHT;
    return {
      ...base,
      state: 'passed',
      done: `${SCRIPT_STRESS_CAUGHT} of ${n} caught`,
      line2: `${missed} missed`,
      line2Tone: 'ask',
      missed,
      aria: `${o.label}: ${SCRIPT_STRESS_CAUGHT} of ${n} caught, ${missed} missed`,
    };
  }
  return { ...base, state: 'passed', done: `${n}/${n}`, word: 'Passed', glyph: 'pass', aria: `${o.label}: ${n} of ${n} passed` };
}

/** Everything CheckTrace needs for a scenario except `script` and `highlight`. */
export function scenarioView(s: Scenario): {
  lanes: LaneView[];
  ghost: { title: string; lanes: LaneView[]; note: Array<{ text: string; mono?: boolean }> } | null;
  header: { left: string; right: string; verdict: string; tone: 'pass' | 'ask'; done: true };
  footer: { text: string; meta: string };
  liveText: string;
  draftLabel: string;
} {
  return {
    lanes: s.lanes.map(scriptLaneView),
    ghost: s.ghost ? { title: 'DRAFT 1', lanes: s.ghost.map(scriptLaneView), note: SCRIPT_GHOST_NOTE.map((x) => ({ ...x })) } : null,
    header: { ...s.header, done: true },
    footer: { ...s.footer },
    liveText: s.liveText,
    draftLabel: s.draftName,
  };
}

// ───────────────────────── motion (the design's `mk`, as animation strings) ─────────────────────────

/** When a lane plays: seconds from the start of the run. */
export interface Timing {
  start: number;
  dur: number;
}

/**
 * Animation strings for every moving part of one lane. `undefined` = no animation (the static style already is the end
 * state). Indices in `cells` match the drawn cells.
 */
export interface LaneMotion {
  li?: string;
  pen?: string;
  cells: Array<string | undefined>;
  wait?: string;
  run?: string;
  strip?: string;
  done?: string;
  strike?: string;
  ask?: string;
  /** Steps in the running counter strip ("0/n" … "n/n"), for `ct` steps(k). */
  steps: number;
}

/**
 * The design's `mk` motion for a lane that ENDS in `view.state`, played at `t`. A lane with no timing, or one that is
 * not settled (off, ready, waiting, running, skipped), does not move.
 */
export function laneMotion(view: LaneView, t: Timing | null, sx: Sfx): LaneMotion {
  const n = view.cells;
  const stop = view.state === 'stopped';
  const stopAt = stop ? Math.max(1, Math.min(view.stopAt ?? n, n)) : n;
  const steps = stop ? stopAt : n;
  const settled = view.state === 'passed' || view.state === 'failed' || view.state === 'stopped';
  if (!t || !settled) return { cells: new Array<undefined>(n).fill(undefined), steps };
  const { start, dur } = t;
  const end = start + dur;
  const fail = view.state === 'failed';
  const missedFrom = view.kind === 'stress' ? n - (view.missed ?? 0) : n;
  const cells: Array<string | undefined> = [];
  for (let i = 0; i < n; i++) {
    const delay = view.kind === 'grid' ? start + dur * (i / (stop ? stopAt : n)) : start + dur * ((i + 0.5) / n);
    if (fail) cells.push(anim('st', sx, 0.18, end));
    else if (stop && i === stopAt - 1) cells.push(anim('fi', sx, 0.2, end));
    else if (stop && i > stopAt - 1) cells.push(undefined);
    else if (i >= missedFrom) cells.push(anim('fi', sx, 0.2, delay));
    else cells.push(anim('tk', sx, 0.12, delay, 'linear'));
  }
  let pen: string;
  // the scripted stop sweeps to cell 47 (the `sp` keyframe ends at 93.3%); any other stop point just jitters in place
  if (stop) pen = (stopAt === 47 && view.kind === 'grid' ? anim('sp', sx, dur, start, `steps(${stopAt},end)`) + ',' : '') + anim('jt', sx, 0.12, end, 'steps(2,end)');
  else if (view.kind === 'grid') pen = anim('sg', sx, dur, start, 'steps(100,end)');
  else pen = anim('sw', sx, dur, start, 'linear');
  const li = stop ? `${anim('lg', sx, dur, start, 'linear')},${anim('ak', sx, 0.2, end)}` : anim('lg', sx, dur, start, 'linear');
  return {
    li,
    pen,
    cells,
    wait: anim('fo', sx, 0.05, start, 'linear'),
    ...(fail ? {} : { run: anim('on', sx, dur, start, 'linear'), strip: anim('ct', sx, dur, start, `steps(${steps},end)`) }),
    done: anim('fi', sx, 0.15, end),
    ...(fail ? { strike: anim('sl', sx, 0.3, end + 0.1) } : {}),
    ...(stop ? { ask: anim('dg', sx, 0.6, end) } : {}),
    steps,
  };
}

/** Panel-level motion: header swap, timer, seal line, ghost fade, ghost note. */
export interface PanelMotion {
  hdrLeft?: string;
  hdrVerdict?: string;
  timerRunning?: string;
  timerDone?: string;
  seal?: string;
  ghost?: string;
  ghostNote?: string;
}

export function panelMotion(tEnd: number, sx: Sfx, opts: { seal: boolean; ghost: boolean }): PanelMotion {
  return {
    hdrLeft: anim('fo', sx, 0.2, tEnd),
    hdrVerdict: anim('fi', sx, 0.2, tEnd),
    timerRunning: anim('on', sx, tEnd, 0, 'linear'),
    timerDone: anim('fi', sx, 0.2, tEnd),
    ...(opts.seal ? { seal: anim('sl', sx, 0.4, tEnd) } : {}),
    ...(opts.ghost ? { ghost: anim('gh', sx, 0.24, 1.5), ghostNote: anim('fi', sx, 0.2, 1.3) } : {}),
  };
}

/** The live trace's short play when a real lane settles. */
export const LIVE_TIMING: Timing = { start: 0, dur: 0.35 };

/** The `left` of the scripted stop pen / a stopped grid's pen: the centre of table `k` in the 50-column grid (4px + 2px gap). */
export function gridPenLeft(k: number): string {
  const col = (Math.max(1, k) - 1) % 50;
  return `${(((col * 6 + 2) / 298) * 100).toFixed(1)}%`;
}
