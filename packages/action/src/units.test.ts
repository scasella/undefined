/** Unit tests: globs, diff parsing, function ranges, escaping, the comment's size cap, untrusted reports, the API client. */
import { describe, expect, it } from 'vitest';
import { pathFilter, parsePatterns } from './glob';
import { parseDiff, touches, unquotePath } from './diff';
import { declaresType, fileRanges } from './ranges';
import { code, fenced, MARKER, MAX_COMMENT, renderComment, text } from './comment';
import { failing, parseReport, REPORT_FORMAT, REPORT_VERSION, type Report, type ReportFunction } from './model';
import { upsertComment } from './github';
import { annotation, escapeProperty, input } from './commands';
import { failOnInput } from './main';
import { sourcesForCheckFile } from './touched';
import { decodeMappings } from './mutantLines';
import { fakeGitHub, writes } from '../test/helpers';

describe('paths', () => {
  it('globs: **, *, braces, exclusions; never test, spec or declaration files', () => {
    const f = pathFilter('src/**/*.ts, !src/generated/**\nlib/{a,b}.ts');
    expect(f('src/stats.ts')).toBe(true);
    expect(f('src/deep/x/y.ts')).toBe(true);
    expect(f('src/generated/z.ts')).toBe(false);
    expect(f('lib/a.ts')).toBe(true);
    expect(f('lib/c.ts')).toBe(false);
    expect(f('src/stats.test.ts')).toBe(false);
    expect(f('src/__tests__/x.ts')).toBe(false);
    expect(f('src/types.d.ts')).toBe(false);
    expect(f('src/stats.js')).toBe(false);
    expect(f('other/src/stats.ts')).toBe(false);
    expect(parsePatterns('a/{b,c}/*.ts,d.ts')).toEqual(['a/{b,c}/*.ts', 'd.ts']);
  });

  it('a spec or test file maps back to the source it checks', () => {
    expect(sourcesForCheckFile('src/stats.test.ts')).toEqual(['src/stats.ts']);
    expect(sourcesForCheckFile('src/stats.undefined.json')).toEqual(['src/stats.ts']);
    expect(sourcesForCheckFile('src/__tests__/stats.spec.ts')).toEqual(['src/__tests__/stats.ts', 'src/stats.ts']);
    expect(sourcesForCheckFile('src/stats.ts')).toEqual([]);
  });
});

describe('diff', () => {
  const patch = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -3 +3 @@ x',
    '-a',
    '+b',
    '@@ -10,2 +9,0 @@',
    '-gone',
    '-gone',
    'diff --git a/src/new.ts b/src/new.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1,4 @@',
    'diff --git a/src/old.ts b/src/old.ts',
    'deleted file mode 100644',
    '--- a/src/old.ts',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    'diff --git a/x.ts b/y.ts',
    'similarity index 90%',
    'rename from x.ts',
    'rename to y.ts',
    '--- a/x.ts',
    '+++ b/y.ts',
    '@@ -5,0 +6,2 @@',
    'diff --git "a/sp ace\\303\\251.ts" "b/sp ace\\303\\251.ts"',
    '--- "a/sp ace\\303\\251.ts"',
    '+++ "b/sp ace\\303\\251.ts"',
    '@@ -1 +1 @@',
  ].join('\n');

  it('parses new-side hunks per file; deleted files are skipped; renames and quoted paths are handled', () => {
    expect(parseDiff(patch)).toEqual([
      { path: 'src/a.ts', status: 'modified', hunks: [{ start: 3, count: 1 }, { start: 9, count: 0 }] },
      { path: 'src/new.ts', status: 'added', hunks: [{ start: 1, count: 4 }] },
      { path: 'y.ts', status: 'renamed', hunks: [{ start: 6, count: 2 }] },
      { path: 'sp aceé.ts', status: 'modified', hunks: [{ start: 1, count: 1 }] },
    ]);
    expect(unquotePath('plain.ts')).toBe('plain.ts');
  });

  it('a hunk touches a range when it overlaps it; a pure deletion only when strictly inside', () => {
    expect(touches({ start: 3, count: 1 }, 1, 5)).toBe(true);
    expect(touches({ start: 6, count: 2 }, 1, 5)).toBe(false);
    expect(touches({ start: 5, count: 3 }, 1, 5)).toBe(true);
    expect(touches({ start: 3, count: 0 }, 1, 5)).toBe(true); // lines deleted between 3 and 4
    expect(touches({ start: 5, count: 0 }, 1, 5)).toBe(false); // deleted after the closing brace
    expect(touches({ start: 0, count: 0 }, 1, 5)).toBe(false); // deleted before the first line
  });
});

