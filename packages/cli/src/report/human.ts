/**
 * Human output (docs/WORKSPACE-DESIGN.md §4.2): per function, the gate rows, the verdict, the evidence line (the same
 * sentence the site shows, engine shared/evidence.ts describeEvidence), the rejecting gate's headline and diagnostics
 * with file lines, surviving mutants with their file lines, and spec-gap questions with the test to add for each
 * answer. Plain text, no colour, so the output is the same in a terminal, a log and a test.
 */
import type { Diagnostic, GateResult } from '@scasella/undefined-engine/types';
import type { CertifyReport, FunctionReport } from '../certifyCommand';
import { gapDecision, renderGap } from './gaps';

const GATE_LABEL: Record<GateResult['gate'], string> = { compile: 'Compile', tests: 'Tests', properties: 'Properties', invariants: 'Invariants' };
const MARK: Record<GateResult['status'], string> = { pass: '✓', fail: '✗', skipped: '–', pending: '·', running: '·' };
const MAX_DIAGNOSTICS = 8;

const VERDICT: Record<FunctionReport['result']['verdict'], string> = {
  accepted: 'ACCEPTED',
  rejected: 'REJECTED',
  gaps: 'SPEC GAP',
  'could-not-run': 'COULD NOT RUN',
};

function gateRow(g: GateResult): string {
  const label = GATE_LABEL[g.gate].padEnd(11);
  const detail = g.summary || g.note || g.status;
  return `  ${label} ${MARK[g.status]} ${detail}${g.status === 'skipped' && g.note && g.note !== detail ? ` (${g.note})` : ''}`;
}

function indentLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((l) => `${prefix}${l}`)
    .join('\n');
}

function fileLine(f: FunctionReport, file: string, bodyRelative: number): string {
  if (f.synthesised) return `${file}:${f.result.line}`;
  return `${file}:${f.result.bodyLine + bodyRelative - 1}`;
}

function diagnosticText(d: Diagnostic, f: FunctionReport, file: string): string {
  switch (d.kind) {
    case 'compile': {
      const where = fileLine(f, file, d.line);
      const head = `${where}: ${d.category} TS${d.code}: ${d.message}`;
      return d.snippet ? `${head}\n  ${d.snippet.trim()}` : head;
    }
    case 'test': {
      const lines = [`test "${d.name}": ${d.message}`];
      if (d.call) lines.push(`  call:     ${d.call}`);
      if (d.expected !== undefined) lines.push(`  expected: ${d.expected}`);
      if (d.actual !== undefined) lines.push(`  actual:   ${d.actual}`);
      if (d.error && d.error !== d.message) lines.push(`  error:    ${d.error}`);
      if (d.silentOn) lines.push(`  the check says the spec was silent on ${d.silentOn}`);
      return lines.join('\n');
    }
    case 'property': {
      const lines = [`property "${d.name}"`];
      if (d.call) lines.push(`  call:     ${d.call}`);
      lines.push(`  counterexample: ${d.counterexample} (shrunk ${d.shrinks} times, after ${d.runs} runs, seed ${d.seed})`);
      if (d.expected !== undefined) lines.push(`  expected: ${d.expected}`);
      if (d.actual !== undefined) lines.push(`  actual:   ${d.actual}`);
      if (d.error) lines.push(`  error:    ${d.error}`);
      if (d.silentOn) lines.push(`  the check says the spec was silent on ${d.silentOn}`);
      return lines.join('\n');
    }
    case 'invariant': {
      const lines = [`${d.invariant}: ${d.message}`];
      if (d.call) lines.push(`  call:     ${d.call}`);
      if (d.budgetMs !== undefined) lines.push(`  budget:   ${d.budgetMs} ms${d.elapsedMs !== undefined ? `, stopped after ${d.elapsedMs} ms` : ''}`);
      if (d.phase) lines.push(`  during:   ${d.phase}`);
      if (d.detail) lines.push(`  detail:   ${d.detail}`);
      return lines.join('\n');
    }
  }
}

