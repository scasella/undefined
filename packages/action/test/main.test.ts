/**
 * The Action end to end: real git repositories, the real engine and Node gate host (watchdog included), and a mocked
 * GitHub REST API behind an injected `fetch`. Covers the brief's cases: create, update in place, no change, rejection
 * fails the check, a spec gap does not, no changed functions, a fork's read-only token, the fork-safe comment mode,
 * and the dry run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeGateHost, type NodeGateHost } from '@scasella/undefined-engine/node';
import { run, type Deps } from '../src/main';
import { certifiedBy } from '../src/host';
import { MARKER } from '../src/comment';
import { parseReport } from '../src/model';
import { fakeGitHub, makeRepo, writes, type FakeGitHub, type Repo } from './helpers';

let host: NodeGateHost;
let tmp: string;
const repos: Repo[] = [];
beforeAll(async () => {
  host = await createNodeGateHost();
  tmp = mkdtempSync(join(tmpdir(), 'undefined-action-env-'));
});
afterAll(() => {
  for (const r of repos) r.remove();
  rmSync(tmp, { recursive: true, force: true });
});

const STATS = `/** Returns the median of a list of numbers. */
export function median(numbers: number[]): number {
  const s = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
`;
const STATS_TESTS = `import { it, expect } from 'vitest';
import { median } from './stats';
it('odd', () => { expect(median([3, 1, 2])).toBe(2); });
it('even', () => { expect(median([4, 1, 3, 2])).toBe(2.5); });
`;
const WRONG = STATS.replace('(s[mid - 1]! + s[mid]!) / 2', 's[mid]!');

interface Run {
  code: number;
  out: string[];
  log: string[];
  summary: string;
  outputs: string;
}

let n = 0;
async function act(repo: Repo, gh: FakeGitHub | null, extra: Record<string, string> = {}, event?: unknown): Promise<Run> {
  n += 1;
  const eventPath = join(tmp, `event-${n}.json`);
  const head = repo.git('rev-parse', 'HEAD').trim();
  const base = repo.git('rev-parse', 'main~1').trim();
  writeFileSync(eventPath, JSON.stringify(event ?? { pull_request: { number: 7, base: { sha: base }, head: { sha: head } } }));
  const outputFile = join(tmp, `output-${n}`);
  const summaryFile = join(tmp, `summary-${n}`);
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');
  const out: string[] = [];
  const log: string[] = [];
  const deps: Deps = {
    fetch: gh?.fetch ?? ((async () => {
      throw new Error('no network in this test');
    }) as typeof fetch),
    out: (l) => out.push(l),
    log: (l) => log.push(l),
    createHost: async () => host,
    certifiedBy,
  };
  const code = await run(
    {
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'octo/demo',
      GITHUB_API_URL: 'http://api.github.test',
      GITHUB_WORKSPACE: repo.dir,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      RUNNER_TEMP: tmp,
      'INPUT_GITHUB-TOKEN': 'test-token',
      INPUT_MUTATION: 'false',
      INPUT_PATHS: 'src/**/*.ts',
      'INPUT_RESULT-PATH': join(tmp, `result-${n}.json`),
      ...extra,
    },
    deps,
  );
  return { code, out, log, summary: readFileSync(summaryFile, 'utf8'), outputs: readFileSync(outputFile, 'utf8') };
}

function repoWith(base: Record<string, string>, head: Record<string, string | null>): Repo {
  const r = makeRepo();
  repos.push(r);
  r.write({ 'README.md': 'demo\n', ...base });
  r.commit('base');
  r.write(head);
  r.commit('pr');
  return r;
}

describe('one comment per PR, updated on each push', () => {
  const gh = fakeGitHub();
  let repo: Repo;

  it('a rejection fails the check and creates the comment', async () => {
    repo = repoWith({ 'src/stats.test.ts': STATS_TESTS, 'src/stats.ts': 'export function noop(): void {\n}\n' }, { 'src/stats.ts': WRONG });
    const r = await act(repo, gh);
    expect(r.code).toBe(1);
    expect(writes(gh)).toEqual(['POST /repos/octo/demo/issues/7/comments']);
    expect(gh.requests.every((q) => q.auth === 'Bearer test-token')).toBe(true);
    const body = gh.comments[0]!.body;
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('| `median` `src/stats.ts:2` | **rejected** by tests | Rejected: median(\\[4, 1, 3, 2\\]) returned 3, expected 2.5 |');
    expect(body).toContain('This check fails because a function was rejected.');
    expect(r.out.some((l) => l.startsWith('::error file=src/stats.ts,line=2,'))).toBe(true);
    expect(r.outputs).toMatch(/^result-path<<undefined_[0-9a-f]+\n.*result-\d+\.json\n/);
    expect(r.summary).toContain(MARKER);
  });

  it('the next push updates the same comment in place, and an accepted function passes', async () => {
    repo.write({ 'src/stats.ts': STATS });
    repo.commit('fix');
    // the PR's base is still the first commit
    const base = repo.git('rev-list', '--max-parents=0', 'HEAD').trim();
    const head = repo.git('rev-parse', 'HEAD').trim();
    const r = await act(repo, gh, {}, { pull_request: { number: 7, base: { sha: base }, head: { sha: head } } });
    expect(r.code).toBe(0);
    expect(writes(gh)).toEqual(['POST /repos/octo/demo/issues/7/comments', `PATCH /repos/octo/demo/issues/comments/${gh.comments[0]!.id}`]);
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0]!.body).toContain('| `median` `src/stats.ts:2` | accepted | Compiled. 2 unit tests.');
    expect(gh.comments[0]!.body).toContain(head.slice(0, 7));
  });

  it('a re-run with nothing new sends no write at all', async () => {
    const base = repo.git('rev-list', '--max-parents=0', 'HEAD').trim();
    const head = repo.git('rev-parse', 'HEAD').trim();
    const before = writes(gh).length;
    const r = await act(repo, gh, {}, { pull_request: { number: 7, base: { sha: base }, head: { sha: head } } });
    expect(r.code).toBe(0);
    expect(writes(gh)).toHaveLength(before);
    expect(r.log.some((l) => l.includes('comment unchanged'))).toBe(true);
  });

  it('finds its comment on a later page among other comments, and ignores comments without the marker', async () => {
    const other = fakeGitHub();
    for (let i = 0; i < 130; i++) other.comments.push({ id: i + 1, body: i === 3 ? `quoting ${MARKER}` : `comment ${i}`, user: { login: 'someone', type: 'User' } });
    other.comments.push({ id: 999, body: `${MARKER}\nold`, user: { login: 'github-actions[bot]', type: 'Bot' } });
    const base = repo.git('rev-list', '--max-parents=0', 'HEAD').trim();
    const head = repo.git('rev-parse', 'HEAD').trim();
    await act(repo, other, {}, { pull_request: { number: 7, base: { sha: base }, head: { sha: head } } });
    expect(writes(other)).toEqual(['PATCH /repos/octo/demo/issues/comments/999']);
    expect(other.requests.filter((q) => q.method === 'GET').map((q) => q.path)).toEqual([
      '/repos/octo/demo/issues/7/comments?per_page=100&page=1',
      '/repos/octo/demo/issues/7/comments?per_page=100&page=2',
    ]);
  });

  it('ignores a marked comment someone else wrote (the PR author cannot pre-empt or hijack the report)', async () => {
    const other = fakeGitHub();
    other.comments.push({ id: 1, body: `${MARKER}\nall accepted, nothing to see`, user: { login: 'pr-author', type: 'User' } });
    const base = repo.git('rev-list', '--max-parents=0', 'HEAD').trim();
    const head = repo.git('rev-parse', 'HEAD').trim();
    await act(repo, other, {}, { pull_request: { number: 7, base: { sha: base }, head: { sha: head } } });
    expect(writes(other)).toEqual(['POST /repos/octo/demo/issues/7/comments']);
    expect(other.comments[0]!.body).toBe(`${MARKER}\nall accepted, nothing to see`);
  });
});

describe('verdict policy', () => {
  it('a spec gap passes the check and asks the reviewer, with paste-ready tests', async () => {
    const tests = `${STATS_TESTS}/** @silentOn what the median of nothing is @reasonable Throwing on an empty list is also defensible. */
it('empty', () => { expect(median([])).toBe(0); });
`;
    const repo = repoWith({ 'src/stats.ts': 'export function noop(): void {\n}\n' }, { 'src/stats.ts': STATS, 'src/stats.test.ts': tests });
    const gh = fakeGitHub();
    const r = await act(repo, gh);
    expect(r.code).toBe(0);
    const body = gh.comments[0]!.body;
    expect(body).toContain('| `median` `src/stats.ts:2` | spec gap |');
    expect(body).toContain('This check passes: spec gaps are questions for the reviewer, never failures.');
    expect(body).toContain("**`median([])`** (`src/stats.ts:2`): the spec didn't say what the median of nothing is. The check `empty` expects `0`; the code returns `NaN`. Throwing on an empty list is also defensible.");
    expect(body).toContain('To decide, add one of these to src/stats.test.ts:');
    expect(body).toContain('  it("decided: median([]) returns NaN", () => {\n    expect(median([])).toBe(NaN);\n  });');
    expect(body).toContain('  it("decided: median([]) throws", () => {\n    expect(() => median([])).toThrow();\n  });');
    expect(r.out.some((l) => l.startsWith('::warning file=src/stats.ts,line=2,') && l.includes('spec gap'))).toBe(true);
    expect(r.out.some((l) => l.startsWith('::error'))).toBe(false);
  });

  it('could-not-run passes by default and fails only when opted in', async () => {
    const src = 'const LIMIT = 3;\nexport function capped(x: number): number {\n  return Math.min(x, LIMIT);\n}\n';
    const repo = repoWith({ 'src/cap.ts': 'export function noop(): void {\n}\n' }, { 'src/cap.ts': src });
    const a = await act(repo, null, { 'INPUT_DRY-RUN': 'true' });
    expect(a.code).toBe(0);
    expect(a.out.join('\n')).toContain('could not run');
    expect(a.out.join('\n')).toContain('uses LIMIT from module scope');
    const b = await act(repo, null, { 'INPUT_DRY-RUN': 'true', 'INPUT_FAIL-ON': 'rejection, could-not-run' });
    expect(b.code).toBe(1);
    const c = await act(repo, null, { 'INPUT_DRY-RUN': 'true', 'INPUT_FAIL-ON': 'gaps' });
    expect(c.code).toBe(1);
    expect(c.log.join('\n')).toContain('a spec gap never fails the check');
  });

  it("a fork's read-only token: the comment is skipped with a warning and the verdict still decides the check", async () => {
    const repo = repoWith({ 'src/stats.test.ts': STATS_TESTS, 'src/stats.ts': 'export function noop(): void {\n}\n' }, { 'src/stats.ts': WRONG });
    const gh = fakeGitHub();
    gh.writeStatus = 403;
    const r = await act(repo, gh);
    expect(r.code).toBe(1);
    expect(gh.comments).toHaveLength(0);
    expect(r.out.some((l) => l.startsWith('::warning::the comment could not be posted: POST /repos/octo/demo/issues/7/comments: 403'))).toBe(true);
    expect(r.summary).toContain('**rejected** by tests');
  });
});

describe('what counts as touched', () => {
  it('no changed exported function: no comment is created', async () => {
    const repo = repoWith({ 'src/stats.ts': STATS, 'src/stats.test.ts': STATS_TESTS }, { 'README.md': 'changed\n', 'src/notes.txt': 'x\n' });
    const gh = fakeGitHub();
    const r = await act(repo, gh);
    expect(r.code).toBe(0);
    expect(writes(gh)).toEqual([]);
    expect(r.log.some((l) => l.includes('0 exported function(s) touched'))).toBe(true);
  });

  it('no changed exported function, but an earlier comment exists: it is replaced by a short note', async () => {
    const repo = repoWith({ 'src/stats.ts': STATS, 'src/stats.test.ts': STATS_TESTS }, { 'README.md': 'changed\n' });
    const gh = fakeGitHub();
    gh.comments.push({ id: 5, body: `${MARKER}\nold results`, user: { login: 'github-actions[bot]', type: 'Bot' } });
    await act(repo, gh);
    expect(writes(gh)).toEqual(['PATCH /repos/octo/demo/issues/comments/5']);
    expect(gh.comments[0]!.body).toMatch(/^<!-- undefined-certify -->\n### Undefined: no exported TypeScript functions changed at `[0-9a-f]{7}`/);
  });

  it('only the touched function is reported; a changed test file touches every function it covers; paths filters', async () => {
    const two = `${STATS}\nexport function double(x: number): number {\n  return x * 2;\n}\n`;
    const repo = repoWith({ 'src/stats.ts': two, 'src/stats.test.ts': STATS_TESTS, 'lib/other.ts': 'export function one(): number {\n  return 1;\n}\n' }, {
      'src/stats.ts': two.replace('return x * 2;', 'return x + x;'),
      'lib/other.ts': 'export function one(): number {\n  return 2 - 1;\n}\n',
    });
    const a = await act(repo, null, { 'INPUT_DRY-RUN': 'true' });
    const report = parseReport(readFileSync(join(tmp, `result-${n}.json`), 'utf8'));
    expect(report.functions.map((f) => [f.file, f.name, f.why])).toEqual([['src/stats.ts', 'double', 'changed']]);
    expect(a.code).toBe(0);

    repo.write({ 'src/stats.test.ts': `${STATS_TESTS}it('three', () => { expect(median([1, 2, 3])).toBe(2); });\n` });
    repo.commit('more tests');
    const root = repo.git('rev-list', '--max-parents=0', 'HEAD').trim();
    await act(repo, null, { 'INPUT_DRY-RUN': 'true', INPUT_PATHS: 'src/**/*.ts\nlib/**' }, { pull_request: { number: 7, base: { sha: root }, head: { sha: repo.git('rev-parse', 'HEAD').trim() } } });
    const second = parseReport(readFileSync(join(tmp, `result-${n}.json`), 'utf8'));
    expect(second.functions.map((f) => [f.file, f.name, f.why])).toEqual([
      ['lib/other.ts', 'one', 'changed'],
      ['src/stats.ts', 'median', 'its test file changed'],
      ['src/stats.ts', 'double', 'changed'],
    ]);
  });
});

describe('surviving mutants', () => {
  it('are listed with the file line they mutate, mapped back through the compiled code', async () => {
    const src = `/** Of age? */
export function isAdult(age: number): boolean {
  // the legal age

  if (age >= 18) {
    return true;
  }
  return false;
}
`;
    const tests = `import { it, expect } from 'vitest';
import { isAdult } from './age';
it('grown up', () => { expect(isAdult(30)).toBe(true); });
it('child', () => { expect(isAdult(5)).toBe(false); });
`;
    const repo = repoWith({ 'src/age.ts': 'export function noop(): void {\n}\n' }, { 'src/age.ts': src, 'src/age.test.ts': tests });
    const r = await act(repo, null, { 'INPUT_DRY-RUN': 'true', INPUT_MUTATION: 'true' });
    expect(r.code).toBe(0);
    const report = parseReport(readFileSync(join(tmp, `result-${n}.json`), 'utf8'));
    const f = report.functions[0]!;
    expect(f.verdict).toBe('accepted');
    expect(f.survivors.length).toBeGreaterThan(0);
    // every surviving mutant here is in `if (age >= 18)`: file line 5, compiled line 2 (the emitter drops the blank line)
    expect(f.survivors.map((s) => [s.line, s.compiledLine])).toEqual(f.survivors.map(() => [5, 2]));
    expect(r.out.join('\n')).toContain('- `src/age.ts:5` (`isAdult`, compiled line 2): `>=` → `>`');
  });
});

describe('dry run and the fork-safe comment mode', () => {
  it('dry run: prints the comment, sends nothing', async () => {
    const repo = repoWith({ 'src/stats.test.ts': STATS_TESTS, 'src/stats.ts': 'export function noop(): void {\n}\n' }, { 'src/stats.ts': STATS });
    const r = await act(repo, null, { UNDEFINED_DRY_RUN: '1' }, {});
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    expect(r.out[0]!.startsWith(MARKER)).toBe(true);
    expect(r.out[0]).toContain('| `median` `src/stats.ts:2` | accepted |');
  });

  it('comment mode posts a certify run\'s report only on the PR whose head was certified, and runs no PR code', async () => {
    const repo = repoWith({ 'src/stats.test.ts': STATS_TESTS, 'src/stats.ts': 'export function noop(): void {\n}\n' }, { 'src/stats.ts': WRONG });
    const head = repo.git('rev-parse', 'HEAD').trim();
    const certifyRun = await act(repo, null, { INPUT_MODE: 'certify' });
    expect(certifyRun.code).toBe(1);
    const resultFile = join(tmp, `result-${n}.json`);

    // a trusted workflow_run job: run from a directory without the PR's code; it never starts a gate host
    const empty = makeRepo();
    repos.push(empty);
    const gh = fakeGitHub();
    gh.pullHead = head;
    const ok = await act(repo, gh, { INPUT_MODE: 'comment', 'INPUT_REPORT-FILE': resultFile, GITHUB_WORKSPACE: empty.dir }, { workflow_run: { head_sha: head } });
    expect(ok.code).toBe(0);
    expect(writes(gh)).toEqual(['POST /repos/octo/demo/issues/7/comments']);
    expect(gh.comments[0]!.body).toContain('**rejected** by tests');

    // the PR moved on: nothing is posted
    const moved = fakeGitHub();
    moved.pullHead = 'f'.repeat(40);
    const stale = await act(repo, moved, { INPUT_MODE: 'comment', 'INPUT_REPORT-FILE': resultFile }, { workflow_run: { head_sha: head } });
    expect(stale.code).toBe(0);
    expect(writes(moved)).toEqual([]);

    // a report for another commit than the workflow run: refused
    const other = fakeGitHub();
    other.pullHead = head;
    const wrong = await act(repo, other, { INPUT_MODE: 'comment', 'INPUT_REPORT-FILE': resultFile }, { workflow_run: { head_sha: 'a'.repeat(40) } });
    expect(wrong.code).toBe(1);
    expect(writes(other)).toEqual([]);

    // a tampered report: refused before anything is rendered or sent
    const tampered = join(tmp, 'tampered.json');
    const j = JSON.parse(readFileSync(resultFile, 'utf8'));
    j.functions[0].line = '1; DROP';
    writeFileSync(tampered, JSON.stringify(j));
    const bad = await act(repo, other, { INPUT_MODE: 'comment', 'INPUT_REPORT-FILE': tampered }, { workflow_run: { head_sha: head } });
    expect(bad.code).toBe(1);
    expect(bad.out.join('\n')).toContain('report functions[0].line: expected a non-negative integer');
    expect(writes(other)).toEqual([]);
  });
});
