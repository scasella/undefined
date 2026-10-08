/**
 * The landing stage's data (V3-Door-Landing 97-384 and its script 859-1196): the scripted check trace, the answer card
 * and the agreement rail of the example "Who are our top customers by revenue?". Pure: no DOM.
 *
 * Every figure is computed from the real rows (model/figures.ts over bundledOrders()), never typed in: the locked
 * answer ($2,252.07), the four rows under it, and the thrown-out first draft ($2,260.06, "a refunded order").
 *
 * The trace is an ILLUSTRATION (docs/FRONT-DOOR.md, honesty rule 2): a slowed-down playback, not a recorded run. So
 * the design's "real run 0.41 s" meta and its "0.41 s" timer are reworded here; nothing claims a measured duration.
 */
import { bundledOrders } from '../../data/orders';
import { AGREED, formatMoney, thrownOutDraft, topCustomers, type DataRow } from '../model/figures';
import { shapeValue, type AnswerView } from '../model/answer';
import type { AssumptionList } from '../model/assumptions';
import { illustrativeAgreement, type AgreementView } from '../model/agreement';
import { stressChecked, stressNotChecked, type StressStatus } from '../model/lanes';
import { SCRIPT_SEAL, SCRIPT_STRESS, scenarios, scenarioView, type Scenario, type ScenarioId } from '../model/traceScript';

export const STAGE_QUESTION = 'Who are our top customers by revenue?';
export const STAGE_FILE = 'orders.csv';
/**
 * The example's version number: "Version 4", the number a real replay run of this very example commits. It is the
 * engine's own count, not something the recording holds: the first run's snapshots are 1 the initial image, 2 loading
 * orders.csv, 3 installing the demo's agreement, so the first accepted draft is committed at 4 (`Artifact.revision`,
 * which is what the answer card's caption and the honesty bar show). stageData.test.ts replays the bundled recording
 * through the real engine and pins this number to what it commits.
 */
export const STAGE_VERSION = 4;

/**
 * What the stress test came to in the ONE recorded run (orders.csv, "top customers by revenue", the first draft accepted, Version 4):
 * 12 deliberate breaks, 8 caught, 4 missed. Not typed from memory: stageData.test.ts replays the bundled recording through the real
 * engine, lets its stress test finish and pins this to what the engine reports, so a re-recording or an engine change fails a test
 * instead of letting the landing drift. The illustration above it (traceScript.ts SCRIPT_STRESS) has its own, labelled numbers.
 */
export const RECORDED_STRESS: Extract<StressStatus, { kind: 'done' }> = { kind: 'done', total: 12, caught: 8, missed: 4 };
/** The recorded run's first draft was accepted: nothing was thrown out (the illustration throws one out, to show what a rejection looks like). */
export const RECORDED_DRAFTS_THROWN_OUT = 0;

/**
 * The name of the stage's pass playback, as its toggle reads. The evidence section's recorded-run block points at it by this name
 * ('The "Watch it pass" playback above throws one out'), because the other playback ("Watch it stop and ask") throws nothing out.
 */
export const WATCH_PASS_LABEL = 'Watch it pass';

/**
 * The stage's ONE label, the small mono caption under the trace: the playback, and the example answer it leads to, are an
 * illustration. Nothing else on the stage says it again (the trace's footer and timer used to, twice more).
 */
export const ILLUSTRATION_CAPTION = 'Illustrative playback of the example below, slowed down';
/** Replaces the design's "Slowed down so you can watch · real run 0.41 s" (not a recorded run): what ran, counted from the script. */
export const PASS_META = `${scenarios.pass.lanes.length} checks · 1 draft thrown out`;
/** Replaces the design's "0.41 s" timer at the end of the pass playback: there is no measured duration to show, so it shows nothing. */
export const PASS_TIMER = '';

