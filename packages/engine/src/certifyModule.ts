/**
 * certify({ source, spec }): the high-level API the CLI and the Action share. Host-neutral and file-system free: it
 * takes TEXT (a TypeScript file exporting functions, and optionally an `undefined-spec` file or a vitest test file) and
 * a GateHost; node/certifyFile.ts adds discovery and reading files for Node.
 *
 * Per exported function: split the source (ingest/source.ts), build its FunctionSpec from the spec text, certify its
 * body (certify.ts certifyBody: compile, tests, properties, invariants, mutation check, evidence, gap questions,
 * provenance). Same-file callees are certified first and linked as certified callees (the composition path), in
 * dependency order. Code from any source is certified the same way; nothing here generates code.
 */
import type { FunctionSpec, GateResult, Hash, Json, Program } from './types';
import { acceptedRecord, certifyBody, exitCodeFor, isUngated, type Certification, type GateHost } from './certify';
import { extractFunctions, type ExtractedFunction, type IngestIssue } from './ingest/source';
import { decodeDatasets, parseSpecFile, specFor, SpecFileError, triggeringCall, type SpecFile } from './ingest/specFile';
import { ingestVitest, type VitestIngest } from './ingest/vitest';
import { UNSUPPORTED_MATCHER } from './ingest/expectShim';

export type SpecInput =
  | { kind: 'undefined-spec'; text: string; file: string }
  | { kind: 'vitest'; text: string; file: string; isSourceModule: (specifier: string) => boolean };

export interface CertifyInput {
  source: string;
  sourceFile: string;
  spec?: SpecInput;
  host: GateHost;
  /** Certify only these exports (their same-file callees are still certified first). */
  functions?: readonly string[];
  /** budgetMs for functions whose spec does not set one (default 1000). */
  defaultBudgetMs?: number;
  mutation?: boolean | { timeBoxMs?: number; maxMutants?: number };
  certifiedBy?: Record<string, Json>;
  onGate?: (fn: string, r: GateResult) => void;
  onStart?: (fn: string) => void;
}

export interface FunctionResult extends Certification {
  /** 1-based line of the declaration in the source file, and of its body's first line. */
  line: number;
  bodyLine: number;
  /** No tests, properties, pins or decisions: only Compile (and Invariants on a triggering call, if any) ran. */
  unchecked: boolean;
  spec: FunctionSpec;
  /** Checks the vitest file skips (`it.skip`/`it.todo`). */
  skippedByTestFile: string[];
}

export interface CertifyResult {
  exitCode: 0 | 1 | 2 | 3;
  /** In certification order (callees first). */
  functions: FunctionResult[];
  /** Everything that could not be read or run (exit 3), with file and line. */
  issues: IngestIssue[];
  /** Plain notes (e.g. "the spec's doc wins over the JSDoc of median"). */
  notes: string[];
  /** Where the checks came from. */
  specSource: 'undefined-spec' | 'vitest' | 'none';
  /** vitest only: tests that call no function of the source file (not run). */
  unattributed: string[];
}

/** A function that could not be certified because of an ingestion problem: reported, never a verdict on the code. */
function notRun(f: ExtractedFunction, spec: FunctionSpec, reason: string): FunctionResult {
  return {
    name: f.name,
    body: f.body,
    verdict: 'could-not-run',
    reason,
    gates: [],
    diagnostics: [],
    specHash: '',
    testsHash: '',
    seed: 0,
    compile: { gate: { gate: 'compile', status: 'skipped', ms: 0, summary: 'not run', diagnostics: [] }, js: null, source: '', returnType: '', deps: [] },
    gapQuestions: [],
    calls: [],
    provenance: null,
    line: f.line,
    bodyLine: f.bodyLine,
    unchecked: false,
    spec,
    skippedByTestFile: [],
  };
}

