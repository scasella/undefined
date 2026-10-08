/**
 * "It asks instead of guessing": the landing's two example questions and their state machine. Pure.
 *
 * 'gap'   = a case your rules don't cover (the engine's real stop-and-ask: a rejection whose diagnostic is silentOn).
 * 'clash' = two rules that disagree. The engine has no such signal (docs/FRONT-DOOR.md honesty rule 3): it is an
 *           illustration only, and the section's small print says so (ASKS_SMALL_PRINT).
 * The clash amounts are computed from the sample rows (every row counted: Puddlesworth Inc $2,599.13).
 */
import { HOUSE_RULES } from '../model/agreements';
import { LADDER_DEFS, ladderLeader, type DataRow } from '../model/figures';

export type AskMode = 'gap' | 'clash';

export interface AsksState {
  mode: AskMode;
  /** Selected option id in each mode (kept when switching between them). */
  gap: string;
  clash: string;
  saved: boolean;
}

export const INITIAL_ASKS: AsksState = { mode: 'gap', gap: 'leave', clash: 'rule', saved: false };

export const ASK_MODES: ReadonlyArray<{ id: AskMode; label: string }> = [
  { id: 'gap', label: "A case your rules don't cover" },
  { id: 'clash', label: 'Two rules that disagree' },
];

export const ASKS_SMALL_PRINT =
  "The two-rules question is an illustration of what we'd ask. Today the checks stop only on cases your rules don't cover.";

export interface AskOption {
  id: string;
  label: string;
  /** The live preview sentence under the options. */
  preview: string;
}

export interface AskQuestion {
  mode: AskMode;
  head: string;
  body: string;
  legend: string;
  /** Radio group name. */
  name: string;
  options: AskOption[];
  selected: string;
  preview: string;
  /** The rule as shown once saved. */
  savedRule: string;
}

export interface ClashFigures {
  /** `Revenue counts paid orders only` */
  rule: string;
  /** `Paid orders only` (the same rule as the ladder names it) */
  ruleShort: string;
  ruleNote: string;
  /** `Puddlesworth Inc` */
  lockedName: string;
  /** `$2,599.13` */
  lockedAmount: string;
  lockedNote: string;
}

const GAP_PREFIX = 'This adds a house rule: ';

export function clashFigures(rows: readonly DataRow[]): ClashFigures {
  const every = ladderLeader(rows, { paidOnly: false, once: false });
  return {
    rule: HOUSE_RULES[0]!.name,
    ruleShort: LADDER_DEFS[1]!.head,
    ruleNote: 'House rule · you · 5 Oct 2026',
    lockedName: every.name,
    lockedAmount: every.amount,
    lockedNote: 'Locked answer · you · 4 Oct 2026 · counts every row',
  };
}

export function gapOptions(): AskOption[] {
  return [
    { id: 'zero', label: 'Show them with $0', preview: `${GAP_PREFIX}customers with only refunded orders are listed with $0.00.` },
    { id: 'leave', label: 'Leave them out of the list', preview: `${GAP_PREFIX}customers with only refunded orders are left out.` },
    { id: 'warn', label: 'Stop and show a warning', preview: `${GAP_PREFIX}if a customer has only refunded orders, stop and show a warning.` },
    { id: 'else', label: 'Something else', preview: "This adds a house rule in your words. We'll read it back to you before anything is checked." },
  ];
}

export function clashOptions(f: ClashFigures): AskOption[] {
  const locked = `${f.lockedName} = ${f.lockedAmount}`;
  return [
    { id: 'rule', label: 'Keep the rule. Unlock that answer.', preview: `${locked} is unlocked. ${f.ruleShort} stays a house rule.` },
    { id: 'lock', label: 'Keep the locked answer. Switch the rule off.', preview: `${f.ruleShort} is switched off. Every later version has to give ${locked}.` },
    { id: 'else', label: 'Something else', preview: "Tell us what you meant. We'll read it back to you before anything is checked." },
  ];
}

/** The saved state's sentence: a gap preview without its "This adds a house rule: " lead-in, capitalised. */
export function savedRuleText(mode: AskMode, preview: string): string {
  if (mode === 'clash') return preview;
  return preview.replace(GAP_PREFIX, '').replace(/^./, (m) => m.toUpperCase());
}

export function askQuestion(state: AsksState, f: ClashFigures): AskQuestion {
  const isGap = state.mode === 'gap';
  const options = isGap ? gapOptions() : clashOptions(f);
  const want = isGap ? state.gap : state.clash;
  const cur = options.find((o) => o.id === want) ?? options[0]!;
  return {
    mode: state.mode,
    head: isGap ? 'What should happen to a customer whose orders were all refunded?' : "Two of your rules can't both be true",
    body: isGap
      ? "We tried a made-up table where that happens. Your house rules don't say."
      : 'Your locked answer counts every row. Your house rule counts paid orders only. No calculation can pass both, so nothing new is shown.',
    legend: isGap ? 'What should happen?' : 'Which one wins?',
    name: isGap ? 'gap-choice' : 'clash-choice',
    options,
    selected: cur.id,
    preview: cur.preview,
    savedRule: savedRuleText(state.mode, cur.preview),
  };
}

// ───────── transitions (the design's showGap / showClash / pick / saveQ / resetQ) ─────────

/** Choosing a kind of question (even the one already shown) reopens it unsaved; each mode keeps its own pick. */
export const showMode = (s: AsksState, mode: AskMode): AsksState => ({ ...s, mode, saved: false });
export const pickOption = (s: AsksState, id: string): AsksState => (s.mode === 'gap' ? { ...s, gap: id } : { ...s, clash: id });
export const saveRule = (s: AsksState): AsksState => ({ ...s, saved: true });
export const showAgain = (s: AsksState): AsksState => ({ ...s, saved: false });