/** The design's "See the calculation" code (LANDING 297-311), verbatim. */
export const CALC_SOURCE = `// Top customers by revenue · Version ${STAGE_VERSION}
function topCustomersByRevenue(rows) {
  const seen = new Set();
  const totals = new Map();
  for (const r of rows) {
    if (r.status !== "paid") continue;   // your rule: paid orders only
    if (seen.has(r.id)) continue;        // your rule: each order number once
    seen.add(r.id);
    const revenue = r.quantity * r.unitPrice * (1 - (r.discount ?? 0));
    totals.set(r.customer, (totals.get(r.customer) ?? 0) + revenue);
  }
  return [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);
}`;

/** "What the AI assumed" on the example (design copy; an illustration, like the rest of the stage). */
export const STAGE_ASSUMPTIONS: AssumptionList = {
  items: [
    { id: 'a1', text: 'Revenue = quantity × unit price, after discount.' },
    { id: 'a2', text: 'Top 5 by revenue. Ties are listed in alphabetical order.' },
    { id: 'a3', text: 'Customers are grouped by name exactly as written in the file.' },
  ],
  empty: null,
};

/** What the illustrated stress test left unsaid, in the live answer's own words (model/lanes.ts, the same definition). */
const STAGE_BREAKS_MISSED = stressNotChecked(SCRIPT_STRESS)!;

export const STAGE_NOT_CHECKED: readonly string[] = [
  `whether ${STAGE_FILE} is the complete export`,
  'whether revenue should include tax or shipping',
  'whether this was the right question',
  STAGE_BREAKS_MISSED,
];

/** The seal the card wears once lane 06 has ended: Passed every check · stress test caught 11 of 12 (illustrative numbers). */
export const STAGE_SEAL = { text: SCRIPT_SEAL, ran: 5, of: 6, complete: true } as const;

/** The rail's stop-and-ask mini card (the stop scenario only). */
export const MINI_QUESTION = {
  eyebrow: 'A QUESTION ONLY YOU CAN ANSWER',
  head: 'What should happen to a customer whose orders were all refunded?',
  body: "We tried a made-up table where that happens. Your house rules don't say. We won't guess.",
  cta: 'Answer it below',
  href: '#asks',
  /** When it slides in (seconds), just after the stop at tEnd 2.7. */
  delay: 2.8,
  dur: 0.24,
} as const;

export type GhostNote = Array<{ text: string; mono?: boolean }>;

export interface StageData {
  lock: { name: string; value: number; amount: string };
  scenarios: Record<ScenarioId, Scenario>;
  views: Record<ScenarioId, ReturnType<typeof scenarioView>>;
  answer: AnswerView;
  checked: string[];
  /** The items of `checked` that take the amber glyph (the stress test missed one break). */
  checkedAsk: string[];
  agreement: AgreementView;
}

/** The ghost note under the thrown-out draft, with the figures of the real first draft. */
export function ghostNote(rows: readonly DataRow[]): GhostNote {
  const d = thrownOutDraft(rows);
  if (!d) return [{ text: "First draft thrown out: it didn't match an answer you locked. Checks 04 to 06 never ran: a draft stops at its first failure." }];
  return [
    { text: `First draft thrown out: it didn't match an answer you locked. ${d.customer}: expected ` },
    { text: d.expected, mono: true },
    { text: ', got ' },
    { text: d.got, mono: true },
    { text: `. ${d.draftSentence} Checks 04 to 06 never ran: a draft stops at its first failure.` },
  ];
}

/** A scenario with the computed lock figure in lane 03 and the honest pass meta / timer. Never mutates the source. */
export function stageScenario(base: Scenario, lockText: string): Scenario {
  const lanes = base.lanes.map((l) => (l.num === '03' ? { ...l, label: `Matches your locked answer · ${lockText}` } : { ...l }));
  if (base.id !== 'pass') return { ...base, lanes };
  return { ...base, lanes, header: { ...base.header, right: PASS_TIMER }, footer: { ...base.footer, meta: PASS_META } };
}