export async function certify(i: CertifyInput): Promise<CertifyResult> {
  const issues: IngestIssue[] = [];
  const notes: string[] = [];
  const extracted = await extractFunctions(i.source, i.sourceFile);
  issues.push(...extracted.issues);
  const sourceIssues = issues.length;
  const byName = new Map(extracted.functions.map((f) => [f.name, f]));

  // the checks
  let specFile: SpecFile | null = null;
  let vitest: VitestIngest | null = null;
  if (i.spec?.kind === 'undefined-spec') {
    try {
      specFile = parseSpecFile(i.spec.text, i.spec.file);
    } catch (e) {
      issues.push({ file: i.spec.file, message: e instanceof Error ? e.message : String(e) });
    }
    for (const n of Object.keys(specFile?.functions ?? {})) {
      if (!byName.has(n) && !extracted.issues.some((x) => x.fn === n)) issues.push({ file: i.spec.file, message: `functions.${n}: the source file exports no function ${n} the gates can certify` });
    }
  } else if (i.spec?.kind === 'vitest') {
    vitest = await ingestVitest(i.spec.text, i.spec.file, [...byName.keys()], i.spec.isSourceModule);
    issues.push(...vitest.issues);
  }
  const datasets: Record<Hash, unknown> = specFile ? decodeDatasets(specFile.datasets) : {};
  // Nothing is certified on a partial spec: a spec or test file with a construct the gates cannot run stops every
  // function it covers (a dropped check must never turn into an acceptance).
  const specUnreadable = issues.length > sourceIssues ? `${i.spec?.file ?? 'the spec'} has constructs the gates cannot run (see the issues)` : null;

  // which functions, in dependency order
  const wanted = i.functions && i.functions.length > 0 ? [...i.functions] : [...byName.keys()];
  for (const w of wanted) if (!byName.has(w) && !extracted.issues.some((x) => x.fn === w)) issues.push({ file: i.sourceFile, message: `no exported function ${w}` });
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (n: string, chain: string[]): void => {
    const f = byName.get(n);
    if (!f || state.get(n) === 'done') return;
    if (state.get(n) === 'visiting') {
      issues.push({ file: i.sourceFile, line: f.line, fn: n, message: `${[...chain, n].join(' → ')}: a cycle; the gates link callees that were certified first` });
      return;
    }
    state.set(n, 'visiting');
    for (const c of f.callees) visit(c, [...chain, n]);
    state.set(n, 'done');
    order.push(n);
  };
  for (const w of wanted) visit(w, []);
  const cyclic = new Set(issues.filter((x) => x.message.includes(': a cycle;')).flatMap((x) => x.message.split(':')[0]!.split(' → ')));

  const program: Program = { functions: {} };
  const results: FunctionResult[] = [];
  for (const name of order) {
    const f = byName.get(name)!;
    const entry = specFile?.functions[name];
    const v = vitest?.byFunction[name];
    let spec: FunctionSpec;
    try {
      spec = specFor(f, v ? { tests: v.tests, properties: v.properties } : entry, { ...(i.defaultBudgetMs !== undefined ? { defaultBudgetMs: i.defaultBudgetMs } : {}), file: i.spec?.file ?? i.sourceFile });
    } catch (e) {
      const reason = e instanceof SpecFileError ? e.message : String(e);
      issues.push({ file: i.spec?.file ?? i.sourceFile, fn: name, message: reason });
      results.push(notRun(f, { name, params: f.params, returns: f.returns, doc: f.doc, tests: '', properties: '', budgetMs: 0, maxAttempts: 1, origin: 'user' }, reason));
      continue;
    }
    if (entry?.doc !== undefined && f.doc !== '' && entry.doc !== f.doc) notes.push(`${name}: the spec file's doc is used, not the function's JSDoc`);
    if (specUnreadable) {
      results.push(notRun(f, spec, specUnreadable));
      continue;
    }
    if (cyclic.has(name)) {
      results.push(notRun(f, spec, 'part of a call cycle'));
      continue;
    }
    const missing = f.callees.filter((c) => !program.functions[c]);
    if (missing.length > 0) {
      results.push(notRun(f, spec, `calls ${missing.join(', ')}, which ${missing.length === 1 ? 'was' : 'were'} not certified`));
      continue;
    }
    i.onStart?.(name);
    let cert: Certification;
    try {
      const callArgs = triggeringCall(entry);
      cert = await certifyBody({
        spec,
        body: f.body,
        host: i.host,
        ...(callArgs ? { callArgs } : {}),
        datasets,
        program,
        ...(i.mutation !== undefined ? { mutation: i.mutation } : {}),
        ...(i.certifiedBy ? { certifiedBy: i.certifiedBy } : {}),
        ...(i.onGate ? { onGate: (r: GateResult) => i.onGate!(name, r) } : {}),
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      results.push(notRun(f, spec, reason));
      continue;
    }
    // backstop for the static matcher check: a matcher the shim does not know is the test file's problem, not the code's
    if (cert.verdict !== 'accepted' && JSON.stringify(cert.diagnostics).includes(UNSUPPORTED_MATCHER)) {
      cert = { ...cert, verdict: 'could-not-run', reason: 'the test file uses an expect matcher the gates do not support', gapQuestions: [] };
    }
    const rec = acceptedRecord(cert, spec, program, i.host.now());
    if (rec) program.functions[name] = rec;
    results.push({ ...cert, line: f.line, bodyLine: f.bodyLine, unchecked: isUngated(spec), spec, skippedByTestFile: v?.skipped ?? [] });
  }
  if (extracted.functions.length === 0 && extracted.issues.length === 0) issues.push({ file: i.sourceFile, message: 'no exported function found' });

  return {
    exitCode: exitCodeFor(
      results.map((r) => r.verdict),
      issues.length > 0,
    ),
    functions: results,
    issues,
    notes,
    specSource: specFile ? 'undefined-spec' : vitest ? 'vitest' : 'none',
    unattributed: vitest?.unattributed ?? [],
  };
}
