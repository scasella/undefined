/**
 * Decisions: rulings the user made where a check said the spec was silent (docs/DECIDE-DESIGN.md §1, §3).
 * Pure and light (no fast-check, no sandbox modules): the engine, the prompt, eject and the UI all share it.
 *
 * - effectiveChecks(spec): the spec's tests and properties with the decisions' generated source appended, plus the
 *   checks they waive. With no decisions it returns the spec's own strings unchanged (so nothing that runs, lists or
 *   counts checks changes for a spec without decisions).
 * - decisionTest(): the generated test source. Literals come from shared/literal.ts tsLiteral over the ENCODED
 *   arguments and value, so NaN, -0, undefined, bigint, Map and Set are written exactly and `eq` compares them exactly.
 * - Outcomes are compared on their encoded form (canonical JSON): no deepEqual import, which would pull the sandbox
 *   (and fast-check) into the main bundle. Map/Set entries compare in order, so two such values that eq() would call
 *   equal can compare unequal here; the consequence is only that the ruling is treated as waiving (never replays).
 */
import type { Decision, DecisionAnswers, DecisionRuling, FunctionSpec, GapKind, Json, Outcome, WaivedCheck } from '../types';
import { decodeValue } from '../shared/serialize';
import { show } from '../shared/show';
import { tsLiteral } from '../shared/literal';

/** The comment line that starts the decisions block appended to the effective tests / properties. */
export const DECISIONS_HEADER = '// Decisions (decided by you; listed in the Repo tab)';
/** Every decision test's name starts with this. */
export const DECIDED_PREFIX = 'decided: ';

export interface EffectiveChecks {
  tests: string;
  properties: string;
  waived: WaivedCheck[];
}

export function decisionsOf(spec: Pick<FunctionSpec, 'decisions'>): Decision[] {
  return spec.decisions ?? [];
}

function appendBlock(base: string, sources: string[]): string {
  if (sources.length === 0) return base;
  const head = base.replace(/\s+$/, '');
  return `${head}${head === '' ? '' : '\n\n'}${DECISIONS_HEADER}\n${sources.join('\n')}\n`;
}

export function effectiveChecks(spec: Pick<FunctionSpec, 'tests' | 'properties' | 'decisions'>): EffectiveChecks {
  const ds = decisionsOf(spec);
  if (ds.length === 0) return { tests: spec.tests, properties: spec.properties, waived: [] };
  return {
    tests: appendBlock(spec.tests, ds.filter((d) => d.placement === 'tests').map((d) => d.test)),
    properties: appendBlock(spec.properties, ds.filter((d) => d.placement === 'properties').map((d) => d.test)),
    waived: waivedBy(ds),
  };
}

/** The distinct checks the waiving decisions switch off on their silent domain. */
export function waivedBy(ds: readonly Decision[]): WaivedCheck[] {
  const out: WaivedCheck[] = [];
  for (const d of ds) {
    if (!d.waives) continue;
    if (!out.some((w) => w.kind === d.answers.checkKind && w.name === d.answers.check)) out.push({ kind: d.answers.checkKind, name: d.answers.check });
  }
  return out;
}

/** Whether every decision agrees with the check it answers (none waives): the recorded checks implied them. */
export function allImplied(spec: Pick<FunctionSpec, 'decisions'>): boolean {
  const ds = decisionsOf(spec);
  return ds.length > 0 && ds.every((d) => !d.waives);
}

/** The spec without its decisions (the field removed, so it hashes as the spec did before them). */
export function withoutDecisions(spec: FunctionSpec): FunctionSpec {
  const { decisions: _d, ...rest } = spec;
  return rest;
}

// ───────────────────────── outcomes ─────────────────────────