function functionText(f: FunctionReport, rep: CertifyReport, quiet: boolean): string {
  const r = f.result;
  const spec = rep.specFile ? `spec: ${rep.specFile}` : 'no spec or test file';
  const head = `${r.name}  ${rep.file}:${r.line}  (${spec}${r.specHash ? `, seed ${r.seed}` : ''})`;
  const verdict = r.verdict === 'accepted' && r.unchecked ? 'ACCEPTED (unchecked: no tests, properties or pins; only Compile ran)' : VERDICT[r.verdict];
  if (quiet) return `${VERDICT[r.verdict].padEnd(13)} ${r.name}${r.verdict === 'accepted' && r.unchecked ? ' (unchecked)' : ''}  ${rep.file}:${r.line}${r.headline && r.verdict !== 'accepted' ? `  ${r.headline}` : r.reason ? `  ${r.reason}` : ''}`;

  const out: string[] = [head];
  for (const g of r.gates) out.push(gateRow(g));
  out.push(`  ${verdict}${r.rejectedBy && r.verdict !== 'accepted' ? ` ${r.verdict === 'gaps' ? 'in' : 'by'} ${GATE_LABEL[r.rejectedBy]}` : ''}`);
  if (r.verdict === 'could-not-run' && r.reason) out.push(`  ${r.reason}`);
  if (r.headline && r.verdict !== 'accepted') out.push(`  ${r.headline}`);
  if (r.verdict === 'accepted' && r.evidenceLine) out.push(`  ${r.evidenceLine}`);

  if (r.verdict === 'rejected' || r.verdict === 'gaps' || (r.verdict === 'could-not-run' && r.diagnostics.length > 0)) {
    const shown = r.diagnostics.slice(0, MAX_DIAGNOSTICS);
    for (const d of shown) out.push(indentLines(diagnosticText(d, f, rep.file), '    '));
    if (r.diagnostics.length > shown.length) out.push(`    … and ${r.diagnostics.length - shown.length} more (see --json)`);
    if (r.rejectedBy && r.rejectedBy !== 'invariants') {
      const later = r.gates.filter((g) => g.status === 'skipped' && GATE_ORDER_INDEX[g.gate] > GATE_ORDER_INDEX[r.rejectedBy!]).map((g) => GATE_LABEL[g.gate]);
      if (later.length > 0) out.push(`  Not reached: ${later.join(', ')} (a failing gate stops the later ones).`);
    }
  }

  if (r.gapQuestions.length > 0) {
    out.push(r.verdict === 'gaps' ? '  Decisions for the reviewer:' : '  Also spec gaps (decide them; the rejection above stands either way):');
    const style = rep.result?.specSource === 'vitest' ? 'vitest' : 'test-api';
    for (const q of r.gapQuestions) out.push(renderGap(gapDecision(q), style, '  '));
  }

  for (const m of f.mutantLines) {
    const where = m.fileLine !== null ? `${rep.file}:${m.fileLine} (compiled line ${m.compiledLine})` : `compiled line ${m.compiledLine}`;
    out.push(`  survived: ${where}  ${m.original} → ${m.mutated}  (may be an equivalent mutant)`);
  }
  if (r.mutation?.skipped && r.verdict === 'accepted') out.push(`  Mutation check: ${r.mutation.skipped}`);
  if (r.skippedByTestFile.length > 0) out.push(`  Skipped by the test file (not run, not counted): ${r.skippedByTestFile.join('; ')}`);
  return out.join('\n');
}

const GATE_ORDER_INDEX: Record<GateResult['gate'], number> = { compile: 0, tests: 1, properties: 2, invariants: 3 };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function renderHuman(rep: CertifyReport, quiet = false): string {
  const blocks: string[] = [];
  const res = rep.result;
  for (const msg of rep.fatal) blocks.push(`error: ${msg}`);
  if (!quiet) for (const n of rep.notes) blocks.push(`note: ${n}`);
  if (res) {
    for (const n of res.notes) if (!quiet) blocks.push(`note: ${n}`);
    for (const i of res.issues) {
      const where = `${i.file}${i.line ? `:${i.line}` : ''}`;
      const message = i.message.startsWith(`${i.file}: `) ? i.message.slice(i.file.length + 2) : i.message;
      const fn = i.fn && !message.startsWith(`${i.fn} `) && !message.startsWith(`${i.fn}:`) ? `${i.fn}: ` : '';
      blocks.push(`could not run: ${where}: ${fn}${message}`);
    }
    if (!quiet && res.unattributed.length > 0) blocks.push(`not run (they call no function of ${rep.file}): ${res.unattributed.join('; ')}`);
  }
  for (const f of rep.functions) blocks.push(functionText(f, rep, quiet));

  const count = (v: string): number => rep.functions.filter((f) => f.result.verdict === v).length;
  const parts = [
    count('accepted') ? `${count('accepted')} accepted` : '',
    count('rejected') ? `${count('rejected')} rejected` : '',
    count('gaps') ? plural(count('gaps'), 'with spec gaps', 'with spec gaps') : '',
    count('could-not-run') ? `${count('could-not-run')} could not run` : '',
  ].filter(Boolean);
  const meaning = { 0: 'pass', 1: 'rejected', 2: 'spec gaps found', 3: 'could not run' }[rep.exitCode];
  const summary = `${plural(rep.functions.length, 'function')}${parts.length ? `: ${parts.join(', ')}` : ''}. Exit ${rep.exitCode} (${meaning}).`;
  if (quiet || rep.functions.length === 0) return `${[...blocks, summary].join(quiet ? '\n' : '\n\n')}\n`;
  const footer = 'Nothing was generated. The code ran in a Node worker_thread with a watchdog; that is not a secure sandbox.';
  return `${[...blocks, summary, footer].join('\n\n')}\n`;
}
