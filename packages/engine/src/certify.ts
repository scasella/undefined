/**
 * The certification pipeline, shared by the site's orchestrator (apps/site/src/core/engine.ts) and the Node CLI /
 * Action (through node/certifyFile.ts). Host-neutral: everything that differs between the browser and Node is a
 * `GateHost` (how gates 2–4 run; the compiler and transpiler default to the engine's own).
 *
 * The site keeps its UI pacing, queue, history, store and generation; it calls the pieces here in its existing order
 * (specChecks → specErrorGates / execGateInput → host.execGates, and mutationCheck for the lazy broken-copy check), so
 * nothing is computed twice and its behaviour is unchanged. certifyBody() composes the same pieces without pacing, for
 * code from any source. Nothing here generates code.
 */
import type {
  Artifact,
  Candidate,
  Diagnostic,
  Evidence,
  FunctionRecord,
  FunctionSpec,
  GapQuestion,
  GateResult,
  Hash,
  Json,
  MutationReport,
  Pin,
  Program,
  WaivedCheck,
} from './types';
import { GATE_ORDER } from './types';
import { compileCandidate, transpileUserCode, type CompileContext, type CompileOutput } from './gates/compile';
import { evidenceFrom, type ExecGateInput, type PinnedCase } from './sandbox/gateRunner';
import { notReached } from './sandbox/attribution';
import { decisionsOf, effectiveChecks } from './decide/decisions';
import { gapQuestion } from './decide/gaps';
import { gateSeed, hashesFor } from './shared/hash';
import { describeEvidence, MUTATION_BASELINE_FAILED, MUTATION_BASELINE_SLOW_PREFIX, MUTATION_FAILED_PREFIX } from './shared/evidence';
import { decodeValue } from './shared/serialize';
import { DEFAULT_MAX_MUTANTS, DEFAULT_TIME_BOX_MS, runMutation, type MutantRunner } from './mutation/run';
import { generateMutants } from './mutation/mutate';
import { NO_TESTS_REASON, skippedReport } from './mutation/classify';
import { closureOf, othersFor, stampDeps } from './compose/graph';
import { provenance } from './eject/eject';

// ───────────────────────── the host seam ─────────────────────────

/** What differs between hosts: how gates 2–4 run (a browser Worker or a Node worker_thread, same runner). */
export interface GateHost {
  execGates(input: ExecGateInput, onGate?: (r: GateResult) => void): Promise<GateResult[]>;
  /** Wall clock in ms since the epoch (MutationReport.at, provenance timestamps). */
  now(): number;
}

export type Transpile = (src: string) => { js: string; error?: string };
export type Compile = (spec: FunctionSpec, body: string, ctx?: CompileContext) => Promise<CompileOutput>;

// ───────────────────────── verdict helpers (moved from the site's core/engine.ts) ─────────────────────────

/** Per-call budget for mutants (a mutant is a broken copy: it gets at most a second per call). */
export const MUTANT_CALL_BUDGET_MS = 1000;

/** Gate-result failures that are not a verdict on the candidate: the run could not happen. */
const INFRA_DIAGNOSTICS = new Set(['(load)', '(spec error)', '(gate runner)', '(gate worker)']);
const INFRA_NOTES = new Set(['spec error', 'gate worker error']);

/** The reason a failing gate result is infrastructure (load error, spec error, runner/worker fault), else null. */
export function infraFailure(r: GateResult): string | null {
  if (r.status !== 'fail') return null;
  const d = r.diagnostics.find((x) => x.kind === 'test' && INFRA_DIAGNOSTICS.has(x.name));
  if (d || (r.note && INFRA_NOTES.has(r.note)) || r.summary === 'gate runner error') {
    const what = d && d.kind === 'test' ? (d.error ?? d.message) : (r.headline ?? r.summary);
    return `${r.summary || r.note || 'gate error'}: ${what}`.replace(/^(.+): \1$/, '$1');
  }
  return null;
}

/**
 * One mutant's fate from its Tests/Properties gate results (plus an Invariants failure, attribution rule):
 * no failure → 'survived'; an Invariants `bounded` failure (the watchdog stopped a call, or the per-mutant overall
 * cap, which is a time limit too) → 'killed-by-bound'; any other test/property/invariant failure → 'killed'.
 * A load error, spec error or gate-runner fault is not a kill: it throws, and the whole check fails visibly.
 */
