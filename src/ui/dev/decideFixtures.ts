/**
 * Fixture states for the Decide flow (DEV ONLY), on the REAL median and slugify example specs, with decisions built
 * by the real decide module (so the generated tests, hashes-to-be and wording cannot drift from the engine's).
 *   decide-median            committed after "rejected by Properties, spec was silent": the Decide card can open
 *   decide-median-recertified  ruled NaN (agrees with the tests): re-certified in place, 1 decision in Repo/evidence
 *   decide-median-needs-live   ruled "throws" in replay mode: the committed function fails it; re-grow needs live
 *   decide-slugify           slugify committed after the apostrophes test said the spec was silent
 * UI review states (scripts/shots.mjs; SCENARIO_UI in fixtures.ts opens the block and picks a choice):
 *   decide-open        the Decide block open on #1's rejection, NaN (what your tests expect) picked
 *   decide-custom      replay mode, "type your own" with -1: the preview, and the replay needs-live warning
 *   decide-needs-live  after ruling "throws" in replay mode: the needs-live message and the ways forward
 *   decision-applied   after ruling NaN: re-certified; the Repo tab lists the decision
 */
import type { Decision, EngineState, FunctionSpec, GateResult, GenerateError } from '../../types';
import { EXAMPLES as REAL_EXAMPLES } from '../../examples';
import { encodeValue } from '../../shared/serialize';
import { buildDecision, decisionSummary } from '../../decide/decisions';
import { decidedReason } from '../../shared/evidence';
import { RUN_LIVE_FIX } from '../../core/generator';
import { baseState, doneAttempts, eid, gate, medianGeneration, openingTranscript, revRow, T0 } from './fixtures';

const h = (seed: string): string => seed.repeat(64).slice(0, 64);
const ex = (id: string) => REAL_EXAMPLES.find((e) => e.id === id)!;

const MEDIAN_REAL = ex('median');
const SLUGIFY_REAL = ex('slugify');
export const MEDIAN_EX_SPEC: FunctionSpec = MEDIAN_REAL.spec!;
export const SLUGIFY_EX_SPEC: FunctionSpec = SLUGIFY_REAL.spec!;
const MEDIAN_THROWS = MEDIAN_REAL.badBodies.find((b) => b.silentOn)!.body;
const MEDIAN_OK = MEDIAN_REAL.goodBodies[0]!;
const SLUG_SPLITS = SLUGIFY_REAL.badBodies.find((b) => b.silentOn === 'whether an apostrophe splits a word')!.body;
const SLUG_OK = SLUGIFY_REAL.goodBodies[0]!;

const notReached = (g: GateResult['gate']): GateResult => gate(g, 'skipped', 'not reached', { note: 'not reached' });
const MEDIAN_PROPS = ['agrees with a sort-based reference', 'the order of the input does not matter', 'result lies between the smallest and largest value'];

/** What the gate executor reports for the throws-on-empty body: rejected by Properties, the spec was silent. */
export function medianSilentGates(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 196 }),
    gate('tests', 'pass', '4/4 tests passed', { ms: 6, counts: { passed: 4, total: 4 } }),
    gate('properties', 'fail', `1/3 properties failed (300 runs: ${MEDIAN_PROPS.map((p) => `${JSON.stringify(p)} 100`).join(', ')})`, {
      ms: 48,
      counts: { passed: 2, total: 3 },
      headline: 'Rejected: median([]) threw Error: empty list, expected NaN',
      diagnostics: [
        {
          kind: 'property',
          name: MEDIAN_PROPS[0]!,
          counterexample: '[[]]',
          call: 'median([])',
          error: 'Error: empty list',
          expected: 'NaN',
          shrinks: 0,
          runs: 6,
          seed: 1938244123,
          silentOn: 'what the median of nothing is',
          reasonable: 'Throwing on an empty list is a common, defensible choice; so is returning NaN.',
          args: [[]],
          expectedOutcome: { returns: encodeValue(NaN) },
          actualOutcome: { throws: true },
        },
      ],
    }),
    notReached('invariants'),
  ];
}

function medianAccepted(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 181 }),
    gate('tests', 'pass', '4/4 tests passed', { ms: 6, counts: { passed: 4, total: 4 } }),
    gate('properties', 'pass', `3/3 properties held (300 runs: ${MEDIAN_PROPS.map((p) => `${JSON.stringify(p)} 100`).join(', ')})`, { ms: 61, counts: { passed: 3, total: 3 } }),
    gate('invariants', 'pass', 'pure ✓ bounded ✓ (25 sampled calls replayed on frozen arguments)', { ms: 14 }),
  ];
}

