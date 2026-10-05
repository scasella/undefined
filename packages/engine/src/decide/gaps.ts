/**
 * Spec gaps as questions (docs/DECIDE-DESIGN.md §2). Pure: from a "spec was silent" diagnostic and the spec, the
 * question the Decide card asks and the alternatives it offers. The alternatives are COMPUTED: a fixed table keyed by
 * the gap's kind and the return type, the failing check's own answer, the candidate's observed answer (labelled as
 * such) and whatever the check declared (opt-in `alternatives` marker option). The model never proposes one.
 */
import type { Diagnostic, FunctionSpec, GapAlternative, GapKind, GapQuestion, Json, Outcome } from '../types';
import { decodeValue, encodeValue } from '../shared/serialize';
import { isMap, isSet } from '../shared/show';
import { callLabel, decisionId, lossy, outcomeLabel, ruleDomain, sameOutcome } from './decisions';

// ───────────────────────── classification ─────────────────────────

const PUNCT = /[!-/:-@[-`{-~]/;

function isEmpty(v: unknown): boolean {
  if (v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object' && v !== null) {
    if (isMap(v) || isSet(v)) return v.size === 0;
    const proto = Object.getPrototypeOf(v);
    return (proto === Object.prototype || proto === null) && Object.keys(v).length === 0;
  }
  return false;
}

/** Same-type, same-text values (for "duplicates": ties in a list). Encoded canonical text. */
function hasDuplicates(xs: unknown[]): boolean {
  const seen = new Set<string>();
  for (const x of xs) {
    const k = JSON.stringify(encodeValue(x));
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

/**
 * The gap's kind from the DECODED arguments of the failing call: top-level arguments and the elements of top-level
 * arrays are looked at; the first rule that matches wins (empty, non-finite, negative, non-integer, duplicates,
 * non-ASCII, symbols, other). Only chooses table rows and wording: whether Decide is offered depends on the marker.
 */
export function classifyGap(args: readonly unknown[]): GapKind {
  const flat: unknown[] = [];
  for (const a of args) {
    flat.push(a);
    if (Array.isArray(a)) flat.push(...a);
  }
  if (args.some(isEmpty)) return 'empty';
  const nums = flat.filter((x): x is number => typeof x === 'number');
  const bigs = flat.filter((x): x is bigint => typeof x === 'bigint');
  if (nums.some((n) => !Number.isFinite(n))) return 'non-finite';
  if (nums.some((n) => n < 0 || Object.is(n, -0)) || bigs.some((b) => b < 0n)) return 'negative';
  if (nums.some((n) => !Number.isInteger(n))) return 'non-integer';
  if (args.some((a) => Array.isArray(a) && hasDuplicates(a))) return 'duplicates';
  const strs = flat.filter((x): x is string => typeof x === 'string');
  if (strs.some((s) => [...s].some((ch) => ch.codePointAt(0)! > 0x7f))) return 'non-ascii';
  if (strs.some((s) => PUNCT.test(s))) return 'symbols';
  return 'other';
}

export type ReturnCategory = 'number' | 'bigint' | 'string' | 'boolean' | 'array' | 'other';

/** The category of a TS return type (`number | null` → number, nullable). */
export function returnCategory(type: string | null): { category: ReturnCategory; nullable: boolean; optional: boolean } {
  const t = (type ?? '').trim();
  const parts = t.split('|').map((p) => p.trim()).filter(Boolean);
  const nullable = parts.includes('null');
  const optional = parts.includes('undefined') || parts.includes('void');
  const core = parts.filter((p) => p !== 'null' && p !== 'undefined' && p !== 'void');
  let category: ReturnCategory = 'other';
  if (core.length === 1) {
    const c = core[0]!;
    if (c === 'number') category = 'number';
    else if (c === 'bigint') category = 'bigint';
    else if (c === 'string') category = 'string';
    else if (c === 'boolean') category = 'boolean';
    else if (/\[\]$/.test(c) || /^(Readonly)?Array<.*>$/.test(c) || /^readonly .*\[\]$/.test(c)) category = 'array';
  }
  return { category, nullable, optional };
}

// ───────────────────────── the table ─────────────────────────

interface Row {
  id: string;
  outcome: Outcome;
  /** Only selectable when the return type admits undefined. */
  needsUndefined?: boolean;
}

const THROWS: Outcome = { throws: true };
const value = (v: unknown): Outcome => ({ returns: encodeValue(v) });

/** Table rows by gap kind × return category (docs/DECIDE-DESIGN.md §2.2). */
export function tableRows(kind: GapKind, category: ReturnCategory): Row[] {
  const rows: Row[] = [];
  const add = (id: string, outcome: Outcome, extra: Partial<Row> = {}): void => void rows.push({ id, outcome, ...extra });
  if (kind === 'empty') {
    add('throws', THROWS);
    if (category === 'number') {
      add('nan', value(NaN));
      add('zero', value(0));
      add('undefined', value(undefined), { needsUndefined: true });
    } else if (category === 'bigint') add('zero-n', value(0n));
    else if (category === 'string') add('empty-string', value(''));
    else if (category === 'array') add('empty-array', value([]));
    else if (category === 'boolean') add('false', value(false));
  } else if (kind === 'non-finite') {
    if (category === 'number') {
      add('throws', THROWS);
      add('nan', value(NaN));
    }
  } else if (kind === 'negative') {
    if (category === 'number') {
      add('throws', THROWS);
      add('nan', value(NaN));
      add('zero', value(0));
    } else if (category === 'bigint') {
      add('throws', THROWS);
      add('zero-n', value(0n));
    }
  } else if (kind === 'non-integer') {
    if (category === 'number') {
      add('throws', THROWS);
      add('nan', value(NaN));
    }
  }
  return rows;
}

// ───────────────────────── the question ─────────────────────────

export interface GapInput {
  spec: Pick<FunctionSpec, 'name' | 'params' | 'returns' | 'decisions'>;
  diagnostic: Diagnostic;
  /** The artifact's recorded return type, used when the spec declares none. */
  returnType?: string;
}

function shownOf(o: Outcome, error?: string): string {
  if ('throws' in o) return error ? `threw ${error}` : 'threw';
  return outcomeLabel(o);
}

/**
 * The Decide card's content, or null when the diagnostic cannot be decided: no applying silentOn marker, no exact
 * call (the executor sets args/expectedOutcome/actualOutcome only then), or an argument that cannot be written back.
 */
export function gapQuestion(input: GapInput): GapQuestion | null {
  const d = input.diagnostic;
  if (d.kind !== 'test' && d.kind !== 'property') return null;
  if (!d.silentOn || !d.args || !d.expectedOutcome || !d.actualOutcome) return null;
  if (d.args.some(lossy)) return null;
  let decoded: unknown[];
  try {
    decoded = d.args.map((a) => decodeValue(a));
  } catch {
    return null;
  }
  const fn = input.spec.name;
  const kind = classifyGap(decoded);
  const ret = returnCategory(input.spec.returns ?? input.returnType ?? null);
  const expected = d.expectedOutcome;
  const actual = d.actualOutcome;
  const alternatives: GapAlternative[] = [];
  const push = (a: Omit<GapAlternative, 'agrees'>): void => {
    if (a.outcome && alternatives.some((x) => x.outcome && sameOutcome(x.outcome, a.outcome!))) return;
    alternatives.push({ ...a, agrees: a.outcome !== undefined && sameOutcome(a.outcome, expected) });
  };
  push({ id: 'tests', label: outcomeLabel(expected), source: 'tests', outcome: expected });
  push({ id: 'candidate', label: outcomeLabel(actual), source: 'candidate', outcome: actual });
  for (const row of tableRows(kind, ret.category)) {
    const disabled =
      row.needsUndefined && !ret.optional
        ? `Your signature says \`${input.spec.returns ?? input.returnType ?? 'its return type'}\`; returning undefined needs the return type changed (Edit spec).`
        : undefined;
    push({ id: row.id, label: outcomeLabel(row.outcome), source: 'common', outcome: row.outcome, ...(disabled ? { disabled } : {}) });
  }
  if (kind === 'empty' && ret.nullable) push({ id: 'null', label: 'null', source: 'common', outcome: { returns: null } });
  // relational rows (non-integer, one number parameter): "the same as f(floor x)" / "the same as f(round x)"
  if (kind === 'non-integer' && input.spec.params.length === 1 && input.spec.params[0]!.type.trim() === 'number' && typeof decoded[0] === 'number') {
    const x = decoded[0];
    const targets: Array<[string, number]> = [['floor', Math.floor(x)]];
    if (Math.round(x) !== Math.floor(x)) targets.push(['round', Math.round(x)]);
    for (const [id, y] of targets) {
      const args: Json[] = [encodeValue(y)];
      const label = `same as ${callLabel(fn, args)}`;
      alternatives.push({ id, label, source: 'common', relational: { args, label }, agrees: false });
    }
  }
  for (const [i, a] of (d.alternatives ?? []).entries()) push({ id: `declared-${i}`, label: a.label, source: 'declared', outcome: a.outcome });
  // A property marked silent on EVERY input (no `when`): a disagreeing ruling would waive the whole property, which
  // would weaken the spec far beyond the one call ruled on. Only an agreeing ruling is offered.
  const onlyAgreeing =
    d.kind === 'property' && d.everyInput
      ? `The property "${d.name}" says the spec was silent on every input (its marker has no \`when\`), so replacing it for this call would switch it off everywhere. Only its own answer can be decided here; to rule otherwise, give the marker a \`when\` or edit the property (Edit spec).`
      : undefined;
  if (onlyAgreeing) {
    for (const a of alternatives) if (!a.agrees && !a.disabled) a.disabled = onlyAgreeing;
  }

  const checkKind = d.kind;
  const gate = d.kind === 'test' ? 'tests' : 'properties';
  const rule = ruleDomain(input.spec, kind);
  const ids = (['tests', 'properties'] as const).map((placement) => decisionId(d.args!, { checkKind, check: d.name }, placement));
  const existing = (input.spec.decisions ?? []).find((x) => ids.includes(x.id));
  const q: GapQuestion = {
    fn,
    kind,
    call: callLabel(fn, d.args),
    args: d.args,
    silentOn: d.silentOn,
    check: { name: d.name, kind: checkKind, gate },
    expectedShown: shownOf(expected),
    actualShown: shownOf(actual, d.error),
    alternatives,
  };
  if (d.reasonable) q.reasonable = d.reasonable;
  if (rule) q.ruleScope = { label: `for ${rule.phrase}` };
  if (existing) q.existing = existing.id;
  if (onlyAgreeing) q.onlyAgreeing = onlyAgreeing;
  return q;
}
