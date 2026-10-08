import { describe, expect, it } from 'vitest';
import type {
  Artifact,
  AttemptView,
  Candidate,
  Diagnostic,
  EngineState,
  FunctionRecord,
  FunctionSpec,
  GateResult,
  GenerationView,
  Program,
  ReplEntry,
} from '@scasella/undefined-engine/types';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import { bundledOrders } from '../../data/orders';
import type { OutputEntry } from '../model/answer';
import { dataFacts } from '../model/assumptions';
import { OFF_NOTES } from '../model/lanes';
import { seedAgreement, SEEDED_PIN_ID } from '../model/agreements';
import { DEFAULT_QUESTION_ID, sampleOpeningQuestion } from '../model/questions';
import { SEEDED_LOCK_NOTE } from '../model/agreement';
import type { DatasetRef } from '@scasella/undefined-engine/types';
import {
  agreementFor,
  answerView,
  certifiedGeneration,
  countedFor,
  giveUpOnStress,
  heldCaptionFor,
  lockInfo,
  matchRun,
  NO_RECORDING_OWN,
  noRecordingText,
  noRecordingView,
  outcomeOf,
  runFlag,
  sampleOffer,
  sealOf,
  silentDiagnostic,
  stressGaveUp,
  switchToSample,
  telemetryOf,
  traceSummary,
  traceView,
  versionLine,
  type RunMatch,
  type RunRef,
} from './derive';

// ───── fixtures in the exact shapes the engine produces (see sandbox/gateExecutor.ts) ─────

const FN = 'topCustomersByRevenue';
const CALL = `${FN}(orders)`;

const gate = (g: GateResult['gate'], status: GateResult['status'], summary: string, extra: Partial<GateResult> = {}): GateResult => ({
  gate: g,
  status,
  ms: 100,
  summary,
  diagnostics: [],
  ...extra,
});
/** A spec-less call: only Compile and Invariants have something to run. */
const basicGates = (): GateResult[] => [
  gate('compile', 'pass', 'compiled', { ms: 120 }),
  gate('tests', 'skipped', 'no tests yet', { ms: 0 }),
  gate('properties', 'skipped', 'no properties yet', { ms: 0 }),
  gate('invariants', 'pass', 'pure ✓ bounded ✓ (1 sampled call replayed on frozen arguments)', { ms: 290 }),
];
const fullGates = (): GateResult[] => [
  gate('compile', 'pass', 'compiled', { ms: 120 }),
  gate('tests', 'pass', '6 unit tests + 1 pinned passed', { ms: 90 }),
  gate('properties', 'pass', '2/2 properties held (200 runs: "Revenue counts paid orders only" 100, "Each order number is counted once" 100)', { ms: 150 }),
  gate('invariants', 'pass', 'pure ✓ bounded ✓ (1 sampled call replayed on frozen arguments)', { ms: 50 }),
];
const pinFail: Diagnostic = { kind: 'test', name: `pinned: ${CALL}`, message: 'not equal', call: CALL, expected: '[…]', actual: '[…]' };
const rejectedByPin = (): GateResult[] => [
  gate('compile', 'pass', 'compiled', { ms: 120 }),
  gate('tests', 'fail', '6/7 tests passed (6 unit + 1 pinned)', { ms: 80, diagnostics: [pinFail], headline: `Rejected: ${CALL} returned […], expected […]` }),
  gate('properties', 'skipped', 'not reached', { ms: 0 }),
  gate('invariants', 'skipped', 'not reached', { ms: 0 }),
];

const cand = (attempt: number, gates: GateResult[], verdict: Candidate['verdict'], notes = ''): Candidate => ({
  id: `c${attempt}`,
  attempt,
  body: 'return [];',
  notes,
  source: 'replay',
  generationMs: 10,
  gates,
  verdict,
});
const att = (attempt: number, status: AttemptView['status'], gates: GateResult[], notes = ''): AttemptView => ({
  attempt,
  status,
  shown: 'return [];',
  gates,
  ...(status === 'accepted' || status === 'rejected' ? { candidate: cand(attempt, gates, status === 'accepted' ? 'accepted' : 'rejected', notes) } : {}),
});
const gen = (attempts: AttemptView[], phase: GenerationView['phase'], extra: Partial<GenerationView> = {}): GenerationView => ({
  id: 'g2',
  fn: FN,
  signature: `function ${FN}(arg0: OrdersRow[])`,
  call: CALL,
  phase,
  attempt: attempts.length,
  maxAttempts: 3,
  progress: [],
  attempts,
  ungated: false,
  mode: 'replay',
  ...extra,
});

const TOP5 = [
  { customer: 'Puddlesworth Inc', revenue: 2599.13 },
  { customer: 'Kettlewhistle Farms', revenue: 2359.63 },
  { customer: 'Brambleskate Ltd', revenue: 2355.91 },
  { customer: 'Chef Ravioli Starbright', revenue: 2260.06 },
  { customer: 'Grommet & Gasket LLC', revenue: 2175.72 },
];
const pinnable = { fn: FN, call: CALL, args: [{ kind: 'dataset' as const, name: 'orders', hash: 'h-orders' }], expected: encodeValue(TOP5) };
const output = (extra: Partial<OutputEntry> = {}): OutputEntry => ({
  kind: 'output',
  id: 'out1',
  value: '[…]',
  ms: 3,
  label: 'generated',
  note: 'Assumes revenue is quantity × unit price after discount. Ties are sorted alphabetically.',
  pinnable,
  ...extra,
});

const specless = (pins: FunctionSpec['pins'] = []): FunctionSpec => ({
  name: FN,
  params: [{ name: 'arg0', type: 'OrdersRow[]' }],
  returns: null,
  doc: '',
  tests: '',
  properties: '',
  budgetMs: 1000,
  maxAttempts: 3,
  origin: 'call',
  ...(pins.length ? { pins } : {}),
});
const artifact = (gates: GateResult[], ev: Partial<NonNullable<Artifact['evidence']>> = {}, candidates?: Candidate[]): Artifact => ({
  body: 'return [];',
  source: '',
  js: '',
  returnType: 'Array<{ customer: string; revenue: number }>',
  specHash: 's1',
  testsHash: 't1',
  model: 'gpt',
  codexVersion: '1',
  committedAt: 1,
  candidates: candidates ?? [cand(1, gates, 'accepted', 'Assumes revenue is quantity × unit price after discount.')],
  revision: 4,
  evidence: { compiled: true, unitTests: 0, pinnedTests: 0, properties: [], sampledCalls: 1, mutation: { total: 0, killed: 0, killedByBound: 0, survived: 0, stillborn: 0, survivors: [], ms: 0, at: 1, skipped: 'no tests yet: nothing could kill a mutant' }, ...ev },
});
const record = (spec: FunctionSpec, art: Artifact | null): FunctionRecord => ({ spec, specHash: 's1', testsHash: 't1', artifact: art });
const program = (rec?: FunctionRecord): Program => ({ functions: rec ? { [FN]: rec } : {} });

