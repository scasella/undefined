/**
 * Hand-written EngineStates for developing and screenshotting the UI without the real engine.
 * DEV ONLY: imported dynamically from main.tsx behind import.meta.env.DEV.
 */
import type {
  Artifact,
  AttemptView,
  Candidate,
  DatasetRef,
  Declined,
  EngineState,
  ExampleInfo,
  FunctionRecord,
  FunctionSpec,
  GateId,
  GateResult,
  GenerationView,
  ProgressLine,
  RecordingPreview,
  ReplEntry,
  RestartOption,
  Revision,
} from '../../types';
import { EXAMPLES as REAL_EXAMPLES } from '../../examples';
import { buildPrompt, declarationLine, type PromptInput } from '../../shared/prompt';
import { ORDERS_GOOD, ordersCallSpec } from '../../examples/orders';
import { bundledOrders } from '../../data/orders';
import { inferDataset } from '../../data/infer';
import { sampleForModel } from '../../data/sample';
import { tablePreview } from '../../sandbox/replCore';
import { encodeValue } from '../../shared/serialize';
import { suggestProperties } from '../../suggest/suggest';
import { appendProperty } from '../../suggest/apply';
import { addedCheckReason } from '../../shared/evidence';
import { DECIDE_SCENARIOS } from './decideFixtures';

export const T0 = Date.UTC(2026, 9, 4, 9, 0, 0);
const h = (seed: string): string => seed.repeat(64).slice(0, 64);

// ───────── specs and bodies ─────────

/** The executor's summary format: total runs, then each property's runs (names as JSON strings). */
export const MEDIAN_PROPS_SUMMARY = '2/2 properties held (200 runs: "agrees with the sort-based reference" 100, "result is within min and max" 100)';

export const MEDIAN_SPEC: FunctionSpec = {
  name: 'median',
  params: [{ name: 'numbers', type: 'number[]' }],
  returns: 'number',
  doc: 'The median of a non-empty list of finite numbers. For an even count, the mean of the two middle values. Throws RangeError on an empty list. Must not mutate its input.',
  tests: `test("odd count", () => eq(median([3, 1, 2]), 2));
test("even count", () => eq(median([4, 1, 3, 2]), 2.5));
test("single", () => eq(median([7]), 7));
test("empty throws", () => throws(() => median([]), RangeError));
test("does not sort input", () => { const xs = [3, 1, 2]; median(xs); eq(xs, [3, 1, 2]); });`,
  properties: `matchesReference("agrees with the sort-based reference",
  [fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1 })],
  (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; });
property("result is within min and max", [fc.array(fc.integer(), { minLength: 1 })],
  (xs) => median(xs) >= Math.min(...xs) && median(xs) <= Math.max(...xs));`,
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'example',
  exampleId: 'median',
};

export const FIB_SPEC: FunctionSpec = {
  name: 'fibonacci',
  params: [{ name: 'n', type: 'number' }],
  returns: 'number',
  doc: 'The n-th Fibonacci number (fibonacci(0) = 0, fibonacci(1) = 1) for 0 <= n <= 90. Must return within the budget for every n in range.',
  tests: `test("small", () => eq([0, 1, 2, 10].map(fibonacci), [0, 1, 1, 55]));
test("large", () => eq(fibonacci(90), 2880067194370816000));`,
  properties: '',
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'example',
  exampleId: 'fibonacci',
};

export const CLAMP_SPEC: FunctionSpec = {
  name: 'clamp',
  params: [
    { name: 'x', type: 'number' },
    { name: 'lo', type: 'number' },
    { name: 'hi', type: 'number' },
  ],
  returns: 'number',
  doc: 'x limited to the closed range [lo, hi].',
  tests: '',
  properties: '',
  budgetMs: 1000,
  maxAttempts: 3,
  origin: 'user',
};

export const MEDIAN_BAD = `const sorted = [...numbers].sort((a, b) => a - b);
// middle element of the sorted copy
return sorted[Math.floor((sorted.length - 1) / 2)];`;

export const MEDIAN_GOOD = `if (numbers.length === 0) throw new RangeError("median of an empty list");
const sorted = [...numbers].sort((a, b) => a - b);
const mid = Math.floor(sorted.length / 2);
return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];`;

export const MEDIAN_COMPILE_BAD = `const sorted = [...numbers].sort((a, b) => a - b);
const mid = Math.floor(sorted.length / 2);
const result: number = sorted.length % 2 === 0 ? "even" : sorted[mid];
return result;`;

export const MEDIAN_MUTATES = `numbers.sort((a, b) => a - b);
const mid = numbers.length >> 1;
return numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2;`;

export const FIB_NAIVE = `if (n < 2) return n;
return fibonacci(n - 1) + fibonacci(n - 2);`;

export const FIB_GOOD = `let a = 0, b = 1;
for (let i = 0; i < n; i++) [a, b] = [b, a + b];
return a;`;

export const CLAMP_BODY = `return Math.min(hi, Math.max(lo, x));`;

// ───────── gate builders ─────────

export function pendingGates(): GateResult[] {
  return (['compile', 'tests', 'properties', 'invariants'] as GateId[]).map((gate) => ({
    gate,
    status: 'pending',
    ms: 0,
    summary: '',
    diagnostics: [],
  }));
}

export function gate(g: GateId, status: GateResult['status'], summary: string, extra: Partial<GateResult> = {}): GateResult {
  return { gate: g, status, ms: 0, summary, diagnostics: [], ...extra };
}

const notReached = (g: GateId): GateResult => gate(g, 'skipped', 'not reached', { note: 'not reached' });

export const PROPERTIES_HEADLINE = 'Rejected: median([1, 2]) returned 1, expected 1.5';

export function medianRejectedGates(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 212 }),
    gate('tests', 'pass', '5/5 tests passed', { ms: 9, counts: { passed: 5, total: 5 } }),
    gate('properties', 'fail', '1/2 properties failed', {
      ms: 41,
      counts: { passed: 1, total: 2 },
      headline: PROPERTIES_HEADLINE,
      diagnostics: [
        {
          kind: 'property',
          name: 'agrees with the sort-based reference',
          call: 'median([1, 2])',
          counterexample: '[[1, 2]]',
          expected: '1.5',
          actual: '1',
          shrinks: 14,
          runs: 3,
          seed: 1938244123,
        },
      ],
    }),
    notReached('invariants'),
  ];
}

