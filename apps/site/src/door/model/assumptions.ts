/**
 * The answer card's honesty lists, built only from real facts:
 *  - "What the AI assumed": the model's own notes on the grown function (ReplEntry output `.note` for an unchecked
 *    grow, else the accepted Candidate's `notes`), split into sentences. No notes → say so.
 *  - "Checked against": what actually ran on the accepted draft (gate results + Evidence + the mutation report).
 *    A check that did not run is never listed.
 *  - "Not checked": always the file's completeness and whether this was the right question, plus cheap, TRUE
 *    data-derived warnings (repeated ids, status values) when no house rule covers them, plus "you haven't set any
 *    yet" when the agreement is empty, or "added after this answer was checked" when the agreement holds
 *    something this answer was never checked against (a lock added afterwards: pins are outside the hashes).
 * Pure: no DOM, no engine calls.
 */
import type { Artifact, Candidate, Decision, Evidence, FunctionSpec, GateResult, MutationReport, Pin } from '@scasella/undefined-engine/types';
import { leadSummary, unitFromQuestion } from './answer';

// ───────────────────────── what the AI assumed ─────────────────────────

export interface AssumptionItem {
  /** Stable for the same text, so a confirmation survives re-renders of the same answer. */
  id: string;
  text: string;
}

export interface AssumptionList {
  items: AssumptionItem[];
  /** Set (and items empty) when the model left no notes. */
  empty: string | null;
}

export const NO_NOTES = 'The AI left no notes about its assumptions.';

function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'as' + (h >>> 0).toString(36);
}

