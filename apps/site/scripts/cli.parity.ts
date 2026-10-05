/**
 * CLI parity (`npm run check:parity`, after `npm run build:cli`): every candidate body of every session of every shipped
 * recording, certified by the BUILT CLI as a subprocess (`node packages/cli/dist/cli.js certify <file> --json`, empty
 * environment, one at a time so no two watchdogs share the CPU), must reproduce what the site showed in the browser for
 * the same body (src/examples/parity.browser.json, measured by scripts/parity-measure.mjs on the production build):
 *   - the recording's specHash and testsHash (so the same seed);
 *   - the verdict, exit code, rejecting gate, every gate's status and the rejection headline;
 *   - for accepted bodies: the evidence line (describeEvidence, the site's tooltip and eject's provenance line), the
 *     site's "What was checked" sentence rebuilt from the CLI's --json evidence (ui/evidence.ts plainEvidence), the
 *     mutation buckets and WHICH mutants survived (survivorLine).
 * The allowances and the one verdict mapping are stated in src/examples/parityFixtures.ts and docs/EVIDENCE.md: only
 * killed + killed-by-bound is compared (timing), a time-boxed mutation run fails, and a rejection whose every failure the
 * spec was silent on is `gaps` / exit 2 in the CLI where the site shows "Rejected … spec was silent" with Decide.
 * Writes the comparison table to .tmp/parity-cli.json (repo root).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Evidence, MutationReport } from '@scasella/undefined-engine/types';
import { survivorLine } from '@scasella/undefined-engine/shared/evidence';
import { NO_TESTS_REASON } from '@scasella/undefined-engine/mutation/classify';
import { plainEvidence } from '../src/lib/evidence';
import { plainHeadline } from '../src/lib/explain';
import { expectedVerdict, gateId, IDS, loadBrowser, loadRecording, mergeTimeLimit, sourceFile, specFile } from '../src/examples/parityFixtures';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(ROOT, 'packages/cli/dist/cli.js');
const browser = loadBrowser();
const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

interface CliFunction {
  verdict: string;
  specHash: string;
  testsHash: string;
  rejectedBy?: string;
  headline?: string;
  gates: Array<{ gate: string; status: string }>;
  evidenceLine: string | null;
  evidence: Evidence | null;
  calls: string[];
  mutation: MutationReport | null;
  mutantLines: Array<{ line: number | null }> | null;
  gaps: unknown[];
}
interface Row {
  example: string;
  candidate: string;
  site: string;
  cli: string;
  exit: number | null;
  evidenceLineMatch: string;
  siteBuckets: string;
  cliBuckets: string;
  survivorsMatch: string;
  difference: string;
  ms: number;
}
const table: Row[] = [];

/** "Tests killed 9 of 12 mutants (2 more stopped by the time limit; 1 survived…)" → buckets */
function bucketsOf(line: string): string {
  if (/No tests yet/.test(line)) return 'not run (no tests)';
  const k = /Tests killed (\d+) of (\d+)/.exec(line);
  const b = /(\d+) more stopped by the time limit/.exec(line);
  const s = /(\d+) survived/.exec(line);
  return k ? `${k[1]}+${b?.[1] ?? 0} bound/${k[2]}, ${s?.[1] ?? 0} survived` : '?';
}
const cliBuckets = (m: MutationReport | null): string =>
  !m ? 'none' : m.skipped === NO_TESTS_REASON ? 'not run (no tests)' : `${m.killed}+${m.killedByBound} bound/${m.total}, ${m.survived} survived`;

