/**
 * The one PR comment (docs/WORKSPACE-DESIGN.md §5.3), rendered from a Report. Every string in a Report may come from
 * the PR (function names, test names, values the code returned), so all text is escaped: table cells cannot break the
 * table, inline code cannot break out of its backticks, fenced snippets use a fence longer than any backtick run in
 * them, raw HTML is neutralised (so nobody can forge the marker), and `@` cannot ping anyone.
 */
import { failing, type Report, type ReportFunction, type ReportGap } from './model';

export const MARKER = '<!-- undefined-certify -->';
/** GitHub's limit is 65 536 characters; leave room. */
export const MAX_COMMENT = 60_000;

const ZWSP = '​';

/** Plain text: no HTML, no mentions, no line breaks, no table pipes. */
export function text(s: string): string {
  return s
    .replace(/\r?\n|\r/g, ' ')
    .replace(/[\\`*_[\]#~|]/g, (m) => `\\${m}`)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, `@${ZWSP}`);
}

/** Inline code that survives any content (a fence longer than the longest backtick run; pipes escaped for tables). */
export function code(s: string, inTable = false): string {
  const flat = s.replace(/\r?\n|\r/g, ' ');
  const one = inTable ? flat.replace(/\|/g, '\\|') : flat;
  const longest = Math.max(0, ...[...one.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = one.startsWith('`') || one.endsWith('`') || one === '' ? ' ' : '';
  return `${fence}${pad}${one}${pad}${fence}`;
}

/** A fenced block that its content cannot close. */
export function fenced(s: string, lang: string): string {
  const longest = Math.max(0, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${s.replace(/\r\n?/g, '\n')}\n${fence}`;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

const where = (f: Pick<ReportFunction, 'file' | 'line'>, line = f.line): string => `${f.file}:${line}`;

function verdictCell(f: ReportFunction): string {
  switch (f.verdict) {
    case 'accepted':
      return f.unchecked ? 'accepted, unchecked' : 'accepted';
    case 'rejected':
      return `**rejected**${f.rejectedBy ? ` by ${text(f.rejectedBy)}` : ''}`;
    case 'gaps':
      return 'spec gap';
    case 'could-not-run':
      return 'could not run';
  }
}

function evidenceCell(f: ReportFunction): string {
  if (f.verdict === 'accepted') {
    const line = f.evidenceLine ?? 'Accepted.';
    const why = f.specFile ? `${f.specFile} has no checks for it` : 'no spec or test file found';
    return text(clip(f.unchecked ? `${line} Unchecked: ${why}, so only Compile could judge it.` : line, 600));
  }
  if (f.verdict === 'could-not-run') return text(clip(`Not a verdict on the code: ${f.reason ?? f.headline ?? 'it could not be certified'}`, 600));
  if (f.verdict === 'gaps') {
    const n = f.gaps.length;
    return text(clip(`${f.headline ?? 'Rejected only by checks marked @silentOn'}. ${n} decision${n === 1 ? '' : 's'} for the reviewer below.`, 600));
  }
  return text(clip(f.headline ?? 'Rejected.', 600));
}

function counts(r: Report): string {
  const by = (v: ReportFunction['verdict']): number => r.functions.filter((f) => f.verdict === v).length;
  const parts: string[] = [];
  const rej = by('rejected');
  const gaps = by('gaps');
  const cnr = by('could-not-run');
  const acc = by('accepted');
  if (rej) parts.push(`${rej} rejected`);
  if (gaps) parts.push(`${gaps} with spec gaps`);
  if (cnr) parts.push(`${cnr} could not run`);
  if (acc) parts.push(`${acc} accepted`);
  return parts.join(', ');
}

const shortSha = (s: string | null): string => (s ? s.slice(0, 7) : 'the working tree');

function header(r: Report): string[] {
  const n = r.functions.length;
  const fails = failing(r).length > 0;
  return [
    MARKER,
    `### Undefined: ${n} function${n === 1 ? '' : 's'} certified at ${code(shortSha(r.headSha ?? r.checkedOut))}: ${counts(r)}`,
    '',
    'Checked by the gates (compile, tests, properties, invariants) and a mutation check. Nothing was generated. The PR\'s code ran in a Node `worker_thread` with a watchdog; that is not a secure sandbox.',
    fails
      ? 'This check fails because a function was rejected.'
      : r.functions.some((f) => f.verdict === 'gaps')
        ? 'This check passes: spec gaps are questions for the reviewer, never failures.'
        : 'This check passes.',
  ];
}

function table(r: Report): string[] {
  return [
    '| function | verdict | evidence |',
    '|---|---|---|',
    ...r.functions.map((f) => `| ${code(f.name, true)} ${code(where(f), true)} | ${verdictCell(f)} | ${evidenceCell(f)} |`),
  ];
}

function survivors(r: Report): string[] {
  const rows = r.functions.flatMap((f) =>
    f.survivors.map((s) => `- ${code(s.line !== null ? where(f, s.line) : f.file)} (${code(f.name)}, compiled line ${s.compiledLine}): ${code(s.original)} → ${code(s.mutated)}`),
  );
  if (rows.length === 0) return [];
  return ['', '<details><summary>Mutants that survived (each may be an equivalent mutant; a test that kills it makes the check stricter)</summary>', '', ...rows, '', '</details>'];
}

function gapBlock(f: ReportFunction, g: ReportGap, withSnippets: boolean): string[] {
  const out: string[] = [
    '',
    `**${code(g.call)}** (${code(where(f))}): the spec didn't say ${text(g.silentOn)}. The check ${code(g.check)} expects ${code(g.expected)}; the code ${g.actual.startsWith('threw') ? code(g.actual) : `returns ${code(g.actual)}`}.${g.reasonable ? ` ${text(g.reasonable)}` : ''}`,
  ];
  if (g.onlyAgreeing) out.push('', text(g.onlyAgreeing));
  if (!withSnippets) {
    out.push('', `To decide, add a test to ${text(g.target)} (the snippets are in the job log; the comment was too long).`);
    return out;
  }
  out.push('', `To decide, add one of these to ${text(g.target)}:`);
  for (const c of g.choices) {
    out.push('', `- ${text(c.label)}${c.note ? `. ${text(c.note)}` : ''}`, '', fenced(c.snippet, c.lang).replace(/^/gm, '  '));
  }
  return out;
}

function decisions(r: Report, withSnippets: boolean): string[] {
  const gaps = r.functions.flatMap((f) => f.gaps.map((g) => [f, g] as const));
  if (gaps.length === 0) return [];
  return [
    '',
    '#### Decisions for the reviewer',
    'Each question is a case the spec is silent on: a check marked `@silentOn` disagrees with the code. A gap never fails this check. Answer it by adding the test for the answer you choose.',
    ...gaps.flatMap(([f, g]) => gapBlock(f, g, withSnippets)),
  ];
}

function notes(r: Report): string[] {
  if (r.notes.length === 0) return [];
  return ['', '<details><summary>Notes</summary>', '', ...r.notes.map((n) => `- ${text(clip(n, 800))}`), '', '</details>'];
}

/** The comment for a run that found no changed exported functions (only used to replace an earlier comment). */
export function renderEmpty(r: Pick<Report, 'headSha' | 'checkedOut'>): string {
  return [MARKER, `### Undefined: no exported TypeScript functions changed at ${code(shortSha(r.headSha ?? r.checkedOut))}`, '', 'Nothing to certify. Nothing was generated.'].join('\n');
}

/** The whole comment, at most MAX_COMMENT characters: detail is dropped (snippets, then sections) before rows are. */
export function renderComment(r: Report): string {
  if (r.functions.length === 0) return renderEmpty(r);
  const footer = ['', '<sub>Undefined certify: certifies code from any source, never generates it. Nothing is sent anywhere except this comment.</sub>'];
  const attempts = [
    () => [...header(r), '', ...table(r), ...survivors(r), ...decisions(r, true), ...notes(r), ...footer],
    () => [...header(r), '', ...table(r), ...survivors(r), ...decisions(r, false), ...notes(r), ...footer],
    () => [...header(r), '', ...table(r), '', 'Survivors, decisions and notes are in the job log (the comment was too long).', ...footer],
  ];
  for (const a of attempts) {
    const body = a().join('\n');
    if (body.length <= MAX_COMMENT) return body;
  }
  const lines = [...header(r), '', '| function | verdict | evidence |', '|---|---|---|'];
  const tail = ['', 'More functions than fit in one comment; the full report is in the job log and the `result-path` file.', ...footer];
  let used = lines.join('\n').length + tail.join('\n').length + 2;
  for (const row of table(r).slice(2)) {
    if (used + row.length + 1 > MAX_COMMENT) break;
    lines.push(row);
    used += row.length + 1;
  }
  return [...lines, ...tail].join('\n');
}
