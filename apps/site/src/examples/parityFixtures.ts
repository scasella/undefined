/**
 * Shared by the two parity suites (src/examples/parity.node.test.ts: the engine's Node path in-process;
 * scripts/cli.parity.ts: the built CLI as a subprocess). Both write the SAME files for every recorded candidate and
 * compare with the SAME browser measurement (parity.browser.json, written by scripts/parity-measure.mjs --write).
 *
 * Stated allowances (timing only; docs/EVIDENCE.md "Node and CLI parity"):
 *   1. killed vs killed-by-bound: a mutant that both fails a check and runs slowly can be stopped by the 1000 ms
 *      per-call limit first on one machine and fail its check first on another, so only killed + killedByBound is
 *      compared, never the split (mergeTimeLimit removes the split from both evidence sentences);
 *   2. a mutation run cut short by the 6 s time box is never accepted as a smaller total: it fails the suite.
 * One mapping that is NOT timing (WORKSPACE-DESIGN §11 #10): when every failure in the rejecting gate carries "the spec
 * was silent" marker, the site shows "Rejected by <gate> — spec was silent" with a Decide card; the engine/CLI reports
 * that same rejection as verdict `gaps` (exit 2) with the same question. Any other rejection is `rejected` (exit 1).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FunctionSpec, Json } from '@scasella/undefined-engine/types';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import { parseCsv } from '../data/csv';
import { coerceCsvRows } from '../data/infer';
import { BUNDLED_ORDERS_CSV } from '../data/orders';

export interface RecordedSession {
  fn: string;
  label: string;
  specHash: string;
  testsHash: string;
  spec: FunctionSpec;
  calls: string[];
  attempts: Array<{ body: string }>;
}

export interface BrowserGate {
  gate: string;
  status: string;
}
export type BrowserAttempt =
  | { verdict: 'rejected'; gates: BrowserGate[]; rejection: { gateLine: string; headline: string } }
  | { verdict: 'accepted'; gates: BrowserGate[]; text: string; evidenceLine: string; survivors: string[]; committed: string };
export interface BrowserMeasurement {
  measuredAt: string;
  how: string;
  head: string;
  dirtyTree: boolean;
  chrome: string;
  recordings: Record<string, string[]>;
  /** examples[id][session][attempt] */
  examples: Record<string, BrowserAttempt[][]>;
}

export const IDS = ['median', 'slugify', 'fibonacci', 'orders'] as const;
export const RECORDINGS = fileURLToPath(new URL('../../public/recordings/', import.meta.url));

export function loadRecording(id: string): { sessions: RecordedSession[] } {
  return JSON.parse(readFileSync(`${RECORDINGS}${id}.json`, 'utf8')) as { sessions: RecordedSession[] };
}

export function loadBrowser(): BrowserMeasurement {
  return JSON.parse(readFileSync(fileURLToPath(new URL('./parity.browser.json', import.meta.url)), 'utf8')) as BrowserMeasurement;
}

/** The browser's gate label → the engine's gate id ("Compile" → compile). */
export const gateId = (label: string): string => label.trim().toLowerCase();

/** "✕ REJECTED BY PROPERTIES — SPEC WAS SILENT · #1" → { gate: 'properties', silent: true } */
export function parseGateLine(line: string): { gate: string; silent: boolean } {
  const m = /REJECTED BY (\w+)/i.exec(line);
  return { gate: (m?.[1] ?? '').toLowerCase(), silent: /SPEC WAS SILENT/i.test(line) };
}

/**
 * Remove the killed / killed-by-bound split (allowance 1) from either sentence:
 *   evidence line: "Tests killed 9 of 12 mutants (2 more stopped by the time limit; 1 survived…)" → "Tests killed 11 of 12 mutants (1 survived…)"
 *   site sentence: "caught 11 of 12 … (2 of them by the time limit; 1 slipped through…)" → "caught 11 of 12 … (1 slipped through…)"
 */
export function mergeTimeLimit(line: string): string {
  return line
    .replace(/Tests killed (\d+) of (\d+ mutants?) \((\d+) more stopped by the time limit(; |\))/, (_m, k: string, n: string, b: string, end: string) => `Tests killed ${Number(k) + Number(b)} of ${n}${end === '; ' ? ' (' : ''}`)
    .replace(/(\d+) of them by the time limit; /, '')
    .replace(/ \((\d+) of them by the time limit\)/, '');
}

const rows = coerceCsvRows(parseCsv(BUNDLED_ORDERS_CSV()).rows).rows;

/** The recorded triggering call's arguments: `median([3, 1, 4, 2])` → [[3, 1, 4, 2]]; `f(rows)` → [the bundled rows]. */
export function callArgs(call: string, fn: string): unknown[] {
  const inner = call.slice(fn.length + 1, -1);
  // our own recording data, evaluated in the test process (not a gate): literals, or the bound dataset
  return new Function('rows', `return [${inner}];`)(rows) as unknown[];
}

/** The file a user would have: the type declarations, then `export function name(params): returns {\n<body>\n}`. */
export function sourceFile(spec: FunctionSpec, body: string): string {
  const params = spec.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const returns = spec.returns === null ? '' : `: ${spec.returns}`;
  return `${spec.typeDecls ? `${spec.typeDecls}\n\n` : ''}export function ${spec.name}(${params})${returns} {\n${body}\n}\n`;
}

/** The `undefined-spec` v1 file beside it: the recorded spec as recorded, plus the triggering call's arguments. */
export function specFile(spec: FunctionSpec, call: string): string {
  const entry: Record<string, Json> = {
    doc: spec.doc,
    tests: spec.tests,
    properties: spec.properties,
    budgetMs: spec.budgetMs,
    params: spec.params as unknown as Json,
    returns: spec.returns,
    ...(spec.typeDecls ? { typeDecls: spec.typeDecls } : {}),
    calls: [callArgs(call, spec.name).map((a) => encodeValue(a))],
  };
  return JSON.stringify({ format: 'undefined-spec', version: 1, functions: { [spec.name]: entry } }, null, 2);
}

/** The expected engine/CLI verdict and exit code for a browser attempt (the one non-timing mapping above). */
export function expectedVerdict(a: BrowserAttempt): { verdict: 'accepted' | 'rejected' | 'gaps'; exit: 0 | 1 | 2; gate: string | null } {
  if (a.verdict === 'accepted') return { verdict: 'accepted', exit: 0, gate: null };
  const g = parseGateLine(a.rejection.gateLine);
  return g.silent ? { verdict: 'gaps', exit: 2, gate: g.gate } : { verdict: 'rejected', exit: 1, gate: g.gate };
}
