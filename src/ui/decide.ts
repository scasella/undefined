/**
 * The Decide card's words and its "what will be added" preview (docs/DECIDE-DESIGN.md §6). Pure: built from the
 * engine's GapQuestion (never from model text) and the same decide/decisions.ts builders the engine stores, so the
 * preview is exactly the test that gets added.
 */
import type { AttemptView, Decision, ExpectationPreview, FunctionSpec, GapAlternative, GapQuestion, GapRef, GenerationView, Program } from '../types';
import { decisionName, decisionSummary, decisionTest, ruleDomain, sameOutcome, type RulingSpec } from '../decide/decisions';
import { decidedReason } from '../shared/evidence';
import { failingGate } from './select';

/** What the user has picked in the card: an alternative by id, or "type your own". */
export type DecideSelection = { kind: 'alternative'; id: string } | { kind: 'custom'; expr: string; throws: boolean };

/**
 * Where the rejection's first diagnostic lives. A committed grow points into the artifact's stored candidates (it
 * survives reloads); anything else carries the diagnostic itself.
 */
export function gapRefFor(gen: GenerationView, a: AttemptView, program: Program): GapRef | null {
  const fail = failingGate(a.gates);
  const d = fail?.diagnostics[0];
  if (!fail || !d || (d.kind !== 'test' && d.kind !== 'property') || !d.silentOn) return null;
  const art = program.functions[gen.fn]?.artifact;
  if (gen.kind !== 'recheck' && gen.phase === 'committed' && gen.revision !== undefined && art && art.revision === gen.revision && a.candidate) {
    const i = art.candidates.findIndex((c) => c.id === a.candidate!.id);
    if (i >= 0) return { fn: gen.fn, revision: gen.revision, candidate: i, gate: fail.gate, index: 0 };
  }
  return { fn: gen.fn, diagnostic: d };
}

/** The first rejected attempt of a finished grow whose rejection the user can rule on (for the line under Accepted). */
export function decidableAttempt(gen: GenerationView, program: Program, question: (ref: GapRef) => GapQuestion | null): { attempt: AttemptView; ref: GapRef; q: GapQuestion } | null {
  if (gen.phase !== 'committed' && gen.phase !== 'failed') return null;
  for (const a of gen.attempts) {
    if (a.status !== 'rejected') continue;
    const ref = gapRefFor(gen, a, program);
    const q = ref ? question(ref) : null;
    if (ref && q) return { attempt: a, ref, q };
  }
  return null;
}

/** `The spec didn't say what the median of nothing is.` */
export function questionLine(q: GapQuestion): string {
  return `The spec didn't say ${q.silentOn}.`;
}

/** "returns NaN" / "throws an error" / "returns the same as median([2])" (the value part is set as code). */
export function altParts(alt: Pick<GapAlternative, 'outcome' | 'relational' | 'label'>): { verb: string; value: string | null } {
  if (alt.relational) return { verb: 'returns the same as', value: alt.relational.label.replace(/^same as /, '') };
  if (alt.outcome && 'throws' in alt.outcome) return { verb: 'throws an error', value: null };
  return { verb: 'returns', value: alt.label };
}

/** The small tag after an alternative: where it comes from. Never "the model suggests". */
export function sourceTag(alt: GapAlternative, attempt: number): string {
  switch (alt.source) {
    case 'tests':
      return 'what your tests expect';
    case 'candidate':
      return `what draft #${attempt} did`;
    case 'declared':
      return 'listed by your check';
    case 'common':
      return 'a common choice';
  }
}

/** The ruling a selection stands for, decided exactly as the engine decides it (engine.ts decide). */
export function rulingFor(q: GapQuestion, sel: DecideSelection | null, preview: ExpectationPreview | null): RulingSpec | null {
  if (!sel) return null;
  if (sel.kind === 'alternative') {
    const alt = q.alternatives.find((a) => a.id === sel.id);
    if (!alt || alt.disabled) return null;
    if (alt.relational) return { kind: 'relational', args: alt.relational.args };
    return alt.outcome ? { kind: 'outcome', outcome: alt.outcome } : null;
  }
  if (sel.throws) return { kind: 'outcome', outcome: { throws: true } };
  if (!preview || !preview.ok || sel.expr.trim() === '') return null;
  return preview.outcome && !preview.mentionsFn ? { kind: 'outcome', outcome: preview.outcome } : { kind: 'expr', expr: sel.expr.trim() };
}