export function classifyMutant(results: readonly GateResult[]): 'killed' | 'killed-by-bound' | 'survived' {
  const failed = results.filter((r) => r.status === 'fail');
  if (failed.length === 0) return 'survived';
  for (const r of failed) {
    const infra = infraFailure(r);
    if (infra) throw new Error(infra);
  }
  const inv = failed.find((r) => r.gate === 'invariants');
  if (inv && inv.diagnostics.some((d) => d.kind === 'invariant' && d.invariant === 'bounded')) return 'killed-by-bound';
  return 'killed';
}

/**
 * Facts about what ran against an accepted candidate (compile passed, by construction). `spec` adds how many of the
 * unit tests / properties came from the user's decisions (absent when none, so older evidence is unchanged).
 */
export function evidenceOf(gates: readonly GateResult[], mutation?: MutationReport, spec?: Pick<FunctionSpec, 'decisions'>): Evidence {
  const ds = spec ? decisionsOf(spec) : [];
  const unit = ds.filter((d) => d.placement === 'tests').length;
  const props = ds.length - unit;
  return {
    compiled: true,
    ...evidenceFrom(gates),
    ...(mutation ? { mutation } : {}),
    ...(unit > 0 ? { decisions: unit } : {}),
    ...(props > 0 ? { decisionProperties: props } : {}),
  };
}

/** No tests, no properties, no decisions and no pins: nothing checks the candidate against an intent. */
export function isUngated(spec: FunctionSpec): boolean {
  const eff = effectiveChecks(spec);
  return !eff.tests.trim() && !eff.properties.trim() && !(spec.pins && spec.pins.length > 0);
}

// ───────────────────────── gate input ─────────────────────────

export interface SpecChecks {
  testsJs: string;
  propertiesJs: string;
  waived: WaivedCheck[];
  /** Set when the spec's own checks (with the decisions' generated ones) do not transpile: the spec's fault. */
  error?: { gate: 'tests' | 'properties'; message: string };
}

/** The spec check: the effective tests/properties transpiled (decisions included), and the checks they waive. */
export function specChecks(spec: FunctionSpec, transpile: Transpile = transpileUserCode): SpecChecks {
  const eff = effectiveChecks(spec);
  const tests = transpile(eff.tests);
  const props = transpile(eff.properties);
  const error = tests.error ? { gate: 'tests' as const, message: tests.error } : props.error ? { gate: 'properties' as const, message: props.error } : undefined;
  return { testsJs: tests.js, propertiesJs: props.js, waived: eff.waived, ...(error ? { error } : {}) };
}

/** The four gate results when the spec's checks do not load (compile passed): the spec error and not-reached. */
export function specErrorGates(compileGate: GateResult, bad: { gate: 'tests' | 'properties'; message: string }): GateResult[] {
  const at = GATE_ORDER.indexOf(bad.gate);
  return GATE_ORDER.map((g, i) =>
    i === 0
      ? compileGate
      : i === at
        ? {
            gate: bad.gate,
            status: 'fail',
            ms: 0,
            summary: 'spec error',
            note: 'spec error',
            headline: `Spec error: ${bad.gate} ${bad.message}`,
            diagnostics: [{ kind: 'test', name: '(spec error)', message: bad.message, error: bad.message }],
          }
        : notReached(g),
  );
}

/** The ExecGateInput for one candidate (same fields, same order as the site has always built it). */
export function execGateInput(a: {
  spec: FunctionSpec;
  js: string;
  checks: Pick<SpecChecks, 'testsJs' | 'propertiesJs' | 'waived'>;
  specHash: Hash;
  testsHash: Hash;
  callArgs?: unknown[];
  pinned?: PinnedCase[];
  deps?: ExecGateInput['deps'];
}): ExecGateInput {
  return {
    name: a.spec.name,
    js: a.js,
    testsJs: a.checks.testsJs,
    propertiesJs: a.checks.propertiesJs,
    budgetMs: a.spec.budgetMs,
    seed: gateSeed(a.specHash, a.testsHash),
    // The triggering call's real arguments: without them a spec with no tests/properties gives the Invariants
    // replay nothing to call, and impure / mutating / non-terminating bodies would pass.
    ...(a.callArgs ? { callArgs: a.callArgs } : {}),
    // Results the user pinned from earlier calls: unit tests the candidate must reproduce.
    ...(a.pinned && a.pinned.length > 0 ? { pinned: a.pinned } : {}),
    // Checks a decision replaced on the domain the spec was silent on.
    ...(a.checks.waived.length > 0 ? { waived: a.checks.waived } : {}),
    // The other functions it calls, with their certified code: judged over the whole call tree.
    ...(a.deps && a.deps.length > 0 ? { deps: a.deps } : {}),
  };
}