describe('function ranges from the AST', () => {
  it('JSDoc through closing brace, arrow consts, overloads as one function, and type declarations', async () => {
    const src = `import type { X } from './x';
/** Doc
 * more */
export function a(n: number): number {
  return n;
}
function hidden(): void {}
export const b = (s: string): string =>
  s.trim();
export function o(x: number): number;
export function o(x: string): string;
export function o(x: any): any {
  return x;
}
type Row = { id: number };
export interface Box { row: Row }
`;
    const r = await fileRanges(src);
    expect(r.functions).toEqual([
      { name: 'a', from: 2, to: 6 },
      { name: 'b', from: 8, to: 9 },
      { name: 'o', from: 10, to: 14 },
    ]);
    expect(r.types).toEqual([
      { name: 'Row', from: 15, to: 15 },
      { name: 'Box', from: 16, to: 16 },
    ]);
    expect(declaresType('type Row = { id: number };\ninterface Box { row: Row }', 'Row')).toBe(true);
    expect(declaresType('type Rows = Row[];', 'Row')).toBe(false);
  });
});

describe('escaping (every string in a report may come from the PR)', () => {
  it('plain text cannot add HTML, forge the marker, ping anyone or break a table', () => {
    const t = text(`${MARKER} <img src=x> @octocat | **bold**\nnext`);
    expect(t).not.toContain('<');
    expect(t).not.toContain('@octocat');
    expect(t).not.toMatch(/(^|[^\\])\|/);
    expect(t).not.toContain('\n');
    expect(t).toContain('&lt;!-- undefined-certify --&gt;');
  });

  it('inline code and fences cannot be closed by their content', () => {
    expect(code('a`b')).toBe('``a`b``');
    expect(code('`x`')).toBe('`` `x` ``');
    expect(code('a|b', true)).toBe('`a\\|b`');
    expect(code('a|b')).toBe('`a|b`');
    expect(fenced('x ``` y', 'ts')).toBe('````ts\nx ``` y\n````');
  });

  it('workflow commands escape their data and properties', () => {
    expect(annotation('error', 'a%b\nc', { file: 'a,b:c.ts', line: 3, title: 't' })).toBe('::error file=a%2Cb%3Ac.ts,line=3,title=t::a%25b%0Ac');
    expect(escapeProperty('x')).toBe('x');
    expect(input({ 'INPUT_GITHUB-TOKEN': ' t ' }, 'github-token')).toBe('t');
    expect(input({}, 'paths', 'src/**/*.ts')).toBe('src/**/*.ts');
  });
});

const fn = (over: Partial<ReportFunction> = {}): ReportFunction => ({
  name: 'f',
  file: 'src/f.ts',
  line: 1,
  verdict: 'accepted',
  unchecked: false,
  why: 'changed',
  specFile: 'src/f.test.ts',
  evidenceLine: 'Compiled. 1 unit test.',
  survivors: [],
  gaps: [],
  ...over,
});
const report = (functions: ReportFunction[], over: Partial<Report> = {}): Report => ({
  format: REPORT_FORMAT,
  version: REPORT_VERSION,
  repository: 'octo/demo',
  pr: 7,
  headSha: 'abcdef0123456789',
  checkedOut: 'abcdef0123456789',
  base: '0123456789abcdef',
  functions,
  notes: [],
  failOn: ['rejected'],
  ...over,
});