/** Whether a ruling agrees with what the failing check expects (then nothing is replaced, and replay can follow). */
export function rulingAgrees(q: GapQuestion, r: RulingSpec | null): boolean {
  const expected = q.alternatives.find((a) => a.source === 'tests')?.outcome;
  return !!r && r.kind === 'outcome' && !!expected && sameOutcome(r.outcome, expected);
}

/** The test (or rule) the ruling adds: a plain sentence and the exact source the engine will store. */
export function testPreview(spec: Pick<FunctionSpec, 'params'>, q: GapQuestion, r: RulingSpec, scope: 'call' | 'rule'): { plain: string; source: string; rule: boolean } {
  const rule = scope === 'rule' && r.kind !== 'relational' ? ruleDomain(spec, q.kind) : null;
  const name = decisionName(q.fn, q.args, r, rule).replace(/^decided: /, '');
  return { plain: `${rule ? 'Adds a rule' : 'Adds a test'}: ${name}.`, source: decisionTest(q.fn, q.args, r, rule), rule: !!rule };
}

/** What deciding will do, said before the button is pressed. */
export function consequenceLines(q: GapQuestion, agrees: boolean, opts: { committed: boolean; replay: boolean }): { lines: string[]; needsLive: boolean } {
  const lines: string[] = [];
  if (agrees) {
    lines.push('This agrees with your tests, so no check is replaced.');
  } else if (q.check.kind === 'test') {
    lines.push(`This replaces your test "${q.check.name}", all of it, not only this call. Add more rulings if it checked other cases.`);
  } else {
    lines.push(`This replaces your check "${q.check.name}" where the spec was silent (${q.silentOn}); it still runs everywhere else.`);
  }
  lines.push(
    opts.committed
      ? `The committed ${q.fn} is re-checked against it. If it passes, nothing is written again; if not, the model writes ${q.fn} again with your ruling.`
      : `The model writes ${q.fn} again with your ruling.`,
  );
  const needsLive = opts.replay && !agrees;
  return { lines, needsLive };
}

/** The replay-mode warning for a ruling no recorded draft was checked against. */
export const REPLAY_NEEDS_LIVE =
  'This page is replaying recorded drafts, and none was checked against this ruling. If the committed function fails it, writing it again needs live mode.';

/** "re-certified" / "re-growing" / null: how a decision just made went, read from the program and the panel. */
export function decisionOutcome(program: Program, gen: GenerationView | null, fn: string, d: Decision | undefined): 'recertified' | 'regrowing' | null {
  const rec = program.functions[fn];
  if (!rec || !d) return null;
  const a = rec.artifact;
  if (a && a.specHash === rec.specHash && a.testsHash === rec.testsHash && a.recertified?.some((r) => r.reason === decidedReason(decisionSummary(d)))) return 'recertified';
  if (gen?.decision?.id === d.id) return 'regrowing';
  return null;
}

/** Said (to screen readers, through the gate panel's announcer) once a decision is removed: what became of the function. */
export function removalMessage(program: Program, fn: string, summary: string): string {
  const rec = program.functions[fn];
  const a = rec?.artifact;
  const live = !!a && a.specHash === rec!.specHash && a.testsHash === rec!.testsHash;
  return live
    ? `Removed your decision ${summary}. ${fn} r${a!.revision} passes the spec without it.`
    : `Removed your decision ${summary}. ${fn} is written again on its next call.`;
}

/** The name of a decision's generated test (`decided: median([]) returns NaN`), read off its stored source. */
export function decisionTestName(d: Pick<Decision, 'test'>): string {
  const m = /^(?:test|property)\(("(?:[^"\\]|\\.)*")/.exec(d.test);
  if (!m) return d.test.split('\n')[0] ?? '';
  try {
    return JSON.parse(m[1]!) as string;
  } catch {
    return m[1]!;
  }
}
