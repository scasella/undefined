/**
 * "Your agreement": the examples, locked answers and house rules a function is held to, in the design's words.
 *
 * Built from the REAL program (Program.functions[fn].spec): authored unit tests are examples, pins are locked answers,
 * decisions and authored properties are house rules. Authored tests and properties carry no timestamp in the engine,
 * so their chips carry no date; only pins (pinnedAt) and decisions (decidedAt) do.
 *
 * `illustrativeAgreement()` is the landing's static example (V3-Door-Landing rail), flagged `illustrative: true`.
 */
import type { Decision, Pin, Program } from '@scasella/undefined-engine/types';
import { listTestNames } from '@scasella/undefined-engine/shared/specInfo';
import { DECIDED_PREFIX, decisionSummary, decisionsOf } from '@scasella/undefined-engine/decide/decisions';
import { decodeValue } from '@scasella/undefined-engine/shared/serialize';
import { show } from '@scasella/undefined-engine/shared/show';
import { humanizeName, leadParts } from './answer';

/** Which lane of the check trace a chip stands for (examples → 02, locked answers → 03, house rules → 04). */
export type AgreementHighlight = 'ex' | 'lock' | 'rules';

export interface AgreementChip {
  /** Stable key for lists. */
  id: string;
  /** Main line, e.g. `Chef Ravioli Starbright = $2,252.07`. */
  t: string;
  /** Meta line (monospace), e.g. `Locked · you · 5 Oct 2026 · on orders.csv`. */
  p: string;
  /** Locked answers only: the two halves of `t` (the value is set in monospace). */
  label?: string;
  value?: string;
}

/** The AI's assumption shown dashed under the house rules, with Confirm (landing illustration only). */
export interface AgreementAssumption {
  t: string;
  pendingMeta: string;
  confirmedMeta: string;
}