/** Split a note into sentences: on newlines, the engine's ' · ' join, and sentence ends before a capital/digit. */
export function splitSentences(note: string): string[] {
  const out: string[] = [];
  for (const chunk of note.split(/\n+|\s+·\s+/)) {
    // "fn: note" prefixes from a multi-function note stay with their first sentence
    // a leading "fnName: " (the engine's multi-function join) is dropped: the card shows what was assumed, not code names
    const body = chunk.trim().replace(/^[A-Za-z_$][\w$]*:\s+/, '');
    const parts = body.split(/(?<![Ee]\.g\.|[Ii]\.e\.)(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/);
    for (const p of parts) {
      let t = p.trim();
      if (!t) continue;
      t = t.charAt(0).toUpperCase() + t.slice(1);
      if (!/[.!?]$/.test(t)) t += '.';
      out.push(t);
    }
  }
  return out;
}

export function assumptionsFromNote(note: string | null | undefined): AssumptionList {
  const sentences = note ? splitSentences(note) : [];
  if (sentences.length === 0) return { items: [], empty: NO_NOTES };
  const seen = new Map<string, number>();
  const items = sentences.map((text) => {
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return { id: hashId(text) + (n ? `-${n}` : ''), text };
  });
  return { items, empty: null };
}

/** The note to read: the entry's own note (unchecked grows), else the accepted draft's notes on the artifact. */
export function noteFor(entryNote: string | null | undefined, artifact: Artifact | null | undefined): string {
  if (entryNote && entryNote.trim()) return entryNote;
  return acceptedCandidate(artifact)?.notes ?? '';
}

export function acceptedCandidate(artifact: Artifact | null | undefined): Candidate | undefined {
  if (!artifact) return undefined;
  for (let i = artifact.candidates.length - 1; i >= 0; i--) if (artifact.candidates[i]!.verdict === 'accepted') return artifact.candidates[i];
  return undefined;
}

// ───────────────────────── checked against ─────────────────────────

/** The facts the "Checked against" list is made from. Counts are of checks that RAN and passed. */
export interface CheckFacts {
  /** Compile gate passed. */
  compiled: boolean;
  /** Authored unit tests ("examples"), decision tests excluded. */
  examples: number;
  /** Pinned tests ("locked answers"). */
  locked: number;
  /** 'Chef Ravioli Starbright = $2,252.07' when exactly one answer is locked and it has a lead. */
  lockedLabel: string | null;
  /** House rules: user decisions + authored properties. */
  houseRules: number;
  /** Made-up tables the property checks ran on (max runs over properties); 0 when no property ran. */
  madeUpTables: number;
  /** Invariants gate passed (pure + bounded). */
  invariants: boolean;
  /** Mutation check, only when it finished and was not skipped. */
  stress: { total: number; caught: number } | null;
}

export const EMPTY_FACTS: CheckFacts = {
  compiled: false, examples: 0, locked: 0, lockedLabel: null, houseRules: 0, madeUpTables: 0, invariants: false, stress: null,
};

/** Stress test facts from a mutation report: N-way = total − stillborn, caught = killed + killedByBound. */
export function stressFacts(report: MutationReport | undefined): CheckFacts['stress'] {
  if (!report || report.skipped) return null;
  const total = report.total - report.stillborn;
  if (total <= 0) return null;
  return { total, caught: report.killed + report.killedByBound };
}

const gatePassed = (gates: GateResult[] | undefined, id: GateResult['gate']): boolean => gates?.find((g) => g.gate === id)?.status === 'pass';

/**
 * Facts from a committed artifact and its spec. `mutationDone` must be false while the engine's lazy mutation check
 * is still waiting/running for this function (state.mutation), so a stale report is never shown as this run's.
 */
export function checkFactsFrom(input: {
  artifact: Artifact | null | undefined;
  spec: FunctionSpec | null | undefined;
  question?: string;
  mutationDone?: boolean;
}): CheckFacts {
  const { artifact, spec } = input;
  const ev: Evidence | undefined = artifact?.evidence;
  const cand = acceptedCandidate(artifact);
  const gates = cand?.gates;
  if (!artifact || !ev) return { ...EMPTY_FACTS, compiled: gatePassed(gates, 'compile'), invariants: gatePassed(gates, 'invariants') };
  const decisions: Decision[] = spec?.decisions ?? [];
  const authoredProps = Math.max(0, ev.properties.length - (ev.decisionProperties ?? 0));
  const testsRan = gatePassed(gates, 'tests');
  const propsRan = gatePassed(gates, 'properties');
  const examples = testsRan ? Math.max(0, ev.unitTests - (ev.decisions ?? 0)) : 0;
  const locked = ev.pinnedTests;
  const pins: Pin[] = spec?.pins ?? [];
  const lockedLabel = locked === 1 && pins.length === 1 ? leadSummary(pins[0]!.expected, input.question ?? '') : null;
  const houseRules = (testsRan || propsRan ? decisions.length : 0) + (propsRan ? authoredProps : 0);
  const madeUpTables = propsRan && ev.properties.length > 0 ? Math.max(...ev.properties.map((p) => p.runs)) : 0;
  return {
    compiled: ev.compiled && gatePassed(gates, 'compile'),
    examples,
    locked,
    lockedLabel,
    houseRules,
    madeUpTables,
    invariants: gatePassed(gates, 'invariants'),
    stress: input.mutationDone === false ? null : stressFacts(ev.mutation),
  };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Whether the user has set anything the checks hold the AI to. */
export const hasAgreement = (f: CheckFacts): boolean => f.examples + f.locked + f.houseRules > 0;

/**
 * 'your 6 examples', 'your locked answer (Chef Ravioli Starbright = $2,252.07)', 'your 2 house rules on 100 made-up
 * tables', '12-way stress test (11 caught)', 'never changes your data', 'finishes fast'. With no agreement:
 * 'runs without errors', 'never changes your data', 'finishes fast'.
 */
export function checkedList(f: CheckFacts): string[] {
  const out: string[] = [];
  if (!hasAgreement(f) && f.compiled) out.push('runs without errors');
  if (f.examples > 0) out.push(f.examples === 1 ? 'your example' : `your ${f.examples} examples`);
  if (f.locked > 0) out.push(f.locked === 1 ? (f.lockedLabel ? `your locked answer (${f.lockedLabel})` : 'your locked answer') : `your ${f.locked} locked answers`);
  if (f.houseRules > 0) {
    const rules = f.houseRules === 1 ? 'your house rule' : `your ${f.houseRules} house rules`;
    out.push(f.madeUpTables > 0 ? `${rules} on ${plural(f.madeUpTables, 'made-up table', 'made-up tables')}` : rules);
  }
  if (f.stress) out.push(`${f.stress.total}-way stress test (${f.stress.caught} caught)`);
  if (f.invariants) out.push('never changes your data', 'finishes fast');
  return out;
}

// ───────────────────────── not checked ─────────────────────────

/** Cheap facts about the user's rows, for the data-derived "Not checked" warnings. */
export interface DataFacts {
  /** The id-like column ('id', 'orderId', …), or null. */
  idColumn: string | null;
  /** How many id values appear more than once. */
  repeatedIds: number;
  /** The status-like column, or null. */
  statusColumn: string | null;
  /** Its distinct values, in first-seen order (only when there are 2..8 of them). */
  statusValues: string[];
}

const ID_COLUMN = /^(id|order_?id|order_?number|order_?no|invoice_?id|transaction_?id)$/i;
const STATUS_COLUMN = /^(status|order_?status|state|payment_?status)$/i;

/** Work out DataFacts from parsed rows (the rows the user brought; nothing is sent anywhere). */
export function dataFacts(rows: ReadonlyArray<Record<string, unknown>>): DataFacts {
  const facts: DataFacts = { idColumn: null, repeatedIds: 0, statusColumn: null, statusValues: [] };
  const first = rows[0];
  if (!first) return facts;
  const keys = Object.keys(first);
  const idCol = keys.find((k) => ID_COLUMN.test(k)) ?? null;
  if (idCol) {
    const counts = new Map<unknown, number>();
    for (const r of rows) {
      const v = r[idCol];
      if (v === null || v === undefined || v === '') continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    facts.idColumn = idCol;
    facts.repeatedIds = [...counts.values()].filter((n) => n > 1).length;
  }
  const stCol = keys.find((k) => STATUS_COLUMN.test(k)) ?? null;
  if (stCol) {
    const values: string[] = [];
    for (const r of rows) {
      const v = r[stCol];
      if (typeof v === 'string' && v !== '' && !values.includes(v)) values.push(v);
      if (values.length > 8) break;
    }
    if (values.length >= 2 && values.length <= 8) {
      facts.statusColumn = stCol;
      facts.statusValues = values;
    }
  }
  return facts;
}

/** All the words a user's house rules are written in (decision labels, phrases, reasons, what they answer; authored property source). */
export function ruleTexts(spec: FunctionSpec | null | undefined): string[] {
  if (!spec) return [];
  const out: string[] = [];
  for (const d of spec.decisions ?? []) {
    out.push(d.ruling.label, d.call);
    if (d.rule) out.push(d.rule.phrase);
    if (d.reason) out.push(d.reason);
    out.push(d.answers.silentOn, d.answers.check);
  }
  if (spec.properties) out.push(spec.properties);
  return out;
}

const listWords = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export interface NotCheckedInput {
  fileName: string;
  question: string;
  facts: CheckFacts;
  data?: DataFacts | null;
  /** The spec's decisions (a 'duplicates' decision covers repeated ids). */
  decisions?: Decision[];
  /** ruleTexts(spec): what the user's house rules say, for the status check. */
  rules?: string[];
  /** What the user has SET now (the spec: model/agreement.ts counts). Absent: taken to be what ran. */
  set?: { examples: number; locks: number; rules: number };
}

/** `your locked answer`, `your 2 house rules`, `your 6 examples and your locked answer` (only the parts given). */
function yourParts(n: { examples: number; locks: number; rules: number }): string[] {
  const out: string[] = [];
  if (n.examples > 0) out.push(n.examples === 1 ? 'your example' : `your ${n.examples} examples`);
  if (n.locks > 0) out.push(n.locks === 1 ? 'your locked answer' : `your ${n.locks} locked answers`);
  if (n.rules > 0) out.push(n.rules === 1 ? 'your house rule' : `your ${n.rules} house rules`);
  return out;
}

/**
 * What the user set that this answer was never checked against: a kind with something set and nothing run. (Kinds with
 * something run are left alone: their counts can differ for reasons that are not lateness.)
 */
export function setAfterCheck(set: { examples: number; locks: number; rules: number }, f: CheckFacts): { examples: number; locks: number; rules: number } {
  return {
    examples: f.examples === 0 ? set.examples : 0,
    locks: f.locked === 0 ? set.locks : 0,
    rules: f.houseRules === 0 ? set.rules : 0,
  };
}

const MONEYISH = /revenue|amount|total|price|spend|sales|income|profit|money|\$/i;

/**
 * 'whether the 12 repeated order numbers should count twice', 'whether refunded and pending orders should count (your
 * status column has paid, pending and refunded)', 'whether orders.csv is the complete export', 'whether this was the
 * right question', and 'your examples, locked answers and house rules: you haven't set any yet' when nothing is set.
 */
export function notCheckedList(input: NotCheckedInput): string[] {
  const out: string[] = [];
  const rules = (input.rules ?? []).join('\n');
  const d = input.data;
  if (d && d.statusColumn && d.statusValues.length >= 2 && MONEYISH.test(input.question) && !/status|paid|refund|pending|cancel/i.test(rules)) {
    const vals = d.statusValues;
    const paidLike = vals.find((v) => /^(paid|complete|completed|settled|fulfilled)$/i.test(v));
    if (paidLike) {
      const others = vals.filter((v) => v !== paidLike);
      const noun = unitFromQuestion(input.question) || (/order/i.test(input.fileName + ' ' + input.question) ? 'orders' : 'rows');
      out.push(`whether ${listWords(others)} ${noun} should count (your ${d.statusColumn} column has ${listWords(vals)})`);
    } else {
      out.push(`whether every ${d.statusColumn} should count (your ${d.statusColumn} column has ${listWords(vals)})`);
    }
  }
  const dupRuled = (input.decisions ?? []).some((x) => x.kind === 'duplicates') || /\bonce\b|duplicate|repeat|unique|dedup|distinct/i.test(rules);
  if (d && d.idColumn && d.repeatedIds > 0 && !dupRuled) {
    const orders = /order/i.test(d.idColumn) || (/^id$/i.test(d.idColumn) && /order/i.test(input.fileName + ' ' + input.question));
    const noun = orders ? plural(d.repeatedIds, 'repeated order number', 'repeated order numbers') : plural(d.repeatedIds, `repeated ${d.idColumn} value`, `repeated ${d.idColumn} values`);
    out.push(`whether the ${noun} should count twice`);
  }
  if (input.fileName) out.push(`whether ${input.fileName} is the complete export`);
  out.push('whether this was the right question');
  const set = input.set ?? { examples: input.facts.examples, locks: input.facts.locked, rules: input.facts.houseRules };
  const lateSet = setAfterCheck(set, input.facts);
  const late = yourParts(lateSet);
  if (late.length > 0) out.push(`${listWords(late)}: added after this answer was checked`);
  else if (!hasAgreement(input.facts) && set.examples + set.locks + set.rules === 0) out.push("your examples, locked answers and house rules: you haven't set any yet");
  return out;
}
