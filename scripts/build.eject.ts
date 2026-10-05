/**
 * Step 1 of `npm run check:eject` (scripts/eject-check.mjs runs this under vitest so the app's TypeScript modules load
 * as they do in the tests). For every session of every shipped recording (public/recordings/*.json): the recorded
 * spec, the last recorded candidate (the one the app commits on replay), the REAL compile gate and gate executor
 * (no watchdog in Node), an Artifact built from the recording's provenance, then src/eject's files and zip, written
 * to .tmp/eject-check/out/<label>/ with a manifest.json for step 2.
 *
 * The orders sessions have no checks at all, so each is also ejected once more with one pinned result (the
 * function's own output on the bundled rows, as "Pin as test" would record it) to exercise pins over a dataset.
 *
 * median is also ejected once more with a WAIVING decision (docs/DECIDE-DESIGN.md §6.4): the user ruled that
 * median([]) throws, which replaces the reference property on the empty list, and the committed body is the example's
 * throws-on-empty body. The ejected test file must apply the same waiver as the app (and pass).
 *
 * Composition (docs/COMPOSE-DESIGN.md §A7): a TEST-ONLY fixture (not a shipped example; no spec in src/examples
 * changes) certifies slugify (its example spec and first good body) and then `slugifyAll`, whose body calls slugify,
 * through the real compile gate (slugify declared as another function) and the real gate executor (slugify linked),
 * then ejects slugifyAll WITH slugify. Both test files must pass in the fresh project, each against the real code.
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
import { ejectClosure, ejectFiles, ejectZip } from '../src/eject/eject';
import { othersFor, stampDeps } from '../src/compose/graph';
import { buildDecision, effectiveChecks } from '../src/decide/decisions';
import { EXAMPLES } from '../src/examples';
import { unzipStore } from '../src/eject/zip';
import type { Artifact, Candidate, Decision, FunctionRecord, FunctionSpec, Pin, Program, Recording, RecordedSession } from '../src/types';

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
  /** Tests vitest reports as skipped (unit tests a decision replaced). */
  skipped: number;
  gates: string;
}
const manifest: ManifestRow[] = [];

function userJs(src: string): string {
  const out = transpileUserCode(src);
  if (out.error) throw new Error(`spec source does not transpile: ${out.error}`);
  return out.js;
}

type Decided = { body: string; decision: (at: number) => Decision };