export function medianAcceptedGates(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 188 }),
    gate('tests', 'pass', '5/5 tests passed', { ms: 8, counts: { passed: 5, total: 5 } }),
    gate('properties', 'pass', MEDIAN_PROPS_SUMMARY, { ms: 63, counts: { passed: 2, total: 2 } }),
    gate('invariants', 'pass', 'pure · bounded (26 calls replayed)', { ms: 17 }),
  ];
}

function compileRejectedGates(): GateResult[] {
  return [
    gate('compile', 'fail', '1 error', {
      ms: 230,
      headline: "Rejected: line 3: Type 'string' is not assignable to type 'number'",
      diagnostics: [
        {
          kind: 'compile',
          code: 2322,
          message: "Type 'string' is not assignable to type 'number'.",
          category: 'error',
          line: 3,
          col: 7,
          endLine: 3,
          endCol: 13,
          snippet: 'const result: number = sorted.length % 2 === 0 ? "even" : sorted[mid];',
        },
      ],
    }),
    notReached('tests'),
    notReached('properties'),
    notReached('invariants'),
  ];
}

function fibTimeoutGates(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 174 }),
    gate('tests', 'skipped', 'interrupted', { note: 'interrupted: invariant violated', ms: 1503 }),
    gate('properties', 'skipped', 'not reached', { note: 'interrupted: invariant violated' }),
    gate('invariants', 'fail', 'bounded violated', {
      ms: 1503,
      headline: 'Rejected: fibonacci(90) did not return within 1500 ms (bounded)',
      diagnostics: [
        {
          kind: 'invariant',
          invariant: 'bounded',
          message: 'fibonacci(90) did not return within 1500 ms',
          call: 'fibonacci(90)',
          phase: 'tests',
          budgetMs: 1500,
          elapsedMs: 1503,
          detail: 'worker terminated by the watchdog',
        },
      ],
    }),
  ];
}

function mutationGates(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 190 }),
    gate('tests', 'fail', '4/5 tests passed', {
      ms: 11,
      counts: { passed: 4, total: 5 },
      headline: 'Rejected: median([3, 1, 2]) left its input as [1, 2, 3], expected [3, 1, 2]',
      diagnostics: [
        {
          kind: 'test',
          name: 'does not sort input',
          message: 'expected values to be deeply equal',
          call: 'median([3, 1, 2])',
          expected: '[3, 1, 2]',
          actual: '[1, 2, 3]',
        },
      ],
    }),
    notReached('properties'),
    notReached('invariants'),
  ];
}

function randomGates(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 201 }),
    gate('tests', 'pass', '5/5 tests passed', { ms: 9, counts: { passed: 5, total: 5 } }),
    gate('properties', 'pass', MEDIAN_PROPS_SUMMARY, { ms: 70, counts: { passed: 2, total: 2 } }),
    gate('invariants', 'fail', 'pure violated', {
      ms: 4,
      headline: "Rejected: candidate read global 'Math.random' (pure)",
      diagnostics: [
        {
          kind: 'invariant',
          invariant: 'pure',
          message: "candidate read global 'Math.random'",
          call: 'median([0, 0])',
          phase: 'invariants',
        },
      ],
    }),
  ];
}

// ───────── candidates / attempts ─────────

/** Which spec the candidate was generated against, and the rejected candidates before it (they reach its prompt). */
export interface CandidateCtx {
  spec?: FunctionSpec;
  prior?: Candidate[];
  /** A call-inferred spec: the argument types and the datasets the call ran over, as the engine sends them. */
  callArgTypes?: string[];
  dataSamples?: PromptInput['dataSamples'];
}

/** The real prompt builder, so "What the model saw" in a fixture is exactly what the engine would send. */
export function fixturePrompt(ctx: CandidateCtx = {}): string {
  return buildPrompt({
    spec: ctx.spec ?? MEDIAN_SPEC,
    history: (ctx.prior ?? []).map((c) => ({ attempt: c.attempt, body: c.body, gates: c.gates, ...(c.headline ? { headline: c.headline } : {}) })),
    ...(ctx.callArgTypes ? { callArgTypes: ctx.callArgTypes } : {}),
    ...(ctx.dataSamples ? { dataSamples: ctx.dataSamples } : {}),
  });
}

export function candidate(attempt: number, body: string, gates: GateResult[], notes = '', ctx: CandidateCtx = {}): Candidate {
  const failing = gates.find((g) => g.status === 'fail');
  return {
    id: `c${attempt}-${body.length}`,
    attempt,
    body,
    notes,
    source: 'live',
    generationMs: 6200 + attempt * 900,
    gates,
    verdict: failing ? 'rejected' : 'accepted',
    rejectedBy: failing?.gate,
    headline: failing?.headline,
    prompt: fixturePrompt(ctx),
  };
}

export function doneAttempt(attempt: number, body: string, gates: GateResult[], notes = '', ctx: CandidateCtx = {}): AttemptView {
  const c = candidate(attempt, body, gates, notes, ctx);
  return { attempt, status: c.verdict === 'accepted' ? 'accepted' : 'rejected', shown: body, gates, candidate: c };
}

/** Consecutive finished attempts of one grow: each one's prompt carries the rejected ones before it. */
export function doneAttempts(spec: FunctionSpec, items: Array<[body: string, gates: GateResult[], notes?: string]>): AttemptView[] {
  const out: AttemptView[] = [];
  items.forEach(([body, gates, notes], i) => {
    out.push(doneAttempt(i + 1, body, gates, notes ?? '', { spec, prior: out.map((a) => a.candidate!) }));
  });
  return out;
}

export function progressLines(): ProgressLine[] {
  return [
    { t: 0, text: 'POST /generate · gpt-6-luna · effort medium', channel: 'system' },
    { t: 412, text: 'codex exec started (sandbox: read-only, no tools)', channel: 'event' },
    { t: 1890, text: 'thinking…', channel: 'event' },
    { t: 4210, text: 'drafting function body', channel: 'event' },
  ];
}

// ───────── state pieces ─────────

/** The real example list (blurbs, calls, break-it labels), reduced to what the UI sees, so fixtures cannot drift. */
export const EXAMPLES: ExampleInfo[] = REAL_EXAMPLES.map(({ id, title, blurb, call, fn, breakIt }) => ({
  id,
  title,
  blurb,
  call,
  fn,
  breakIt: { ...breakIt },
}));

