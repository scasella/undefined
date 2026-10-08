/**
 * "This check may be wrong": when every draft of an answer was thrown out by the SAME check, and that check is one the AI drafted
 * (model/specDraft.ts DRAFTED_MARK), the thrown-out card says so instead of only "every draft was thrown out". Pure.
 *
 * Two honest readings, and the diagnostics say which to lead with. The model that writes the answer never sees a check's body, only
 * the agreement's words and the checks' names (docs/DESIGN.md "What the model sees"), so a check can fail every draft because
 *   - 'check'      its own expected answer is off: an example, and the drafts, written separately, all gave the SAME answer to it;
 *   - 'agreement'  the agreement never says what the check requires: the drafts disagree with each other, or it is a house rule (a
 *                  property's counterexample is shrunk per draft, so comparing what the drafts gave there means nothing).
 * The page offers both ways forward in both cases (drop the check · write what it requires into the agreement), the favoured one
 * first; the viewer decides (PRODUCT.md principle 4). Nothing here runs anything: `withoutCheck` / `withRequirement` return the spec
 * to install (session.applySpec), then the page asks again.
 */
import type { Diagnostic, FunctionSpec, GenerationView } from '@scasella/undefined-engine/types';
import { listTestNames } from '@scasella/undefined-engine/shared/specInfo';
import { DRAFTED_MARK } from './specDraft';

export interface SuspectCheck {
  name: string;
  kind: 'example' | 'rule';
  /** The check in plain words (the comment line draftToSpec wrote above it), or its name. */
  plain: string;
  /** The check's own source, as installed. */
  source: string;
  /** Which reading the evidence favours (see above). */
  reading: 'check' | 'agreement';
  /** Drafts it threw out. */
  drafts: number;
  /** The call the check made, and what it expected, from the last draft's failure (examples; may be absent). */
  call: string | null;
  expected: string | null;
  /** What each draft gave, in order (examples; empty for a house rule). */
  gave: string[];
}

/** A drafted section split into its checks: the mark, then `// plain\n<source>\n` blocks (draftToSpec), each holding one named check. */
export interface DraftedBlock {
  name: string;
  plain: string;
  text: string;
}

export function draftedBlocks(section: string): DraftedBlock[] | null {
  if (!section.startsWith(DRAFTED_MARK)) return null;
  const body = section.slice(DRAFTED_MARK.length + 1);
  // a block starts with its plain-words comment after a blank line; a piece that names no check belongs to the block before it
  const pieces = body.split(/\n\n(?=\/\/ )/);
  const out: DraftedBlock[] = [];
  for (const piece of pieces) {
    const names = listTestNames(piece);
    if (names.length === 0 && out.length > 0) {
      out[out.length - 1]!.text += `\n\n${piece}`;
      continue;
    }
    if (names.length !== 1) return null;
    const first = piece.split('\n', 1)[0] ?? '';
    out.push({ name: names[0]!, plain: first.startsWith('// ') ? first.slice(3).trim() : names[0]!, text: piece });
  }
  return out;
}

/** The section again, from blocks: exactly what draftToSpec writes for them ('' when none is left). */
function joinBlocks(blocks: readonly DraftedBlock[]): string {
  return blocks.length === 0 ? '' : `${DRAFTED_MARK}\n${blocks.map((b) => b.text).join('\n\n')}`;
}

type CheckDiagnostic = Extract<Diagnostic, { kind: 'test' } | { kind: 'property' }>;

/** The check that threw a draft out, or null when something else did (it did not compile, it was not pure, it ran too long…). */
function rejectingCheck(a: GenerationView['attempts'][number]): CheckDiagnostic | null {
  if (a.status !== 'rejected') return null;
  const failed = a.gates.find((g) => g.status === 'fail');
  if (!failed || (failed.gate !== 'tests' && failed.gate !== 'properties')) return null;
  const d = failed.diagnostics.find((x): x is CheckDiagnostic => x.kind === 'test' || x.kind === 'property');
  return d ?? null;
}

/**
 * The suspect, when there is one: at least two drafts, every one thrown out, every one by the same check, and that check is drafted
 * (in the drafted section of the spec the drafts ran against).
 */
export function suspectCheck(gen: GenerationView | null, spec: FunctionSpec | null): SuspectCheck | null {
  if (!gen || !spec || gen.phase !== 'failed' || gen.declined || gen.attempts.length < 2) return null;
  const ds = gen.attempts.map(rejectingCheck);
  if (ds.some((d) => d === null)) return null;
  const all = ds as CheckDiagnostic[];
  const name = all[0]!.name;
  if (!all.every((d) => d.name === name && d.kind === all[0]!.kind)) return null;
  const kind = all[0]!.kind === 'test' ? 'example' : 'rule';
  const block = (draftedBlocks(kind === 'example' ? spec.tests : spec.properties) ?? []).find((b) => b.name === name);
  if (!block) return null;
  const gave = kind === 'example' ? all.map((d) => d.actual ?? (d.error ? `threw ${d.error}` : '')).filter((x) => x !== '') : [];
  const converged = kind === 'example' && gave.length === all.length && gave.every((g) => g === gave[0]);
  const last = all[all.length - 1]!;
  return {
    name,
    kind,
    plain: block.plain,
    source: block.text.split('\n').slice(1).join('\n').trim(),
    reading: converged ? 'check' : 'agreement',
    drafts: all.length,
    call: kind === 'example' ? (last.call ?? null) : null,
    expected: kind === 'example' ? (last.expected ?? null) : null,
    gave,
  };
}

/** The spec without the suspect check (the others byte for byte as they were). null when it cannot be found. */
export function withoutCheck(spec: FunctionSpec, s: Pick<SuspectCheck, 'name' | 'kind'>): FunctionSpec | null {
  const key = s.kind === 'example' ? 'tests' : 'properties';
  const blocks = draftedBlocks(spec[key]);
  if (!blocks || !blocks.some((b) => b.name === s.name)) return null;
  return { ...spec, [key]: joinBlocks(blocks.filter((b) => b.name !== s.name)) };
}

/** The line the agreement gains when the viewer says the check is right: its plain words, as a requirement the answer's writer reads. */
export const requirementLine = (plain: string): string => `- The agreement also requires: ${plain.replace(/\s+/g, ' ').trim()}`;

/** The spec with the check's requirement written into the agreement (`doc`), so the model that writes the answer reads it. */
export function withRequirement(spec: FunctionSpec, s: Pick<SuspectCheck, 'plain'>): FunctionSpec {
  const line = requirementLine(s.plain);
  return spec.doc.includes(line) ? spec : { ...spec, doc: `${spec.doc.trimEnd()}\n${line}` };
}