const state = (p: Partial<EngineState> = {}): EngineState =>
  ({
    ready: true,
    mode: 'replay',
    service: { state: 'down' },
    program: program(),
    headRevision: 4,
    revisions: [{ id: 4, at: new Date(2026, 9, 5, 12).getTime(), kind: 'commit', title: 'x', fns: 1, artifacts: 1 }],
    repl: [],
    replInput: '',
    generation: null,
    env: {},
    hints: { opener: false, takeaway: false },
    start: 'examples',
    datasets: [],
    send: { samples: true, sampleRows: 3 },
    busy: false,
    examples: [],
    pacing: { typeCharMs: 0, gateDwellMs: 0, replayMaxMs: 0 },
    ...p,
  }) as EngineState;

const runRef = (p: Partial<RunRef> = {}): RunRef => ({ id: 1, origin: 'ask', questionId: 'top', fn: FN, call: CALL, genBefore: 'g1', replBefore: 2, pending: false, ...p });
const input: ReplEntry = { kind: 'input', id: 'in1', text: CALL };
const before: ReplEntry[] = [{ kind: 'input', id: 'in0', text: 'old()' }, { kind: 'output', id: 'out0', value: '1', ms: 1, label: null }];

// ───────────────────────── tests ─────────────────────────

describe('matchRun', () => {
  it('takes only the generation with a new id for this function, and entries after the run started', () => {
    const g = gen([att(1, 'accepted', basicGates())], 'committed');
    const s = state({ generation: g, repl: [...before, input, output()] });
    const m = matchRun(s, runRef());
    expect(m.generation).toBe(g);
    expect(m.output?.id).toBe('out1');
    // the generation that was there before the run is not this run's
    expect(matchRun(s, runRef({ genBefore: 'g2' })).generation).toBeNull();
    // another function's generation is not this run's
    expect(matchRun(state({ generation: { ...g, fn: 'other' } }), runRef()).generation).toBeNull();
    // a reset emptied the REPL: nothing of the run is left
    expect(matchRun(state({ repl: [] }), runRef()).output).toBeNull();
  });
  it('stops at the next input once this run has its answer', () => {
    const later: ReplEntry[] = [{ kind: 'input', id: 'in2', text: 'x' }, { kind: 'output', id: 'out9', value: '2', ms: 1, label: null }];
    const m = matchRun(state({ repl: [...before, input, output(), ...later] }), runRef());
    expect(m.output?.id).toBe('out1');
  });
});

describe('outcomeOf', () => {
  const o = (s: EngineState, r: RunRef = runRef(), canDecide?: (r: unknown) => boolean) => outcomeOf(s, r, matchRun(s, r), canDecide);

  it('idle without a run; running while pending or busy or a draft is being written/checked', () => {
    expect(outcomeOf(state(), null, { generation: null, output: null, error: null }).kind).toBe('idle');
    expect(o(state(), runRef({ pending: true })).kind).toBe('running');
    expect(o(state({ busy: true })).kind).toBe('running');
    expect(o(state({ generation: gen([att(1, 'generating', [])], 'generating') })).kind).toBe('running');
    expect(o(state({ generation: gen([att(1, 'gating', [])], 'gating') })).kind).toBe('running');
  });

  it('committed (written now) vs cached (certified earlier: no new generation)', () => {
    const g = gen([att(1, 'accepted', basicGates())], 'committed', { revision: 4 });
    expect(o(state({ generation: g, repl: [...before, input, output()] })).kind).toBe('committed');
    expect(o(state({ generation: { ...g, id: 'g1' }, repl: [...before, input, output({ label: 'cached artifact' })] })).kind).toBe('cached');
  });

  it('it says no: the decline reason and the model sentence', () => {
    const g = gen([att(1, 'aborted', [])], 'failed', { declined: { reason: 'cannot-be-pure', message: 'It needs today’s date.' } });
    expect(o(state({ generation: g }))).toEqual({ kind: 'declined', reason: 'cannot-be-pure', message: 'It needs today’s date.' });
  });

  it('replay with no recording (needsLive on own data, or the no_recording code)', () => {
    const own = gen([], 'failed', { error: { code: 'no_recording', message: 'none' }, needsLive: { reason: 'data', datasets: ['orders'] } });
    expect(o(state({ generation: own }))).toMatchObject({ kind: 'no-recording', onData: true });
    const spec = gen([], 'failed', { error: { code: 'no_recording', message: 'Run live' } });
    expect(o(state({ generation: spec }))).toMatchObject({ kind: 'no-recording', onData: false, message: 'Run live' });
  });

  it('every draft thrown out; replay ran out of recorded drafts; live service problems carry their fix', () => {
    const three = gen([att(1, 'rejected', rejectedByPin()), att(2, 'rejected', rejectedByPin()), att(3, 'rejected', rejectedByPin())], 'failed');
    expect(o(state({ generation: three }))).toEqual({ kind: 'thrown-out', recordedOut: false });
    const out = gen([att(1, 'rejected', rejectedByPin()), att(2, 'aborted', [])], 'failed', { error: { code: 'recording_exhausted', message: 'x' } });
    expect(o(state({ generation: out }))).toEqual({ kind: 'thrown-out', recordedOut: true });
    const svc = gen([att(1, 'aborted', [])], 'failed', { mode: 'live', error: { code: 'not_logged_in', message: 'Log in', fix: ['codex login'] } });
    expect(o(state({ generation: svc }))).toEqual({ kind: 'service', error: { code: 'not_logged_in', message: 'Log in', fix: ['codex login'] } });
  });

  it('stopped: the last draft failed a check that says the rules are silent (the same Diagnostic object)', () => {
    const silent: Diagnostic = { ...pinFail, name: 'empty file', silentOn: 'an empty file', args: [encodeValue([])], expectedOutcome: { returns: encodeValue([]) } };
    const gates = [rejectedByPin()[0]!, gate('tests', 'fail', '5/6 tests passed', { diagnostics: [silent] }), rejectedByPin()[2]!, rejectedByPin()[3]!];
    const g = gen([att(1, 'rejected', gates)], 'failed');
    const out = o(state({ generation: g }));
    expect(out.kind).toBe('stopped');
    if (out.kind === 'stopped') {
      expect(out.diagnostic).toBe(silent); // identity: engine.decide's refStillCurrent compares by reference
      expect(out.ref).toEqual({ fn: FN, diagnostic: silent });
    }
    expect(silentDiagnostic(g)).toBe(silent);
    // a silent check the engine cannot rule on is just thrown out
    expect(o(state({ generation: g }), runRef(), () => false)).toEqual({ kind: 'thrown-out', recordedOut: false });
    expect(runFlag({ kind: 'stopped', ref: { fn: FN, diagnostic: silent }, diagnostic: silent })).toBe('held');
  });

  it('a runtime error of the call (no generation)', () => {
    const err: ReplEntry = { kind: 'error', id: 'er1', name: 'TypeError', message: 'x is undefined' };
    expect(o(state({ repl: [...before, input, err] }))).toEqual({ kind: 'error', name: 'TypeError', message: 'x is undefined' });
  });
});