function rec(spec: FunctionSpec, artifact: Artifact | null, specSeed = 'a3', testsSeed = '7c'): FunctionRecord {
  return { spec, specHash: h(specSeed), testsHash: h(testsSeed), artifact };
}

export function medianArtifact(revision = 2, candidates?: Candidate[]): Artifact {
  return {
    body: MEDIAN_GOOD,
    source: `function median(numbers: number[]): number {\n${MEDIAN_GOOD}\n}`,
    js: `function median(numbers) {\n${MEDIAN_GOOD}\n}`,
    returnType: 'number',
    specHash: h('a3'),
    testsHash: h('7c'),
    model: 'gpt-6-luna',
    codexVersion: '0.157.2',
    committedAt: T0 + 60_000,
    candidates:
      candidates ??
      doneAttempts(MEDIAN_SPEC, [
        [MEDIAN_BAD, medianRejectedGates()],
        [MEDIAN_GOOD, medianAcceptedGates()],
      ]).map((a) => a.candidate!),
    revision,
  };
}

type RevRow = EngineState['revisions'][number];

export function revRow(r: Partial<Revision> & Pick<Revision, 'id' | 'kind' | 'title'>, fns: number, artifacts: number): RevRow {
  return { at: T0 + r.id * 60_000, ...r, fns, artifacts };
}

const R1 = revRow({ id: 1, kind: 'init', title: 'empty program with 3 example specs' }, 3, 0);
const R2 = revRow(
  { id: 2, kind: 'commit', fn: 'median', title: 'median certified (attempt 2 of 3, rejected by properties first)' },
  3,
  1,
);

export function baseState(): EngineState {
  return {
    ready: true,
    mode: 'live',
    service: { state: 'up', codexVersion: '0.157.2', model: 'gpt-6-luna', effort: 'medium' },
    program: {
      functions: {
        median: rec(MEDIAN_SPEC, null),
        fibonacci: rec(FIB_SPEC, null, 'f1', 'b0'),
      },
    },
    headRevision: 1,
    revisions: [R1],
    repl: [],
    replInput: 'median([3, 1, 4, 2])',
    generation: null,
    env: {},
    hints: { opener: true, takeaway: false },
    datasets: [],
    send: { samples: true, sampleRows: 3 },
    busy: false,
    examples: EXAMPLES,
    pacing: { typeCharMs: 14, gateDwellMs: 380, replayMaxMs: 4000 },
  };
}

export function medianGeneration(attempts: AttemptView[], extra: Partial<GenerationView> = {}): GenerationView {
  return {
    id: 'g1',
    fn: 'median',
    signature: 'function median(numbers: number[]): number',
    call: 'median([3, 1, 4, 2])',
    phase: 'generating',
    attempt: Math.max(1, attempts.length),
    maxAttempts: 3,
    progress: progressLines(),
    attempts,
    ungated: false,
    mode: 'live',
    ...extra,
  };
}

let idn = 0;
export const eid = (p: string): string => `${p}${++idn}`;

export function openingTranscript(call = 'median([3, 1, 4, 2])', fn = 'median'): ReplEntry[] {
  return [
    { kind: 'input', id: eid('in'), text: call },
    { kind: 'error', id: eid('er'), name: 'ReferenceError', message: `${fn} is not defined` },
    { kind: 'info', id: eid('if'), text: 'Generating…', tone: 'accent' },
  ];
}

export const RESTARTS: RestartOption[] = [
  { id: 'retry', label: 'Retry with the error fed back', description: 'Ask the model again, showing it this error.' },
  { id: 'rollback', label: 'Roll back', description: 'Restore the previous revision.' },
  { id: 'edit-spec', label: 'Edit the spec', description: 'Open the spec in the repo tab.' },
];

function committedState(): EngineState {
  const s = baseState();
  s.program.functions.median = rec(MEDIAN_SPEC, medianArtifact());
  s.headRevision = 2;
  s.revisions = [R1, R2];
  s.hints.opener = false;
  s.replInput = '';
  s.repl = [
    ...openingTranscript(),
    { kind: 'output', id: eid('out'), value: '2.5', ms: 0.4, label: 'generated', detail: 'revision 2', pinnable: medianPinnable('[3, 1, 4, 2]', 2.5) },
  ];
  s.generation = medianGeneration(
    doneAttempts(MEDIAN_SPEC, [
      [MEDIAN_BAD, medianRejectedGates()],
      [MEDIAN_GOOD, medianAcceptedGates()],
    ]),
    { phase: 'committed', attempt: 2, revision: 2 },
  );
  return s;
}

/** What the engine attaches to a median result line (the outermost committed call and its result). */
export function medianPinnable(list: string, expected: number): NonNullable<Extract<ReplEntry, { kind: 'output' }>['pinnable']> {
  return { fn: 'median', call: `median(${list})`, args: [{ kind: 'value', encoded: JSON.parse(list) as number[] }], expected };
}

// ───────── the orders data (the bundled, fictional orders.csv) ─────────

const ORDER_ROWS = bundledOrders();
const ORDERS_INFERRED = inferDataset(ORDER_ROWS);
export const ORDERS_REF: DatasetRef = {
  name: 'rows',
  hash: h('5e'),
  typeName: 'Row',
  typeDecl: ORDERS_INFERRED.typeDecl,
  rowCount: ORDER_ROWS.length,
  columns: ORDERS_INFERRED.columns,
  source: 'bundled',
  filename: 'orders.csv',
  bytes: 61_204,
};
export const ORDERS_SPEC: FunctionSpec = ordersCallSpec(ORDERS_INFERRED.typeDecl);
/** What ORDERS_GOOD returns on the bundled rows (examples.test.ts proves these numbers with the real gates). */
export const ORDERS_RESULT = [
  { customer: 'Puddlesworth Inc', revenue: 2507.13 },
  { customer: 'Brambleskate Ltd', revenue: 2355.91 },
  { customer: 'Chef Ravioli Starbright', revenue: 2252.07 },
  { customer: 'Grommet & Gasket LLC', revenue: 2175.72 },
  { customer: 'Kettlewhistle Farms', revenue: 2034.13 },
];
const ORDERS_NOTE = 'Skips refunded orders, applies the discount when present, rounds each total to cents, top 5 by revenue.';

