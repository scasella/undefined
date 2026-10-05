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
import { scenarios, scenarioView, type Scenario, type ScenarioId } from '../model/traceScript';

export const STAGE_QUESTION = 'Who are our top customers by revenue?';
export const STAGE_FILE = 'orders.csv';
/** The example's version number (the landing's illustration is "Version 3", as the honesty bar says). */
export const STAGE_VERSION = 3;

/** The small mono caption under the trace: the playback is an illustration. */
export const ILLUSTRATION_CAPTION = 'Illustrative playback of the example below, slowed down';
/** Replaces the design's "Slowed down so you can watch · real run 0.41 s" (not a recorded run). */
export const PASS_META = 'Illustrative · slowed down so you can watch · 6 checks · 1 draft thrown out';
/** Replaces the design's "0.41 s" timer at the end of the pass playback (no measured duration to show). */
export const PASS_TIMER = 'illustrative';

/** The design's "See the calculation" code (LANDING 297-311), verbatim. */
export const CALC_SOURCE = `// Top customers by revenue · Version 3
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

export const STAGE_NOT_CHECKED: readonly string[] = [
  `whether ${STAGE_FILE} is the complete export`,
  'whether revenue should include tax or shipping',
  'whether this was the right question',
];

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
      '12-way stress test (11 caught)',
      'never changes your data',
      'finishes fast',
    ],
    agreement,
  };
}

let cached: StageData | null = null;
/** The stage over the bundled sample (orders.csv, 332 rows), computed once. */
export function landingStage(): StageData {
  return (cached ??= buildStage(bundledOrders()));
}

/**
 * How long the playback runs, in seconds, before the page is at rest (the shell's "running" pulse stops then).
 * pass: the answer reveal ends with the last row's 'ri' (tRev + .22 + .06·3 + .3); stop: the mini question lands.
 */
export function settleSeconds(s: Scenario, restRows = 4): number {
  if (s.id === 'stop') return Math.max(s.tEnd, MINI_QUESTION.delay + MINI_QUESTION.dur);
  return Math.max(s.tEnd, s.tRev + 0.22 + 0.06 * Math.max(0, restRows - 1) + 0.3);
}