export interface AgreementView {
  /** `6 examples · 1 locked answer · 2 house rules` */
  counts: string;
  n: { examples: number; locks: number; rules: number };
  examples: AgreementChip[];
  locks: AgreementChip[];
  rules: AgreementChip[];
  /** No examples, locked answers or house rules: the first answer gets basic checks only. */
  empty: boolean;
  /** True when the agreement came with a demo file (the caller knows; defaults to spec.origin === 'example'). */
  seeded: boolean;
  /** True only for illustrativeAgreement(): not read from any program. */
  illustrative: boolean;
  assumption?: AgreementAssumption;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `5 Oct 2026`, in the viewer's own calendar (as decide/decisions.ts decidedOn). */
export function dayText(at: number): string {
  const d = new Date(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function countsText(n: { examples: number; locks: number; rules: number }): string {
  return [
    plural(n.examples, 'example', 'examples'),
    plural(n.locks, 'locked answer', 'locked answers'),
    plural(n.rules, 'house rule', 'house rules'),
  ].join(' · ');
}

/** Test names the user wrote (decision tests, `decided: …`, are rulings and counted as house rules instead). */
function authoredNames(src: string): string[] {
  return listTestNames(src).filter((name) => !name.startsWith(DECIDED_PREFIX));
}

/** The shown value of a pin's expected result (decoded first, so tagged values like NaN or Map render properly). */
export function pinValueText(expected: Pin['expected']): string {
  let v: unknown;
  try {
    v = decodeValue(expected);
  } catch {
    v = expected;
  }
  return show(v);
}

function pinIsNumber(expected: Pin['expected']): boolean {
  try {
    const v = decodeValue(expected);
    return (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'bigint';
  } catch {
    return false;
  }
}

/**
 * A locked answer in the design's words: its lead, `Chef Ravioli Starbright = $2,252.07` (model/answer.ts leadParts,
 * the function's name standing in for the question so a revenue function reads as money); a single figure keeps the
 * call as its label, `totalRevenue(rows) = $9,876.00`. A result with no lead (a table, text) falls back to the shown value.
 */
export function pinLead(pin: Pin, fn: string): { label: string; value: string } {
  let lead: { name: string; num: string } | null = null;
  try {
    lead = leadParts(pin.expected, humanizeName(fn));
  } catch {
    lead = null;
  }
  if (lead && lead.name) return { label: lead.name, value: lead.num };
  // a single figure: only a number is re-formatted (a string keeps its quotes, so an empty one still reads as "")
  if (lead && pinIsNumber(pin.expected)) return { label: pin.label, value: lead.num };
  return { label: pin.label, value: pinValueText(pin.expected) };
}

function pinChip(pin: Pin, program: Program, fn: string): AgreementChip {
  const { label, value } = pinLead(pin, fn);
  const files: string[] = [];
  for (const a of pin.args) {
    if (a.kind !== 'dataset') continue;
    const ref = program.datasets?.[a.name];
    const file = ref && ref.hash === a.hash ? (ref.filename ?? ref.name) : a.name;
    if (!files.includes(file)) files.push(file);
  }
  return {
    id: `lock:${pin.id}`,
    t: `${label} = ${value}`,
    p: `Locked · you · ${dayText(pin.pinnedAt)}${files.length ? ` · on ${files.join(', ')}` : ''}`,
    label,
    value,
  };
}

function decisionChip(d: Decision): AgreementChip {
  const reason = d.reason?.trim();
  return { id: `rule:${d.id}`, t: decisionSummary(d), p: `you · ${dayText(d.decidedAt)}${reason ? ` · Why: ${reason}` : ''}` };
}

/** An empty agreement (no function yet, or a spec-less call). */
export function emptyAgreement(): AgreementView {
  const n = { examples: 0, locks: 0, rules: 0 };
  return { counts: countsText(n), n, examples: [], locks: [], rules: [], empty: true, seeded: false, illustrative: false };
}

/**
 * The real agreement of `fn` in `program`. A missing function gives the empty agreement.
 * `opts.seeded` overrides whether it "came with this demo file" (default: the spec's origin is 'example').
 */
export function agreementOf(program: Program, fn: string, opts: { seeded?: boolean } = {}): AgreementView {
  const rec = program.functions[fn];
  if (!rec) return emptyAgreement();
  const { spec } = rec;
  const examples = authoredNames(spec.tests).map((name, i) => ({ id: `ex:${i}:${name}`, t: name, p: 'made-up table with a known answer' }));
  const locks = (spec.pins ?? []).map((pin) => pinChip(pin, program, fn));
  const rules = [
    ...decisionsOf(spec).map(decisionChip),
    ...authoredNames(spec.properties).map((name, i) => ({ id: `prop:${i}:${name}`, t: name, p: 'checked on made-up tables' })),
  ];
  const n = { examples: examples.length, locks: locks.length, rules: rules.length };
  const empty = n.examples + n.locks + n.rules === 0;
  return {
    counts: countsText(n),
    n,
    examples,
    locks,
    rules,
    empty,
    seeded: !empty && (opts.seeded ?? spec.origin === 'example'),
    illustrative: false,
  };
}

/**
 * The start page's compact chip list (V3-Door-FirstRun 356-378): examples as ONE aggregate chip, then locked answers,
 * then house rules. `lock` marks chips that get the lock glyph.
 */
export function compactChips(view: AgreementView): Array<AgreementChip & { lock: boolean }> {
  const out: Array<AgreementChip & { lock: boolean }> = [];
  if (view.n.examples > 0) {
    out.push({
      id: 'ex:all',
      t: plural(view.n.examples, 'example', 'examples'),
      p: view.illustrative ? ILLUSTRATIVE_EXAMPLES_META : 'made-up tables with known answers',
      lock: false,
    });
  }
  for (const c of view.locks) out.push({ ...c, lock: true });
  for (const c of view.rules) out.push({ ...c, lock: false });
  return out;
}

// ───────────────────────── the landing's illustration ─────────────────────────

const ILLUSTRATIVE_EXAMPLES: Array<[string, string]> = [
  ['One order of 2 × $10.00 gives $20.00', 'made-up · 1 row'],
  ['A 25% discount on 4 × $5.00 gives $15.00', 'made-up · 1 row'],
  ['Two customers tied at $50.00 are listed A to Z', 'made-up · 2 rows'],
  ['Seven customers: only the top 5 come back', 'made-up · 7 rows'],
  ['An empty file gives an empty list', 'made-up · 0 rows'],
  ['One customer in two countries is one line', 'made-up · 2 rows'],
];

const ILLUSTRATIVE_RULES: Array<[string, string]> = [
  ['Revenue counts paid orders only', "you · 5 Oct 2026 · Why: refunds and pending orders aren't revenue yet"],
  ['Each order number is counted once', 'you · 5 Oct 2026 · Why: the export repeats some orders'],
];

/**
 * The landing's static agreement (V3-Door-Landing 343-380): 6 examples, 1 locked answer, 2 house rules and the
 * unconfirmed "Revenue is after discounts" assumption. An illustration, not read from any program.
 * `lockValue` lets the caller pass the computed figure (model/figures.ts); it defaults to the verified $2,252.07.
 */
export function illustrativeAgreement(lockValue = '$2,252.07'): AgreementView {
  const examples = ILLUSTRATIVE_EXAMPLES.map(([t, p], i) => ({ id: `ex:${i}`, t, p: `${p} · you · 4 Oct 2026` }));
  const label = 'Chef Ravioli Starbright';
  const locks: AgreementChip[] = [{ id: 'lock:0', t: `${label} = ${lockValue}`, p: 'Locked · you · 5 Oct 2026 · on orders.csv', label, value: lockValue }];
  const rules = ILLUSTRATIVE_RULES.map(([t, p], i) => ({ id: `rule:${i}`, t, p }));
  const n = { examples: examples.length, locks: locks.length, rules: rules.length };
  return {
    counts: countsText(n),
    n,
    examples,
    locks,
    rules,
    empty: false,
    seeded: true,
    illustrative: true,
    assumption: {
      t: 'Revenue is after discounts',
      pendingMeta: "The AI's assumption · not confirmed yet",
      confirmedMeta: 'Confirmed by you · 5 Oct 2026',
    },
  };
}

/** The start page's aggregate example chip in the design reads `made-up tables with known answers · you · 4 Oct 2026`. */
export const ILLUSTRATIVE_EXAMPLES_META = 'made-up tables with known answers · you · 4 Oct 2026';