let dir: string;
beforeAll(() => {
  if (!existsSync(CLI)) throw new Error(`${CLI} is missing: run npm run build:cli first`);
  dir = mkdtempSync(join(tmpdir(), 'undefined-cli-parity-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(ROOT, '.tmp'), { recursive: true });
  writeFileSync(join(ROOT, '.tmp/parity-cli.json'), `${JSON.stringify({ measuredAt: new Date().toISOString(), browser: { measuredAt: browser.measuredAt, head: browser.head, chrome: browser.chrome }, node: process.version, rows: table }, null, 2)}\n`);
  for (const r of table) process.stderr.write(`[parity:cli] ${r.example} ${r.candidate}: site ${r.site} | cli ${r.cli} (exit ${r.exit}) | evidence line ${r.evidenceLineMatch} | site ${r.siteBuckets} | cli ${r.cliBuckets} | ${r.difference} | ${r.ms} ms\n`);
});

describe('the built CLI reproduces the site on every recorded candidate', () => {
  for (const id of IDS) {
    it(`${id}: every session, every attempt`, () => {
      const rec = loadRecording(id);
      const measured = browser.examples[id]!;
      expect(browser.recordings[id], `${id}: parity.browser.json was measured on other recordings; re-run parity-measure.mjs --write`).toEqual(rec.sessions.map((s) => s.specHash));
      expect(measured.length, id).toBe(rec.sessions.length);
      for (const [si, session] of rec.sessions.entries()) {
        expect(measured[si]!.length, `${id} session ${si + 1}: attempts`).toBe(session.attempts.length);
        for (const [ai, attempt] of session.attempts.entries()) {
          const where = `${id} s${si + 1} a${ai + 1}`;
          const site = measured[si]![ai]!;
          const want = expectedVerdict(site);
          const base = join(dir, `${id}-${si}-${ai}`);
          mkdirSync(base, { recursive: true });
          writeFileSync(join(base, `${session.fn}.ts`), sourceFile(session.spec, attempt.body));
          writeFileSync(join(base, `${session.fn}.undefined.json`), specFile(session.spec, session.calls[0]!));
          const t0 = Date.now();
          const run = spawnSync(process.execPath, [CLI, 'certify', `${session.fn}.ts`, '--json'], { cwd: base, env: {}, encoding: 'utf8', timeout: 120_000 });
          const ms = Date.now() - t0;
          let doc: { exitCode: number; issues: unknown[]; functions: Record<string, CliFunction> };
          try {
            doc = JSON.parse(run.stdout) as typeof doc;
          } catch {
            throw new Error(`${where}: stdout is not one JSON document (exit ${run.status})\n${run.stdout.slice(0, 500)}\n${run.stderr.slice(0, 1500)}`);
          }
          const f = doc.functions[session.fn]!;
          const row: Row = {
            example: id,
            candidate: `session ${si + 1} attempt ${ai + 1}`,
            site: site.verdict === 'rejected' ? `rejected by ${want.gate}${want.verdict === 'gaps' ? ' (spec was silent)' : ''}` : 'accepted',
            cli: f ? `${f.verdict}${f.rejectedBy ? ` by ${f.rejectedBy}` : ''}` : 'missing',
            exit: run.status,
            evidenceLineMatch: '—',
            siteBuckets: '—',
            cliBuckets: '—',
            survivorsMatch: '—',
            difference: want.verdict === 'gaps' ? 'site Decide card = CLI gaps/exit 2 (mapping)' : 'none',
            ms,
          };
          table.push(row);
          expect(doc.issues, where).toEqual([]);
          expect([f.specHash, f.testsHash], `${where}: hashes`).toEqual([session.specHash, session.testsHash]);
          expect(run.status, `${where}: exit code`).toBe(want.exit);
          expect(doc.exitCode, where).toBe(want.exit);
          expect(f.verdict, `${where}: ${f.headline ?? ''}`).toBe(want.verdict);
          expect(f.rejectedBy ?? null, where).toBe(want.gate);
          expect(Object.fromEntries(f.gates.map((g) => [g.gate, g.status])), `${where}: gate statuses`).toEqual(Object.fromEntries(site.gates.map((g) => [gateId(g.gate), g.status])));
          if (site.verdict === 'rejected') {
            // the site renders the gate's headline through plainHeadline (drops "Rejected: " and the " (bounded)" tag)
            expect(norm(plainHeadline(f.headline ?? '')), `${where}: headline`).toBe(norm(site.rejection.headline));
            if (want.verdict === 'gaps') expect(f.gaps.length, `${where}: gap questions`).toBeGreaterThan(0);
            continue;
          }
          // accepted
          const m = f.mutation!;
          row.siteBuckets = bucketsOf(site.evidenceLine);
          row.cliBuckets = cliBuckets(m);
          if (m.skipped !== NO_TESTS_REASON) expect(m.skipped, `${where}: machine too slow for the 6 s box`).toBeUndefined();
          const lineSame = f.evidenceLine === site.evidenceLine;
          const lineMerged = mergeTimeLimit(f.evidenceLine ?? '') === mergeTimeLimit(site.evidenceLine);
          row.evidenceLineMatch = lineSame ? 'exact' : lineMerged ? 'equal after merging the time-limit split' : 'DIFFERS';
          if (!lineSame && lineMerged) row.difference = `killed/bound split ${row.siteBuckets.split(',')[0]} vs ${row.cliBuckets.split(',')[0]} (watchdog timing)`;
          expect(mergeTimeLimit(f.evidenceLine ?? ''), `${where}: evidence line`).toBe(mergeTimeLimit(site.evidenceLine));
          expect(mergeTimeLimit(plainEvidence(f.evidence!, f.calls)), `${where}: the site's sentence`).toBe(mergeTimeLimit(site.text));
          const surv = (m.survivors ?? []).map(survivorLine);
          row.survivorsMatch = JSON.stringify(surv) === JSON.stringify(site.survivors) ? 'same' : 'DIFFERS';
          expect(surv, `${where}: survivors`).toEqual(site.survivors);
        }
      }
    }, 600_000);
  }
});
