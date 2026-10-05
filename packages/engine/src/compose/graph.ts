/**
 * The dependency graph between generated functions (docs/COMPOSE-DESIGN.md §A2–A4). Pure and synchronous: every
 * function here reads a Program and returns new values.
 *
 * - An artifact records its DIRECT dependencies in `Artifact.deps` (name → closureHash + revision of the callee it was
 *   certified with; closureHash covers what the callee itself calls). Nothing about composition is hashed into a spec: replay keys never move.
 * - Status through dependencies is DERIVED, never stored (dependencyStatus): any revision is self-consistent, so
 *   rollback and import need no repair.
 * - What a body may call (othersFor): every other function that is runnable, minus those that would close a cycle,
 *   minus those whose types clash with the caller's. Sorted by name, so the prompt is stable.
 */
import type { Artifact, DependencyStatus, DependencyView, DepStamp, FunctionRecord, FunctionSpec, Hash, Program } from '../types';
import { declarationLine } from '../shared/declaration';
import { sha256Sync } from './sha256';

/** Same rule as core/program.ts isLive (not imported: program.ts imports this module). */
export function isOwnLive(rec: FunctionRecord | undefined): boolean {
  return !!rec && rec.artifact !== null && rec.artifact.specHash === rec.specHash && rec.artifact.testsHash === rec.testsHash;
}

/**
 * The identity a dependent is certified against: the callee's compiled TypeScript (typeDecls + signature + body) and
 * its return type (which covers an inferred one). It does not move when the callee is re-certified against stronger
 * checks or gets a mutation report: the dependent's behaviour depends on the callee's code, not on its tests.
 */
export function implHash(a: Pick<Artifact, 'source' | 'returnType'>): Hash {
  return sha256Sync(`${a.source}\u0000${a.returnType}`);
}

/**
 * What a dependent's stamp records for a callee: the callee's implHash when it calls nothing (so a leaf's stamp IS its
 * implHash), otherwise its implHash combined with its own stamps. Stamps are themselves closure hashes, so this covers
 * the whole closure: when h changes and g (which calls h) is re-certified against it, g's stamp of h moves, so g's
 * closure hash moves, so f (which calls g) is out of date too and is re-checked before it runs again.
 */
export function closureHash(a: Pick<Artifact, 'source' | 'returnType' | 'deps'>): Hash {
  const own = implHash(a);
  const deps = a.deps;
  if (!deps || Object.keys(deps).length === 0) return own;
  const parts = Object.keys(deps)
    .sort()
    .map((n) => `${n}=${deps[n]!.hash}`);
  return sha256Sync(`${own}\u0000${parts.join('\u0000')}`);
}

/** Direct dependencies recorded on `rec`'s artifact, sorted ([] when none or no artifact). */
export function directDeps(rec: FunctionRecord | undefined): string[] {
  return Object.keys(rec?.artifact?.deps ?? {}).sort();
}

/** The `Artifact.deps` stamp for `names` as they stand in `program` (undefined when the list is empty). */
export function stampDeps(program: Program, names: readonly string[]): Record<string, DepStamp> | undefined {
  if (names.length === 0) return undefined;
  const out: Record<string, DepStamp> = {};
  for (const n of [...names].sort()) {
    const a = program.functions[n]?.artifact;
    if (!a) throw new Error(`cannot record a dependency on ${n}: it has no artifact`);
    out[n] = { hash: closureHash(a), revision: a.revision };
  }
  return out;
}

/** Every function `fn` reaches through recorded deps (excluding itself unless there is a cycle back to it). */
export function reachable(program: Program, fn: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...directDeps(program.functions[fn])];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...directDeps(program.functions[n]));
  }
  return seen;
}

interface Walk {
  memo: Map<string, DependencyStatus>;
  active: Set<string>;
}

function views(program: Program, fn: string, w: Walk): DependencyView[] {
  const rec = program.functions[fn];
  const stamps = rec?.artifact?.deps ?? {};
  return Object.keys(stamps)
    .sort()
    .map((name) => {
      const stamp = stamps[name]!;
      const callee = program.functions[name];
      const own = isOwnLive(callee);
      const nowHash = own ? closureHash(callee!.artifact!) : null;
      const base = {
        name,
        certifiedRevision: stamp.revision,
        certifiedHash: stamp.hash,
        nowRevision: own ? callee!.artifact!.revision : null,
        nowHash,
      };
      if (!own) return { ...base, state: 'missing' as const, why: missingWhy(callee) };
      if (nowHash !== stamp.hash) return { ...base, state: 'changed' as const };
      const inner = statusIn(program, name, w).kind;
      return { ...base, state: inner === 'none' || inner === 'current' ? ('current' as const) : ('waiting' as const) };
    });
}