/**
 * A spec's pins as gate cases, STRICTLY: dataset arguments resolved from `datasets` (hash → rows), and a pin whose
 * dataset is missing is an error (a CI tool must not silently weaken a spec; the site instead skips it with a notice).
 */
export function decodePinsStrict(spec: Pick<FunctionSpec, 'pins'>, datasets: Readonly<Record<Hash, unknown>> = {}): PinnedCase[] {
  return (spec.pins ?? []).map((pin: Pin) => {
    const args = pin.args.map((a) => {
      if (a.kind === 'value') return decodeValue(a.encoded);
      if (!Object.prototype.hasOwnProperty.call(datasets, a.hash)) throw new Error(`pin ${JSON.stringify(pin.label)} needs dataset ${a.hash}, which was not provided`);
      return datasets[a.hash];
    });
    return { label: pin.label, args, expected: decodeValue(pin.expected) };
  });
}

// ───────────────────────── the mutation check ─────────────────────────

export interface MutationCheckInput {
  spec: FunctionSpec;
  /** The accepted candidate's compiled JS. */
  js: string;
  specHash: Hash;
  testsHash: Hash;
  pinned: PinnedCase[];
  /** The functions it calls (certified js, callees first): they run as certified in every mutant run. */
  deps?: ExecGateInput['deps'];
  /** Run all four gates on the unmutated function first to get its evidence (an artifact committed without any). */
  needBaseline: boolean;
  execGates: (input: ExecGateInput) => Promise<GateResult[]>;
  transpile?: Transpile;
  /** Wall clock for MutationReport.at. */
  now: () => number;
  timeBoxMs?: number;
  maxMutants?: number;
  /** Called between awaited steps; throw from it to abort (the site throws its Aborted). */
  checkpoint?: () => void;
  progress?: (done: number, total: number) => void;
}

/**
 * Generate up to DEFAULT_MAX_MUTANTS mutants of the compiled JS and run each against the spec's tests, properties and
 * pins (phases tests + properties; the Invariants gate still reports a bounded/pure violation). Same seed as the
 * gates. The unmutated function runs first through exactly the runner the mutants get: a kill only means something if
 * the original passes. Throws when the spec's checks do not load or a run is an infrastructure failure.
 */