function ordersState(opts: { pinned: boolean }): EngineState {
  const s = baseState();
  s.hints.opener = false;
  s.replInput = '';
  s.datasets = [ORDERS_REF];
  s.program.datasets = { rows: ORDERS_REF };
  const gates = [
    gate('compile', 'pass', 'compiled, strict', { ms: 214 }),
    gate('tests', 'skipped', 'no tests yet', { note: 'no tests yet — add one to make the gate stricter' }),
    gate('properties', 'skipped', 'no properties yet', { note: 'no properties yet — add one to make the gate stricter' }),
    gate('invariants', 'pass', 'pure · bounded (1 sampled call replayed on frozen arguments)', { ms: 21 }),
  ];
  const call = 'topCustomersByRevenue(rows)';
  const attempt = doneAttempt(1, ORDERS_GOOD, gates, ORDERS_NOTE, {
    spec: ORDERS_SPEC,
    callArgTypes: ['Row[]'],
    dataSamples: [{ name: 'rows', typeName: 'Row', rowCount: ORDER_ROWS.length, sampleText: sampleForModel(ORDER_ROWS, { count: 3 }).text }],
  });
  const artifact: Artifact = {
    body: ORDERS_GOOD,
    source: `${ORDERS_INFERRED.typeDecl}\nfunction topCustomersByRevenue(arg0: Row[])\n{\n${ORDERS_GOOD}\n}`,
    js: `function topCustomersByRevenue(arg0) {\n${ORDERS_GOOD}\n}`,
    returnType: '{ customer: string; revenue: number; }[]',
    specHash: h('3b'),
    testsHash: h('e0'),
    model: 'gpt-6-luna',
    codexVersion: '0.157.2',
    committedAt: T0 + 180_000,
    candidates: [attempt.candidate!],
    revision: 3,
  };
  const pin = { id: 'a1b2c3d4e5f6', label: call, args: [{ kind: 'dataset' as const, name: 'rows', hash: ORDERS_REF.hash }], expected: ORDERS_RESULT, pinnedAt: T0 + 200_000 };
  const spec: FunctionSpec = opts.pinned ? { ...ORDERS_SPEC, pins: [pin] } : ORDERS_SPEC;
  s.program.functions.topCustomersByRevenue = rec(spec, artifact, '3b', 'e0');
  const rows: RevRow[] = [
    R1,
    revRow({ id: 2, kind: 'dataset', title: 'Loaded dataset rows: 332 rows × 10 columns', detail: 'bundled orders.csv · hash 5e5e…' }, 2, 0),
    revRow({ id: 3, kind: 'commit', fn: 'topCustomersByRevenue', title: 'topCustomersByRevenue certified — first attempt' }, 3, 1),
  ];
  if (opts.pinned) rows.push(revRow({ id: 4, kind: 'pin', fn: 'topCustomersByRevenue', title: `Pinned: ${call}` }, 3, 1));
  s.revisions = rows;
  s.headRevision = rows.length;
  const resultTable = tablePreview(ORDERS_RESULT)!;
  const refunded = ORDER_ROWS.filter((r) => r.status === 'refunded');
  s.repl = [
    { kind: 'info', id: eid('if'), text: `\`rows\` is bound: \`${ORDERS_INFERRED.typeDecl}\` (332 rows)`, tone: 'muted' },
    ...openingTranscript(call, 'topCustomersByRevenue'),
    {
      kind: 'output',
      id: eid('out'),
      value: '[{ customer: "Puddlesworth Inc", revenue: 2507.13 }, { customer: "Brambleskate Ltd", revenue: 2355.91 }, { customer: "Chef Ravioli Starbright", revenue: 2252.07 }, …]',
      ms: 2.1,
      label: 'generated',
      detail: 'revision 3',
      note: ORDERS_NOTE,
      table: resultTable,
      pinnable: { fn: 'topCustomersByRevenue', call, args: pin.args, expected: ORDERS_RESULT },
      ...(opts.pinned ? { pinned: true } : {}),
    },
    ...(opts.pinned ? [{ kind: 'info' as const, id: eid('if'), text: 'Pinned. The next regeneration has to reproduce this result.', tone: 'accent' as const }] : []),
    { kind: 'input', id: eid('in'), text: 'refunds = rows.filter((r) => r.status === "refunded")' },
    { kind: 'output', id: eid('out'), value: `[{ id: ${String(refunded[0]?.id)}, … }, …]`, ms: 0.4, label: null, table: tablePreview(refunded)! },
    { kind: 'input', id: eid('in'), text: 'rows' },
    { kind: 'output', id: eid('out'), value: '[{ id: 1001, … }, …]', ms: 0.6, label: null, table: tablePreview(ORDER_ROWS)! },
  ];
  s.env = { rows: '[{ id: 1001, orderDate: "2024-01-02", … }, …]', refunds: `[… ${refunded.length} rows]` };
  s.generation = {
    ...medianGeneration([attempt], { phase: 'committed', attempt: 1, revision: 3 }),
    id: 'g-orders',
    fn: 'topCustomersByRevenue',
    signature: declarationLine(ORDERS_SPEC),
    call,
    ungated: true,
  };
  return s;
}

const TAKEAWAY = "You didn't write this. The model wrote it. Your tests hold the contract, and your toolchain enforced it.";

/** A spec inferred from a call, as gates/source.ts specFromCall builds it (params arg0.., no return type, no doc). */
function specFromCallLike(name: string, argTypes: string[]): FunctionSpec {
  return {
    name,
    params: argTypes.map((type, i) => ({ name: `arg${i}`, type })),
    returns: null,
    doc: '',
    tests: '',
    properties: '',
    budgetMs: 1500,
    maxAttempts: 3,
    origin: 'call',
  };
}