function missingWhy(rec: FunctionRecord | undefined): string {
  if (!rec) return 'it is no longer in the program';
  if (!rec.artifact) return 'it has no certified code';
  if (rec.artifact.specHash !== rec.specHash) return 'its spec changed after it was certified';
  return 'its checks changed after it was certified';
}

/** Memoised per walk; a cycle in recorded deps (only an edited image can hold one) reads as waiting, never loops. */
function statusIn(program: Program, fn: string, w: Walk): DependencyStatus {
  const hit = w.memo.get(fn);
  if (hit) return hit;
  if (w.active.has(fn)) return { kind: 'waiting', calls: [], waitingFor: [] };
  const rec = program.functions[fn];
  let out: DependencyStatus;
  if (!isOwnLive(rec) || directDeps(rec).length === 0) {
    out = { kind: 'none' };
  } else {
    w.active.add(fn);
    const calls = views(program, fn, w);
    if (calls.some((c) => c.state === 'changed')) out = { kind: 'changed', calls };
    else if (calls.some((c) => c.state !== 'current')) out = { kind: 'waiting', calls, waitingFor: waitingRoots(program, fn, w) };
    else out = { kind: 'current', calls };
    w.active.delete(fn);
  }
  w.memo.set(fn, out);
  return out;
}

/** The functions (reached from `fn`) that have no runnable code: what a call has to grow first. Sorted. */
function waitingRoots(program: Program, fn: string, w: Walk): string[] {
  const out = new Set<string>();
  for (const n of reachable(program, fn)) {
    if (n === fn) continue;
    const rec = program.functions[n];
    if (!isOwnLive(rec)) out.add(n);
    else if (statusIn(program, n, w).kind === 'changed') out.add(n);
  }
  return [...out].sort();
}

/** Derived dependency status of `fn` (see types.ts DependencyStatus). */
export function dependencyStatus(program: Program, fn: string): DependencyStatus {
  return statusIn(program, fn, { memo: new Map(), active: new Set() });
}

/** Own-live and every dependency current: may be called by others, ejected, shown as certified. */
export function isRunnable(program: Program, fn: string): boolean {
  if (!isOwnLive(program.functions[fn])) return false;
  const k = dependencyStatus(program, fn).kind;
  return k === 'none' || k === 'current';
}

/**
 * Whether `fn` belongs in the live runtime: own-live and not 'changed' (a 'changed' function would run against code
 * it was not certified with). A 'waiting' one is defined: reaching its missing callee is an undefined call of it.
 */
export function inRuntime(program: Program, fn: string): boolean {
  return isOwnLive(program.functions[fn]) && dependencyStatus(program, fn).kind !== 'changed';
}

/** Functions whose artifact records `fn` as a direct dependency, sorted. */
export function directDependents(program: Program, fn: string): string[] {
  return Object.keys(program.functions)
    .filter((n) => n !== fn && program.functions[n]!.artifact?.deps?.[fn] !== undefined)
    .sort();
}

/** Every function that (transitively) depends on one of `fns`, callees before callers. */
export function transitiveDependents(program: Program, fns: readonly string[]): string[] {
  const set = new Set<string>();
  const queue = [...fns];
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const d of directDependents(program, n)) {
      if (!set.has(d) && !fns.includes(d)) {
        set.add(d);
        queue.push(d);
      }
    }
  }
  return topoOrder(program, [...set]).filter((n) => set.has(n));
}