describe('the comment', () => {
  it('fails only on rejection by default; never on a gap', () => {
    expect(failing(report([fn({ verdict: 'gaps' }), fn({ verdict: 'could-not-run' })]))).toEqual([]);
    expect(failing(report([fn({ verdict: 'rejected' })]))).toHaveLength(1);
    expect(failing(report([fn({ verdict: 'could-not-run' })], { failOn: ['rejected', 'could-not-run'] }))).toHaveLength(1);
    expect(failOnInput('rejection')).toEqual(['rejected']);
    expect(failOnInput('could-not-run')).toEqual(['rejected', 'could-not-run']);
    expect(() => failOnInput('gap')).toThrow(/never fails/);
  });

  it('stays under the size cap by dropping detail before rows', () => {
    const big = Array.from({ length: 400 }, (_, i) =>
      fn({
        name: `f${i}`,
        line: i + 1,
        verdict: 'gaps',
        headline: 'Rejected: x'.repeat(10),
        gaps: [{ call: `f${i}([])`, silentOn: 'x', check: 'c', expected: '0', actual: 'NaN', target: 'src/f.test.ts', choices: [{ label: 'k', agrees: true, snippet: 'it("x", () => {});\n'.repeat(20), lang: 'ts' }] }],
      }),
    );
    const body = renderComment(report(big));
    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT);
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('| `f0` `src/f.ts:1` | spec gap |');
  });

  it('round-trips through the untrusted-report validator, which rejects bad shapes and oversize strings', () => {
    const r = report([fn({ survivors: [{ line: null, compiledLine: 2, original: '<', mutated: '<=' }] })]);
    expect(parseReport(JSON.stringify({ ...r, extra: 1 }))).toEqual(r);
    expect(() => parseReport('{')).toThrow(/not JSON/);
    expect(() => parseReport(JSON.stringify({ ...r, format: 'x' }))).toThrow(/format/);
    expect(() => parseReport(JSON.stringify({ ...r, pr: -1 }))).toThrow(/report pr/);
    expect(() => parseReport(JSON.stringify({ ...r, headSha: 'main' }))).toThrow(/commit hash/);
    expect(() => parseReport(JSON.stringify(report([fn({ verdict: 'great' as never })])))).toThrow(/verdict/);
    expect(() => parseReport(JSON.stringify(report([fn({ name: 'x'.repeat(201) })])))).toThrow(/longer than/);
    expect(() => parseReport(JSON.stringify({ ...r, failOn: ['gaps'] }))).toThrow(/failOn/);
  });
});

describe('GitHub client', () => {
  it('creates, then updates in place, then leaves an identical comment alone', async () => {
    const gh = fakeGitHub();
    const client = { fetch: gh.fetch, api: 'http://api.github.test', token: 't', repo: 'octo/demo' };
    expect(await upsertComment(client, 7, `${MARKER}\none`)).toMatchObject({ action: 'created' });
    expect(await upsertComment(client, 7, `${MARKER}\ntwo`)).toMatchObject({ action: 'updated', id: gh.comments[0]!.id });
    expect(await upsertComment(client, 7, `${MARKER}\ntwo`)).toMatchObject({ action: 'unchanged' });
    expect(gh.comments.map((c) => c.body)).toEqual([`${MARKER}\ntwo`]);
    expect(writes(gh)).toHaveLength(2);
  });

  it('does not create a comment when asked not to; a read-only token is reported, not thrown; other failures throw', async () => {
    const gh = fakeGitHub();
    const client = { fetch: gh.fetch, api: 'http://api.github.test', token: 't', repo: 'octo/demo' };
    expect(await upsertComment(client, 7, MARKER, { createIfMissing: false })).toEqual({ action: 'skipped' });
    gh.writeStatus = 403;
    expect(await upsertComment(client, 7, MARKER)).toMatchObject({ action: 'forbidden' });
    gh.writeStatus = 500;
    await expect(upsertComment(client, 7, MARKER)).rejects.toThrow(/500/);
  });
});

describe('source maps', () => {
  it('decodes VLQ mappings to original lines', () => {
    // from ts.transpileModule of a 3-line function: line 0 has no mapping, then lines 1..3 map to 1..3
    expect(decodeMappings(';AAAA,SAAS;IACP;AACF')).toEqual([[], [0, 0], [1], [2]]);
  });
});

describe('logLine (PR text in the job log cannot become a workflow command)', () => {
  it('escapes newlines and other control characters and breaks a leading ::', async () => {
    const { logLine } = await import('./commands');
    expect(logLine('  f src/a.ts:1: rejected: threw Error: x\n::add-mask::y\r\u001b[2K')).toBe('  f src/a.ts:1: rejected: threw Error: x\\u000a::add-mask::y\\u000d\\u001b[2K');
    expect(logLine('::error::pwn.ts: certifying f')).toBe('\\u003a:error::pwn.ts: certifying f');
    expect(logLine('  ::warning::x')).toBe('  \\u003a:warning::x');
    expect(logLine('undefined-certify: 2 changed file(s)')).toBe('undefined-certify: 2 changed file(s)');
  });
});