/** A spec-less call the model declined: one candidate, no gate run, program unchanged, the REPL says why. */
function declinedState(call: string, fn: string, argTypes: string[], declined: Declined): EngineState {
  const s = baseState();
  s.hints.opener = false;
  s.replInput = '';
  const spec = specFromCallLike(fn, argTypes);
  const tag = declined.reason === 'cannot-be-pure' ? 'CANNOT_BE_PURE' : 'NEEDS_SPEC';
  const body = `throw new Error("${tag}: ${declined.message}");`;
  const gates: GateResult[] = (['compile', 'tests', 'properties', 'invariants'] as GateId[]).map((g) => ({
    gate: g,
    status: 'skipped',
    ms: 0,
    summary: 'not run',
    note: 'the model declined',
    diagnostics: [],
  }));
  const c: Candidate = {
    id: `c1-${fn}`,
    attempt: 1,
    body,
    notes: declined.message,
    source: 'live',
    generationMs: 5400,
    gates,
    verdict: 'aborted',
    prompt: buildPrompt({ spec, callArgTypes: argTypes, history: [] }),
    declined,
  };
  const message =
    declined.reason === 'cannot-be-pure'
      ? `The model declined to write \`${fn}\`: ${declined.message} Generated functions are pure — no clock, randomness, network, files or hidden state — so it would only be faking it. Pass what it needs in as an argument (for example a seed or a timestamp).`
      : `The model couldn't tell what \`${fn}\` should do: ${declined.message} Add a one-line spec and call it again.`;
  s.repl = [
    ...openingTranscript(call, fn),
    {
      kind: 'error',
      id: eid('er'),
      name: 'Declined',
      message,
      restarts:
        declined.reason === 'needs-spec'
          ? [
              { id: 'edit-spec', label: 'Write a spec', description: "Open this function's spec in the repo tab (parameters filled in from the call) and say what it should do." },
              { id: 'dismiss', label: 'Dismiss', description: 'Leave the program as it is.' },
            ]
          : [{ id: 'dismiss', label: 'Dismiss', description: 'Leave the program as it is.' }],
    },
  ];
  s.generation = {
    ...medianGeneration([{ attempt: 1, status: 'aborted', shown: body, gates, candidate: c }], { phase: 'failed', attempt: 1, declined }),
    id: `g-${fn}`,
    fn,
    signature: declarationLine(spec),
    call,
    ungated: true,
  };
  return s;
}

// ───────── evidence, the mutation check, suggested checks ─────────

export const SORT_SPEC: FunctionSpec = {
  name: 'sortNumbers',
  params: [{ name: 'xs', type: 'number[]' }],
  returns: 'number[]',
  doc: 'The numbers in ascending order, as a new array.',
  tests: 'test("three", () => eq(sortNumbers([3, 1, 2]), [1, 2, 3]));',
  properties: '',
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'user',
};
export const SORT_GOOD = 'return [...xs].sort((a, b) => a - b);';
export const SORT_LEXICAL = 'return [...xs].sort();';

function sortGates(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 161 }),
    gate('tests', 'pass', '1/1 test passed', { ms: 4, counts: { passed: 1, total: 1 } }),
    gate('properties', 'skipped', 'no properties yet', { note: 'no properties yet — add one to make the gate stricter' }),
    gate('invariants', 'pass', 'pure ✓ bounded ✓ (2 sampled calls replayed on frozen arguments)', { ms: 3 }),
  ];
}

function sortArtifact(body: string, revision: number): Artifact {
  const c = candidate(1, body, sortGates(), 'copy, then sort');
  return {
    body,
    source: `function sortNumbers(xs: number[]): number[] {\n${body}\n}`,
    js: `function sortNumbers(xs) {\n    ${body}\n}`,
    returnType: 'number[]',
    specHash: h('5a'),
    testsHash: h('1d'),
    model: 'gpt-6-luna',
    codexVersion: '0.157.2',
    committedAt: T0 + revision * 60_000,
    candidates: [c],
    revision,
    evidence: { compiled: true, unitTests: 1, pinnedTests: 0, properties: [], sampledCalls: 2 },
  };
}

function sortState(body: string): EngineState {
  const s = baseState();
  s.hints.opener = false;
  s.replInput = '';
  s.program.functions.sortNumbers = rec(SORT_SPEC, sortArtifact(body, 3), '5a', '1d');
  s.revisions = [R1, revRow({ id: 2, kind: 'spec-edit', fn: 'sortNumbers', title: 'Spec added: sortNumbers — no artifact yet' }, 3, 0), revRow({ id: 3, kind: 'commit', fn: 'sortNumbers', title: 'sortNumbers certified — first attempt' }, 3, 1)];
  s.headRevision = 3;
  s.repl = [
    ...openingTranscript('sortNumbers([3, 1, 2])', 'sortNumbers'),
    { kind: 'output', id: eid('out'), value: '[1, 2, 3]', ms: 0.2, label: 'generated', detail: 'revision 3' },
  ];
  s.generation = {
    ...medianGeneration([doneAttempt(1, body, sortGates(), 'copy, then sort')], { phase: 'committed', attempt: 1, revision: 3 }),
    id: 'g-sort',
    fn: 'sortNumbers',
    signature: 'function sortNumbers(xs: number[]): number[]',
    call: 'sortNumbers([3, 1, 2])',
  };
  return s;
}

/** The median artifact with its evidence and a finished mutation check (two survivors, one stopped by the bound). */
function committedEvidenceState(): EngineState {
  const s = committedState();
  const a = s.program.functions.median.artifact!;
  a.evidence = {
    compiled: true,
    unitTests: 5,
    pinnedTests: 0,
    properties: [
      { name: 'agrees with the sort-based reference', runs: 100 },
      { name: 'result is within min and max', runs: 100 },
    ],
    sampledCalls: 26,
    mutation: {
      total: 12,
      killed: 9,
      killedByBound: 1,
      survived: 2,
      stillborn: 1,
      survivors: [
        { id: 'boundary@1:9+1', kind: 'boundary', line: 1, original: '0', mutated: '-1' },
        { id: 'comparison@4:34', kind: 'comparison', line: 4, original: '===', mutated: '!==' },
      ],
      ms: 1840,
      at: T0 + 180_000,
    },
  };
  s.mutation = { fn: 'median', phase: 'done', done: 12, total: 12 };
  return s;
}

function suggestionsState(): EngineState {
  const s = sortState(SORT_GOOD);
  s.mutation = { fn: 'sortNumbers', phase: 'running', done: 5, total: 12 };
  return s;
}

/** The sortNumbers check that the lexical-sort body fails. */
export function sortedSuggestion() {
  return suggestProperties(SORT_SPEC, { functions: {} }).find((x) => x.kind === 'sorted')!;
}

