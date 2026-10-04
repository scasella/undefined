/**
 * Result construction shared by the in-worker executor and the main-thread runner, so both apply the
 * attribution rule (docs/DESIGN.md "Gate semantics" 4–5) identically.
 */
import type { Diagnostic, GateId, GateResult } from '../types';

export type ExecPhase = 'tests' | 'properties' | 'invariants';
export const EXEC_PHASES: readonly ExecPhase[] = ['tests', 'properties', 'invariants'];

export const INTERRUPTED_NOTE = 'interrupted: invariant violated';

export function notReached(gate: GateId): GateResult {
  return { gate, status: 'skipped', ms: 0, summary: 'not reached', diagnostics: [], note: 'not reached' };
}

export function interrupted(gate: GateId, ms = 0): GateResult {
  return { gate, status: 'skipped', ms, summary: 'interrupted', diagnostics: [], note: INTERRUPTED_NOTE };
}

type InvariantDiagnostic = Extract<Diagnostic, { kind: 'invariant' }>;

/**
 * `Rejected: fibonacci(90) did not return within 1500 ms (bounded)`, `Rejected: median([2, 1]) mutated its argument (pure)`.
 * Bounded messages are full sentences; pure replay messages ("mutated its argument") get the call as subject.
 */
export function invariantHeadline(d: InvariantDiagnostic): string {
  const needsSubject = d.invariant === 'pure' && d.call && !d.message.startsWith('candidate ') && !d.message.startsWith(d.call);
  const subject = needsSubject ? `${d.call} ` : '';
  return `Rejected: ${subject}${d.message} (${d.invariant})`;
}

export function invariantFailure(d: InvariantDiagnostic, ms: number): GateResult {
  return {
    gate: 'invariants',
    status: 'fail',
    ms,
    summary: `${d.invariant} violated`,
    headline: invariantHeadline(d),
    diagnostics: [d],
  };
}

/**
 * The attribution rule: an invariant violation observed while `phase` was running is reported by the
 * Invariants gate. Phases that completed keep their results (taken from `completed`); the interrupted
 * phase and every later non-invariants phase become `skipped` with the interrupted note.
 */
export function applyAttribution(
  completed: readonly GateResult[],
  phase: ExecPhase,
  invariant: GateResult,
  phaseMs = 0,
): GateResult[] {
  const at = EXEC_PHASES.indexOf(phase);
  return EXEC_PHASES.map((gate, i) => {
    if (gate === 'invariants') return invariant;
    if (i < at) return completed.find((r) => r.gate === gate) ?? notReached(gate);
    return interrupted(gate, i === at ? phaseMs : 0);
  });
}

/** Message for a pure violation recorded by mask.ts (e.g. `Math.random`, `Date (reads the clock)`). */
export function pureMessage(what: string): string {
  if (what.startsWith('wrote global ') || what.startsWith('modified ') || what.startsWith('added property ')) return `candidate ${what}`;
  return `candidate read global '${what.replace(/ \(reads the clock\)$/, '')}'`;
}
