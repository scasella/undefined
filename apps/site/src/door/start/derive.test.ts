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
import { seedAgreement } from '../model/agreements';
import type { DatasetRef } from '@scasella/undefined-engine/types';
import {
  agreementFor,
  answerView,
  certifiedGeneration,
  countedFor,
  heldCaptionFor,
  lockInfo,
  matchRun,
  NO_RECORDING_OWN,
  noRecordingText,
  outcomeOf,
  runFlag,
  silentDiagnostic,
  telemetryOf,
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
    revisions: [{ id: 4, at: Date.UTC(2026, 9, 5, 12), kind: 'commit', title: 'x', fns: 1, artifacts: 1 }],
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
      'Stress test: small breaks on purpose',
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
    expect(heldCaptionFor({ kind: 'no-recording', onData: true, message: 'x' }, NO_RECORDING_OWN)).toBe(NO_RECORDING_OWN);
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
    expect(lockInfo(s.program, m.output)).toEqual({ locked: true, entryId: 'out1', pin: { fn: FN, id: 'pin1' } });
    expect(lockInfo(program(record(specless(), null)), output())).toEqual({ locked: false, entryId: 'out1', pin: null });
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
    expect(noRecordingText(false, { label: 'Count orders by status' })).toBe(
      'In this demo, answers are recorded, and this question has no recorded answer with these checks, so it needs the version on your computer. “Count orders by status” has one: try it.',
    );
  });
  it('version line from the head revision', () => {
    expect(versionLine(state())).toBe('Version 4 · 5 Oct 2026');
  });
});
