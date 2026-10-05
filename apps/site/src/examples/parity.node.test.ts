/**
 * Node parity, in-process: every candidate body of every session of the shipped recordings, certified by the engine's
 * Node path (certifyFile: a real TypeScript file and an `undefined-spec` file on disk, the Node gate host with its real
 * watchdog in a worker_thread, the mutation check), must reproduce what the site showed in the browser for the same body.
 *
 * Reference: parity.browser.json, measured by `node apps/site/scripts/parity-measure.mjs --write` on the production
 * build in headless Chrome (the recordings carry only the model's bodies, not gate results). The same comparison runs
 * through the BUILT CLI as a subprocess in apps/site/scripts/cli.parity.ts (`npm run check:parity`).
 *
 * Compared: specHash/testsHash (so the seed), verdict, exit code, rejecting gate, each gate's status, the rejection
 * headline as the site renders it; for accepted bodies the evidence line, the site's "What was checked" sentence, the
 * mutation buckets and which mutants survived.
 * Stated allowances (parityFixtures.ts, docs/EVIDENCE.md "Node and CLI parity"): only killed + killed-by-bound is
 * compared (watchdog timing); a mutation run cut short by the 6 s box FAILS; a rejection the spec was silent on is
 * `gaps`/exit 2 here where the site shows it with a Decide card. The Node host's heap cap (256 MB) and 1 MB stack are
 * Node-only / approximate (docs/SECURITY.md); none of these bodies comes near either.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { survivorLine } from '@scasella/undefined-engine/shared/evidence';
import { NO_TESTS_REASON } from '@scasella/undefined-engine/mutation/classify';
import { certifyFile, createNodeGateHost, type NodeGateHost } from '@scasella/undefined-engine/node';
import { plainEvidence } from '../lib/evidence';
import { plainHeadline } from '../lib/explain';
import { expectedVerdict, gateId, IDS, loadBrowser, loadRecording, mergeTimeLimit, sourceFile, specFile } from './parityFixtures';

const browser = loadBrowser();
const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

let host: NodeGateHost;
let dir: string;
beforeAll(async () => {
  host = await createNodeGateHost();
  dir = await mkdtemp(join(tmpdir(), 'undefined-parity-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('mergeTimeLimit removes only the killed / killed-by-bound split', () => {
  it('evidence line and site sentence, with and without survivors', () => {
    expect(mergeTimeLimit('Tests killed 9 of 12 mutants (2 more stopped by the time limit; 1 survived, which may be equivalent).')).toBe('Tests killed 11 of 12 mutants (1 survived, which may be equivalent).');
    expect(mergeTimeLimit('Tests killed 10 of 12 mutants (2 more stopped by the time limit).')).toBe('Tests killed 12 of 12 mutants.');
    expect(mergeTimeLimit('caught 11 of 12 copies (2 of them by the time limit; 1 slipped through).')).toBe('caught 11 of 12 copies (1 slipped through).');
    expect(mergeTimeLimit('caught 12 of 12 copies (2 of them by the time limit).')).toBe('caught 12 of 12 copies.');
    expect(mergeTimeLimit('Tests killed 12 of 12 mutants.')).toBe('Tests killed 12 of 12 mutants.');
  });
});

describe('Node certify reproduces the browser on every recorded candidate', () => {
  for (const id of IDS) {
    it(`${id}: every session, every attempt`, async () => {
      const rec = loadRecording(id);
      const measured = browser.examples[id]!;
      expect(browser.recordings[id], `${id}: parity.browser.json was measured on other recordings`).toEqual(rec.sessions.map((s) => s.specHash));
      for (const [si, session] of rec.sessions.entries()) {
        expect(measured[si]!.length, `${id} session ${si + 1}: attempts`).toBe(session.attempts.length);
        for (const [ai, attempt] of session.attempts.entries()) {
          const where = `${id} session ${si + 1} attempt ${ai + 1}`;
          const site = measured[si]![ai]!;
          const want = expectedVerdict(site);
          const base = join(dir, `${id}-${si}-${ai}`);
          await writeFile(`${base}.ts`, sourceFile(session.spec, attempt.body));
          await writeFile(`${base}.undefined.json`, specFile(session.spec, session.calls[0]!));
          const r = await certifyFile({ file: `${base}.ts`, host });
          expect(r.issues, where).toEqual([]);
          expect(r.specFile, where).toBe(`${base}.undefined.json`);
          const f = r.functions[0]!;
          expect([f.specHash, f.testsHash], where).toEqual([session.specHash, session.testsHash]);
          expect(f.verdict, `${where}: ${f.headline ?? ''}`).toBe(want.verdict);
          expect(r.exitCode, where).toBe(want.exit);
          expect(f.rejectedBy ?? null, where).toBe(want.gate);
          expect(Object.fromEntries(f.gates.map((g) => [g.gate, g.status])), `${where}: gate statuses`).toEqual(Object.fromEntries(site.gates.map((g) => [gateId(g.gate), g.status])));
          if (site.verdict === 'rejected') {
            expect(norm(plainHeadline(f.headline ?? '')), where).toBe(norm(site.rejection.headline));
            if (want.verdict === 'gaps') expect(f.gapQuestions.length, where).toBeGreaterThan(0);
            continue;
          }
          const m = f.mutation!;
          expect(m, where).toBeDefined();
          if (m.skipped !== NO_TESTS_REASON) expect(m.skipped, `${where}: machine too slow for the 6 s box`).toBeUndefined();
          expect(mergeTimeLimit(f.evidenceLine ?? ''), `${where}: evidence line`).toBe(mergeTimeLimit(site.evidenceLine));
          expect(mergeTimeLimit(plainEvidence(f.evidence!, f.calls)), `${where}: the site's sentence`).toBe(mergeTimeLimit(site.text));
          expect(m.survivors.map(survivorLine), `${where}: survivors`).toEqual(site.survivors);
          process.stderr.write(`\n[parity] ${where}: ${f.evidenceLine}`);
        }
      }
    }, 180_000);
  }
});
