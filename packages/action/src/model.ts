/**
 * The Action's report: what was certified, as plain data. The comment is rendered from this and only this, so the
 * fork-safe split (docs/WORKSPACE-DESIGN.md §5.7) can certify in one workflow (`mode: certify`, untrusted, read-only
 * token) and comment from another (`mode: comment`, trusted, never runs PR code) by passing this JSON between them.
 * In `mode: comment` the JSON came from a run of untrusted code, so `parseReport` validates every field and caps every
 * string before anything is rendered.
 */

export const REPORT_FORMAT = 'undefined-action-report';
export const REPORT_VERSION = 1;

export type Verdict = 'accepted' | 'rejected' | 'gaps' | 'could-not-run';

export interface ReportSurvivor {
  /** File line, or null when it could not be mapped exactly (then only the compiled line is shown). */
  line: number | null;
  compiledLine: number;
  original: string;
  mutated: string;
}

export interface ReportChoice {
  /** `Keep the check's answer (NaN)` */
  label: string;
  /** Agrees with the failing check (the code must change), as opposed to waiving it. */
  agrees: boolean;
  /** Paste-ready text. */
  snippet: string;
  lang: 'ts' | 'json';
  /** What else the reviewer has to do (e.g. change the check marked @silentOn). */
  note?: string;
}

export interface ReportGap {
  /** `median([])` */
  call: string;
  silentOn: string;
  reasonable?: string;
  /** The failing check's name. */
  check: string;
  expected: string;
  actual: string;
  /** Where the snippets go: `src/stats.test.ts` or `functions.median.decisions in src/stats.undefined.json`. */
  target: string;
  choices: ReportChoice[];
  /** Set when only the check's own answer can be decided (a property marked silent on every input). */
  onlyAgreeing?: string;
}

export interface ReportFunction {
  name: string;
  /** Repository-relative. */
  file: string;
  line: number;
  verdict: Verdict;
  /** Accepted with nothing to check against (no spec or test file): only Compile ran. */
  unchecked: boolean;
  /** Why it was certified: `changed`, `uses type Row, which changed`, `its test file changed`. */
  why: string;
  specFile: string | null;
  rejectedBy?: string;
  headline?: string;
  reason?: string;
  evidenceLine?: string;
  survivors: ReportSurvivor[];
  gaps: ReportGap[];
}

export interface Report {
  format: typeof REPORT_FORMAT;
  version: typeof REPORT_VERSION;
  /** `owner/repo` */
  repository: string | null;
  pr: number | null;
  /** The commit the PR's head pointed at (what the reviewer sees), and what was actually on disk. */
  headSha: string | null;
  checkedOut: string | null;
  base: string | null;
  functions: ReportFunction[];
  /** Problems not tied to one function (a spec file that does not parse, …). */
  notes: string[];
  /** The check fails on these verdicts. Never on 'gaps'. */
  failOn: Array<'rejected' | 'could-not-run'>;
}

/** Whether the check fails: a rejection (and, only when opted in, a function that could not run). Never a gap. */
export function failing(r: Pick<Report, 'functions' | 'failOn'>): ReportFunction[] {
  return r.functions.filter((f) => (f.verdict === 'rejected' && r.failOn.includes('rejected')) || (f.verdict === 'could-not-run' && r.failOn.includes('could-not-run')));
}

// ───────────────────────── validation of an untrusted report ─────────────────────────

export class ReportError extends Error {}

const MAX_TEXT = 4_000;
const MAX_SNIPPET = 8_000;
const MAX_FUNCTIONS = 500;
const MAX_ITEMS = 100;

function fail(path: string, what: string): never {
  throw new ReportError(`report ${path}: ${what}`);
}
function obj(v: unknown, path: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'expected an object');
  return v as Record<string, unknown>;
}
function str(v: unknown, path: string, max = MAX_TEXT): string {
  if (typeof v !== 'string') fail(path, 'expected a string');
  if (v.length > max) fail(path, `longer than ${max} characters`);
  return v;
}
function optStr(v: unknown, path: string, max = MAX_TEXT): string | undefined {
  return v === undefined ? undefined : str(v, path, max);
}
function nullableStr(v: unknown, path: string, max = MAX_TEXT): string | null {
  return v === null ? null : str(v, path, max);
}
function int(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(path, 'expected a non-negative integer');
  return v;
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'expected true or false');
  return v;
}
function arr(v: unknown, path: string, max = MAX_ITEMS): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  if (v.length > max) fail(path, `more than ${max} items`);
  return v;
}
function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail(path, `expected one of ${allowed.join(', ')}`);
  return v as T;
}
const SHA = /^[0-9a-f]{7,64}$/;
function sha(v: unknown, path: string): string | null {
  if (v === null) return null;
  const s = str(v, path, 64);
  if (!SHA.test(s)) fail(path, 'expected a commit hash');
  return s;
}

