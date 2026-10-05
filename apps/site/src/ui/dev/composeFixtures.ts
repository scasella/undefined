/**
 * Fixture states for composition and multi-statement REPL lines (DEV ONLY; docs/COMPOSE-DESIGN.md). Built on the REAL
 * slugify example spec and bodies, with dependency stamps from the real compose/graph.ts (so `dependencyStatus` in the
 * UI derives the same status the engine would), the real prompt builder, and compile output captured from the real
 * compile gate.
 *   composed-committed  slugifyAll grown with `titles.map(slugify)`: the Draft says "uses slugify"; the Repo lists it
 *   dependent-stale     Break it on slugify regrew it with underscores (r7); slugifyAll, certified against r2, was
 *                       re-checked with the new slugify and fails its tests: out of date, with a Re-check button
 *   cycle-rejected      slugifyAll's spec changed; uniqueSlugs (which calls it) reached it, so it is being grown, and
 *                       draft #1 called uniqueSlugs back: the compile gate refused the cycle; uniqueSlugs waits
 *   repl-multi          multi-statement lines: one grow mid-line re-ran only its statement; destructuring; an error
 *                       naming its statement
 */
import type { Artifact, AttemptView, EngineState, FunctionRecord, FunctionSpec, GateResult, GenerationView, ReplEntry } from '@scasella/undefined-engine/types';
import { EXAMPLES as REAL_EXAMPLES } from '../../examples';
import { buildPrompt, declarationLine } from '../../shared/prompt';
import { buildSource } from '@scasella/undefined-engine/gates/source';
import { othersFor, stampDeps, type Callable } from '@scasella/undefined-engine/compose/graph';
import { calledByInfo, rerunText } from '../../core/engine';
import {
  baseState,
  candidate,
  eid,
  gate,
  medianAcceptedGates,
  medianArtifact,
  medianGeneration,
  medianPinnable,
  MEDIAN_GOOD,
  MEDIAN_SPEC,
  progressLines,
  revRow,
  RESTARTS,
  T0,
} from './fixtures';

const h = (seed: string): string => seed.repeat(64).slice(0, 64);
const SLUG = REAL_EXAMPLES.find((e) => e.id === 'slugify')!;
export const SLUGIFY_SPEC: FunctionSpec = SLUG.spec!;
const SLUG_OK = SLUG.goodBodies[0]!;
const SLUG_UNDERSCORE = SLUG.goodBodiesAfterBreak[0]!;
const SLUGIFY_BROKEN: FunctionSpec = { ...SLUGIFY_SPEC, ...SLUG.breakPatch } as FunctionSpec;