export async function mutationCheck(a: MutationCheckInput): Promise<{ report: MutationReport; baseline?: Evidence }> {
  const { spec } = a;
  const checkpoint = a.checkpoint ?? ((): void => {});
  const timeBoxMs = a.timeBoxMs ?? DEFAULT_TIME_BOX_MS;
  const seed = gateSeed(a.specHash, a.testsHash);
  // mutants face the decisions too (and the same waivers)
  const checks = specChecks(spec, a.transpile);
  if (checks.error) throw new Error(`the spec's ${checks.error.gate} do not load (${checks.error.message})`);
  const common = {
    name: spec.name,
    testsJs: checks.testsJs,
    propertiesJs: checks.propertiesJs,
    seed,
    ...(a.pinned.length > 0 ? { pinned: a.pinned } : {}),
    ...(checks.waived.length > 0 ? { waived: checks.waived } : {}),
    // only this function is mutated; the functions it calls run as certified, in every run
    ...(a.deps && a.deps.length > 0 ? { deps: a.deps } : {}),
  };
  const budgetMs = Math.min(spec.budgetMs, MUTANT_CALL_BUDGET_MS);
  const unmutated = await a.execGates({ ...common, js: a.js, budgetMs, phases: ['tests', 'properties'], overallCapMs: Math.max(2 * budgetMs, timeBoxMs) });
  checkpoint();
  const baselineFate = classifyMutant(unmutated);
  // Hitting the per-call limit means slow, not wrong: say that, instead of claiming the function fails its own checks.
  if (baselineFate === 'killed-by-bound') return { report: skippedReport(`${MUTATION_BASELINE_SLOW_PREFIX} (${budgetMs} ms per call), so it was not run`, a.now()) };
  if (baselineFate !== 'survived') return { report: skippedReport(MUTATION_BASELINE_FAILED, a.now()) };
  let baseline: Evidence | undefined;
  if (a.needBaseline) {
    const all = await a.execGates({ ...common, js: a.js, budgetMs: spec.budgetMs });
    checkpoint();
    const bad = all.find((g) => g.status === 'fail');
    if (bad) throw new Error(`the committed function does not pass its own checks now (${bad.headline ?? bad.summary})`);
    baseline = evidenceOf(all, undefined, spec);
  }
  const max = a.maxMutants ?? DEFAULT_MAX_MUTANTS;
  // Same seed and max as runMutation below, so the same mutants: only to know the total for the progress line.
  const { mutants } = await generateMutants(a.js, { seed, max });
  checkpoint();
  const total = mutants.length;
  a.progress?.(0, total);
  const boxStart = performance.now();
  let done = 0;
  const runner: MutantRunner = async (js) => {
    checkpoint();
    // run.ts checks the time box only between mutants: cap each run so one slow mutant cannot blow it. Hitting the
    // cap is an Invariants `bounded` failure, i.e. "stopped by the time limit" (killed-by-bound), never a pass.
    const left = timeBoxMs - (performance.now() - boxStart);
    const results = await a.execGates({
      ...common,
      js,
      budgetMs,
      phases: ['tests', 'properties'],
      overallCapMs: Math.max(2 * budgetMs, Math.round(left)),
    });
    checkpoint();
    const fate = classifyMutant(results);
    a.progress?.(++done, total);
    return fate;
  };
  const report = await runMutation({ js: a.js, seed, max, timeBoxMs, runner });
  return { report, ...(baseline ? { baseline } : {}) };
}

// ───────────────────────── certify one body ─────────────────────────

/**
 * accepted: every gate passed. rejected: a gate rejected the code. gaps: rejected ONLY because checks marked "the spec
 * was silent" disagree with the code (every diagnostic of the rejecting Tests/Properties gate is a decidable gap).
 * could-not-run: the spec's checks do not load, or the gate runner/worker failed: not a verdict on the code.
 */
export type CertifyVerdict = 'accepted' | 'rejected' | 'gaps' | 'could-not-run';

export interface Certification {
  name: string;
  /** The certified body, exactly as given. */
  body: string;
  verdict: CertifyVerdict;
  /** Four results, GATE_ORDER. */
  gates: GateResult[];
  /** The rejecting gate, when one rejected. */
  rejectedBy?: GateResult['gate'];
  /** The rejecting gate's headline, verbatim. */
  headline?: string;
  /** Why it could not run (verdict 'could-not-run'). */
  reason?: string;
  /** The rejecting gate's diagnostics (empty when accepted). */
  diagnostics: Diagnostic[];
  specHash: Hash;
  testsHash: Hash;
  seed: number;
  compile: CompileOutput;
  /** Accepted only. Includes the mutation report unless the check was turned off. */
  evidence?: Evidence;
  /** shared/evidence.ts describeEvidence: the same sentence the site shows. */
  evidenceLine?: string;
  mutation?: MutationReport;
  /** One question per decidable spec gap in the rejecting gate (decide/gaps.ts), also printed when mixed with real failures. */
  gapQuestions: GapQuestion[];
  /** Direct callees it was certified with (same-file functions), sorted. */
  calls: string[];
  /** eject/eject.ts provenance() of the certified function (accepted only), with model/codexVersion null. */
  provenance: Record<string, unknown> | null;
}

export interface CertifyBodyInput {
  spec: FunctionSpec;
  body: string;
  host: GateHost;
  compile?: Compile;
  transpile?: Transpile;
  /** Triggering call(s): the first is handed to the gates (Invariants replays it), like the site's REPL call. */
  callArgs?: unknown[];
  /** Dataset rows by hash, for pins with dataset arguments. */
  datasets?: Readonly<Record<Hash, unknown>>;
  /** Already-certified functions it may call (same file), as a Program of accepted artifacts. */
  program?: Program;
  /** Mutation check: on by default. */
  mutation?: boolean | { timeBoxMs?: number; maxMutants?: number };
  onGate?: (r: GateResult) => void;
  /** Tool identification merged into the provenance (e.g. versions); never sent anywhere. */
  certifiedBy?: Record<string, Json>;
}

