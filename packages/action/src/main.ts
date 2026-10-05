/**
 * The Action (docs/WORKSPACE-DESIGN.md §5): certify the exported TypeScript functions a PR touches, keep one comment
 * up to date, fail the check only on a rejection, never on a spec gap.
 *
 * Modes:
 *   certify-and-comment  (default) diff → touched functions → certify → result file → the one comment.
 *   certify              the same without commenting (the untrusted half of the fork-safe setup).
 *   comment              read a result file written by `certify`, validate it as untrusted data, check it belongs to the
 *                        PR's current head, post or update the comment. Runs no PR code and needs no checkout.
 * Dry run (input `dry-run: true` or UNDEFINED_DRY_RUN=1): nothing is sent; the comment is printed to stdout. Locally,
 * in any git repository: `UNDEFINED_DRY_RUN=1 UNDEFINED_BASE=main node packages/action/dist/index.js`.
 *
 * Neutral: it certifies code from any source (a person, Claude Code, Codex, Cursor) and never generates code.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { GateHost, Json } from '@scasella/undefined-engine';
import { annotation, appendSummary, bool, input, logLine, setOutput, type Env } from './commands';
import { renderComment } from './comment';
import { certifyTouched, type CertifyTouchedResult } from './certifyTouched';
import { changedFiles, gitIn } from './diff';
import { pathFilter } from './glob';
import { pullHeadSha, upsertComment, type GitHub } from './github';
import { failing, parseReport, REPORT_FORMAT, REPORT_VERSION, type Report } from './model';
import { touchedFunctions } from './touched';

export interface Deps {
  fetch: typeof fetch;
  /** stdout: workflow commands, and the comment in a dry run. */
  out(line: string): void;
  /** Progress for the job log (stderr). */
  log(line: string): void;
  createHost(): Promise<GateHost>;
  certifiedBy(): Promise<Record<string, Json>>;
}

const MODES = ['certify-and-comment', 'certify', 'comment'] as const;
type Mode = (typeof MODES)[number];

interface PullRequestEvent {
  pull_request?: { number?: number; base?: { sha?: string }; head?: { sha?: string } };
  workflow_run?: { head_sha?: string };
}

export function failOnInput(v: string): Report['failOn'] {
  const out: Report['failOn'] = [];
  for (const raw of v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const k = raw === 'rejection' ? 'rejected' : raw;
    if (k === 'gap' || k === 'gaps') throw new Error('input fail-on: a spec gap never fails the check (it is a question for the reviewer)');
    if (k !== 'rejected' && k !== 'could-not-run') throw new Error(`input fail-on: expected rejection and/or could-not-run, got ${JSON.stringify(raw)}`);
    if (!out.includes(k)) out.push(k);
  }
  if (!out.includes('rejected')) out.unshift('rejected');
  return out;
}

function readEvent(env: Env): PullRequestEvent {
  if (!env.GITHUB_EVENT_PATH || !existsSync(env.GITHUB_EVENT_PATH)) return {};
  return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as PullRequestEvent;
}

/** Runs the Action; resolves to the process exit code. */
export async function run(env: Env, deps: Deps): Promise<number> {
  const dryRun = bool(env, 'dry-run', false) || ['1', 'true', 'yes'].includes((env.UNDEFINED_DRY_RUN ?? '').toLowerCase());
  // In a dry run stdout is the comment alone; annotations go to the log.
  const emit = dryRun ? deps.log : deps.out;
  try {
    const mode = input(env, 'mode', 'certify-and-comment') as Mode;
    if (!MODES.includes(mode)) throw new Error(`input mode: expected one of ${MODES.join(', ')}, got ${JSON.stringify(mode)}`);
    const event = readEvent(env);
    const gh: GitHub = {
      fetch: deps.fetch,
      api: env.GITHUB_API_URL ?? 'https://api.github.com',
      token: input(env, 'github-token', env.GITHUB_TOKEN ?? ''),
      repo: env.GITHUB_REPOSITORY ?? '',
    };
    if (mode === 'comment') return await commentMode(env, deps, gh, event, dryRun);
    return await certifyMode(env, deps, gh, event, mode, dryRun, emit);
  } catch (e) {
    emit(annotation('error', `undefined-certify could not run: ${e instanceof Error ? e.message : String(e)}`));
    return 1;
  }
}