export function buildStage(rows: readonly DataRow[]): StageData {
  const top = topCustomers(rows, AGREED);
  const lead = top[0] ?? { name: '', value: 0 };
  const amount = formatMoney(lead.value);
  const lockText = `${lead.name} = ${amount}`;

  const sc = { pass: stageScenario(scenarios.pass, lockText), stop: stageScenario(scenarios.stop, lockText) };
  const note = ghostNote(rows);
  const view = (s: Scenario) => {
    const v = scenarioView(s);
    return v.ghost ? { ...v, ghost: { ...v.ghost, note: note.map((x) => ({ ...x })) } } : v;
  };

  const answer = shapeValue(
    top.map((r) => [r.name, r.value] as [string, number]),
    {
      question: STAGE_QUESTION,
      fileName: STAGE_FILE,
      rowCount: rows.length,
      revision: STAGE_VERSION,
      callName: 'topCustomersByRevenue',
      counted: 'paid orders only, each order number once',
    },
  );

  const base = illustrativeAgreement(amount);
  const agreement: AgreementView = {
    ...base,
    locks: base.locks.map((l, i) => (i === 0 ? { ...l, label: lead.name, value: amount, t: lockText } : l)),
  };

  return {
    lock: { name: lead.name, value: lead.value, amount },
    scenarios: sc,
    views: { pass: view(sc.pass), stop: view(sc.stop) },
    answer,
    checked: [
      'your 6 examples',
      `your locked answer (${lockText})`,
      'your 2 house rules on 100 made-up tables',
      stressChecked(SCRIPT_STRESS)!.text,
      'never changes your data',
      'finishes fast',
    ],
    checkedAsk: stressChecked(SCRIPT_STRESS)!.ask ? [stressChecked(SCRIPT_STRESS)!.text] : [],
    agreement,
  };
}

let cached: StageData | null = null;
/** The stage over the bundled sample (orders.csv, 332 rows), computed once. */
export function landingStage(): StageData {
  return (cached ??= buildStage(bundledOrders()));
}

/**
 * When the landing's answer card is released, in ms after the playback (re)starts: at the scenario's reveal (`tRev`). null: never;
 * the stop scenario holds the card until the viewer decides, whatever the clock says.
 */
export function cardReleaseMs(s: Scenario): number | null {
  return s.id === 'stop' ? null : Math.round(s.tRev * 1000);
}

/** Whether the landing's answer card is still held (a compact skeleton, nothing of the answer in layout or in the accessibility tree). */
export function cardHeld(s: Scenario, released: boolean): boolean {
  return s.id === 'stop' || !released;
}

/**
 * Whether a viewer keeps their place when the card is released: `cardTop` is the card's top edge in the window (getBoundingClientRect().top).
 * The card grows by about 870 px (about 1,450 px on a phone) and everything under it moves down by the same distance. A viewer whose window
 * has the start of the card in it is watching it fill, so it grows under them. A viewer whose window starts below the card's top (above
 * zero) is reading something under it, the evidence or, on a phone, the agreement: the page is moved back by the distance, so their line
 * does not jump. Not "the card is wholly above the window": the section under the card sits 24 px below it, so that rule only protected a
 * viewer within 24 px of the evidence, and a viewer reading a few hundred px into it still saw the whole section leave.
 */
export function keepsPlaceAtRelease(cardTop: number): boolean {
  return cardTop < 0;
}

/** How far to scroll to put a line back where it was: its top in the window before the release and after it. Under a pixel is not worth a scroll. */
export function placeCorrection(before: number, after: number): number {
  const moved = after - before;
  return Math.abs(moved) < 1 ? 0 : moved;
}

/**
 * How long the playback runs, in seconds, before the page is at rest (the shell's "running" pulse stops then).
 * pass: the answer reveal ends with the last row's 'ri' (tRev + .22 + .06·3 + .3); stop: the mini question lands.
 */
export function settleSeconds(s: Scenario, restRows = 4): number {
  if (s.id === 'stop') return Math.max(s.tEnd, MINI_QUESTION.delay + MINI_QUESTION.dur);
  return Math.max(s.tEnd, s.tRev + 0.22 + 0.06 * Math.max(0, restRows - 1) + 0.3);
}
