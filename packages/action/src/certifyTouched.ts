/**
 * Certify the touched functions, file by file, with the engine API in this process (certifyModule.ts certify() and
 * the Node gate host): the same ingestion, discovery and gates as the CLI, no CLI binary. Same-file callees are
 * certified too (they have to be, to be linked) but only touched functions are reported. Nothing is generated.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { certify, extractFunctions, type FunctionResult, type GateHost, type Json, type SpecInput } from '@scasella/undefined-engine';
import { discoverSpec, refersTo } from '@scasella/undefined-engine/node/certifyFile';
import { reportGap, type SpecKind } from './gaps';
import { lineMapper } from './mutantLines';
import type { ReportFunction } from './model';
import type { Touched } from './touched';

export interface CertifyTouchedInput {
  root: string;
  touched: Touched;
  host: GateHost;
  mutation: boolean;
  defaultBudgetMs?: number;
  certifiedBy: Record<string, Json>;
  /** decidedAt for the decision snippets (the commit's time, so a re-run renders the same comment). */
  decidedAt: number;
  exists(abs: string): boolean;
  log(line: string): void;
}

export interface CertifyTouchedResult {
  functions: ReportFunction[];
  notes: string[];
  /** The engine's results, for the result file (`--json`-style detail). */
  raw: Array<{ file: string; specFile: string | null; functions: FunctionResult[] }>;
}

const rel = (root: string, abs: string): string => (abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : abs);

export async function certifyTouched(i: CertifyTouchedInput): Promise<CertifyTouchedResult> {
  const functions: ReportFunction[] = [];
  const notes: string[] = [];
  const raw: CertifyTouchedResult['raw'] = [];
  for (const [file, names] of [...i.touched].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const abs = join(i.root, file);
    const source = await readFile(abs, 'utf8');
    const specAbs = discoverSpec(abs, i.exists);
    const specRel = specAbs ? rel(i.root, specAbs) : null;
    let spec: SpecInput | undefined;
    if (specAbs && specRel) {
      const text = await readFile(specAbs, 'utf8');
      spec = specAbs.endsWith('.json') || /^\s*\{/.test(text)
        ? { kind: 'undefined-spec', text, file: specRel }
        : { kind: 'vitest', text, file: specRel, isSourceModule: (s) => refersTo(specAbs, s, abs) };
    }
    i.log(`${file}: certifying ${[...names.keys()].join(', ')}${specRel ? ` against ${specRel}` : ' (no spec or test file found)'}`);
    const result = await certify({
      source,
      sourceFile: file,
      ...(spec ? { spec } : {}),
      host: i.host,
      functions: [...names.keys()],
      mutation: i.mutation,
      ...(i.defaultBudgetMs !== undefined ? { defaultBudgetMs: i.defaultBudgetMs } : {}),
      certifiedBy: i.certifiedBy,
    });
    raw.push({ file, specFile: specRel, functions: result.functions });
    const extracted = await extractFunctions(source, file);
    const specKind: SpecKind = spec?.kind === 'vitest' ? 'vitest' : 'undefined-spec';
    const fileIssues = result.issues.filter((x) => !x.fn);
    for (const x of fileIssues) notes.push(`${x.file}${x.line ? `:${x.line}` : ''}: ${x.message}`);

    for (const [name, why] of names) {
      const r = result.functions.find((f) => f.name === name);
      if (!r) {
        // refused before it could run (unsupported signature, module-scope dependency, a file that does not parse)
        const issue = result.issues.find((x) => x.fn === name) ?? fileIssues[0];
        functions.push({
          name,
          file,
          line: issue?.line ?? extracted.functions.find((f) => f.name === name)?.line ?? 1,
          verdict: 'could-not-run',
          unchecked: false,
          why,
          specFile: specRel,
          reason: issue ? issue.message : 'it was not certified',
          survivors: [],
          gaps: [],
        });
        continue;
      }
      const ex = extracted.functions.find((f) => f.name === name);
      const map = await lineMapper({ spec: r.spec, body: r.body, compile: r.compile, bodyLine: r.bodyLine, declLine: r.line, expressionBody: ex?.expressionBody ?? false });
      const own = result.issues.filter((x) => x.fn === name).map((x) => x.message);
      const f: ReportFunction = {
        name,
        file,
        line: r.line,
        verdict: r.verdict,
        unchecked: r.unchecked,
        why,
        specFile: specRel,
        survivors: (r.mutation?.survivors ?? []).map((s) => ({ line: map(s.line), compiledLine: s.line, original: s.original, mutated: s.mutated })),
        gaps: specRel ? r.gapQuestions.map((q) => reportGap(q, { kind: specKind, specFile: specRel, decidedAt: i.decidedAt })) : [],
      };
      if (r.rejectedBy) f.rejectedBy = r.rejectedBy;
      if (r.headline) f.headline = r.headline;
      const reason = r.reason ?? (own.length > 0 ? own.join('; ') : undefined);
      if (reason) f.reason = reason;
      if (r.evidenceLine) f.evidenceLine = r.evidenceLine;
      functions.push(f);
    }
  }
  // by file, then by position in the file (not by the order the diff happened to touch them)
  functions.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  return { functions, notes, raw };
}