async function certifyMode(env: Env, deps: Deps, gh: GitHub, event: PullRequestEvent, mode: Mode, dryRun: boolean, emit: (s: string) => void): Promise<number> {
  const pr = event.pull_request;
  if (!pr && !dryRun) {
    emit(annotation('notice', 'not a pull_request event: nothing to certify (run it on pull_request, or set dry-run)'));
    return 0;
  }
  const workspace = env.GITHUB_WORKSPACE ?? process.cwd();
  const wd = input(env, 'working-directory', '.');
  const git = gitIn(isAbsolute(wd) ? wd : resolve(workspace, wd));
  const root = (await git(['rev-parse', '--show-toplevel'])).trim();
  const base = pr?.base?.sha ?? (env.UNDEFINED_BASE?.trim() || 'HEAD~1');
  const { mergeBase, files } = await changedFiles(git, base);
  const checkedOut = (await git(['rev-parse', 'HEAD'])).trim();
  const decidedAt = Number((await git(['log', '-1', '--format=%ct', 'HEAD'])).trim()) * 1000;
  const include = pathFilter(input(env, 'paths', 'src/**/*.ts'));
  const exists = (abs: string): boolean => existsSync(abs);
  const touched = await touchedFunctions({
    root,
    files,
    include,
    exists,
    read: async (rel) => {
      try {
        return await readFile(join(root, rel), 'utf8');
      } catch {
        return null;
      }
    },
  });
  const n = [...touched.values()].reduce((a, m) => a + m.size, 0);
  // progress lines carry PR-controlled text (file names, thrown messages): escaped so they cannot become workflow commands
  const log = (line: string): void => deps.log(logLine(line));
  log(`undefined-certify: ${files.length} changed file(s) since ${mergeBase.slice(0, 7)}; ${n} exported function(s) touched under ${include.patterns.join(', ')}`);

  let certified: CertifyTouchedResult = { functions: [], notes: [], raw: [] };
  if (n > 0) {
    const budget = input(env, 'budget-ms', '');
    const defaultBudgetMs = budget === '' ? undefined : Number(budget);
    if (defaultBudgetMs !== undefined && !(Number.isInteger(defaultBudgetMs) && defaultBudgetMs > 0)) throw new Error(`input budget-ms: expected a positive integer, got ${JSON.stringify(budget)}`);
    certified = await certifyTouched({
      root,
      touched,
      host: await deps.createHost(),
      mutation: bool(env, 'mutation', true),
      ...(defaultBudgetMs !== undefined ? { defaultBudgetMs } : {}),
      certifiedBy: await deps.certifiedBy(),
      decidedAt,
      exists,
      log,
    });
  }
  const report: Report = {
    format: REPORT_FORMAT,
    version: REPORT_VERSION,
    repository: gh.repo || null,
    pr: pr?.number ?? null,
    headSha: pr?.head?.sha ?? null,
    checkedOut,
    base: mergeBase,
    functions: certified.functions,
    notes: certified.notes,
    failOn: failOnInput(input(env, 'fail-on', 'rejection')),
  };

  // the result file: the report (what `mode: comment` reads) plus the engine's detail (provenance per accepted function)
  const resultPath = resolve(workspace, input(env, 'result-path', join(env.RUNNER_TEMP ?? tmpdir(), 'undefined-certify.json')));
  mkdirSync(dirname(resultPath), { recursive: true });
  const detail = certified.raw.map((f) => ({
    file: f.file,
    specFile: f.specFile,
    functions: f.functions.map((r) => ({
      name: r.name,
      verdict: r.verdict,
      specHash: r.specHash,
      testsHash: r.testsHash,
      seed: r.seed,
      gates: r.gates.map((g) => ({ gate: g.gate, status: g.status, summary: g.summary, ms: g.ms })),
      mutation: r.mutation ?? null,
      provenance: r.provenance,
    })),
  }));
  writeFileSync(resultPath, `${JSON.stringify({ ...report, detail }, null, 2)}\n`);
  setOutput(env, 'result-path', resultPath);

  for (const f of report.functions) {
    const at = { file: f.file, line: f.line, title: `undefined-certify: ${f.name}` };
    if (f.verdict === 'rejected') emit(annotation(report.failOn.includes('rejected') ? 'error' : 'warning', f.headline ?? 'rejected', at));
    else if (f.verdict === 'gaps') emit(annotation('warning', `spec gap: ${f.gaps.map((g) => `${g.call}: the spec didn't say ${g.silentOn}`).join('; ')}`, at));
    else if (f.verdict === 'could-not-run') emit(annotation(report.failOn.includes('could-not-run') ? 'error' : 'warning', `could not run: ${f.reason ?? f.headline ?? ''}`, at));
    for (const s of f.survivors) emit(annotation('notice', `mutant survived (may be equivalent): ${s.original} → ${s.mutated}`, { file: f.file, line: s.line ?? f.line, title: `undefined-certify: ${f.name}` }));
  }
  for (const f of report.functions) log(`  ${f.name} ${f.file}:${f.line}: ${f.verdict}${f.evidenceLine ? `: ${f.evidenceLine}` : f.headline ? `: ${f.headline}` : f.reason ? `: ${f.reason}` : ''}`);

  const body = renderComment(report);
  appendSummary(env, body);
  if (dryRun) deps.out(body);
  else if (mode === 'certify-and-comment') await postComment(deps, gh, report, body, emit);

  const fails = failing(report);
  if (fails.length > 0) log(`undefined-certify: failing the check: ${fails.map((f) => `${f.name} (${f.verdict})`).join(', ')}`);
  return fails.length > 0 ? 1 : 0;
}

async function postComment(deps: Deps, gh: GitHub, report: Report, body: string, emit: (s: string) => void): Promise<void> {
  if (report.pr === null) return;
  if (!gh.token || !gh.repo) {
    emit(annotation('warning', 'no github-token or GITHUB_REPOSITORY: the comment was not posted (it is in the step summary)'));
    return;
  }
  try {
    const r = await upsertComment(gh, report.pr, body, { createIfMissing: report.functions.length > 0 });
    if (r.action === 'forbidden') emit(annotation('warning', `the comment could not be posted: ${r.message}. The results are in the step summary.`));
    else deps.log(`undefined-certify: comment ${r.action}${'id' in r ? ` (${r.id})` : ''}`);
  } catch (e) {
    // posting is reporting, not the verdict: an API failure never changes the check's result
    emit(annotation('warning', `the comment could not be posted: ${e instanceof Error ? e.message : String(e)}`));
  }
}

async function commentMode(env: Env, deps: Deps, gh: GitHub, event: PullRequestEvent, dryRun: boolean): Promise<number> {
  const file = input(env, 'report-file', '');
  if (!file) throw new Error('mode comment needs report-file: the result file a `mode: certify` run wrote (downloaded as an artifact)');
  const report = parseReport(await readFile(resolve(env.GITHUB_WORKSPACE ?? process.cwd(), file), 'utf8'));
  const body = renderComment(report);
  if (dryRun) {
    deps.out(body);
    return 0;
  }
  if (report.pr === null) throw new Error('the report names no pull request');
  if (report.repository !== null && gh.repo !== '' && report.repository !== gh.repo) throw new Error(`the report is for ${report.repository}, not ${gh.repo}`);
  // The report came from untrusted code: post it only on the PR whose current head is the commit that was certified.
  const runSha = event.workflow_run?.head_sha;
  if (!runSha) throw new Error('mode comment runs on a workflow_run event (it needs workflow_run.head_sha to check the report)');
  if (report.headSha !== runSha) throw new Error(`the report is for commit ${report.headSha ?? '(none)'}, the workflow run for ${runSha}`);
  const prHead = await pullHeadSha(gh, report.pr);
  if (prHead !== runSha) {
    deps.out(annotation('warning', `PR #${report.pr} has moved on to ${prHead.slice(0, 7)} (or is not the PR that was certified): the comment was not updated`));
    return 0;
  }
  appendSummary(env, body);
  await postComment(deps, gh, report, body, deps.out);
  return 0;
}