/** The composed eject fixture's caller (scripts/build.eject.ts SLUGIFY_ALL), shortened to what the UI shows. */
export const SLUGIFY_ALL_SPEC: FunctionSpec = {
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
export const SLUGIFY_ALL_BODY = 'return titles.map((t) => slugify(t));';

const UNIQUE_SLUGS_SPEC: FunctionSpec = {
  name: 'uniqueSlugs',
  params: [{ name: 'titles', type: 'string[]' }],
  returns: 'string[]',
  doc: 'Slugs for a list of titles, in order; a slug seen before gets -2, -3, … appended.',
  tests: String.raw`test('duplicates are numbered', () => {
  eq(uniqueSlugs(['Hello World', 'hello world!', 'Other']), ['hello-world', 'hello-world-2', 'other']);
});`,
  properties: '',
  budgetMs: 1000,
  maxAttempts: 3,
  origin: 'user',
};
const UNIQUE_SLUGS_BODY = `const seen = new Map<string, number>();
return slugifyAll(titles).map((s) => {
  const n = (seen.get(s) ?? 0) + 1;
  seen.set(s, n);
  return n === 1 ? s : \`\${s}-\${n}\`;
});`;

/** The draft the cycle fixture shows, and the compile gate's real verdict on it (captured from compileCandidate). */
export const CYCLE_BODY = 'return uniqueSlugs(titles).map((s) => s.replace(/-\\d+$/, ""));';
export const CYCLE_HEADLINE =
  'Rejected: line 1: slugifyAll cannot call uniqueSlugs: uniqueSlugs already calls slugifyAll (uniqueSlugs → slugifyAll): generated functions cannot call each other in a cycle.';
function cycleGates(): GateResult[] {
  const snippet = CYCLE_BODY;
  return [
    gate('compile', 'fail', '3 errors', {
      ms: 11,
      counts: { passed: 0, total: 1 },
      headline: CYCLE_HEADLINE,
      diagnostics: [
        { kind: 'compile', code: 0, message: 'slugifyAll cannot call uniqueSlugs: uniqueSlugs already calls slugifyAll (uniqueSlugs → slugifyAll): generated functions cannot call each other in a cycle.', category: 'error', line: 1, col: 8, endLine: 1, endCol: 19, snippet },
        { kind: 'compile', code: 2304, message: "Cannot find name 'uniqueSlugs'.", category: 'error', line: 1, col: 8, endLine: 1, endCol: 19, snippet },
        { kind: 'compile', code: 7006, message: "Parameter 's' implicitly has an 'any' type.", category: 'error', line: 1, col: 33, endLine: 1, endCol: 34, snippet },
      ],
    }),
    gate('tests', 'skipped', 'not reached', { note: 'not reached' }),
    gate('properties', 'skipped', 'not reached', { note: 'not reached' }),
    gate('invariants', 'skipped', 'not reached', { note: 'not reached' }),
  ];
}

function slugifyGates(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 188 }),
    gate('tests', 'pass', '9/9 tests passed', { ms: 6, counts: { passed: 9, total: 9 } }),
    gate('properties', 'pass', '3/3 properties held (300 runs)', { ms: 41, counts: { passed: 3, total: 3 } }),
    gate('invariants', 'pass', 'pure ✓ bounded ✓ (24 sampled calls replayed on frozen arguments)', { ms: 7 }),
  ];
}

function slugifyAllGates(): GateResult[] {
  return [
    gate('compile', 'pass', 'compiled, strict', { ms: 152 }),
    gate('tests', 'pass', '2/2 tests passed', { ms: 4, counts: { passed: 2, total: 2 } }),
    gate('properties', 'pass', '1/1 property held (100 runs: "one slug per title" 100)', { ms: 19, counts: { passed: 1, total: 1 } }),
    gate('invariants', 'pass', 'pure ✓ bounded ✓ (14 sampled calls replayed on frozen arguments)', { ms: 5 }),
  ];
}

/** The prompt the engine would send for `spec` in `program` (OTHER FUNCTIONS listed only when something may be called). */
function promptIn(program: EngineState['program'], spec: FunctionSpec, extra: { callArgTypes?: string[] } = {}): string {
  const c: Callable = othersFor(program, spec);
  return buildPrompt({
    spec,
    history: [],
    ...extra,
    ...(c.others.length > 0 ? { others: c.others.map((o) => ({ decl: o.decl, doc: o.doc, ...(o.types.length > 0 ? { types: o.types.map((t) => t.text) } : {}) })) } : {}),
  });
}

function artifactOf(spec: FunctionSpec, body: string, revision: number, gates: GateResult[], prompt: string, seeds: [string, string]): Artifact {
  const c = { ...candidate(1, body, gates, ''), prompt };
  return {
    body,
    source: buildSource(spec, body).source,
    js: `function ${spec.name}(${spec.params.map((p) => p.name).join(', ')}) {\n${body}\n}`,
    returnType: spec.returns ?? 'unknown',
    specHash: h(seeds[0]),
    testsHash: h(seeds[1]),
    model: 'gpt-6-luna',
    codexVersion: '0.157.2',
    committedAt: T0 + revision * 60_000,
    candidates: [c],
    revision,
    evidence: {
      compiled: true,
      unitTests: gates[1]!.counts?.total ?? 0,
      pinnedTests: 0,
      properties: gates[2]!.status === 'pass' ? [{ name: spec.name === 'slugifyAll' ? 'one slug per title' : 'output is a slug', runs: 100 }] : [],
      sampledCalls: 14,
    },
  };
}

function record(spec: FunctionSpec, artifact: Artifact | null, seeds: [string, string]): FunctionRecord {
  return { spec, specHash: h(seeds[0]), testsHash: h(seeds[1]), artifact };
}