function recheckFailedState(): EngineState {
  const s = sortState(SORT_LEXICAL);
  const sug = sortedSuggestion();
  const reason = addedCheckReason(sug.title);
  const spec = appendProperty(SORT_SPEC, sug);
  const r = s.program.functions.sortNumbers;
  s.program.functions.sortNumbers = { ...r, spec, testsHash: h('e4') }; // stale: certified against the old tests
  s.revisions.push(revRow({ id: 4, kind: 'spec-edit', fn: 'sortNumbers', title: `${reason}: the committed function fails it`, detail: 'tests hash 1d1d… → e4e4…' }, 3, 0));
  s.headRevision = 4;
  const headline = `Rejected: property "${sug.title}" failed for sortNumbers([10, 2])`;
  const gates: GateResult[] = [
    gate('compile', 'pass', 'compiled, strict', { ms: 142 }),
    gate('tests', 'pass', '1/1 test passed', { ms: 3, counts: { passed: 1, total: 1 } }),
    gate('properties', 'fail', `1/1 property failed (12 runs: ${JSON.stringify(sug.title)} 12)`, {
      ms: 21,
      counts: { passed: 0, total: 1 },
      headline,
      diagnostics: [
        { kind: 'property', name: sug.title, call: 'sortNumbers([10, 2])', counterexample: '[[10, 2]]', actual: '[10, 2]', shrinks: 9, runs: 12, seed: 1840213377 },
      ],
    }),
    notReached('invariants'),
  ];
  const c: Candidate = { ...candidate(1, SORT_LEXICAL, gates, ''), verdict: 'rejected', rejectedBy: 'properties', headline };
  s.generation = {
    ...s.generation!,
    id: 'g-recheck',
    phase: 'failed',
    attempt: 1,
    maxAttempts: 1,
    progress: [],
    attempts: [{ attempt: 1, status: 'rejected', shown: SORT_LEXICAL, gates, candidate: c }],
    call: 'sortNumbers (committed r3)',
    kind: 'recheck',
    recheck: { reason },
  };
  s.repl.push({ kind: 'info', id: eid('if'), text: 'You added a check and the function committed earlier fails it. It will be regenerated on the next call.', tone: 'warn' });
  return s;
}

// ───────── scenarios ─────────

