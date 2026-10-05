/**
 * Step 1 of `npm run check:eject` (scripts/eject-check.mjs runs this under vitest so the app's TypeScript modules load
 * as they do in the tests). For every session of every shipped recording (public/recordings/*.json): the recorded
 * spec, the last recorded candidate (the one the app commits on replay), the REAL compile gate and gate executor
 * (no watchdog in Node), an Artifact built from the recording's provenance, then src/eject's files and zip, written
 * to .tmp/eject-check/out/<label>/ with a manifest.json for step 2.
 *
 * The orders sessions have no checks at all, so each is also ejected once more with one pinned result (the
 * function's own output on the bundled rows, as "Pin as test" would record it) to exercise pins over a dataset.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileCandidate, transpileUserCode } from '../src/gates/compile';
import { executeGates } from '../src/sandbox/gateExecutor';
import { evidenceFrom } from '../src/sandbox/gateRunner';
import { gateSeed, hashesFor } from '../src/shared/hash';
import { decodeValue, encodeValue } from '../src/shared/serialize';
import { listTestNames } from '../src/shared/specInfo';
import { ejectFiles, ejectZip } from '../src/eject/eject';
import { unzipStore } from '../src/eject/zip';
import type { Artifact, Candidate, FunctionRecord, FunctionSpec, Pin, Recording, RecordedSession } from '../src/types';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, '.tmp', 'eject-check', 'out');
const IDS = ['median', 'slugify', 'fibonacci', 'orders'];
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const versions = {
  vitest: pkg.devDependencies.vitest as string,
  fastCheck: pkg.dependencies['fast-check'] as string,
  typescript: pkg.dependencies.typescript as string,
};

interface ManifestRow {
  label: string;
  fn: string;
  unitTests: number;
  pinned: number;
  properties: number;
  gates: string;
}
const manifest: ManifestRow[] = [];

function userJs(src: string): string {
  const out = transpileUserCode(src);
  if (out.error) throw new Error(`spec source does not transpile: ${out.error}`);
  return out.js;
}

async function build(label: string, rec: Recording, session: RecordedSession, withPin: boolean): Promise<void> {
  const spec: FunctionSpec = { ...session.spec! };
  const hashes = await hashesFor(spec);
  expect(hashes, `${label}: the recording's hashes match its spec`).toEqual({ specHash: session.specHash, testsHash: session.testsHash });
  const last = session.attempts[session.attempts.length - 1]!;
  const compiled = await compileCandidate(spec, last.body);
  expect(compiled.gate.status, `${label}: the committed body compiles`).toBe('pass');

  const datasets = session.datasets ?? {};
  if (withPin) {
    const ref = session.datasetRefs?.[0];
    if (!ref || datasets[ref.hash] === undefined) throw new Error(`${label}: no dataset to pin over`);
    const fn = new Function(`${compiled.js}\nreturn ${spec.name};`)() as (...a: unknown[]) => unknown;
    const pin: Pin = {
      id: 'pin-1',
      label: `${spec.name}(${ref.name})`,
      args: [{ kind: 'dataset', name: ref.name, hash: ref.hash }],
      expected: encodeValue(fn(decodeValue(datasets[ref.hash]!))),
      pinnedAt: Date.parse(rec.recordedAt),
    };
    spec.pins = [pin];
  }
  const pinned = (spec.pins ?? []).map((p) => ({
    label: p.label,
    args: p.args.map((a) => (a.kind === 'dataset' ? decodeValue(datasets[a.hash]!) : decodeValue(a.encoded))),
    expected: decodeValue(p.expected),
  }));
  const gates = executeGates(
    {
      name: spec.name,
      js: compiled.js!,
      testsJs: userJs(spec.tests),
      propertiesJs: userJs(spec.properties),
      budgetMs: spec.budgetMs,
      seed: gateSeed(hashes.specHash, hashes.testsHash),
      pinned,
    },
    { phase: () => {}, enter: () => {}, leave: () => {} },
  );
  const failed = gates.find((g) => g.status === 'fail');
  expect(failed?.headline, `${label}: the committed body passes the gates in Node`).toBeUndefined();
  const all = [compiled.gate, ...gates];

  const candidates: Candidate[] = session.attempts.map((a, i) => {
    const accepted = i === session.attempts.length - 1;
    return {
      id: `${label}-${i + 1}`,
      attempt: i + 1,
      body: a.body,
      notes: a.notes,
      source: 'replay',
      generationMs: a.durationMs,
      gates: accepted ? all : [],
      verdict: accepted ? 'accepted' : 'rejected',
      prompt: a.prompt,
    };
  });
  const artifact: Artifact = {
    body: last.body,
    source: compiled.source,
    js: compiled.js!,
    returnType: compiled.returnType,
    specHash: hashes.specHash,
    testsHash: hashes.testsHash,
    model: session.model ?? rec.model,
    codexVersion: session.codexVersion ?? rec.codexVersion,
    committedAt: Date.parse(rec.recordedAt),
    candidates,
    revision: 2,
    evidence: { compiled: true, ...evidenceFrom(gates) },
  };
  const record: FunctionRecord = { spec, ...hashes, artifact };
  const input = { functions: [record], datasets, datasetRefs: session.datasetRefs, now: Date.parse(rec.recordedAt), versions };
  const { files } = ejectFiles(input);
  const zip = ejectZip(input);
  const back = unzipStore(zip.bytes);
  expect(back.map((e) => e.name)).toEqual(files.map((f) => `${spec.name}-eject/${f.path}`));
  expect(back.map((e) => new TextDecoder().decode(e.data))).toEqual(files.map((f) => f.text));

  const dir = join(OUT, label);
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f.path), f.text);
  writeFileSync(join(OUT, `${label}.zip`), zip.bytes);
  manifest.push({
    label,
    fn: spec.name,
    unitTests: listTestNames(spec.tests).length,
    pinned: spec.pins?.length ?? 0,
    properties: listTestNames(spec.properties).length,
    gates: gates.map((g) => `${g.gate}:${g.status}`).join(' '),
  });
}

describe('eject the shipped recordings', () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const id of IDS) {
    const rec = JSON.parse(readFileSync(join(ROOT, 'public', 'recordings', `${id}.json`), 'utf8')) as Recording;
    rec.sessions.forEach((session, i) => {
      const label = i === 0 ? id : `${id}-broken`;
      it(label, () => build(label, rec, session, false));
      if (id === 'orders') it(`${label}+pin`, () => build(`${label}+pin`, rec, session, true));
    });
  }
  it('writes the manifest', () => {
    writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ versions, rows: manifest }, null, 2));
  });
});
