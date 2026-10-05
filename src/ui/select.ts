/** Pure view selectors over EngineState pieces. No business logic: only "what to show". */
import type {
  AttemptView,
  Diagnostic,
  FunctionRecord,
  FunctionSpec,
  GateId,
  GateResult,
  GenerationView,
  Program,
  SpecPatch,
} from '../types';
import { stripRejected } from './format';

export function failingGate(gates: GateResult[]): GateResult | undefined {
  return gates.find((g) => g.status === 'fail');
}

/** UI-local selection in the retry strip. null = follow the latest attempt. */
export interface AttemptSelection {
  genId: string;
  attempt: number;
}

export function resolveAttempt(gen: GenerationView | null, sel: AttemptSelection | null): AttemptView | undefined {
  if (!gen || gen.attempts.length === 0) return undefined;
  if (sel && sel.genId === gen.id) {
    const hit = gen.attempts.find((a) => a.attempt === sel.attempt);
    if (hit) return hit;
  }
  return gen.attempts[gen.attempts.length - 1];
}

/**
 * The attempt the gate panel judges. Unlike the code pane (which follows the newest candidate as it
 * types in), the gate panel keeps showing the last verdict while the next candidate has no gates yet,
 * so the rejection headline stays on screen during the retry.
 */
export function gateAttempt(gen: GenerationView | null, sel: AttemptSelection | null): AttemptView | undefined {
  if (!gen || gen.attempts.length === 0) return undefined;
  if (sel && sel.genId === gen.id) {
    const hit = gen.attempts.find((a) => a.attempt === sel.attempt);
    if (hit) return hit;
  }
  for (let i = gen.attempts.length - 1; i >= 0; i--) {
    if (gen.attempts[i].gates.length > 0) return gen.attempts[i];
  }
  return gen.attempts[gen.attempts.length - 1];
}

/**
 * The attempt the code pane shows. An explicit selection is honoured as-is. Following the latest attempt,
 * a new attempt that has not typed a single character yet does not blank the pane: the previous candidate
 * (usually the rejected one whose verdict the gate panel still shows) stays up, marked `holdover`, until
 * the new candidate's first characters arrive. An aborted attempt is never covered up: its placeholder is the news.
 */
export function codeAttempt(
  gen: GenerationView | null,
  sel: AttemptSelection | null,
): { attempt: AttemptView; holdover: boolean } | undefined {
  if (!gen || gen.attempts.length === 0) return undefined;
  if (sel && sel.genId === gen.id) {
    const hit = gen.attempts.find((a) => a.attempt === sel.attempt);
    if (hit) return { attempt: hit, holdover: false };
  }
  const latest = gen.attempts[gen.attempts.length - 1];
  const empty = latest.shown.length === 0 && (latest.status === 'generating' || latest.status === 'typing');
  if (empty) {
    for (let i = gen.attempts.length - 2; i >= 0; i--) {
      if (gen.attempts[i].shown.length > 0) return { attempt: gen.attempts[i], holdover: true };
    }
  }
  return { attempt: latest, holdover: false };
}

export function isLatestAttempt(gen: GenerationView, a: AttemptView): boolean {
  return gen.attempts[gen.attempts.length - 1]?.attempt === a.attempt;
}

export function rejectingGateOf(a: AttemptView): GateId | undefined {
  return a.candidate?.rejectedBy ?? failingGate(a.gates)?.gate;
}

export function headlineOf(a: AttemptView): string | undefined {
  return a.candidate?.headline ?? failingGate(a.gates)?.headline;
}

/** Retry-strip chip text, e.g. "#1 rejected by properties — median([1, 2]) returned 1, expected 1.5". */
export function chipText(a: AttemptView): string {
  switch (a.status) {
    case 'rejected': {
      const gate = rejectingGateOf(a);
      const h = stripRejected(headlineOf(a));
      return `#${a.attempt} rejected${gate ? ` by ${gate}` : ''}${h ? ` — ${h}` : ''}`;
    }
    case 'accepted':
      return `#${a.attempt} accepted — passed every gate`;
    case 'aborted':
      return a.candidate?.declined ? `#${a.attempt} declined — ${a.candidate.declined.message}` : `#${a.attempt} aborted`;
    case 'generating':
      return `#${a.attempt} generating…`;
    case 'typing':
      return `#${a.attempt} arriving…`;
    case 'gating':
      return `#${a.attempt} at the gates…`;
  }
}

export type FunctionStatus =
  | { kind: 'certified'; revision: number }
  | { kind: 'stale'; what: 'spec' | 'tests' | 'spec and tests' }
  | { kind: 'none' };

export function functionStatus(rec: FunctionRecord): FunctionStatus {
  const a = rec.artifact;
  if (!a) return { kind: 'none' };
  const specChanged = a.specHash !== rec.specHash;
  const testsChanged = a.testsHash !== rec.testsHash;
  if (specChanged && testsChanged) return { kind: 'stale', what: 'spec and tests' };
  if (specChanged) return { kind: 'stale', what: 'spec' };
  if (testsChanged) return { kind: 'stale', what: 'tests' };
  return { kind: 'certified', revision: a.revision };
}

/** The Draft pane's chip for the last committed function: never "Certified" once its spec or tests changed. */
export function committedChip(rec: FunctionRecord): { label: string; cls: string; title: string } | null {
  const s = functionStatus(rec);
  if (s.kind === 'none') return null;
  const rev = rec.artifact!.revision;
  return s.kind === 'stale'
    ? { label: `Out of date (r${rev})`, cls: 'fs-stale', title: `Accepted at r${rev}; its ${s.what} changed since, so it is written again on its next call.` }
    : { label: `Certified r${rev}`, cls: 'st-accepted', title: 'Written by the model, accepted by the checks. Read-only.' };
}