export const SCENARIOS: Record<string, () => EngineState> = {
  opening: baseState,

  generating: () => {
    const s = baseState();
    s.hints.opener = false;
    s.busy = true;
    s.replInput = '';
    s.repl = openingTranscript();
    s.generation = medianGeneration([{ attempt: 1, status: 'generating', shown: '', gates: [] }]);
    return s;
  },

  'rejected-properties': () => {
    const s = SCENARIOS.generating();
    s.generation = medianGeneration(
      [
        doneAttempt(1, MEDIAN_BAD, medianRejectedGates(), 'sorted copy, middle element'),
        { attempt: 2, status: 'generating', shown: '', gates: [] },
      ],
      { attempt: 2, progress: progressLines().slice(0, 2) },
    );
    return s;
  },

  committed: committedState,

  'committed-evidence': committedEvidenceState,
  suggestions: suggestionsState,
  'recheck-failed': recheckFailedState,
  // the Decide flow (src/ui/dev/decideFixtures.ts)
  ...DECIDE_SCENARIOS,

  cached: () => {
    const s = committedState();
    s.hints.takeaway = true;
    s.repl = [
      ...s.repl,
      { kind: 'input', id: eid('in'), text: 'median([3, 1, 4, 2])' },
      { kind: 'output', id: eid('out'), value: '2.5', ms: 0.1, label: 'cached artifact', detail: 'certified r2' },
      { kind: 'takeaway', id: eid('tk'), text: TAKEAWAY },
      { kind: 'input', id: eid('in'), text: 'xs = [10, 2, 38, 23]' },
      { kind: 'output', id: eid('out'), value: '[10, 2, 38, 23]', ms: 0.1, label: null },
      { kind: 'input', id: eid('in'), text: 'median(xs)' },
      { kind: 'output', id: eid('out'), value: '16.5', ms: 0.1, label: 'cached artifact', detail: 'certified r2' },
    ];
    s.env = { xs: '[10, 2, 38, 23]' };
    return s;
  },

  'compile-rejected': () => {
    const s = SCENARIOS.generating();
    s.generation = medianGeneration([doneAttempt(1, MEDIAN_COMPILE_BAD, compileRejectedGates())], {
      attempt: 1,
      phase: 'generating',
    });
    return s;
  },

  // the spec was silent: a defensible first candidate, rejected by a test that says so (slugify's "special letters")
  'rejected-silent': () => {
    const spec = REAL_EXAMPLES.find((e) => e.id === 'slugify')!.spec!;
    const s = baseState();
    s.hints.opener = false;
    s.busy = true;
    s.replInput = '';
    s.program.functions.slugify = rec(spec, null, '5c', '9d');
    const call = 'slugify("Straße & Smørrebrød")';
    s.repl = openingTranscript(call, 'slugify');
    const gates: GateResult[] = [
      gate('compile', 'pass', 'compiled, strict', { ms: 205 }),
      gate('tests', 'fail', '9/10 tests passed', {
        ms: 12,
        counts: { passed: 9, total: 10 },
        headline: 'Rejected: slugify("Straße") returned "stra-e", expected "strasse"',
        diagnostics: [
          {
            kind: 'test',
            name: 'special letters',
            message: 'expected values to be deeply equal',
            silentOn: 'how to spell letters outside a–z',
            reasonable: 'Dropping or spelling them out are both used in the wild; the doc only said URL slug.',
            call: 'slugify("Straße")',
            expected: '"strasse"',
            actual: '"stra-e"',
          },
        ],
      }),
      notReached('properties'),
      notReached('invariants'),
    ];
    const body = `return title
  .normalize("NFD")
  .replace(/[\\u0300-\\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");`;
    s.generation = {
      ...medianGeneration(
        [
          doneAttempt(1, body, gates, 'strip accents via NFD, then collapse everything else into hyphens', { spec }),
          { attempt: 2, status: 'generating', shown: '', gates: [] },
        ],
        { attempt: 2, progress: progressLines().slice(0, 2) },
      ),
      id: 'g-slug',
      fn: 'slugify',
      signature: declarationLine(spec),
      call,
    };
    return s;
  },

  'invariant-timeout': () => {
    const s = baseState();
    s.hints.opener = false;
    s.busy = true;
    s.repl = openingTranscript('fibonacci(90)', 'fibonacci');
    s.replInput = '';
    s.generation = {
      ...medianGeneration(
        [
          doneAttempt(1, FIB_NAIVE, fibTimeoutGates(), 'classic recursive definition', { spec: FIB_SPEC }),
          { attempt: 2, status: 'typing', shown: FIB_GOOD.slice(0, 40), gates: [] },
        ],
        { attempt: 2 },
      ),
      id: 'g-fib',
      fn: 'fibonacci',
      signature: 'function fibonacci(n: number): number',
      call: 'fibonacci(90)',
    };
    return s;
  },

  'no-tests': () => {
    const s = baseState();
    s.hints.opener = false;
    s.busy = true;
    s.program.functions.clamp = rec(CLAMP_SPEC, null, 'c1', 'e3');
    s.repl = openingTranscript('clamp(12, 0, 10)', 'clamp');
    s.replInput = '';
    const gates = [
      gate('compile', 'pass', 'compiled, strict', { ms: 160 }),
      gate('tests', 'skipped', 'no tests yet', { note: 'no tests yet — add one to make the gate stricter' }),
      gate('properties', 'skipped', 'no properties yet', { note: 'no properties yet — add one to make the gate stricter' }),
      gate('invariants', 'running', 'replaying 1 sampled call…'),
    ];
    s.generation = {
      ...medianGeneration([{ attempt: 1, status: 'gating', shown: CLAMP_BODY, gates }], { phase: 'gating' }),
      id: 'g-clamp',
      fn: 'clamp',
      signature: 'function clamp(x: number, lo: number, hi: number): number',
      call: 'clamp(12, 0, 10)',
      ungated: true,
    };
    return s;
  },

  'budget-exhausted': () => {
    const s = baseState();
    s.hints.opener = false;
    s.repl = [
      ...openingTranscript(),
      {
        kind: 'error',
        id: eid('er'),
        name: 'GrowthFailed',
        message: 'median: 3 candidates, all rejected. The program is unchanged.',
        restarts: [RESTARTS[0], RESTARTS[2]],
      },
    ];
    s.replInput = '';
    s.generation = medianGeneration(
      doneAttempts(MEDIAN_SPEC, [
        [MEDIAN_BAD, medianRejectedGates()],
        [MEDIAN_MUTATES, mutationGates()],
        [MEDIAN_GOOD.replace('const sorted', 'const _r = Math.random();\nconst sorted'), randomGates()],
      ]),
      { phase: 'failed', attempt: 3 },
    );
    return s;
  },

  'service-error': () => {
    const s = baseState();
    s.hints.opener = false;
    s.service = {
      state: 'degraded',
      model: 'gpt-6-luna',
      effort: 'medium',
      problem: { code: 'codex_missing', message: 'Codex CLI was not found on PATH.' },
    };
    s.repl = [
      ...openingTranscript(),
      { kind: 'error', id: eid('er'), name: 'GenerationFailed', message: 'Codex CLI was not found on PATH.', restarts: [RESTARTS[0]] },
    ];
    s.replInput = '';
    s.generation = medianGeneration([{ attempt: 1, status: 'aborted', shown: '', gates: [] }], {
      phase: 'failed',
      error: {
        code: 'codex_missing',
        message: 'Codex CLI was not found on PATH. The local service is running, but it cannot generate code.',
        fix: ['npm install -g @openai/codex@latest', 'codex login', 'codex --version   # 0.157 or later'],
      },
    });
    return s;
  },

  'fault-restart': () => {
    const s = committedState();
    s.repl = [
      ...s.repl,
      { kind: 'input', id: eid('in'), text: 'median([])' },
      {
        kind: 'error',
        id: eid('er'),
        name: 'RangeError',
        message: 'median([]) threw RangeError: median of an empty list',
        restarts: RESTARTS,
        resolved: true,
      },
      { kind: 'input', id: eid('in'), text: 'median(null)' },
      {
        kind: 'error',
        id: eid('er'),
        name: 'TypeError',
        message: "median(null) threw TypeError: numbers is not iterable",
        restarts: RESTARTS,
      },
    ];
    return s;
  },

  // the model declined instead of faking: now() would need the clock
  'declined-pure': () =>
    declinedState('now()', 'now', [], {
      reason: 'cannot-be-pure',
      message: 'Returning the current time requires reading the clock; pass the timestamp in as an argument instead.',
    }),

  // the model declined to invent behaviour: clean() says nothing about what it should remove
  'declined-spec': () =>
    declinedState('clean("  Hello,   World  ")', 'clean', ['string'], {
      reason: 'needs-spec',
      message: 'What should clean do to the string: trim it, collapse inner whitespace, remove punctuation, or something else?',
    }),

  // a function grown with no tests and no properties: accepted, but the result line says nothing checked the intent
  'spec-less-accept': () => {
    const s = baseState();
    s.hints.opener = false;
    s.replInput = '';
    const spec = specFromCallLike('titleCase', ['string']);
    const body = 'return arg0.replace(/\\b([A-Za-z])/g, (letter) => letter.toUpperCase());';
    const notes = 'Uppercases the first ASCII letter at each word boundary and leaves other characters unchanged.';
    const gates = [
      gate('compile', 'pass', 'compiled, strict', { ms: 171 }),
      gate('tests', 'skipped', 'no tests yet', { note: 'no tests yet — add one to make the gate stricter' }),
      gate('properties', 'skipped', 'no properties yet', { note: 'no properties yet — add one to make the gate stricter' }),
      gate('invariants', 'pass', '1 sampled call replayed twice on frozen arguments', { ms: 9 }),
    ];
    const call = 'titleCase("élan vital of the ünderground")';
    s.repl = [
      ...openingTranscript(call, 'titleCase'),
      { kind: 'output', id: eid('out'), value: '"éLan Vital Of The üNderground"', ms: 0.3, label: 'generated', detail: 'revision 2', note: notes },
    ];
    s.generation = {
      ...medianGeneration([doneAttempt(1, body, gates, notes, { spec })], { phase: 'committed', attempt: 1, revision: 2 }),
      id: 'g-title',
      fn: 'titleCase',
      signature: declarationLine(spec),
      call,
      ungated: true,
    };
    return s;
  },

  // a spec-less call over the bundled orders: the result renders as a table, with "Pin as test" under it
  'table-result': () => ordersState({ pinned: false }),

  // the same result after "Pin as test": the line says what the pin became; the Repo tab lists the pinned test
  pinned: () => ordersState({ pinned: true }),

  // the data drawer open over a program with the orders bound (paste something to see the live preview)
  'data-drawer-open': () => {
    const s = baseState();
    s.datasets = [ORDERS_REF];
    s.program.datasets = { rows: ORDERS_REF };
    s.revisions = [R1, revRow({ id: 2, kind: 'dataset', title: 'Loaded dataset rows: 332 rows × 10 columns' }, 2, 0)];
    s.headRevision = 2;
    return s;
  },

  'replay-banner': () => {
    const s = baseState();
    s.mode = 'replay';
    s.service = { state: 'down' };
    return s;
  },

  'repo-stale': () => {
    const s = committedState();
    const edited: FunctionSpec = { ...MEDIAN_SPEC, doc: MEDIAN_SPEC.doc + ' NaN values are ignored.' };
    s.program.functions.median = { ...rec(edited, medianArtifact(), 'd9', '7c') };
    s.headRevision = 3;
    s.revisions = [R1, R2, revRow({ id: 3, kind: 'spec-edit', fn: 'median', title: 'median spec edited: doc', detail: 'artifact r2 is now stale' }, 3, 1)];
    s.generation = null;
    return s;
  },

  // the Share dialog open after the opening commit (the fixture engine exports a small recording)
  'share-dialog': committedState,

  // "Load this recording?" for a dropped recording (the confirmation shown before anything is loaded)
  'load-recording': () => {
    const s = baseState();
    s.mode = 'replay';
    s.service = { state: 'down' };
    return s;
  },

  // the session log dialog, log on, a few entries kept
  'session-log': () => {
    const s = committedState();
    s.sessionLog = { enabled: true, count: 14, status: 'indexeddb' };
    return s;
  },

  // a recording was loaded: the banner under the header and its first call typed in
  'recording-loaded': () => {
    const s = baseState();
    s.loadedRecording = { title: FIXTURE_PREVIEW.title, source: 'gist.githubusercontent.com', calls: FIXTURE_PREVIEW.calls, dismissed: false };
    s.replInput = FIXTURE_PREVIEW.calls[0]!;
    s.hints = { opener: false, takeaway: false };
    s.revisions = [R1, revRow({ id: 2, kind: 'import', title: `Loaded recording: ${FIXTURE_PREVIEW.title}`, detail: 'from gist.githubusercontent.com · 1 spec (median)' }, 2, 0)];
    s.headRevision = 2;
    return s;
  },

  'many-revisions': () => {
    const s = committedState();
    const rows: RevRow[] = [R1, R2];
    const kinds: Array<[Revision['kind'], string, string?]> = [
      ['commit', 'fibonacci certified (attempt 2 of 3, rejected by invariants first)', 'fibonacci'],
      ['spec-edit', 'median spec edited: properties', 'median'],
      ['commit', 'median certified (attempt 1 of 3)', 'median'],
      ['example', 'loaded example slugify', 'slugify'],
      ['commit', 'slugify certified (attempt 3 of 3, rejected by tests, compile)', 'slugify'],
      ['spec-edit', 'slugify spec edited: tests', 'slugify'],
      ['delete', 'clamp deleted', 'clamp'],
      ['import', 'imported undefined-image.json (6 revisions)'],
    ];
    kinds.forEach(([kind, title, fn], i) => {
      rows.push(revRow({ id: i + 3, kind, title, fn }, 3, Math.min(3, 1 + (i >> 1))));
    });
    rows.push(revRow({ id: rows.length + 1, kind: 'rollback', title: 'rolled back to r5', restoredFrom: 5 }, 3, 2));
    s.revisions = rows.map((r, i) => ({ ...r, at: Date.now() - (rows.length - i) * 7 * 60_000 }));
    s.headRevision = rows.length;
    return s;
  },
};

