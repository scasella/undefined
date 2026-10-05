/**
 * `--json`: one document on stdout (docs/WORKSPACE-DESIGN.md §4.5).
 *
 *   { format: 'undefined-certify', version: 1, tool, exitCode, file, specFile, specSource,
 *     functions: { <name>: { verdict, source, specHash, testsHash, seed, …, provenance } }, issues, notes, … }
 *
 * `provenance` is, unmodified, the object the site writes to an ejected folder's provenance.json (engine
 * eject/eject.ts provenance(), through certify.ts certifiedProvenance: `model`/`codexVersion` null, the candidate's
 * `source` 'external', plus `certifiedBy`). It is nested rather than merged so it stays comparable key for key with a
 * site eject. Only accepted functions have one (a rejected function has no artifact to describe); every function has
 * the CLI keys around it. Timestamps (`ejectedAt`, `committedAt`, `at`) and gate/mutation `ms` are the only fields that
 * change between two runs of the same input (the watchdog's timing cases aside, docs/WORKSPACE-DESIGN.md §2.5).
 */
import type { Json } from '@scasella/undefined-engine/types';
import type { CertifyReport, FunctionReport } from '../certifyCommand';
import { gapDecision } from './gaps';

export const JSON_FORMAT = 'undefined-certify';
export const JSON_VERSION = 1;

function functionJson(f: FunctionReport, file: string, specSource: string): Record<string, unknown> {
  const r = f.result;
  return {
    verdict: r.verdict,
    source: { file, line: r.line, bodyLine: r.bodyLine },
    specHash: r.specHash,
    testsHash: r.testsHash,
    seed: r.seed,
    ...(r.rejectedBy ? { rejectedBy: r.rejectedBy } : {}),
    ...(r.headline ? { headline: r.headline } : {}),
    ...(r.reason ? { reason: r.reason } : {}),
    unchecked: r.unchecked,
    calls: r.calls,
    gates: r.gates.map((g) => ({
      gate: g.gate,
      status: g.status,
      summary: g.summary,
      ...(g.headline ? { headline: g.headline } : {}),
      ...(g.note ? { note: g.note } : {}),
      ...(g.counts ? { counts: g.counts } : {}),
      ms: g.ms,
    })),
    diagnostics: r.diagnostics,
    gaps: r.gapQuestions.map((q) => ({ question: q, decision: gapDecision(q) })),
    evidenceLine: r.evidenceLine ?? null,
    evidence: r.evidence ?? null,
    mutation: r.mutation ?? null,
    mutantLines: f.mutantLines,
    ...(specSource === 'vitest' ? { generatedTests: { tests: r.spec.tests, properties: r.spec.properties } } : {}),
    skippedByTestFile: r.skippedByTestFile,
    provenance: r.provenance,
  };
}

export function jsonReport(rep: CertifyReport): Record<string, unknown> {
  const res = rep.result;
  const specSource = res?.specSource ?? 'none';
  const functions: Record<string, unknown> = {};
  for (const f of rep.functions) functions[f.result.name] = functionJson(f, rep.file, specSource);
  return {
    format: JSON_FORMAT,
    version: JSON_VERSION,
    tool: rep.tool,
    exitCode: rep.exitCode,
    file: rep.file,
    specFile: rep.specFile,
    specSource,
    functions,
    order: rep.functions.map((f) => f.result.name),
    issues: [...rep.fatal.map((message) => ({ file: rep.file, message })), ...(res?.issues ?? [])] as unknown as Json,
    notes: [...rep.notes, ...(res?.notes ?? [])],
    unattributed: res?.unattributed ?? [],
  };
}

export function renderJson(rep: CertifyReport): string {
  return `${JSON.stringify(jsonReport(rep), null, 2)}\n`;
}