describe('traceView', () => {
  const base = { label: 'Top 5 customers by revenue', question: 'Who are our top customers by revenue?', file: 'orders.csv', rows: 332, fn: FN, pendingSeed: null };

  it('spec-less, committed: two basic checks passed, the other four off, honest footer', () => {
    const g = gen([att(1, 'accepted', basicGates())], 'committed', { ungated: true, revision: 4 });
    const s = state({ program: program(record(specless(), artifact(basicGates()))), generation: g, repl: [...before, input, output()] });
    const r = runRef();
    const m: RunMatch = matchRun(s, r);
    const t = traceView({ ...base, state: s, run: r, match: m, outcome: outcomeOf(s, r, m) });
    expect(t.lanes.map((l) => [l.num, l.state])).toEqual([
      ['01', 'passed'],
      ['02', 'off'],
      ['03', 'off'],
      ['04', 'off'],
      ['05', 'passed'],
      ['06', 'off'],
    ]);
    expect(t.header.left).toBe('CHECK TRACE · DRAFT 1 · Top 5 customers by revenue · orders.csv · 332 rows');
    expect(t.header.verdict).toBe("Passed 2 basic checks ↓ see what wasn't checked");
    expect(t.header.right).toBe('0.41 s');
    expect(t.footer.text).toBe('Checked against: runs without errors · never changes your data · finishes fast. Nothing else yet.');
    expect(t.liveText).toBe('Passed 2 basic checks. Showing the answer.');
    expect(t.cached).toBe(false);
    expect(telemetryOf(g, t.facts)).toEqual({ checks: 2, ms: 410 });
  });

  it('a lock set after the answer was checked: lane 03 says so, cached or idle, and agrees with the rail', () => {
    const pin = { id: 'pin1', label: CALL, args: pinnable.args, expected: pinnable.expected, pinnedAt: 2 };
    const rec = record(specless([pin]), artifact(basicGates()));
    const s = state({ program: program(rec), generation: gen([att(1, 'accepted', basicGates())], 'committed', { id: 'g1' }), repl: [...before, input, output({ label: 'cached artifact', pinned: true })] });
    const r = runRef({ genBefore: 'g1' });
    const m = matchRun(s, r);
    const t = traceView({ ...base, state: s, run: r, match: m, outcome: outcomeOf(s, r, m) });
    expect(t.cached).toBe(true);
    expect(t.lanes[2]).toMatchObject({ state: 'off', idle: 'Not checked', offNote: OFF_NOTES.locksLate });
    expect(t.lanes[2]!.label).toContain('Matches your locked answer');
    expect(agreementFor(s.program, FN, null, false).counts).toBe('0 examples · 1 locked answer · 0 house rules');
    // another selection and back (no run): the lanes show what the next ask runs, which is not the lock
    const idle = traceView({ ...base, state: s, run: null, match: matchRun(s, null), outcome: { kind: 'idle' } });
    expect(idle.lanes[0]!.state).toBe('ready');
    expect(idle.lanes[2]).toMatchObject({ state: 'off', offNote: OFF_NOTES.locksLate });
    // the same lock on a function with nothing on file: every pin will run
    const fresh = state({ program: program(record(specless([pin]), null)) });
    expect(traceView({ ...base, state: fresh, run: null, match: matchRun(fresh, null), outcome: { kind: 'idle' } }).lanes[2]!.state).toBe('ready');
  });

  it('cached: the certified draft’s real gates, flagged cached, no ghosts, no checks counted as run now', () => {
    const rec = record(specless(), artifact(basicGates()));
    const s = state({ program: program(rec), generation: gen([att(1, 'accepted', basicGates())], 'committed', { id: 'g1' }), repl: [...before, input, output({ label: 'cached artifact' })] });
    const r = runRef({ genBefore: 'g1' });
    const m = matchRun(s, r);
    const t = traceView({ ...base, state: s, run: r, match: m, outcome: outcomeOf(s, r, m) });
    expect(t.cached).toBe(true);
    expect(t.ghost).toEqual([]);
    expect(t.lanes[0]!.state).toBe('passed');
    expect(t.lanes[4]!.state).toBe('passed');
    expect(t.header.verdict).toBe("Passed 2 basic checks ↓ see what wasn't checked");
    expect(t.footer.meta).toBe('checked when it was written · 0.41 s · nothing re-run');
    expect(t.liveText).toBe('Answered by a version that already passed these checks. Showing the answer.');
    expect(certifiedGeneration(rec, CALL, 'replay')!.generation.phase).toBe('committed');
  });

  it('a draft thrown out by the locked answer, then one that passed: DRAFT 1 ghost, six live lanes', () => {
    const spec: FunctionSpec = { ...specless(), tests: 'test("a", () => {})', properties: 'property("b", [], () => {})', pins: [{ id: 'p', label: CALL, args: pinnable.args, expected: pinnable.expected, pinnedAt: 1 }] };
    const g = gen([att(1, 'rejected', rejectedByPin()), att(2, 'accepted', fullGates())], 'committed', { revision: 6 });
    const s = state({ program: program(record(spec, null)), generation: g, repl: [...before, input] });
    const r = runRef();
    const m = matchRun(s, r);
    const t = traceView({ ...base, state: s, run: r, match: m, outcome: outcomeOf(s, r, m) });
    expect(t.ghost.map((x) => x.title)).toEqual(['DRAFT 1']);
    expect(t.ghost[0]!.note[0]!.text).toBe("First draft thrown out: it didn't match an answer you locked. ");
    expect(t.lanes.slice(0, 5).every((l) => l.state === 'passed')).toBe(true);
    expect(t.header.left).toContain('DRAFT 2');
    // draft 1 ran 01, 02 (passed) and 03 (thrown out); draft 2 ran 01–05
    expect(telemetryOf(g, t.facts).checks).toBe(3 + 5);
  });

  it('idle with the seed about to be installed: six lanes ready, the locked answer named', async () => {
    const ref = await ordersRef();
    const seed = seedAgreement('orders', 'top', ref)!;
    const s = state();
    const t = traceView({ ...base, state: s, run: null, match: matchRun(s, null), outcome: { kind: 'idle' }, pendingSeed: seed.spec });
    expect(t.run).toBe('idle');
    expect(t.lanes.map((l) => l.state)).toEqual(['ready', 'ready', 'ready', 'ready', 'ready', 'ready']);
    expect(t.lanes.map((l) => l.label)).toEqual([
      'Runs without errors',
      'Matches your 6 examples',
      'Matches your locked answer · Chef Ravioli Starbright = $2,252.07',
      'Follows your 2 house rules on made-up tables',
      'Never changes your data · finishes fast',
      'Stress test: deliberate breaks',
    ]);
    expect(t.header.right).toBe('waiting for your question');
    expect(t.footer.text).toMatch(/^When you ask, /);
  });

  it('no recording: nothing checked, no draft', () => {
    const g = gen([], 'failed', { error: { code: 'no_recording', message: 'x' }, needsLive: { reason: 'data', datasets: ['orders'] } });
    const s = state({ generation: g, repl: [...before, input] });
    const r = runRef();
    const m = matchRun(s, r);
    const t = traceView({ ...base, state: s, run: r, match: m, outcome: outcomeOf(s, r, m) });
    expect(t.header.verdict).toBe('Not run · no draft to check');
    expect(t.lanes.filter((l) => l.state === 'passed')).toEqual([]);
    expect(t.footer).toEqual({ text: 'Nothing was checked: there was no draft to check, so no answer is shown.', meta: '' });
    expect(t.liveText).toBe('Not run: there was no draft to check. No answer is shown.');
  });
});

