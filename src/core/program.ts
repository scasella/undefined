/**
 * Pure program and revision operations. Every function returns new objects and never mutates its inputs;
 * Programs and Revisions are treated as immutable values throughout the app.
 */
import { hashesFor } from '../shared/hash';
import type { Artifact, Candidate, FunctionRecord, FunctionSpec, Program, Revision } from '../types';

export function emptyProgram(): Program {
  return { functions: {} };
}

export async function recordFor(spec: FunctionSpec, artifact: Artifact | null = null): Promise<FunctionRecord> {
  const { specHash, testsHash } = await hashesFor(spec);
  return { spec, specHash, testsHash, artifact };
}

/** An artifact certified against different spec/test text than the record now holds: an edit invalidated it. */
export function isStale(rec: FunctionRecord): boolean {
  return rec.artifact !== null && (rec.artifact.specHash !== rec.specHash || rec.artifact.testsHash !== rec.testsHash);
}

export function isLive(rec: FunctionRecord): boolean {
  return rec.artifact !== null && !isStale(rec);
}

/** Only live artifacts run: a stale artifact is shown in the repo view but never executed. */
export function jsFunctions(p: Program): Record<string, { js: string; budgetMs: number }> {
  const out: Record<string, { js: string; budgetMs: number }> = {};
  for (const [name, rec] of Object.entries(p.functions)) {
    if (isLive(rec)) out[name] = { js: rec.artifact!.js, budgetMs: rec.spec.budgetMs };
  }
  return out;
}

/** Add or replace a spec. An existing artifact is kept; it becomes stale when the hashes changed. */
export async function withSpec(p: Program, spec: FunctionSpec): Promise<Program> {
  const rec = await recordFor(spec, p.functions[spec.name]?.artifact ?? null);
  return { functions: { ...p.functions, [spec.name]: rec } };
}

/** Attach an artifact to an existing function. Throws when there is no spec under that name. */
export function withArtifact(p: Program, name: string, a: Artifact): Program {
  const rec = p.functions[name];
  if (!rec) throw new Error(`cannot attach artifact: no function named ${name}`);
  return { functions: { ...p.functions, [name]: { ...rec, artifact: a } } };
}

export function withoutFunction(p: Program, name: string): Program {
  const { [name]: _removed, ...rest } = p.functions;
  return { functions: rest };
}

/** `artifacts` counts LIVE artifacts only (what would actually run). */
export function summarize(p: Program): { fns: number; artifacts: number } {
  const recs = Object.values(p.functions);
  return { fns: recs.length, artifacts: recs.filter(isLive).length };
}

/** id = last id + 1 (1 for an empty history); `at` defaults to now. */
export function newRevision(history: Revision[], init: Omit<Revision, 'id' | 'at'> & { at?: number }): Revision {
  const last = history[history.length - 1];
  return { ...init, id: last ? last.id + 1 : 1, at: init.at ?? Date.now() };
}

/** A NEW head revision restoring the target's functions and live state (deep copies). */
export function rollbackRevision(history: Revision[], target: number): Revision {
  const t = history.find((r) => r.id === target);
  if (!t) throw new Error(`cannot roll back: no revision r${target}`);
  return newRevision(history, {
    kind: 'rollback',
    title: `Rolled back to r${target}`,
    restoredFrom: target,
    program: structuredClone(t.program),
    env: structuredClone(t.env),
  });
}

export function initialRevision(program: Program): Revision {
  return { id: 1, at: Date.now(), kind: 'init', title: 'Initial image', program, env: {} };
}

export function revisionLabel(rev: Pick<Revision, 'id'> | number): string {
  return `r${typeof rev === 'number' ? rev : rev.id}`;
}

/**
 * Log title for a commit, from the grow attempt's candidates (accepted one last), e.g.
 * "median certified — attempt 2 of 3 (rejected by properties first)". `maxAttempts` adds the "of N";
 * it is not recoverable from the candidates alone.
 */
export function describeCommit(fn: string, candidates: Candidate[], maxAttempts?: number): string {
  const head = `${fn} certified`;
  if (candidates.length === 0) return head;
  const attempt = candidates[candidates.length - 1]!.attempt;
  const of = maxAttempts !== undefined ? ` of ${maxAttempts}` : '';
  if (candidates.length === 1) return `${head} — first attempt`;
  // Aborted candidates carry no rejecting gate; they count as attempts but are not named.
  const gates = candidates.slice(0, -1).flatMap((c) => (c.rejectedBy ? [c.rejectedBy] : []));
  const why =
    gates.length === 0 ? '' : gates.length === 1 ? ` (rejected by ${gates[0]} first)` : ` (rejected by ${gates.join(', then ')})`;
  return `${head} — attempt ${attempt}${of}${why}`;
}