/** median committed at r2 after candidate #1 was rejected by Properties where the spec was silent. */
function decideMedian(): EngineState {
  const s = baseState();
  const attempts = doneAttempts(MEDIAN_EX_SPEC, [
    [MEDIAN_THROWS, medianSilentGates(), 'Sorted copy; throws on an empty list.'],
    [MEDIAN_OK, medianAccepted(), 'Sorted copy; NaN for an empty list.'],
  ]);
  s.program.functions.median = {
    spec: MEDIAN_EX_SPEC,
    specHash: h('9d'),
    testsHash: h('88'),
    artifact: {
      body: MEDIAN_OK,
      source: `function median(numbers: number[]): number {\n${MEDIAN_OK}\n}`,
      js: `function median(numbers) {\n${MEDIAN_OK}\n}`,
      returnType: 'number',
      specHash: h('9d'),
      testsHash: h('88'),
      model: 'gpt-6-luna',
      codexVersion: '0.157.2',
      committedAt: T0 + 120_000,
      candidates: attempts.map((a) => a.candidate!),
      revision: 2,
      evidence: { compiled: true, unitTests: 4, pinnedTests: 0, properties: MEDIAN_PROPS.map((name) => ({ name, runs: 100 })), sampledCalls: 25 },
    },
  };
  s.revisions = [
    revRow({ id: 1, kind: 'init', title: 'Initial image: median spec, no artifact' }, 1, 0),
    revRow({ id: 2, kind: 'commit', fn: 'median', title: 'median certified — attempt 2 of 3 (rejected by properties first)' }, 1, 1),
  ];
  s.headRevision = 2;
  s.hints.opener = false;
  s.replInput = '';
  s.repl = [...openingTranscript(), { kind: 'output', id: eid('out'), value: '2.5', ms: 0.4, label: 'generated', detail: 'revision 2' }];
  s.generation = medianGeneration(attempts, { phase: 'committed', attempt: 2, revision: 2 });
  return s;
}

/** The decision the engine builds for a ruling on median([]) (the real builder). */
export function medianDecision(ruling: 'nan' | 'throws', reason?: string): Decision {
  return buildDecision({
    fn: 'median',
    kind: 'empty',
    args: [[]],
    ruling: { kind: 'outcome', outcome: ruling === 'nan' ? { returns: encodeValue(NaN) } : { throws: true } },
    answers: { check: MEDIAN_PROPS[0]!, checkKind: 'property', silentOn: 'what the median of nothing is', gate: 'properties' },
    expected: { returns: encodeValue(NaN) },
    decidedAt: T0 + 300_000,
    ...(reason ? { reason } : {}),
  });
}

function decideMedianRecertified(): EngineState {
  const s = decideMedian();
  const d = medianDecision('nan', 'NaN propagates through our averages');
  const rec = s.program.functions.median!;
  const reason = decidedReason(decisionSummary(d));
  rec.spec = { ...rec.spec, decisions: [d] };
  rec.testsHash = h('d1');
  const a = rec.artifact!;
  a.testsHash = rec.testsHash;
  a.recertified = [{ at: T0 + 300_000, revision: 3, reason }];
  a.evidence = { ...a.evidence!, unitTests: 5, decisions: 1 };
  s.revisions.push(revRow({ id: 3, kind: 'decision', fn: 'median', title: `${reason} — re-certified (r2's artifact passes)`, detail: 'tests hash 8888… → d1d1… · the artifact committed at r2 passed the changed checks; no regeneration' }, 1, 1));
  s.headRevision = 3;
  s.repl.push({ kind: 'info', id: eid('if'), text: `median: ${reason}. The committed function already satisfies it: re-certified at r3, nothing regenerated.`, tone: 'accent' });
  s.mutation = { fn: 'median', phase: 'waiting', done: 0, total: 0 };
  return s;
}

function decideMedianNeedsLive(): EngineState {
  const s = decideMedian();
  s.mode = 'replay';
  s.service = { state: 'down' };
  const d = medianDecision('throws');
  const rec = s.program.functions.median!;
  const reason = decidedReason(decisionSummary(d));
  rec.spec = { ...rec.spec, decisions: [d] };
  rec.testsHash = h('e7'); // stale: the artifact was certified against the tests before the decision
  s.revisions.push(revRow({ id: 3, kind: 'decision', fn: 'median', title: `${reason} — the committed function fails it; re-growing`, detail: 'tests hash 8888… → e7e7…' }, 1, 0));
  s.headRevision = 3;
  const error: GenerateError = {
    code: 'no_recording',
    message: `Your decision (${decisionSummary(d)}) differs from what the recorded session was checked against, so there is no recorded answer to replay. Run live to grow median against it.`,
    fix: [...RUN_LIVE_FIX],
  };
  s.generation = {
    ...medianGeneration([], { phase: 'failed', attempt: 1, progress: [], mode: 'replay', error }),
    id: 'g-decision',
    call: `${d.call} (your decision)`,
    decision: { id: d.id, call: d.call },
  };
  s.repl.push(
    { kind: 'info', id: eid('if'), text: `median: the committed function fails your decision (${decisionSummary(d)}); re-growing it against the decision.`, tone: 'warn' },
    { kind: 'info', id: eid('if'), text: 'Re-growing median against your decision…', tone: 'accent' },
    { kind: 'error', id: eid('er'), name: 'GenerationFailed', message: error.message, restarts: [{ id: 'retry', label: 'Retry', description: 'Run the grow loop again with a fresh budget.' }, { id: 'dismiss', label: 'Dismiss', description: 'Leave the program as it is.' }] },
  );
  return s;
}