export function functionStatusText(s: FunctionStatus): string {
  switch (s.kind) {
    case 'certified':
      return `certified r${s.revision}`;
    case 'stale':
      return `invalid: ${s.what} changed — regenerates on next call`;
    case 'none':
      return 'no code yet — written on the first call';
  }
}

/** `function median(numbers: number[]): number` — return type from the spec, else the recorded inferred one. */
export function signatureOf(spec: FunctionSpec, inferredReturn?: string): string {
  const params = spec.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const ret = spec.returns ?? inferredReturn;
  return `function ${spec.name}(${params})${ret ? `: ${ret}` : ''}`;
}

/** The most recently committed function, for the code pane when there is no generation. */
export function latestCommitted(program: Program): FunctionRecord | undefined {
  let best: FunctionRecord | undefined;
  for (const rec of Object.values(program.functions)) {
    if (rec.artifact && (!best || rec.artifact.committedAt > (best.artifact?.committedAt ?? -Infinity))) best = rec;
  }
  return best;
}

export interface SpecDraft {
  doc: string;
  tests: string;
  properties: string;
  budgetMs: number;
  maxAttempts: number;
}

export function draftOf(spec: FunctionSpec): SpecDraft {
  return {
    doc: spec.doc,
    tests: spec.tests,
    properties: spec.properties,
    budgetMs: spec.budgetMs,
    maxAttempts: spec.maxAttempts,
  };
}

/** Only the fields that differ, so editSpec never touches what the user did not change. */
export function specPatch(spec: FunctionSpec, draft: SpecDraft): SpecPatch {
  const patch: SpecPatch = {};
  if (draft.doc !== spec.doc) patch.doc = draft.doc;
  if (draft.tests !== spec.tests) patch.tests = draft.tests;
  if (draft.properties !== spec.properties) patch.properties = draft.properties;
  if (draft.budgetMs !== spec.budgetMs) patch.budgetMs = draft.budgetMs;
  if (draft.maxAttempts !== spec.maxAttempts) patch.maxAttempts = draft.maxAttempts;
  return patch;
}

/** "who decided" line under a diagnostic, built only from fields the gate actually reported. */
export function attribution(d: Diagnostic, gate: GateId): string {
  const parts = [`by gate: ${gate}`];
  switch (d.kind) {
    case 'compile':
      parts.push(`TS${d.code}`, `line ${d.line}:${d.col}`);
      break;
    case 'test':
      parts.push(`test "${d.name}"`);
      break;
    case 'property':
      parts.push(`property "${d.name}"`, `seed ${d.seed}`, `shrunk in ${d.shrinks} step${d.shrinks === 1 ? '' : 's'}`);
      parts.push(`${d.runs} run${d.runs === 1 ? '' : 's'}`);
      break;
    case 'invariant':
      parts.push(`invariant: ${d.invariant}`);
      if (d.phase) parts.push(`during ${d.phase}`);
      break;
  }
  return parts.join(' · ');
}

/** Compile diagnostics grouped by body line (1-based), for marking lines in the code pane. */
export function compileMarks(gates: GateResult[]): Map<number, Extract<Diagnostic, { kind: 'compile' }>[]> {
  const marks = new Map<number, Extract<Diagnostic, { kind: 'compile' }>[]>();
  const compile = gates.find((g) => g.gate === 'compile');
  if (!compile || compile.status !== 'fail') return marks;
  for (const d of compile.diagnostics) {
    if (d.kind !== 'compile') continue;
    const list = marks.get(d.line) ?? [];
    list.push(d);
    marks.set(d.line, list);
  }
  return marks;
}

/**
 * What the New-function-spec form starts with when "Write a spec"/"Edit the spec" points at a function that has no
 * spec yet: the parameters of the generation that just failed for it (inferred from the call, e.g. `arg0: string`)
 * and, when the model declined for lack of a spec, its question as the doc placeholder. null when the current
 * generation is about another function.
 */
export function newSpecPrefill(gen: GenerationView | null, fn: string): { params: string; docPlaceholder?: string } | null {
  if (!gen || gen.fn !== fn) return null;
  const head = `function ${fn}(`;
  if (!gen.signature.startsWith(head)) return null;
  let depth = 1;
  let end = -1;
  for (let i = head.length; i < gen.signature.length; i++) {
    const c = gen.signature[i];
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const out: { params: string; docPlaceholder?: string } = { params: gen.signature.slice(head.length, end) };
  if (gen.declined?.reason === 'needs-spec') out.docPlaceholder = gen.declined.message;
  return out;
}

/** REPL input history (oldest first) derived from the transcript. */
export function inputHistory(entries: { kind: string; text?: string }[]): string[] {
  return entries.filter((e) => e.kind === 'input' && typeof e.text === 'string').map((e) => e.text as string);
}

/**
 * The value the newest REPL call returned (the payoff of a generation), for the accepted headline: the first output
 * after the last input. null when that call has not returned, returned a table, or returned something too long to
 * read in a headline.
 */
export function lastCallValue(entries: ReadonlyArray<{ kind: string; value?: string; table?: unknown }>, maxLen = 32): string | null {
  let from = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.kind === 'input') {
      from = i + 1;
      break;
    }
  }
  const out = entries.slice(from).find((e) => e.kind === 'output');
  if (!out || out.table || typeof out.value !== 'string' || out.value.length > maxLen) return null;
  return out.value;
}

/** The function name a REPL line calls (`median([1])` → median), or null. */
export function calledName(input: string): string | null {
  const m = /^\s*(?:[A-Za-z_$][\w$]*\s*=\s*)?([A-Za-z_$][\w$]*)\s*\(/.exec(input);
  return m ? m[1]! : null;
}