/** slugify r2, then slugifyAll r3 calling it, stamped against slugify r2 by the real graph. */
function composedProgram(): EngineState['program'] {
  const program: EngineState['program'] = { functions: {} };
  program.functions.median = record(MEDIAN_SPEC, null, ['a3', '7c']);
  program.functions.slugify = record(SLUGIFY_SPEC, artifactOf(SLUGIFY_SPEC, SLUG_OK, 2, slugifyGates(), promptIn(program, SLUGIFY_SPEC), ['51', '52']), ['51', '52']);
  const prompt = promptIn(program, SLUGIFY_ALL_SPEC, {});
  const all = artifactOf(SLUGIFY_ALL_SPEC, SLUGIFY_ALL_BODY, 3, slugifyAllGates(), prompt, ['a1', 'a2']);
  all.deps = stampDeps(program, ['slugify']);
  program.functions.slugifyAll = record(SLUGIFY_ALL_SPEC, all, ['a1', 'a2']);
  return program;
}

/** A function, not a constant: fixtures.ts imports this module before its own constants (T0) exist. */
const composedRevs = () => [
  revRow({ id: 1, kind: 'init', title: 'empty program with 3 example specs' }, 3, 0),
  revRow({ id: 2, kind: 'commit', fn: 'slugify', title: 'slugify certified (attempt 1 of 3)' }, 3, 1),
  revRow({ id: 3, kind: 'commit', fn: 'slugifyAll', title: 'slugifyAll certified (attempt 1 of 3); calls slugify' }, 4, 2),
];

const ALL_CALL = 'slugifyAll(["Hello World", "Crème Brûlée"])';

function slugifyAllGeneration(attempts: AttemptView[], extra: Partial<GenerationView>): GenerationView {
  return {
    ...medianGeneration(attempts, extra),
    id: 'g-all',
    fn: 'slugifyAll',
    signature: declarationLine(SLUGIFY_ALL_SPEC),
    call: ALL_CALL,
    ...extra,
  };
}

function composedCommitted(): EngineState {
  const s = baseState();
  s.hints.opener = false;
  s.replInput = '';
  s.program = composedProgram();
  s.revisions = [...composedRevs()];
  s.headRevision = 3;
  const a = s.program.functions.slugifyAll!.artifact!;
  s.repl = [
    { kind: 'input', id: eid('in'), text: 'slugify("Hello, World! Crème Brûlée")' },
    { kind: 'output', id: eid('out'), value: '"hello-world-creme-brulee"', ms: 0.3, label: 'generated', detail: 'revision 2' },
    { kind: 'input', id: eid('in'), text: ALL_CALL },
    { kind: 'error', id: eid('er'), name: 'ReferenceError', message: 'slugifyAll is not defined' },
    { kind: 'info', id: eid('if'), text: 'Generating…', tone: 'accent' },
    { kind: 'output', id: eid('out'), value: '["hello-world", "creme-brulee"]', ms: 0.4, label: 'generated', detail: 'revision 3' },
  ];
  s.generation = slugifyAllGeneration(
    [{ attempt: 1, status: 'accepted', shown: SLUGIFY_ALL_BODY, gates: a.candidates[0]!.gates, candidate: a.candidates[0]!, uses: ['slugify'] }],
    { phase: 'committed', attempt: 1, revision: 3 },
  );
  return s;
}