/**
 * The whole pipeline for one function body, no pacing, no UI, no generation:
 * hashes → compile (with same-file callees as context) → spec check → gates 2–4 on the host → (accepted) mutation
 * check → evidence and its line → gap questions → provenance.
 */
export async function certifyBody(i: CertifyBodyInput): Promise<Certification> {
  const { spec, body, host } = i;
  const compile = i.compile ?? compileCandidate;
  const { specHash, testsHash } = await hashesFor(spec);
  const seed = gateSeed(specHash, testsHash);
  const program: Program = i.program ?? { functions: {} };
  const callable = othersFor(program, spec);
  const ctx: CompileContext | undefined = callable.others.length > 0 || callable.unavailable.length > 0 ? { others: callable.others, unavailable: callable.unavailable } : undefined;
  const compiled = await (ctx ? compile(spec, body, ctx) : compile(spec, body));
  const base = { name: spec.name, body, specHash, testsHash, seed, compile: compiled, calls: [...compiled.deps].sort() };
  const done = (gates: GateResult[], extra: Partial<Certification> & Pick<Certification, 'verdict'>): Certification => ({
    ...base,
    gates,
    diagnostics: [],
    gapQuestions: [],
    provenance: null,
    ...extra,
  });

  if (compiled.gate.status === 'fail' || compiled.js === null) {
    const gates = [compiled.gate, notReached('tests'), notReached('properties'), notReached('invariants')];
    i.onGate?.(compiled.gate);
    return done(gates, { verdict: 'rejected', rejectedBy: 'compile', headline: compiled.gate.headline, diagnostics: compiled.gate.diagnostics });
  }
  i.onGate?.(compiled.gate);
  const checks = specChecks(spec, i.transpile);
  if (checks.error) {
    const gates = specErrorGates(compiled.gate, checks.error);
    return done(gates, { verdict: 'could-not-run', reason: `the spec's ${checks.error.gate} do not load: ${checks.error.message}`, headline: gates.find((g) => g.status === 'fail')?.headline });
  }
  const pinned = decodePinsStrict(spec, i.datasets);
  const deps = closureOf(program, compiled.deps);
  const input = execGateInput({ spec, js: compiled.js, checks, specHash, testsHash, ...(i.callArgs ? { callArgs: i.callArgs } : {}), pinned, deps });
  let exec: GateResult[];
  try {
    exec = await host.execGates(input, i.onGate);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    exec = [
      {
        gate: 'tests',
        status: 'fail',
        ms: 0,
        summary: 'gate runner error',
        headline: `Rejected: gate runner error: ${message}`,
        diagnostics: [{ kind: 'test', name: '(gate runner)', message, error: message }],
      },
      notReached('properties'),
      notReached('invariants'),
    ];
  }
  const gates = [compiled.gate, ...(['tests', 'properties', 'invariants'] as const).map((g) => exec.find((r) => r.gate === g) ?? notReached(g))];
  const failing = gates.find((g) => g.status === 'fail');

  if (failing) {
    const infra = infraFailure(failing);
    if (infra) return done(gates, { verdict: 'could-not-run', rejectedBy: failing.gate, reason: infra, headline: failing.headline, diagnostics: failing.diagnostics });
    const questions = failing.diagnostics.map((d) => gapQuestion({ spec, diagnostic: d, returnType: compiled.returnType }));
    const gapQuestions = questions.filter((q): q is GapQuestion => q !== null);
    const onlyGaps = (failing.gate === 'tests' || failing.gate === 'properties') && questions.length > 0 && questions.every((q) => q !== null);
    return done(gates, {
      verdict: onlyGaps ? 'gaps' : 'rejected',
      rejectedBy: failing.gate,
      headline: failing.headline,
      diagnostics: failing.diagnostics,
      gapQuestions,
    });
  }

  // accepted: the mutation check (or why it did not run), evidence, provenance
  let mutation: MutationReport | undefined;
  const mutOpts = typeof i.mutation === 'object' ? i.mutation : {};
  if (i.mutation === false) {
    mutation = undefined;
  } else if (isUngated(spec)) {
    mutation = skippedReport(NO_TESTS_REASON, host.now());
  } else {
    try {
      mutation = (
        await mutationCheck({
          spec,
          js: compiled.js,
          specHash,
          testsHash,
          pinned,
          deps,
          needBaseline: false,
          execGates: (x) => host.execGates(x),
          ...(i.transpile ? { transpile: i.transpile } : {}),
          now: () => host.now(),
          ...(mutOpts.timeBoxMs !== undefined ? { timeBoxMs: mutOpts.timeBoxMs } : {}),
          ...(mutOpts.maxMutants !== undefined ? { maxMutants: mutOpts.maxMutants } : {}),
        })
      ).report;
    } catch (e) {
      mutation = skippedReport(`${MUTATION_FAILED_PREFIX}${e instanceof Error ? e.message : String(e)}`, host.now());
    }
  }
  const evidence = evidenceOf(gates, mutation, spec);
  const evidenceLine = describeEvidence(evidence, base.calls);
  const now = host.now();
  const candidate: Candidate = { id: `${spec.name}-1`, attempt: 1, body, notes: '', source: 'live', generationMs: 0, gates, verdict: 'accepted' };
  const stamps = stampDeps(program, base.calls);
  const artifact: Artifact = {
    body,
    source: compiled.source,
    js: compiled.js,
    returnType: compiled.returnType,
    specHash,
    testsHash,
    model: '',
    codexVersion: '',
    committedAt: now,
    candidates: [candidate],
    revision: 1,
    evidence,
    ...(stamps ? { deps: stamps } : {}),
  };
  const rec: FunctionRecord = { spec, specHash, testsHash, artifact };
  return done(gates, {
    verdict: 'accepted',
    evidence,
    evidenceLine,
    ...(mutation ? { mutation } : {}),
    provenance: certifiedProvenance(rec, now, i.certifiedBy),
  });
}