const VERDICTS: readonly Verdict[] = ['accepted', 'rejected', 'gaps', 'could-not-run'];

/** Parse and validate a report JSON from an untrusted run. Unknown keys are dropped, every string is capped. */
export function parseReport(text: string): Report {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ReportError(`report: not JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  const o = obj(raw, '');
  if (o.format !== REPORT_FORMAT || o.version !== REPORT_VERSION) fail('format', `expected ${REPORT_FORMAT} v${REPORT_VERSION}`);
  const repository = o.repository === null ? null : str(o.repository, 'repository', 200);
  if (repository !== null && !/^[\w.-]+\/[\w.-]+$/.test(repository)) fail('repository', 'expected owner/repo');
  const pr = o.pr === null ? null : int(o.pr, 'pr');
  const functions = arr(o.functions, 'functions', MAX_FUNCTIONS).map((f, i): ReportFunction => {
    const p = `functions[${i}]`;
    const x = obj(f, p);
    const fn: ReportFunction = {
      name: str(x.name, `${p}.name`, 200),
      file: str(x.file, `${p}.file`, 500),
      line: int(x.line, `${p}.line`),
      verdict: oneOf(x.verdict, `${p}.verdict`, VERDICTS),
      unchecked: bool(x.unchecked, `${p}.unchecked`),
      why: str(x.why, `${p}.why`, 500),
      specFile: nullableStr(x.specFile, `${p}.specFile`, 500),
      survivors: arr(x.survivors, `${p}.survivors`).map((s, j) => {
        const q = `${p}.survivors[${j}]`;
        const y = obj(s, q);
        return {
          line: y.line === null ? null : int(y.line, `${q}.line`),
          compiledLine: int(y.compiledLine, `${q}.compiledLine`),
          original: str(y.original, `${q}.original`, 500),
          mutated: str(y.mutated, `${q}.mutated`, 500),
        };
      }),
      gaps: arr(x.gaps, `${p}.gaps`).map((g, j) => {
        const q = `${p}.gaps[${j}]`;
        const y = obj(g, q);
        const gap: ReportGap = {
          call: str(y.call, `${q}.call`),
          silentOn: str(y.silentOn, `${q}.silentOn`),
          check: str(y.check, `${q}.check`),
          expected: str(y.expected, `${q}.expected`),
          actual: str(y.actual, `${q}.actual`),
          target: str(y.target, `${q}.target`, 600),
          choices: arr(y.choices, `${q}.choices`, 20).map((c, k) => {
            const r = `${q}.choices[${k}]`;
            const z = obj(c, r);
            const choice: ReportChoice = {
              label: str(z.label, `${r}.label`),
              agrees: bool(z.agrees, `${r}.agrees`),
              snippet: str(z.snippet, `${r}.snippet`, MAX_SNIPPET),
              lang: oneOf(z.lang, `${r}.lang`, ['ts', 'json'] as const),
            };
            const note = optStr(z.note, `${r}.note`);
            if (note !== undefined) choice.note = note;
            return choice;
          }),
        };
        const reasonable = optStr(y.reasonable, `${q}.reasonable`);
        if (reasonable !== undefined) gap.reasonable = reasonable;
        const only = optStr(y.onlyAgreeing, `${q}.onlyAgreeing`);
        if (only !== undefined) gap.onlyAgreeing = only;
        return gap;
      }),
    };
    for (const k of ['rejectedBy', 'headline', 'reason', 'evidenceLine'] as const) {
      const v = optStr(x[k], `${p}.${k}`);
      if (v !== undefined) fn[k] = v;
    }
    return fn;
  });
  return {
    format: REPORT_FORMAT,
    version: REPORT_VERSION,
    repository,
    pr,
    headSha: sha(o.headSha, 'headSha'),
    checkedOut: sha(o.checkedOut, 'checkedOut'),
    base: sha(o.base, 'base'),
    functions,
    notes: arr(o.notes, 'notes').map((n, i) => str(n, `notes[${i}]`)),
    failOn: arr(o.failOn, 'failOn', 2).map((v, i) => oneOf(v, `failOn[${i}]`, ['rejected', 'could-not-run'] as const)),
  };
}