/** A recording preview as the engine builds it (the shipped median recording, loaded into a fresh program). */
export const FIXTURE_PREVIEW: Extract<RecordingPreview, { ok: true }> = {
  ok: true,
  title: 'median — a shared session',
  source: 'undefined-session.json',
  summary: '1 function (median), 2 calls, recorded with gpt-6-luna via Codex 0.159.2 on 2026-10-04; the gates will run live in your browser.',
  functions: [{ name: 'median', tests: 5, properties: 2, status: 'same' }],
  calls: ['median([3, 1, 4, 2])', 'median([5, 5, 1])'],
  datasets: [],
  model: 'gpt-6-luna',
  codexVersion: '0.159.2',
  effort: 'low',
  recordedAt: '2026-10-04T15:16:35.783Z',
  canSeed: true,
  replayable: 1,
  skipped: [],
  warning:
    "This recording contains code written by someone else: model-written functions and the test code of the specs. It runs in your browser's sandbox, which limits what it can do but is not a security boundary. Only load recordings from people you trust.",
};

/** Scenarios that open UI-only state (the data drawer, the Repo tab, a dialog) when the fixture engine starts. */
export const SCENARIO_UI: Record<
  string,
  {
    drawer?: boolean;
    tab?: 'revisions' | 'repo';
    added?: () => Array<{ fn: string; id: string; title: string; why: string }>;
    share?: boolean;
    sessionLog?: boolean;
    pending?: () => { input: { text?: string; url?: string; source: string }; preview: RecordingPreview };
    /** Open the Decide block on this attempt's rejection, with a choice already made. */
    decide?: { attempt: number; choice?: string; expr?: string; throws?: boolean; reason?: string };
  }
> = {
  'data-drawer-open': { drawer: true },
  'share-dialog': { share: true },
  'session-log': { sessionLog: true },
  'load-recording': { pending: () => ({ input: { text: '{}', source: FIXTURE_PREVIEW.source }, preview: FIXTURE_PREVIEW }) },
  pinned: { tab: 'repo' },
  'committed-evidence': { tab: 'repo' },
  'decide-median-recertified': { tab: 'repo' },
  'decision-applied': { tab: 'repo' },
  'decide-open': { decide: { attempt: 1, choice: 'tests', reason: 'NaN propagates through our averages' } },
  'decide-custom': { decide: { attempt: 1, choice: 'custom', expr: '-1' } },
  'recheck-failed': {
    added: () => {
      const sug = sortedSuggestion();
      return [{ fn: 'sortNumbers', id: sug.id, title: sug.title, why: sug.why }];
    },
  },
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);
export { TAKEAWAY };