/**
 * The accepted function as a Program entry, so later functions in the same file can call it (compile context and
 * linking). `program` is the one it was certified against (its callees' stamps come from there).
 */
export function acceptedRecord(c: Certification, spec: FunctionSpec, program: Program, at: number): FunctionRecord | null {
  if (c.verdict !== 'accepted' || c.compile.js === null) return null;
  const stamps = stampDeps(program, c.calls);
  return {
    spec,
    specHash: c.specHash,
    testsHash: c.testsHash,
    artifact: {
      body: c.body,
      source: c.compile.source,
      js: c.compile.js,
      returnType: c.compile.returnType,
      specHash: c.specHash,
      testsHash: c.testsHash,
      model: '',
      codexVersion: '',
      committedAt: at,
      candidates: [],
      revision: 1,
      ...(c.evidence ? { evidence: c.evidence } : {}),
      ...(stamps ? { deps: stamps } : {}),
    },
  };
}

/**
 * eject/eject.ts provenance() for a certified (not generated) function: the same structure the site ejects, built by
 * the same function so the two cannot drift; `model`/`codexVersion` are null (nothing generated it), the candidate's
 * `source` is 'external' and `generationMs` null, and `certifiedBy` says what certified it.
 */
export function certifiedProvenance(rec: FunctionRecord, now: number, certifiedBy?: Record<string, Json>): Record<string, unknown> {
  const p = provenance(rec, { now });
  const candidates = (p.candidates as Array<Record<string, unknown>>).map((c) => ({ ...c, source: 'external', generationMs: null }));
  return { ...p, model: null, codexVersion: null, candidates, ...(certifiedBy ? { certifiedBy } : {}) };
}

/** Exit code of a whole run: 1 rejected > 3 could not run > 2 spec gaps > 0 all accepted (docs/WORKSPACE-DESIGN.md §4.3). */
export function exitCodeFor(verdicts: readonly CertifyVerdict[], couldNotIngest = false): 0 | 1 | 2 | 3 {
  if (verdicts.includes('rejected')) return 1;
  if (couldNotIngest || verdicts.includes('could-not-run')) return 3;
  if (verdicts.includes('gaps')) return 2;
  return verdicts.length === 0 ? 3 : 0;
}