async function build(label: string, rec: Recording, session: RecordedSession, withPin: boolean, decided?: Decided): Promise<void> {
  let spec: FunctionSpec = { ...session.spec! };
  const recorded = await hashesFor(spec);
  expect(recorded, `${label}: the recording's hashes match its spec`).toEqual({ specHash: session.specHash, testsHash: session.testsHash });
  if (decided) {
    const d = decided.decision(Date.parse(rec.recordedAt));
    expect(d.waives).toBe(true);
    spec = { ...spec, decisions: [d] };
  }
  const hashes = await hashesFor(spec);
  const last = session.attempts[session.attempts.length - 1]!;
  const body = decided ? decided.body : last.body;
  const compiled = await compileCandidate(spec, body);
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
  const eff = effectiveChecks(spec);
  const gates = executeGates(
    {
      name: spec.name,
      js: compiled.js!,
      testsJs: userJs(eff.tests),
      propertiesJs: userJs(eff.properties),
      budgetMs: spec.budgetMs,
      seed: gateSeed(hashes.specHash, hashes.testsHash),
      pinned,
      ...(eff.waived.length > 0 ? { waived: eff.waived } : {}),
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
    body,
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
    evidence: { compiled: true, ...evidenceFrom(gates), ...(spec.decisions ? { decisions: spec.decisions.length } : {}) },
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
  // unit tests a decision replaced are skipped (not run); the waived property here has a `when`, so it still runs
  const skipped = eff.waived.filter((w) => w.kind === 'test').length;
  manifest.push({
    label,
    fn: spec.name,
    unitTests: listTestNames(eff.tests).length - skipped,
    pinned: spec.pins?.length ?? 0,
    properties: listTestNames(eff.properties).length,
    skipped,
    gates: gates.map((g) => `${g.gate}:${g.status}`).join(' '),
  });
}

/** One waiving decision per example that has a "spec was silent" gap, with the example's body that satisfies it. */
const DECIDED: Record<string, Decided> = {
  // the user ruled median([]) throws: the reference property is waived on the empty list (it has a `when`)
  median: {
    body: EXAMPLES.find((e) => e.id === 'median')!.badBodies.find((b) => b.silentOn)!.body,
    decision: (at) =>
      buildDecision({
        fn: 'median',
        kind: 'empty',
        args: [[]],
        ruling: { kind: 'outcome', outcome: { throws: true } },
        answers: { check: 'agrees with a sort-based reference', checkKind: 'property', silentOn: 'what the median of nothing is', gate: 'properties' },
        expected: { returns: encodeValue(NaN) },
        decidedAt: at,
        reason: 'an empty list is a caller bug here',
      }),
  },
  // the user ruled an apostrophe splits a word: the unit test "apostrophes" is replaced (skipped in the eject)
  slugify: {
    body: EXAMPLES.find((e) => e.id === 'slugify')!.badBodies.find((b) => b.silentOn === 'whether an apostrophe splits a word')!.body,
    decision: (at) =>
      buildDecision({
        fn: 'slugify',
        kind: 'symbols',
        args: ["Don't Stop"],
        ruling: { kind: 'outcome', outcome: { returns: 'don-t-stop' } },
        answers: { check: 'apostrophes', checkKind: 'test', silentOn: 'whether an apostrophe splits a word', gate: 'tests' },
        expected: { returns: 'dont-stop' },
        decidedAt: at,
      }),
  },
};

/** The composed fixture's caller (test-only). */
const SLUGIFY_ALL: FunctionSpec = {
  name: 'slugifyAll',
  params: [{ name: 'titles', type: 'string[]' }],
  returns: 'string[]',
  doc: 'Slugs for a list of titles, in order.',
  tests: String.raw`test('each title', () => {
  eq(slugifyAll(['Hello World', 'Crème Brûlée']), ['hello-world', 'creme-brulee']);
});

test('empty list', () => {
  eq(slugifyAll([]), []);
});`,
  properties: String.raw`property('one slug per title', [fc.array(fc.string({ maxLength: 12 }), { maxLength: 8 })], (titles) => slugifyAll(titles).length === titles.length);`,
  budgetMs: 1000,
  maxAttempts: 3,
  origin: 'user',
};

/** Certify `body` for `spec` in `program` as the engine would (callable functions declared and linked); returns its record. */
async function certify(program: Program, spec: FunctionSpec, body: string, revision: number, at: number): Promise<FunctionRecord> {
  const hashes = await hashesFor(spec);
  const callable = othersFor(program, spec);
  const compiled = callable.others.length > 0 ? await compileCandidate(spec, body, { others: callable.others }) : await compileCandidate(spec, body);
  expect(compiled.gate.status, `${spec.name}: compiles`).toBe('pass');
  const eff = effectiveChecks(spec);
  const deps = compiled.deps.map((n) => ({ name: n, js: program.functions[n]!.artifact!.js, deps: [] as string[] }));
  const gates = executeGates(
    {
      name: spec.name,
      js: compiled.js!,
      testsJs: userJs(eff.tests),
      propertiesJs: userJs(eff.properties),
      budgetMs: spec.budgetMs,
      seed: gateSeed(hashes.specHash, hashes.testsHash),
      ...(deps.length > 0 ? { deps } : {}),
    },
    { phase: () => {}, enter: () => {}, leave: () => {} },
  );
  expect(gates.find((g) => g.status === 'fail')?.headline, `${spec.name}: passes the gates`).toBeUndefined();
  const artifact: Artifact = {
    body,
    source: compiled.source,
    js: compiled.js!,
    returnType: compiled.returnType,
    ...hashes,
    model: 'fixture (hand-written body)',
    codexVersion: '',
    committedAt: at,
    candidates: [{ id: `${spec.name}-1`, attempt: 1, body, notes: 'fixture', source: 'replay', generationMs: 0, gates: [compiled.gate, ...gates], verdict: 'accepted' }],
    revision,
    evidence: { compiled: true, ...evidenceFrom(gates) },
  };
  const stamps = stampDeps(program, compiled.deps);
  if (stamps) artifact.deps = stamps;
  return { spec, ...hashes, artifact };
}

async function buildComposed(): Promise<void> {
  const label = 'compose-slugifyAll';
  const at = Date.UTC(2026, 9, 5, 12);
  const slug = EXAMPLES.find((e) => e.id === 'slugify')!;
  const program: Program = { functions: {} };
  program.functions.slugify = await certify(program, slug.spec!, slug.goodBodies[0]!, 2, at);
  program.functions.slugifyAll = await certify(program, SLUGIFY_ALL, 'return titles.map(slugify);', 3, at);
  expect(Object.keys(program.functions.slugifyAll!.artifact!.deps ?? {}), 'slugifyAll records its call of slugify').toEqual(['slugify']);
  const input = { functions: ejectClosure(program, 'slugifyAll'), now: at, versions };
  const { files } = ejectFiles(input);
  expect(files.map((f) => f.path)).toEqual(['slugifyAll.ts', 'slugifyAll.test.ts', 'slugify.ts', 'slugify.test.ts', 'provenance.json', 'README.md']);
  const zip = ejectZip(input);
  expect(unzipStore(zip.bytes).map((e) => e.name)).toEqual(files.map((f) => `slugifyAll-eject/${f.path}`));
  const dir = join(OUT, label);
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f.path), f.text);
  writeFileSync(join(OUT, `${label}.zip`), zip.bytes);
  const specs = [slug.spec!, SLUGIFY_ALL];
  manifest.push({
    label,
    fn: 'slugifyAll (+ slugify)',
    unitTests: specs.reduce((n, sp) => n + listTestNames(effectiveChecks(sp).tests).length, 0),
    pinned: 0,
    properties: specs.reduce((n, sp) => n + listTestNames(effectiveChecks(sp).properties).length, 0),
    skipped: 0,
    gates: 'composed',
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
      if (i === 0 && DECIDED[id]) it(`${label}+decided`, () => build(`${label}+decided`, rec, session, false, DECIDED[id]));
    });
  }
  it('compose-slugifyAll (a function and the one it calls)', () => buildComposed());
  it('writes the manifest', () => {
    writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ versions, rows: manifest }, null, 2));
  });
});
