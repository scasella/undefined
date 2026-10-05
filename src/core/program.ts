/**
 * Pure program and revision operations. Every function returns new objects and never mutates its inputs;
 * Programs and Revisions are treated as immutable values throughout the app.
 */
import { hashesFor } from '../shared/hash';
import { directDeps, inRuntime } from '../compose/graph';
import type { Artifact, Candidate, DatasetRef, Decision, FunctionRecord, FunctionSpec, Hash, Pin, Program, Revision } from '../types';

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

/**
 * What the live runtime holds: live artifacts only (a stale artifact is shown in the repo view but never executed),
 * minus any whose dependency changed since certification (compose/graph.ts inRuntime: it would run against code it was
 * not certified with). `deps` (the functions it calls, late-bound in the worker) is present only when non-empty.
 */
export function jsFunctions(p: Program): Record<string, { js: string; budgetMs: number; deps?: string[] }> {
  const out: Record<string, { js: string; budgetMs: number; deps?: string[] }> = {};
  for (const [name, rec] of Object.entries(p.functions)) {
    if (!isLive(rec) || !inRuntime(p, name)) continue;
    const deps = directDeps(rec);
    out[name] = deps.length > 0 ? { js: rec.artifact!.js, budgetMs: rec.spec.budgetMs, deps } : { js: rec.artifact!.js, budgetMs: rec.spec.budgetMs };
  }
  return out;
}

/** Add or replace a spec. An existing artifact is kept; it becomes stale when the hashes changed. */
export async function withSpec(p: Program, spec: FunctionSpec): Promise<Program> {
  const rec = await recordFor(spec, p.functions[spec.name]?.artifact ?? null);
  return { ...p, functions: { ...p.functions, [spec.name]: rec } };
}

/** Attach an artifact to an existing function. Throws when there is no spec under that name. */
export function withArtifact(p: Program, name: string, a: Artifact): Program {
  const rec = p.functions[name];
  if (!rec) throw new Error(`cannot attach artifact: no function named ${name}`);
  return { ...p, functions: { ...p.functions, [name]: { ...rec, artifact: a } } };
}

export function withoutFunction(p: Program, name: string): Program {
  const { [name]: _removed, ...rest } = p.functions;
  return { ...p, functions: rest };
}

/** Bind (or rebind) a dataset ref under its variable name. */
export function withDataset(p: Program, ref: DatasetRef): Program {
  return { ...p, datasets: { ...(p.datasets ?? {}), [ref.name]: ref } };
}

/** Drop the dataset bound to `name` (the `datasets` field disappears when it was the last one). */
export function withoutDataset(p: Program, name: string): Program {
  const { [name]: _removed, ...rest } = p.datasets ?? {};
  const { datasets: _all, ...base } = p;
  return Object.keys(rest).length > 0 ? { ...base, datasets: rest } : base;
}

/**
 * Replace a function's pins. Pins are outside both hashes, so the record's hashes and its artifact stay as they are
 * (pinning invalidates nothing). Throws when there is no function named `fn`. An empty list removes the field.
 */
export function withPins(p: Program, fn: string, pins: Pin[]): Program {
  const rec = p.functions[fn];
  if (!rec) throw new Error(`cannot pin: no function named ${fn}`);
  const { pins: _old, ...spec } = rec.spec;
  const next: FunctionSpec = pins.length > 0 ? { ...spec, pins } : spec;
  return { ...p, functions: { ...p.functions, [fn]: { ...rec, spec: next } } };
}

/**
 * A spec with its decisions replaced. An empty list REMOVES the field, so a spec without decisions is byte-identical
 * (JSON, hashes) to one that never had any. Unlike pins, decisions are part of testsHash: callers recompute the
 * record with withSpec (the artifact goes stale unless it is re-checked and restamped).
 */
export function specWithDecisions(spec: FunctionSpec, decisions: readonly Decision[]): FunctionSpec {
  const { decisions: _old, ...rest } = spec;
  return decisions.length > 0 ? { ...rest, decisions: [...decisions] } : rest;
}

/** Replace a function's decisions (record hashes recomputed; see specWithDecisions). Throws when there is no `fn`. */
export async function withDecisions(p: Program, fn: string, decisions: readonly Decision[]): Promise<Program> {
  const rec = p.functions[fn];
  if (!rec) throw new Error(`cannot decide: no function named ${fn}`);
  return withSpec(p, specWithDecisions(rec.spec, decisions));
}

/** Every dataset hash a program refers to: bound datasets plus dataset arguments of pins. */
export function datasetHashes(p: Program): Set<Hash> {
  const out = new Set<Hash>();
  for (const ref of Object.values(p.datasets ?? {})) out.add(ref.hash);
  for (const rec of Object.values(p.functions)) {
    for (const pin of rec.spec.pins ?? []) for (const a of pin.args) if (a.kind === 'dataset') out.add(a.hash);
  }
  return out;
}

/** Dataset hashes referred to by any revision (what must be kept, persisted and exported; the rest is garbage). */
export function referencedDatasets(revisions: readonly Revision[]): Set<Hash> {
  const out = new Set<Hash>();
  for (const r of revisions) for (const h of datasetHashes(r.program)) out.add(h);
  return out;
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