/** Break it on slugify (r5 spec, r7 underscore body); slugifyAll's eager re-check with the new slugify fails its tests. */
function dependentStale(): EngineState {
  const s = composedCommitted();
  const program = s.program;
  const broken = artifactOf(SLUGIFY_BROKEN, SLUG_UNDERSCORE, 5, slugifyGates(), promptIn(program, SLUGIFY_BROKEN), ['5b', '5c']);
  program.functions.slugify = record(SLUGIFY_BROKEN, broken, ['5b', '5c']);
  s.revisions = [
    ...composedRevs(),
    revRow({ id: 4, kind: 'spec-edit', fn: 'slugify', title: 'Break it: underscores — slugify spec edited: doc, tests, properties', detail: 'artifact r2 is now stale' }, 4, 1),
    revRow({ id: 5, kind: 'commit', fn: 'slugify', title: 'slugify certified (attempt 1 of 3)' }, 4, 2),
  ];
  s.headRevision = 5;
  const all = program.functions.slugifyAll!.artifact!;
  const headline = 'Rejected: test "each title" failed: slugifyAll(["Hello World", "Crème Brûlée"]) returned ["hello_world", "creme_brulee"], expected ["hello-world", "creme-brulee"]';
  const gates: GateResult[] = [
    gate('compile', 'pass', 'compiled, strict', { ms: 149 }),
    gate('tests', 'fail', '1/2 tests passed', {
      ms: 5,
      counts: { passed: 1, total: 2 },
      headline,
      diagnostics: [
        { kind: 'test', name: 'each title', call: 'slugifyAll(["Hello World", "Crème Brûlée"])', expected: '["hello-world", "creme-brulee"]', actual: '["hello_world", "creme_brulee"]', message: 'expected ["hello-world", "creme-brulee"], got ["hello_world", "creme_brulee"]' } as GateResult['diagnostics'][number],
      ],
    }),
    gate('properties', 'skipped', 'not reached', { note: 'not reached' }),
    gate('invariants', 'skipped', 'not reached', { note: 'not reached' }),
  ];
  const c = { ...candidate(1, all.body, gates, ''), prompt: all.candidates[0]!.prompt, verdict: 'rejected' as const, rejectedBy: 'tests' as const, headline };
  const what = 'slugify changed r2 → r5';
  s.generation = {
    ...slugifyAllGeneration([{ attempt: 1, status: 'rejected', shown: all.body, gates, candidate: c, uses: ['slugify'] }], {}),
    id: 'g-dep-recheck',
    phase: 'failed',
    attempt: 1,
    maxAttempts: 1,
    progress: [],
    call: 'slugifyAll (committed r3)',
    kind: 'recheck',
    recheck: { reason: `${what}: re-checked with the new slugify`, callees: { names: ['slugify'], what } },
  };
  s.repl.push(
    { kind: 'input', id: eid('in'), text: 'slugify("Hello, World! Crème Brûlée")' },
    { kind: 'error', id: eid('er'), name: 'ReferenceError', message: 'slugify is not defined' },
    { kind: 'info', id: eid('if'), text: 'Generating…', tone: 'accent' },
    { kind: 'output', id: eid('out'), value: '"hello_world_creme_brulee"', ms: 0.3, label: 'generated', detail: 'revision 5' },
    {
      kind: 'info',
      id: eid('if'),
      text: `slugifyAll is out of date: with the new slugify it fails its checks (${headline}). It does not run; the next call regrows it.`,
      tone: 'warn',
    },
  );
  return s;
}

/** uniqueSlugs (r4) calls slugifyAll; slugifyAll's spec changed (r5); a call of uniqueSlugs reached it; draft #1 cycles. */
function cycleRejected(): EngineState {
  const s = baseState();
  s.hints.opener = false;
  s.replInput = '';
  s.busy = true;
  const program = composedProgram();
  const uniq = artifactOf(UNIQUE_SLUGS_SPEC, UNIQUE_SLUGS_BODY, 4, slugifyAllGates().map((g) => (g.gate === 'tests' ? { ...g, summary: '1/1 test passed', counts: { passed: 1, total: 1 } } : g.gate === 'properties' ? gate('properties', 'skipped', 'no properties yet', { note: 'no properties yet — add one to make the gate stricter' }) : g)), promptIn(program, UNIQUE_SLUGS_SPEC), ['b1', 'b2']);
  uniq.deps = stampDeps(program, ['slugifyAll']);
  program.functions.uniqueSlugs = record(UNIQUE_SLUGS_SPEC, uniq, ['b1', 'b2']);
  // the user edited slugifyAll's doc: its artifact no longer counts, and uniqueSlugs waits for it
  const edited: FunctionSpec = { ...SLUGIFY_ALL_SPEC, doc: 'Slugs for a list of titles, in order. Empty titles are dropped.' };
  program.functions.slugifyAll = { ...program.functions.slugifyAll!, spec: edited, specHash: h('a9') };
  s.program = program;
  s.revisions = [
    ...composedRevs(),
    revRow({ id: 4, kind: 'commit', fn: 'uniqueSlugs', title: 'uniqueSlugs certified (attempt 1 of 3); calls slugifyAll' }, 5, 3),
    revRow({ id: 5, kind: 'spec-edit', fn: 'slugifyAll', title: 'slugifyAll spec edited: doc', detail: 'artifact r3 is now stale; uniqueSlugs waits for it' }, 5, 3),
  ];
  s.headRevision = 5;
  const call = 'uniqueSlugs(["Hello World", "hello world!"])';
  s.repl = [
    { kind: 'input', id: eid('in'), text: call },
    { kind: 'error', id: eid('er'), name: 'ReferenceError', message: 'slugifyAll is not defined' },
    { kind: 'info', id: eid('if'), text: calledByInfo('slugifyAll', 'uniqueSlugs') },
    { kind: 'info', id: eid('if'), text: 'Generating…', tone: 'accent' },
  ];
  const prompt = promptIn(program, edited);
  const c1 = { ...candidate(1, CYCLE_BODY, cycleGates(), 'Reuses uniqueSlugs and strips the numeric suffix.'), prompt };
  const attempts: AttemptView[] = [
    { attempt: 1, status: 'rejected', shown: CYCLE_BODY, gates: c1.gates, candidate: c1 },
    { attempt: 2, status: 'generating', shown: '', gates: [] },
  ];
  s.generation = {
    ...slugifyAllGeneration(attempts, {}),
    id: 'g-cycle',
    signature: declarationLine(edited),
    call: 'slugifyAll(["Hello World", "hello world!"]) (called by uniqueSlugs)',
    phase: 'generating',
    attempt: 2,
    progress: progressLines().slice(0, 2),
  };
  return s;
}