async function ordersRef(): Promise<DatasetRef> {
  const { buildDataset } = await import('../../data/dataset');
  const built = await buildDataset('orders', bundledOrders(), { source: 'bundled', filename: 'orders.csv', typeName: 'OrdersRow' });
  if ('error' in built) throw new Error(built.message);
  return built.ref;
}

describe('answerView', () => {
  const ctx = { question: 'Who are our top customers by revenue?', fileName: 'orders.csv', rowCount: 332, fn: FN };

  it('held before any answer, with the caption for the outcome', () => {
    const s = state();
    const a = answerView({ ...ctx, state: s, match: matchRun(s, null), outcome: { kind: 'idle' }, data: null });
    expect(a.held).toBe(true);
    expect(a.view).toBeNull();
    expect(a.heldCaption).toBe('Held until every check passes. Ask to start the checks.');
  });

  it('the veil of a card with nothing to show says what is held, not the sentence the card beside it already says (and offers once)', () => {
    // was the whole no-recording sentence, a third copy of the way out ("switch to orders.csv") beside the sentence and its button
    const none = heldCaptionFor({ kind: 'no-recording', onData: true, message: 'x' });
    expect(none).toBe('Nothing was checked, so no answer is shown.');
    expect(none).not.toContain(NO_RECORDING_OWN);
    expect(none).not.toMatch(/switch to|try it|orders\.csv|your computer/i);
    // the same words as a run that failed before any check: nothing was checked either way
    expect(heldCaptionFor({ kind: 'error', name: 'E', message: 'm' } as never)).toBe(none);
    expect(heldCaptionFor({ kind: 'idle' })).toBe('Held until every check passes. Ask to start the checks.');
  });

  it('a basic answer: the real list, basic level, the model’s own notes, data-derived "not checked"', () => {
    const rows = bundledOrders();
    const s = state({ program: program(record(specless(), artifact(basicGates()))), generation: gen([att(1, 'accepted', basicGates())], 'committed'), repl: [...before, input, output()] });
    const r = runRef();
    const m = matchRun(s, r);
    const a = answerView({ ...ctx, state: s, match: m, outcome: outcomeOf(s, r, m), data: dataFacts(rows) });
    expect(a.held).toBe(false);
    expect(a.level).toBe('basic');
    expect(a.view!.lead).toMatchObject({ name: 'Puddlesworth Inc', num: '$2,599.13' });
    expect(a.view!.rest.map((x) => x.name)).toEqual(['Kettlewhistle Farms', 'Brambleskate Ltd', 'Chef Ravioli Starbright', 'Grommet & Gasket LLC']);
    expect(a.view!.fig).toBe('Fig. 1 · Top 5 customers by revenue · orders.csv · 332 rows · Version 4');
    expect(a.assumptions.items.map((x) => x.text)).toEqual(['Assumes revenue is quantity × unit price after discount.', 'Ties are sorted alphabetically.']);
    expect(a.checked).toEqual(['runs without errors', 'never changes your data', 'finishes fast']);
    expect(a.notChecked).toEqual([
      'whether refunded and pending orders should count (your status column has paid, refunded and pending)',
      'whether the 12 repeated order numbers should count twice',
      'whether orders.csv is the complete export',
      'whether this was the right question',
      "your examples, locked answers and house rules: you haven't set any yet",
    ]);
    expect(a.locked).toBe(false);
    expect(a.canLock).toBe(true);
    expect(countedFor(specless())).toBeUndefined();
  });

  it('locking a basic answer keeps level basic (what ran on it), and the lock is found for undo', () => {
    const pin = { id: 'pin1', label: CALL, args: pinnable.args, expected: pinnable.expected, pinnedAt: 2 };
    const s = state({ program: program(record(specless([pin]), artifact(basicGates()))), generation: gen([att(1, 'accepted', basicGates())], 'committed'), repl: [...before, input, output({ pinned: true })] });
    const r = runRef();
    const m = matchRun(s, r);
    const a = answerView({ ...ctx, state: s, match: m, outcome: outcomeOf(s, r, m), data: null });
    expect(a.locked).toBe(true);
    expect(a.level).toBe('basic');
    // one truth: the lock is in the agreement, so the answer must not say "you haven't set any yet" ...
    expect(a.notChecked).toContain('your locked answer: added after this answer was checked');
    expect(a.notChecked.join('\n')).not.toContain("haven't set any");
    // ... and the lock confirmation: live keeps the promise, the replay demo says it cannot re-run
    expect(a.lockHelp).toBe('Locked. The next version runs full checks, starting with this answer.');
    const replay = answerView({ ...ctx, state: s, match: m, outcome: outcomeOf(s, r, m), data: null, mode: 'replay' });
    expect(replay.lockHelp).toBe("Locked. This demo can't re-run with it, so asking again shows this same answer; on your computer the next version is checked against it.");
    expect(replay.level).toBe('basic');
    expect(lockInfo(s.program, m.output)).toEqual({ locked: true, entryId: 'out1', pin: { fn: FN, id: 'pin1' } });
    expect(lockInfo(program(record(specless(), null)), output())).toEqual({ locked: false, entryId: 'out1', pin: null });
  });

  it('a locked answer that ran full checks: live keeps the card\'s own words, replay says the demo cannot write a later version', () => {
    const pin = { id: 'pin1', label: CALL, args: pinnable.args, expected: pinnable.expected, pinnedAt: 2 };
    const spec: FunctionSpec = { ...specless([pin]), tests: 'test("a", () => {})', properties: 'property("b", [], () => {})' };
    const art = artifact(fullGates(), { unitTests: 7, pinnedTests: 1, properties: [{ name: 'b', runs: 100 }] });
    const s = state({ program: program(record(spec, art)), generation: gen([att(1, 'accepted', fullGates())], 'committed'), repl: [...before, input, output({ pinned: true })] });
    const r = runRef();
    const m = matchRun(s, r);
    const live = answerView({ ...ctx, state: s, match: m, outcome: outcomeOf(s, r, m), data: null, mode: 'live' });
    expect(live.level).toBe('full');
    expect(live.locked).toBe(true);
    expect(live.view?.kind).toBe('ranked');
    // live: '' = the card's own "Every later version has to give this same list.", which is true there
    expect(live.lockHelp).toBe('');
    // replay: nothing later can be written here, so the sentence says what is true here and what holds on the viewer's computer
    const replay = answerView({ ...ctx, state: s, match: m, outcome: outcomeOf(s, r, m), data: null, mode: 'replay' });
    expect(replay.level).toBe('full');
    expect(replay.lockHelp).toBe("Locked, and kept with this answer. This demo can't write a later version; on your computer every later version has to give this same list.");
    expect(replay.lockHelp).not.toContain('Every later version has to give');
    // no mode given: the live words (the default)
    expect(answerView({ ...ctx, state: s, match: m, outcome: outcomeOf(s, r, m), data: null }).lockHelp).toBe('');
  });

  it('not locked: no confirmation text of its own, and an agreement-free answer still says "you haven\'t set any yet"', () => {
    const s = state({ program: program(record(specless(), artifact(basicGates()))), generation: gen([att(1, 'accepted', basicGates())], 'committed'), repl: [...before, input, output()] });
    const r = runRef();
    const m = matchRun(s, r);
    const a = answerView({ ...ctx, state: s, match: m, outcome: outcomeOf(s, r, m), data: null, mode: 'replay' });
    expect(a.lockHelp).toBe('');
    expect(a.notChecked).toContain("your examples, locked answers and house rules: you haven't set any yet");
  });

  it('busy engine: the lock button is disabled', () => {
    const s = state({ busy: true, program: program(record(specless(), artifact(basicGates()))), generation: gen([att(1, 'accepted', basicGates())], 'committed'), repl: [...before, input, output()] });
    const r = runRef();
    const a = answerView({ ...ctx, state: s, match: matchRun(s, r), outcome: { kind: 'committed' }, data: null });
    expect(a.canLock).toBe(false);
  });
});