/** `names` plus everything they reach, callees first (stable: ties by name). A cycle is broken where it is met. */
export function topoOrder(program: Program, names: readonly string[]): string[] {
  const out: string[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();
  const visit = (n: string): void => {
    if (done.has(n) || onStack.has(n)) return;
    onStack.add(n);
    for (const d of directDeps(program.functions[n])) visit(d);
    onStack.delete(n);
    done.add(n);
    out.push(n);
  };
  for (const n of [...names].sort()) visit(n);
  return out;
}

/** One linked dependency for a gate run or the runtime: certified JS plus its own direct dependencies. */
export interface LinkedDep {
  name: string;
  js: string;
  deps: string[];
}

/**
 * The closure of `direct` (callees first) with each function's certified JS, for ExecGateInput.deps. Functions with no
 * artifact are left out (the compile gate already refused a body that calls one).
 */
export function closureOf(program: Program, direct: readonly string[]): LinkedDep[] {
  return topoOrder(program, direct)
    .filter((n) => program.functions[n]?.artifact)
    .map((n) => ({ name: n, js: program.functions[n]!.artifact!.js, deps: directDeps(program.functions[n]) }));
}

// ───────────────────────── what a body may call ─────────────────────────

/** A `type`/`interface` declaration of a spec's typeDecls, by name. */
export interface TypeDecl {
  name: string;
  text: string;
}

/**
 * Split typeDecls (which may hold only `type` and `interface` declarations: compile.ts declProblems) into one entry
 * per declaration, by the line it starts on. Text is trimmed; '' yields [].
 */
export function splitTypeDecls(text: string | undefined): TypeDecl[] {
  const src = (text ?? '').replace(/\r\n?/g, '\n');
  const out: TypeDecl[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const line of src.split('\n')) {
    const m = /^\s*(?:export\s+)?(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) {
      if (cur) out.push({ name: cur.name, text: cur.lines.join('\n').trim() });
      cur = { name: m[1]!, lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) out.push({ name: cur.name, text: cur.lines.join('\n').trim() });
  return out;
}

/** What the compile gate declares and the prompt lists for one callable function. */
export interface OtherFunction {
  name: string;
  /** `function slugify(title: string): string` (an inferred return type is written out). */
  decl: string;
  /** First sentence of its doc, one line, at most 160 characters; '(no doc)' when it has none. */
  doc: string;
  /** Its type declarations the caller does not already declare identically (deduplicated across the list). */
  types: TypeDecl[];
}

/** A program function a body may NOT call, and why (the compile gate names it when the body calls it anyway). */
export interface Unavailable {
  name: string;
  why: string;
}

export interface Callable {
  others: OtherFunction[];
  unavailable: Unavailable[];
}

export const DOC_MAX = 160;

/** First sentence of a doc, on one line, at most DOC_MAX characters. */
export function firstSentence(doc: string): string {
  const one = doc.replace(/\s+/g, ' ').trim();
  if (one === '') return '(no doc)';
  const m = /^(.+?[.!?])(?:\s|$)/.exec(one);
  const s = m ? m[1]! : one;
  return s.length <= DOC_MAX ? s : `${s.slice(0, DOC_MAX - 1)}…`;
}

/**
 * Which other functions a body of `spec` may call, given `program` (docs/COMPOSE-DESIGN.md §A2): runnable ones, minus
 * any that (transitively) call `spec.name`, minus any named like one of its parameters (the parameter shadows it), minus
 * any whose return type is unknown, minus any whose type declarations clash with the caller's or with an earlier
 * listed function's. Everything else in the program is `unavailable` with the reason. Both lists are sorted by name.
 */
export function othersFor(program: Program, spec: FunctionSpec): Callable {
  const f = spec.name;
  const params = new Set(spec.params.map((p) => p.name));
  const declared = new Map<string, string>(); // type name → text, the caller's own first
  for (const t of splitTypeDecls(spec.typeDecls)) declared.set(t.name, t.text);
  const own = new Set(declared.keys());
  const others: OtherFunction[] = [];
  const unavailable: Unavailable[] = [];
  for (const g of Object.keys(program.functions).sort()) {
    if (g === f || params.has(g)) continue;
    const rec = program.functions[g]!;
    const why = unavailableWhy(program, g, f);
    if (why) {
      unavailable.push({ name: g, why });
      continue;
    }
    const a = rec.artifact!;
    if (rec.spec.returns === null && a.returnType === '') {
      unavailable.push({ name: g, why: `${g}'s return type is not known` });
      continue;
    }
    const types: TypeDecl[] = [];
    let clash: string | null = null;
    for (const t of splitTypeDecls(rec.spec.typeDecls)) {
      const seen = declared.get(t.name);
      if (seen === undefined) types.push(t);
      else if (seen !== t.text) {
        clash = t.name;
        break;
      }
    }
    if (clash) {
      unavailable.push({
        name: g,
        why: `${g}'s types clash with ${own.has(clash) ? "this function's" : 'those of another callable function'} (both declare ${clash}, differently)`,
      });
      continue;
    }
    for (const t of types) declared.set(t.name, t.text);
    others.push({ name: g, decl: declarationLine(rec.spec, { forceInferredReturn: a.returnType }), doc: firstSentence(rec.spec.doc), types });
  }
  return { others, unavailable };
}

function unavailableWhy(program: Program, g: string, f: string): string | null {
  const rec = program.functions[g]!;
  if (!rec.artifact) return `${g} has a spec but no certified code yet, so it cannot be called until it has been grown`;
  if (!isOwnLive(rec)) return `${g} is out of date (${missingWhy(rec)}), so it cannot be called until it is regrown`;
  if (reachable(program, g).has(f)) {
    return `${g} already calls ${f} (${cyclePath(program, g, f).join(' → ')}): generated functions cannot call each other in a cycle`;
  }
  const st = dependencyStatus(program, g);
  if (st.kind === 'changed') {
    const changed = st.calls.filter((c) => c.state === 'changed').map((c) => c.name);
    return `${g} is out of date (${changed.join(', ')} changed since it was certified), so it cannot be called until it is re-checked`;
  }
  if (st.kind === 'waiting') return `${g} is waiting for ${st.waitingFor.join(', ')}, which has no runnable code`;
  return null;
}

/** A shortest path g → … → f through recorded deps (both ends included). */
function cyclePath(program: Program, g: string, f: string): string[] {
  const prev = new Map<string, string>();
  const queue = [g];
  const seen = new Set([g]);
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const d of directDeps(program.functions[n])) {
      if (seen.has(d)) continue;
      seen.add(d);
      prev.set(d, n);
      if (d === f) {
        const path = [f];
        let at = f;
        while (prev.has(at)) path.unshift((at = prev.get(at)!));
        return path;
      }
      queue.push(d);
    }
  }
  return [g, f];
}

/**
 * The declaration a dependent was certified against, read back from the callee's ARTIFACT (its compiled source:
 * typeDecls, then the `function` line; compile/source.ts buildSource), not from its current spec: reloading or importing
 * a program recompiles a dependent against exactly what it called, even while that callee's spec has since changed.
 */
export function otherFromArtifact(name: string, a: Pick<Artifact, 'source' | 'returnType'>, callerTypeDecls?: string): OtherFunction | null {
  const lines = a.source.split('\n');
  const at = lines.findIndex((l) => l.startsWith(`function ${name}(`));
  if (at < 0) return null;
  let decl = lines[at]!.trimEnd();
  // a declared return type is the artifact's returnType (compile.ts), written after the parameters
  if (!decl.endsWith(`): ${a.returnType}`)) {
    if (a.returnType === '') return null;
    decl = `${decl}: ${a.returnType}`;
  }
  const mine = new Map(splitTypeDecls(callerTypeDecls).map((t) => [t.name, t.text]));
  const types = splitTypeDecls(lines.slice(0, at).join('\n')).filter((t) => mine.get(t.name) !== t.text);
  return { name, decl, doc: '', types };
}

// ───────────────────────── words ─────────────────────────

/**
 * One line for the Repo (and the evidence list) about what `fn` calls and whether that still holds, or null when it
 * calls nothing. Plain facts: names, revisions, short hashes.
 */
export function dependencyLine(program: Program, fn: string): string | null {
  const st = dependencyStatus(program, fn);
  if (st.kind === 'none') return null;
  const list = (cs: DependencyView[]): string => cs.map((c) => `${c.name} (r${c.certifiedRevision})`).join(', ');
  if (st.kind === 'current') return `Calls ${list(st.calls)}; certified with ${st.calls.length === 1 ? 'that version' : 'those versions'}.`;
  if (st.kind === 'changed') {
    const ch = st.calls.filter((c) => c.state === 'changed');
    const what = ch
      .map((c) => `${c.name}, which changed at r${c.nowRevision} (certified against r${c.certifiedRevision}, ${short(c.certifiedHash)} → ${short(c.nowHash!)})`)
      .join('; ');
    return `Out of date: calls ${what}. It does not run until it is re-checked: the next call re-checks it with the new ${ch.map((c) => c.name).join(', ')}, and regrows it only if that fails.`;
  }
  const missing = st.calls.filter((c) => c.state === 'missing');
  const reasons = missing.map((c) => `${c.name}: ${c.why}`).join('; ');
  return `Waiting for ${st.waitingFor.join(', ')}${reasons ? ` (${reasons})` : ''}. ${fn}'s own code is unchanged; the next call that reaches ${st.waitingFor.length === 1 ? st.waitingFor[0] : 'one of them'} grows it, then ${fn} is re-checked with it.`;
}

function short(h: string): string {
  return `${h.slice(0, 6)}…`;
}