/** Canonical JSON (object keys sorted) of an encoded value: equal strings ⇔ equal encoded values. */
export function canonical(j: Json): string {
  if (j === null || typeof j !== 'object') return JSON.stringify(j);
  if (Array.isArray(j)) return `[${j.map(canonical).join(',')}]`;
  return `{${Object.keys(j)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(j[k]!)}`)
    .join(',')}}`;
}

export function sameOutcome(a: Outcome, b: Outcome): boolean {
  if ('throws' in a || 'throws' in b) return 'throws' in a && 'throws' in b;
  return canonical(a.returns) === canonical(b.returns);
}

/** `NaN`, `"dont-stop"`, `throws` (display text of an outcome). */
export function outcomeLabel(o: Outcome): string {
  if ('throws' in o) return 'throws';
  try {
    return show(decodeValue(o.returns));
  } catch {
    return '…';
  }
}

/** Whether an encoded value contains an `unserializable` placeholder anywhere (it cannot be written as a literal). */
export function lossy(j: Json): boolean {
  if (j === null || typeof j !== 'object') return false;
  if (Array.isArray(j)) return j.some(lossy);
  if (Object.prototype.hasOwnProperty.call(j, '$t')) {
    if (j.$t === 'unserializable') return true;
    const v = j.v;
    if (j.$t === 'object' && v !== null && typeof v === 'object' && !Array.isArray(v)) return Object.keys(v).some((k) => lossy(v[k]!));
    return v !== undefined && lossy(v);
  }
  return Object.keys(j).some((k) => lossy(j[k]!));
}

/** `median([])` from the encoded arguments (display only: show() may cut long values). */
export function callLabel(fn: string, args: readonly Json[]): string {
  return `${fn}(${args.map((a) => {
    try {
      return show(decodeValue(a));
    } catch {
      return '…';
    }
  }).join(', ')})`;
}

/** `median([])` as source: every argument a literal built from its encoded form. */
export function callSource(fn: string, args: readonly Json[], indent = '  '): string {
  return `${fn}(${args.map((a) => tsLiteral(a, indent)).join(', ')})`;
}

// ───────────────────────── rule scope ─────────────────────────

/** A rule (property) ruling's domain: one number/bigint parameter and a rule kind (docs/DECIDE-DESIGN.md §3.3). */
export interface RuleDomain {
  kind: 'negative' | 'non-integer' | 'non-finite';
  param: string;
  /** fast-check arbitrary source, e.g. `fc.integer({ max: -1 })`. */
  arbitrary: string;
  /** `every negative n` */
  phrase: string;
  /** TS type of the parameter (for the predicate's annotation). */
  type: 'number' | 'bigint';
}

export function ruleDomain(spec: Pick<FunctionSpec, 'params'>, kind: GapKind): RuleDomain | null {
  if (spec.params.length !== 1) return null;
  const p = spec.params[0]!;
  const type = p.type.trim();
  if (type !== 'number' && type !== 'bigint') return null;
  if (kind === 'negative') {
    return type === 'number'
      ? { kind, param: p.name, type, arbitrary: 'fc.integer({ max: -1 })', phrase: `every negative ${p.name}` }
      : { kind, param: p.name, type, arbitrary: 'fc.bigInt({ max: -1n })', phrase: `every negative ${p.name}` };
  }
  if (type !== 'number') return null;
  if (kind === 'non-integer') {
    return { kind, param: p.name, type, arbitrary: 'fc.double({ noInteger: true, noNaN: true, noDefaultInfinity: true })', phrase: `every non-integer ${p.name}` };
  }
  if (kind === 'non-finite') return { kind, param: p.name, type, arbitrary: 'fc.constantFrom(NaN, Infinity, -Infinity)', phrase: `every non-finite ${p.name}` };
  return null;
}

// ───────────────────────── generated source ─────────────────────────

/** What the user ruled, in the shape decisionTest needs (relational = "same as f(otherArgs)"). */
export type RulingSpec =
  | { kind: 'outcome'; outcome: Outcome }
  | { kind: 'expr'; expr: string }
  | { kind: 'relational'; args: Json[] };

/** The test's name: `decided: median([]) returns NaN` (read by the model as a check name). */
export function decisionName(fn: string, args: readonly Json[], r: RulingSpec, rule?: RuleDomain | null): string {
  const what =
    r.kind === 'outcome'
      ? 'throws' in r.outcome
        ? 'throws'
        : `returns ${outcomeLabel(r.outcome)}`
      : r.kind === 'expr'
        ? `returns ${r.expr.replace(/\s+/g, ' ').trim()}`
        : `is the same as ${callLabel(fn, r.args)}`;
  if (rule) return `${DECIDED_PREFIX}for ${rule.phrase}, ${fn}(${rule.param}) ${what}`;
  return `${DECIDED_PREFIX}${callLabel(fn, args)} ${what}`;
}

function assertion(fn: string, call: string, r: RulingSpec): string {
  if (r.kind === 'expr') return `eq(${call}, (${r.expr}));`;
  if (r.kind === 'relational') return `eq(${call}, ${callSource(fn, r.args)});`;
  const o = r.outcome;
  return 'throws' in o ? `throws(() => ${call});` : `eq(${call}, ${tsLiteral(o.returns, '  ')});`;
}

/** Generated test source (unit test, or a property for a rule ruling). Stored verbatim on the Decision and hashed. */
export function decisionTest(fn: string, args: readonly Json[], r: RulingSpec, rule?: RuleDomain | null): string {
  const name = JSON.stringify(decisionName(fn, args, r, rule));
  if (rule) {
    const p = rule.param;
    return `property(${name}, [${rule.arbitrary}], (${p}: ${rule.type}) => {\n  ${assertion(fn, `${fn}(${p})`, r)}\n});`;
  }
  return `test(${name}, () => {\n  ${assertion(fn, callSource(fn, args), r)}\n});`;
}

/** Small sync content hash (FNV-1a, 32 bit) for decision ids: deterministic, never security-relevant. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The id of a decision on this call of this check: deciding the same call again replaces it. */
export function decisionId(args: readonly Json[], answers: Pick<DecisionAnswers, 'checkKind' | 'check'>, placement: Decision['placement']): string {
  return `d-${fnv(canonical([args as Json[], answers.checkKind, answers.check, placement]))}`;
}

export interface BuildDecisionInput {
  fn: string;
  kind: GapKind;
  args: Json[];
  ruling: RulingSpec;
  answers: DecisionAnswers;
  /** What the answered check expected at this call; absent means the ruling is treated as waiving. */
  expected?: Outcome;
  rule?: RuleDomain | null;
  decidedAt: number;
  reason?: string;
}

/** Whether a ruling agrees with what the check expected (then it waives nothing and the decision is "implied"). */
export function agrees(r: RulingSpec, expected: Outcome | undefined): boolean {
  return r.kind === 'outcome' && expected !== undefined && sameOutcome(r.outcome, expected);
}

export function buildDecision(i: BuildDecisionInput): Decision {
  const placement: Decision['placement'] = i.rule ? 'properties' : 'tests';
  const ruling: DecisionRuling =
    i.ruling.kind === 'outcome'
      ? { kind: 'outcome', outcome: i.ruling.outcome, label: outcomeLabel(i.ruling.outcome) }
      : i.ruling.kind === 'expr'
        ? { kind: 'expr', expr: i.ruling.expr, label: i.ruling.expr.replace(/\s+/g, ' ').trim() }
        : { kind: 'expr', expr: callSource(i.fn, i.ruling.args, ''), label: `same as ${callLabel(i.fn, i.ruling.args)}` };
  const d: Decision = {
    id: decisionId(i.args, i.answers, placement),
    kind: i.kind,
    call: callLabel(i.fn, i.args),
    args: i.args,
    ruling,
    placement,
    answers: i.answers,
    waives: !agrees(i.ruling, i.expected),
    test: decisionTest(i.fn, i.args, i.ruling, i.rule),
    decidedAt: i.decidedAt,
  };
  if (i.rule) d.rule = { phrase: i.rule.phrase, param: i.rule.param };
  const reason = i.reason?.replace(/\s+/g, ' ').trim();
  if (reason) d.reason = reason;
  return d;
}

/** Replace a decision with the same id, or append it. */
export function upsertDecision(list: readonly Decision[], d: Decision): Decision[] {
  const at = list.findIndex((x) => x.id === d.id);
  if (at < 0) return [...list, d];
  const out = [...list];
  out[at] = d;
  return out;
}

// ───────────────────────── text ─────────────────────────

/** `median([]) → throws` / `for every negative n: throws` (Repo rows, revision titles). */
export function decisionSummary(d: Decision): string {
  return d.rule ? `for ${d.rule.phrase}: ${d.ruling.label}` : `${d.call} → ${d.ruling.label}`;
}

/** One line of the prompt's DECISIONS section (the reason is never sent). */
export function decisionPromptLine(fn: string, d: Decision): string {
  const subject = d.rule ? `For ${d.rule.phrase}, ${fn}(${d.rule.param})` : d.call;
  const r = d.ruling;
  if (r.kind === 'outcome') return `- ${subject} must ${'throws' in r.outcome ? 'throw an Error' : `return ${r.label}`}.`;
  if (r.label.startsWith('same as ')) return `- ${subject} must return the ${r.label}.`;
  return `- ${subject} must return the value of: ${r.label}`;
}

/**
 * `decided by you on 4 Oct 2026`, in the viewer's own calendar: a decision made on the evening of 4 Oct in New York
 * is 5 Oct in UTC, and "decided by you on 5 Oct" would be false to the person who made it.
 */
export function decidedOn(at: number): string {
  const d = new Date(at);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `decided by you on ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** The note the brief asks for: `decided by you on <date>: <reason>`. */
export function decisionNote(d: Pick<Decision, 'decidedAt' | 'reason'>): string {
  return d.reason ? `${decidedOn(d.decidedAt)}: ${d.reason}` : decidedOn(d.decidedAt);
}

/** `replaces "agrees with a sort-based reference" for empty lists` / null when nothing is waived. */
export function waiverText(d: Decision): string | null {
  if (!d.waives) return null;
  const what = d.answers.checkKind === 'test' ? `the test "${d.answers.check}"` : `the property "${d.answers.check}"`;
  return d.answers.checkKind === 'test' ? `replaces ${what}` : `replaces ${what} where the spec was silent (${d.answers.silentOn})`;
}