describe('agreement, copy, version', () => {
  it('the seed shows at once (seeded), a spec-less question has an empty agreement', async () => {
    const ref = await ordersRef();
    const seed = seedAgreement('orders', 'top', ref)!;
    const v = agreementFor(program(), FN, seed.spec, true);
    expect(v.counts).toBe('6 examples · 1 locked answer · 2 house rules');
    expect(v.seeded).toBe(true);
    expect(agreementFor(program(), 'countByStatus', null, false).empty).toBe(true);
    expect(countedFor(seed.spec)).toBe('paid orders only, each order number once');
  });
  it('no-recording sentences', () => {
    expect(noRecordingText(true, null)).toBe(NO_RECORDING_OWN);
    // the own-file sentence no longer ends in advice nothing on the page could act on
    expect(NO_RECORDING_OWN).toBe('In this demo, answers are recorded, so questions about your own file need the version on your computer.');
    expect(NO_RECORDING_OWN).not.toContain('Try a sample file');
    expect(noRecordingText(false, { label: 'Count orders by status' })).toBe(
      'In this demo, answers are recorded, and this question has no recorded answer with these checks, so it needs the version on your computer. “Count orders by status” has one: try it.',
    );
  });
  it('the no-recording sentence in pieces: its action is the only part a page draws as a button, and the pieces read as the sentence', () => {
    const own = noRecordingView(true, null);
    expect(own).toEqual({ before: NO_RECORDING_OWN, action: null, after: '' });
    const none = noRecordingView(false, null);
    expect(none.action).toBeNull();
    expect(none.before + none.after).toBe(noRecordingText(false, null));
    const v = noRecordingView(false, { id: 'top', label: 'Top 5 customers by revenue' });
    expect(v.action).toEqual({ kind: 'question', id: 'top', text: 'try it' });
    expect(v.before.endsWith('“Top 5 customers by revenue” has one: ')).toBe(true);
    expect(v.after).toBe('.');
    // the plain text is the same sentence it always was
    const offer = sampleOffer(null);
    for (const [ownData, other, o] of [[false, { id: 'top', label: 'Top 5 customers by revenue' }, null], [true, { id: 'top', label: 'Top 5 customers by revenue' }, null], [true, null, null], [false, null, null], [true, null, offer], [false, null, offer]] as const) {
      const w = noRecordingView(ownData, other, o);
      expect(w.before + (w.action?.text ?? '') + w.after).toBe(noRecordingText(ownData, other, o));
    }
    expect(noRecordingText(false, { label: 'Top 5 customers by revenue' })).toBe(
      'In this demo, answers are recorded, and this question has no recorded answer with these checks, so it needs the version on your computer. “Top 5 customers by revenue” has one: try it.',
    );
    expect(noRecordingText(true, { label: 'How many rows per region' })).toBe(
      'In this demo, answers are recorded, so questions about your own file need the version on your computer. “How many rows per region” has one: try it.',
    );
  });
  it('a file with nothing recorded is not a dead end: the sentence names the recorded sample and the question it opens on, and its action binds that sample', () => {
    const offer = sampleOffer(null)!;
    expect(offer).toEqual({ sample: 'orders', file: 'orders.csv', question: 'Who are our top customers by revenue?' });
    // the question named is the one binding the sample selects (the sentence stays true), in the question's own words
    expect(DEFAULT_QUESTION_ID[offer.sample]).toBe('top');
    expect(offer.question).toBe(sampleOpeningQuestion('orders').text);
    const own = noRecordingView(true, null, offer);
    expect(own.action).toEqual({ kind: 'sample', sample: 'orders', text: 'switch to orders.csv' });
    expect(own.before).toBe(`${NO_RECORDING_OWN} “Who are our top customers by revenue?” has a recorded answer on one sample file: `);
    expect(own.after).toBe('.');
    expect(noRecordingText(true, null, offer)).toBe(
      'In this demo, answers are recorded, so questions about your own file need the version on your computer. “Who are our top customers by revenue?” has a recorded answer on one sample file: switch to orders.csv.',
    );
    // the other sample: the same way out, with its own first half
    const sales = noRecordingView(false, null, sampleOffer('sales'));
    expect(sales.before.startsWith('In this demo, answers are recorded, and this question has no recorded answer with these checks')).toBe(true);
    expect(sales.action).toMatchObject({ kind: 'sample', sample: 'orders' });
    expect(switchToSample('orders.csv')).toBe('switch to orders.csv');
    // orders.csv itself has no offer (its way out is the other question), and a question on this file wins over the offer
    expect(sampleOffer('orders')).toBeNull();
    expect(noRecordingView(false, { id: 'top', label: 'x' }, offer).action).toMatchObject({ kind: 'question' });
  });
  it('version line from the head revision', () => {
    expect(versionLine(state())).toBe('Version 4 · 5 Oct 2026');
  });
});