function slugSilentGates(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 203 }),
    gate('tests', 'fail', '10/11 tests passed', {
      ms: 7,
      counts: { passed: 10, total: 11 },
      headline: 'Rejected: slugify("Don\'t Stop") returned "don-t-stop", expected "dont-stop"',
      diagnostics: [
        {
          kind: 'test',
          name: 'apostrophes',
          message: 'expected "dont-stop", got "don-t-stop"',
          call: 'slugify("Don\'t Stop")',
          expected: '"dont-stop"',
          actual: '"don-t-stop"',
          silentOn: 'whether an apostrophe splits a word',
          reasonable: 'Both don-t-stop and dont-stop are common slug conventions.',
          args: ["Don't Stop"],
          expectedOutcome: { returns: 'dont-stop' },
          actualOutcome: { returns: 'don-t-stop' },
        },
      ],
    }),
    notReached('properties'),
    notReached('invariants'),
  ];
}

function decideSlugify(): EngineState {
  const s = baseState();
  const accepted: GateResult[] = [
    gate('compile', 'pass', 'compiled, strict', { ms: 188 }),
    gate('tests', 'pass', '11/11 tests passed', { ms: 8, counts: { passed: 11, total: 11 } }),
    gate('properties', 'pass', '2/2 properties held (200 runs: "output is lowercase letters and digits joined by single hyphens" 100, "slugifying a slug changes nothing" 100)', { ms: 40, counts: { passed: 2, total: 2 } }),
    gate('invariants', 'pass', 'pure ✓ bounded ✓ (25 sampled calls replayed on frozen arguments)', { ms: 12 }),
  ];
  const attempts = doneAttempts(SLUGIFY_EX_SPEC, [
    [SLUG_SPLITS, slugSilentGates(), 'Transliterates, then joins runs with hyphens.'],
    [SLUG_OK, accepted, 'Drops apostrophes before joining.'],
  ]);
  s.program.functions = {
    slugify: {
      spec: SLUGIFY_EX_SPEC,
      specHash: h('2d'),
      testsHash: h('cf'),
      artifact: {
        body: SLUG_OK,
        source: `function slugify(title: string): string {\n${SLUG_OK}\n}`,
        js: `function slugify(title) {\n${SLUG_OK}\n}`,
        returnType: 'string',
        specHash: h('2d'),
        testsHash: h('cf'),
        model: 'gpt-6-luna',
        codexVersion: '0.157.2',
        committedAt: T0 + 120_000,
        candidates: attempts.map((a) => a.candidate!),
        revision: 2,
      },
    },
  };
  s.revisions = [
    revRow({ id: 1, kind: 'example', fn: 'slugify', title: 'Loaded example: slugify' }, 1, 0),
    revRow({ id: 2, kind: 'commit', fn: 'slugify', title: 'slugify certified — attempt 2 of 3 (rejected by tests first)' }, 1, 1),
  ];
  s.headRevision = 2;
  s.hints.opener = false;
  s.replInput = '';
  const call = 'slugify("Hello, World! Crème Brûlée")';
  s.repl = [...openingTranscript(call, 'slugify'), { kind: 'output', id: eid('out'), value: '"hello-world-creme-brulee"', ms: 0.3, label: 'generated', detail: 'revision 2' }];
  s.generation = {
    ...medianGeneration(attempts, { phase: 'committed', attempt: 2, revision: 2 }),
    id: 'g-slug',
    fn: 'slugify',
    signature: 'function slugify(title: string): string',
    call,
  };
  return s;
}

/** The opening finished in replay mode (as on the static site): the Decide block opens on the rejection of #1. */
function decideMedianReplay(): EngineState {
  const s = decideMedian();
  s.mode = 'replay';
  s.service = { state: 'down' };
  if (s.generation) s.generation = { ...s.generation, mode: 'replay' };
  return s;
}

export const DECIDE_SCENARIOS: Record<string, () => EngineState> = {
  // UI review states (scripts/shots.mjs); SCENARIO_UI opens the block and preselects a choice
  'decide-open': decideMedian,
  'decide-custom': decideMedianReplay,
  'decide-needs-live': decideMedianNeedsLive,
  'decision-applied': decideMedianRecertified,
  'decide-median': decideMedian,
  'decide-median-recertified': decideMedianRecertified,
  'decide-median-needs-live': decideMedianNeedsLive,
  'decide-slugify': decideSlugify,
};