/** Multi-statement lines after the opening grow: one grow mid-line, destructuring, an error naming its statement. */
function replMulti(): EngineState {
  const s = baseState();
  s.hints.opener = false;
  s.replInput = '';
  s.program.functions.median = { spec: MEDIAN_SPEC, specHash: h('a3'), testsHash: h('7c'), artifact: medianArtifact(2) };
  s.headRevision = 2;
  s.revisions = [
    revRow({ id: 1, kind: 'init', title: 'empty program with 3 example specs' }, 3, 0),
    revRow({ id: 2, kind: 'commit', fn: 'median', title: 'median certified (attempt 1 of 3)' }, 3, 1),
  ];
  const line1 = 'n = 0; xs = [3, 1, 4, 2]; n = n + 1; m = median(xs)';
  const line2 = 'const [lo, hi] = [median([5, 5, 1]), median(xs)]; lo + hi';
  const line3 = 'ok = median([1]); bad = median([]); n = n + 1';
  const entries: ReplEntry[] = [
    { kind: 'input', id: eid('in'), text: line1 },
    { kind: 'error', id: eid('er'), name: 'ReferenceError', message: 'median is not defined' },
    { kind: 'info', id: eid('if'), text: 'Generating…', tone: 'accent' },
    { kind: 'info', id: eid('if'), text: rerunText(3, 4) },
    { kind: 'output', id: eid('out'), value: '2.5', ms: 0.4, label: 'generated', detail: 'revision 2', pinnable: medianPinnable('[3, 1, 4, 2]', 2.5) },
    { kind: 'input', id: eid('in'), text: line2 },
    { kind: 'output', id: eid('out'), value: '7.5', ms: 0.2, label: 'cached artifact' },
    { kind: 'input', id: eid('in'), text: line3 },
    {
      kind: 'error',
      id: eid('er'),
      name: 'RangeError',
      message: 'median([]) threw RangeError: median of an empty list (statement 2 of 3)',
      restarts: RESTARTS,
    },
  ];
  s.repl = entries;
  s.env = { n: '1', xs: '[3, 1, 4, 2]', m: '2.5', lo: '5', hi: '2.5', ok: '1' };
  s.generation = medianGeneration([{ ...candidateAttempt() }], { phase: 'committed', attempt: 1, revision: 2, call: 'median(xs)' });
  return s;
}

function candidateAttempt(): AttemptView {
  const c = candidate(1, MEDIAN_GOOD, medianAcceptedGates(), 'sorted copy; mean of the two middle values for an even count');
  return { attempt: 1, status: 'accepted', shown: MEDIAN_GOOD, gates: c.gates, candidate: c };
}

export const COMPOSE_SCENARIOS: Record<string, () => EngineState> = {
  'composed-committed': composedCommitted,
  'dependent-stale': dependentStale,
  'cycle-rejected': cycleRejected,
  'repl-multi': replMulti,
};