// ───────────────────────── the stress test holds the seal and the answer ─────────────────────────

describe('the stress test comes last: the answer, the seal and the lists are held for it', () => {
  const pin = { id: 'pin1', label: CALL, args: pinnable.args, expected: pinnable.expected, pinnedAt: 2 };
  const fullSpec: FunctionSpec = { ...specless([pin]), tests: 'test("a", () => {})', properties: 'property("b", [], () => {})' };
  const mutationReport = (killed: number, survived: number, extra: Record<string, unknown> = {}) => ({ total: killed + survived, killed, killedByBound: 0, survived, stillborn: 0, survivors: [], ms: 1, at: 1, ...extra });
  const fullArtifact = (mutation?: ReturnType<typeof mutationReport>): Artifact => {
    const a = artifact(fullGates(), { unitTests: 7, pinnedTests: 1, properties: [{ name: 'b', runs: 100 }, { name: 'c', runs: 100 }] });
    const { mutation: _drop, ...evidence } = a.evidence!;
    return { ...a, evidence: { ...evidence, ...(mutation ? { mutation } : {}) } };
  };
  const mut = (phase: 'waiting' | 'running' | 'done', fn = FN): EngineState['mutation'] => ({ fn, phase, done: phase === 'running' ? 5 : 0, total: phase === 'waiting' ? 0 : 12 });
  const fresh = (p: Partial<EngineState> = {}): EngineState =>
    state({ program: program(record(fullSpec, fullArtifact())), generation: gen([att(1, 'accepted', fullGates())], 'committed', { revision: 4 }), repl: [...before, input, output({ pinned: true })], ...p });
  const withReport = (m: ReturnType<typeof mutationReport> | undefined, mutation: EngineState['mutation']): EngineState =>
    fresh({ program: program(record(fullSpec, fullArtifact(m))), ...(mutation ? { mutation } : {}) });
  const ctx = { question: 'Who are our top customers by revenue?', fileName: 'orders.csv', rowCount: 332, fn: FN, data: null };
  const views = (s: EngineState, r: RunRef = runRef()) => {
    const m = matchRun(s, r);
    const outcome = outcomeOf(s, r, m);
    return {
      outcome,
      a: answerView({ ...ctx, state: s, match: m, outcome }),
      t: traceView({ state: s, run: r, match: m, outcome, label: 'Top 5 customers by revenue', question: ctx.question, file: 'orders.csv', rows: 332, fn: FN, pendingSeed: null }),
    };
  };

  describe('outcomeOf', () => {
    const o = (s: EngineState, r: RunRef = runRef()) => outcomeOf(s, r, matchRun(s, r));
    it('committed, but the engine still has the stress test waiting or running for this function: still running, and says which part', () => {
      expect(o(withReport(undefined, mut('waiting')))).toEqual({ kind: 'running', stress: { phase: 'waiting', cached: false } });
      expect(o(withReport(undefined, mut('running')))).toEqual({ kind: 'running', stress: { phase: 'running', cached: false } });
      expect(runFlag(o(withReport(undefined, mut('waiting'))))).toBe('running');
    });
    it('released when it is done, when nothing is scheduled (it will not run), or when it is about another function', () => {
      expect(o(withReport(mutationReport(8, 4), mut('done'))).kind).toBe('committed');
      expect(o(withReport(undefined, undefined)).kind).toBe('committed');
      expect(o(withReport(undefined, mut('waiting', 'other'))).kind).toBe('committed');
    });
    it('an answer certified earlier is held only when its stress test really is queued again; a second ask that re-runs nothing is not', () => {
      const cachedState = (mutation?: EngineState['mutation']) =>
        fresh({ generation: { ...gen([att(1, 'accepted', fullGates())], 'committed'), id: 'g1' }, repl: [...before, input, output({ label: 'cached artifact', pinned: true })], ...(mutation ? { mutation } : {}) });
      expect(o(cachedState(mut('waiting')))).toEqual({ kind: 'running', stress: { phase: 'waiting', cached: true } });
      expect(o(cachedState(mut('done'))).kind).toBe('cached');
      expect(o(cachedState()).kind).toBe('cached');
    });
    it('a spec-less call has no stress test queued: nothing is held, basic checks as before', () => {
      const s = state({ program: program(record(specless(), artifact(basicGates()))), generation: gen([att(1, 'accepted', basicGates())], 'committed'), repl: [...before, input, output()] });
      expect(o(s).kind).toBe('committed');
    });
    it('the page stops waiting after a while (never held for good): released, and the stress test reads as not run', () => {
      const s = withReport(undefined, mut('waiting'));
      expect(o(s).kind).toBe('running');
      giveUpOnStress('out1');
      try {
        expect(o(s).kind).toBe('committed');
        const v = views(s);
        expect(v.a.facts.stress).toEqual({ kind: 'not-run' });
        expect(v.a.seal?.text).toBe("Passed 5 of 6 checks · stress test didn't run");
        expect(v.t.lanes[5]).toMatchObject({ state: 'off', offNote: OFF_NOTES.stressNotRun });
        // and whatever arrives later does not change it
        expect(views(withReport(mutationReport(8, 4), mut('done'))).a.seal?.text).toBe("Passed 5 of 6 checks · stress test didn't run");
      } finally {
        stressGaveUp.value = new Set();
      }
    });
  });

  describe('while it is still to come', () => {
    for (const phase of ['waiting', 'running'] as const) {
      it(`${phase}: no seal, no answer, no lists; the trace says only the stress test is left`, () => {
        const v = views(withReport(undefined, mut(phase)));
        // the answer card
        expect(v.a.held).toBe(true);
        expect(v.a.view).toBeNull();
        expect(v.a.heldCaption).toBe('Held until every check passes.');
        expect(v.a.checked).toEqual([]);
        expect(v.a.notChecked).toEqual([]);
        expect(v.a.seal).toBeNull();
        expect(v.a.canLock).toBe(false);
        // the trace: lanes 01-05 are in, 06 is waiting or running, and there is no verdict
        expect(v.t.lanes.slice(0, 5).map((l) => l.state)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
        expect(v.t.lanes[5]).toMatchObject({ state: phase });
        expect(v.t.header.verdict).toBeUndefined();
        expect(v.t.header.done).toBeUndefined();
        expect(v.t.header).toMatchObject({ running: true, stress: phase });
        expect(v.t.run).toBe('running');
        expect(v.t.footer.text).toMatch(/^The other checks passed\./);
        expect(v.t.liveText).toBe('The other checks passed. Running the stress test before showing the answer.');
        expect(JSON.stringify(v.t)).not.toMatch(/Passed every check/i);
      });
    }
    it('a certified answer waiting on a stress test queued again keeps its certificate on the trace', () => {
      const s = fresh({ generation: { ...gen([att(1, 'accepted', fullGates())], 'committed'), id: 'g1' }, repl: [...before, input, output({ label: 'cached artifact', pinned: true })], mutation: mut('waiting') });
      const v = views(s);
      expect(v.outcome).toMatchObject({ kind: 'running', stress: { cached: true } });
      expect(v.t.cached).toBe(true);
      expect(v.t.lanes.slice(0, 5).map((l) => l.state)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
      expect(v.t.header.verdict).toBeUndefined();
      expect(v.a.held).toBe(true);
    });
  });

  describe('when it has finished, everything arrives together and says the same thing', () => {
    it('8 of 12: the seal, the amber stress line, and the line in "Not checked", in the header, the lane and the card', () => {
      const v = views(withReport(mutationReport(8, 4), mut('done')));
      const seal = 'Passed every check · stress test caught 8 of 12';
      expect(v.outcome.kind).toBe('committed');
      expect(v.a.held).toBe(false);
      expect(v.a.seal).toEqual({ text: seal, ran: 5, of: 6, complete: true });
      expect(v.a.checked).toContain('stress test (caught 8 of 12 deliberate breaks)');
      expect(v.a.checkedAsk).toEqual(['stress test (caught 8 of 12 deliberate breaks)']);
      expect(v.a.notChecked).toContain('4 of 12 deliberate breaks went unnoticed by your checks');
      expect(v.t.header.verdict).toBe(`${seal} ↓ see the list`);
      expect(v.t.header.done).toBe(true);
      expect(v.t.lanes[5]).toMatchObject({ state: 'passed', done: '8 of 12 caught', line2: '4 missed' });
      expect(v.t.liveText).toBe(`${seal}. Showing the answer.`);
      expect(v.t.footer.text).toBe('Checked against: 6 examples · 1 locked answer · 2 house rules on 100 made-up tables · stress test (caught 8 of 12) · your data untouched.');
      // the header and the card build the seal from different facts and must agree
      expect(sealOf(v.a.facts)?.text).toBe(v.t.header.verdict!.replace(' ↓ see the list', ''));
    });
    it('12 of 12: a green line, nothing added to "Not checked"', () => {
      const v = views(withReport(mutationReport(12, 0), mut('done')));
      expect(v.a.seal?.text).toBe('Passed every check · stress test caught 12 of 12');
      expect(v.a.checked).toContain('stress test (caught 12 of 12 deliberate breaks)');
      expect(v.a.checkedAsk).toEqual([]);
      expect(v.a.notChecked.join('\n')).not.toMatch(/deliberate|stress/);
      expect(v.t.lanes[5]).toMatchObject({ state: 'passed', glyph: 'pass', done: '12 of 12 caught' });
    });
    it('it never ran (the engine reported nothing): honest about what ran, never "every check"', () => {
      const v = views(withReport(mutationReport(0, 0, { skipped: 'mutation check failed: boom' }), mut('done')));
      expect(v.a.held).toBe(false);
      expect(v.a.seal).toEqual({ text: "Passed 5 of 6 checks · stress test didn't run", ran: 5, of: 6, complete: false });
      expect(v.a.checked.some((t) => /stress/.test(t))).toBe(false);
      expect(v.a.notChecked).toContain("whether your checks would notice a broken calculation: the stress test didn't run");
      expect(v.t.header.verdict).toBe("Passed 5 of 6 checks · stress test didn't run ↓ see what wasn't checked");
      expect(v.t.lanes[5]).toMatchObject({ state: 'off', offNote: OFF_NOTES.stressNotRun });
      expect(JSON.stringify([v.a.seal, v.t.header, v.t.liveText])).not.toMatch(/every check/i);
    });
    it('it ran out of time: partial, said plainly', () => {
      const v = views(withReport(mutationReport(4, 1, { skipped: 'time box reached after 5 of 12 mutants' }), mut('done')));
      expect(v.a.seal).toEqual({ text: 'Passed 5 of 6 checks · stress test ran out of time', ran: 5, of: 6, complete: false });
      expect(v.a.checkedAsk).toEqual(['stress test (caught 4 of 5 deliberate breaks, ran out of time)']);
      expect(v.a.notChecked).toContain('the stress test ran out of time: it tried 5 of 12 deliberate breaks, and 1 of those went unnoticed by your checks');
    });
    it('a second ask on an answer already certified (nothing re-runs): released at once, the same final words', () => {
      const s = fresh({ program: program(record(fullSpec, fullArtifact(mutationReport(8, 4)))), generation: { ...gen([att(1, 'accepted', fullGates())], 'committed'), id: 'g1' }, repl: [...before, input, output({ label: 'cached artifact', pinned: true })], mutation: mut('done') });
      const v = views(s);
      expect(v.outcome.kind).toBe('cached');
      expect(v.a.held).toBe(false);
      expect(v.a.seal?.text).toBe('Passed every check · stress test caught 8 of 12');
      expect(v.t.header.verdict).toBe('Passed every check · stress test caught 8 of 12 ↓ see the list');
    });
    it('basic checks stay as they were: two checks, the old seal words (none from here), no hold', () => {
      const s = state({ program: program(record(specless(), artifact(basicGates()))), generation: gen([att(1, 'accepted', basicGates())], 'committed'), repl: [...before, input, output()] });
      const v = views(s);
      expect(v.a.held).toBe(false);
      expect(v.a.level).toBe('basic');
      expect(v.a.seal).toBeNull();
      expect(v.t.header.verdict).toBe("Passed 2 basic checks ↓ see what wasn't checked");
      expect(v.a.notChecked.join('\n')).not.toMatch(/stress|deliberate/);
    });
  });

  describe('traceSummary: the one line above the collapsed trace on the answer pane', () => {
    it('Full checks: the seal words and the real run, from the trace\'s own header and footer', () => {
      const v = views(withReport(mutationReport(8, 4), mut('done')));
      expect(v.t.footer.meta).toBe('real run 0.41 s');
      expect(traceSummary(v.t)).toBe('Passed every check · stress test caught 8 of 12 · real run 0.41 s');
      // the same words as the card's seal
      expect(traceSummary(v.t)!.startsWith(v.a.seal!.text)).toBe(true);
    });
    it("a stress test that did not finish is said so, never 'every check'", () => {
      const v = views(withReport(mutationReport(0, 0, { skipped: 'mutation check failed: boom' }), mut('done')));
      expect(traceSummary(v.t)).toBe("Passed 5 of 6 checks · stress test didn't run · real run 0.41 s");
      expect(traceSummary(views(withReport(mutationReport(4, 1, { skipped: 'time box reached after 5 of 12 mutants' }), mut('done'))).t)).toBe('Passed 5 of 6 checks · stress test ran out of time · real run 0.41 s');
    });
    it('Basic checks: two checks, no seal words borrowed from Full', () => {
      const s = state({ program: program(record(specless(), artifact(basicGates()))), generation: gen([att(1, 'accepted', basicGates())], 'committed'), repl: [...before, input, output()] });
      const line = traceSummary(views(s).t);
      expect(line).toBe('Passed 2 basic checks · real run 0.41 s');
      expect(line).not.toMatch(/every check|stress/);
    });
    it('an answer certified earlier says so instead of a real run', () => {
      const s = fresh({ program: program(record(fullSpec, fullArtifact(mutationReport(8, 4)))), generation: { ...gen([att(1, 'accepted', fullGates())], 'committed'), id: 'g1' }, repl: [...before, input, output({ label: 'cached artifact', pinned: true })], mutation: mut('done') });
      const line = traceSummary(views(s).t);
      expect(line).toBe('Passed every check · stress test caught 8 of 12 · checked when it was written · 0.41 s · nothing re-run');
      expect(line).not.toMatch(/real run/);
    });
    it('nothing to say until a run has passed', () => {
      const idle = state({});
      expect(traceSummary(traceView({ state: idle, run: null, match: matchRun(idle, null), outcome: { kind: 'idle' }, label: 'x', question: 'x', file: 'orders.csv', rows: 332, fn: FN, pendingSeed: null }))).toBeNull();
      expect(traceSummary(views(withReport(undefined, mut('running'))).t)).toBeNull();
    });
  });

  it('the ledger the card shows when it is released is the ledger it keeps: engine updates that do not touch the answer change nothing in it', () => {
    const released = views(withReport(mutationReport(8, 4), mut('done'))).a;
    // a later engine tick (e.g. the progress counter being reset by an unrelated operation on another function)
    const later = views(withReport(mutationReport(8, 4), mut('done', 'other'))).a;
    for (const k of ['seal', 'checked', 'checkedAsk', 'notChecked', 'held'] as const) expect(later[k]).toEqual(released[k]);
  });

  describe('a lock that came with the demo file says so next to the Locked button', () => {
    const lockedState = (pinId: string) => {
      const p = { ...pin, id: pinId };
      return fresh({ program: program(record({ ...fullSpec, pins: [p] }, fullArtifact(mutationReport(8, 4)))), mutation: mut('done') });
    };
    it('the seeded pin: one short sentence saying the lock comes with the demo file (not "saved earlier": the demo installs it in this visit)', () => {
      expect(views(lockedState(SEEDED_PIN_ID)).a.lockNote).toBe(SEEDED_LOCK_NOTE);
      expect(SEEDED_LOCK_NOTE).toBe('This lock comes with the demo file.');
    });
    it('in the demo the note and the help are two sentences, not three: the help does not say "Locked, and kept with this answer." again beside the note', () => {
      const seededHelp = (pinId: string) => {
        const s = lockedState(pinId);
        const r = runRef();
        const m = matchRun(s, r);
        return answerView({ ...ctx, state: s, match: m, outcome: outcomeOf(s, r, m), mode: 'replay' }).lockHelp;
      };
      expect(seededHelp(SEEDED_PIN_ID)).toBe("This demo can't write a later version; on your computer every later version has to give this same list.");
      // a lock the viewer made keeps the whole sentence (nothing beside it says it is locked)
      expect(seededHelp('mine')).toBe("Locked, and kept with this answer. This demo can't write a later version; on your computer every later version has to give this same list.");
    });
    it('a pin the viewer made, or no lock at all: nothing', () => {
      expect(views(lockedState('mine')).a.lockNote).toBe('');
      const unlocked = fresh({ program: program(record(fullSpec, fullArtifact(mutationReport(8, 4)))), repl: [...before, input, output()], mutation: mut('done') });
      expect(views(unlocked).a.lockNote).toBe('');
    });
  });
});
