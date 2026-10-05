/**
 * Byte identity of a program with no dependencies between functions (docs/COMPOSE-DESIGN.md §0).
 *
 * Every literal below was captured at HEAD 4efd1ff BEFORE any Phase 3 code existed (prompt module, compile gate and
 * image untouched). Composition may change prompts and compile inputs ONLY when other certified functions exist; with
 * zero others every byte must stay as it was, or the shipped recordings and their "what the model saw" stop being true.
 *
 * Capture mode: `GOLDEN_CAPTURE=1 npx vitest run src/compose/golden.test.ts` prints the current values instead of
 * asserting (only ever run on a HEAD build).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Decision, FunctionSpec, GateResult, Program, Revision } from '../types';
import { toImage } from '../core/store';
import { buildPrompt, type PromptInput } from '../shared/prompt';
import { buildSource, specFromCall } from '../gates/source';
import { compileCandidate, warmUp } from '../gates/compile';
import { EXAMPLES } from '../examples';
import { buildDecision } from '../decide/decisions';
import { specWithDecisions } from '../core/program';
import { encodeValue } from '../shared/serialize';

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const CAPTURE = process.env.GOLDEN_CAPTURE === '1';

const ex = (id: string): FunctionSpec => EXAMPLES.find((e) => e.id === id)!.spec!;
const good = (id: string): string => EXAMPLES.find((e) => e.id === id)!.goodBodies[0]!;

const gate = (g: Partial<GateResult> & Pick<GateResult, 'gate' | 'status'>): GateResult => ({ ms: 12, summary: '', diagnostics: [], ...g });

const AT = Date.UTC(2026, 9, 4, 12);
const nanDecision = (): Decision =>
  buildDecision({
    fn: 'median',
    kind: 'empty',
    args: [[]],
    ruling: { kind: 'outcome', outcome: { returns: encodeValue(NaN) } },
    answers: { check: 'agrees with a sort-based reference', checkKind: 'property', silentOn: 'what the median of nothing is', gate: 'properties' },
    expected: { returns: encodeValue(NaN) },
    decidedAt: AT,
  });
const throwsDecision = (): Decision =>
  buildDecision({
    fn: 'median',
    kind: 'empty',
    args: [[]],
    ruling: { kind: 'outcome', outcome: { throws: true } },
    answers: { check: 'agrees with a sort-based reference', checkKind: 'property', silentOn: 'what the median of nothing is', gate: 'properties' },
    expected: { returns: encodeValue(NaN) },
    decidedAt: AT,
  });

const ROW = 'type Row = { customer: string; total: number }';

/** The prompt inputs whose bytes must not move: every example, every section kind. */
function promptCases(): Record<string, PromptInput> {
  const median = ex('median');
  const history: PromptInput['history'] = [
    { attempt: 1, body: 'return numbers[0]!;', gates: [], headline: 'Rejected: median([1, 2]) returned 1, expected 1.5' },
    {
      attempt: 2,
      body: 'const s = numbers.sort();\nreturn s[0]!;',
      gates: [
        gate({ gate: 'compile', status: 'pass' }),
        gate({ gate: 'tests', status: 'pass', counts: { passed: 2, total: 2 } }),
        gate({ gate: 'properties', status: 'skipped', note: 'interrupted: invariant violated' }),
        gate({
          gate: 'invariants',
          status: 'fail',
          diagnostics: [{ kind: 'invariant', invariant: 'pure', message: 'candidate mutated its argument', call: 'median([2, 1])', phase: 'properties' }],
        }),
      ],
    },
  ];
  const compileFail: PromptInput['history'] = [
    {
      attempt: 1,
      body: 'return "x";',
      gates: [
        gate({
          gate: 'compile',
          status: 'fail',
          diagnostics: [
            { kind: 'compile', code: 2322, message: "Type 'string' is not assignable to type 'number'.", category: 'error', line: 1, col: 1, endLine: 1, endCol: 12, snippet: 'return "x";' },
          ],
        }),
        gate({ gate: 'tests', status: 'skipped' }),
        gate({ gate: 'properties', status: 'skipped' }),
        gate({ gate: 'invariants', status: 'skipped' }),
      ],
    },
  ];
  const decided = specWithDecisions(median, [nanDecision()]);
  return {
    median: { spec: median, history: [] },
    slugify: { spec: ex('slugify'), history: [] },
    fibonacci: { spec: ex('fibonacci'), history: [] },
    'call slugifyAll': { spec: specFromCall('slugifyAll', ['string[]']), callArgTypes: ['string[]'], history: [] },
    'call no args': { spec: specFromCall('now', []), callArgTypes: [], history: [] },
    'dataset topCustomersByRevenue': {
      spec: specFromCall('topCustomersByRevenue', ['Row[]'], { typeDecls: ROW }),
      callArgTypes: ['Row[]'],
      history: [],
      dataSamples: [{ name: 'rows', typeName: 'Row', rowCount: 3 }],
    },
    'dataset with samples': {
      spec: specFromCall('topCustomersByRevenue', ['Row[]'], { typeDecls: ROW }),
      callArgTypes: ['Row[]'],
      history: [],
      dataSamples: [{ name: 'rows', typeName: 'Row', rowCount: 1200, sampleText: '[{"customer":"Ada","total":12.5}]' }],
    },
    'median retry history': { spec: median, history },
    'slugify compile retry': { spec: ex('slugify'), history: compileFail },
    'median runtime fault': {
      spec: median,
      history: [],
      runtimeFault: { call: 'median([])', errorName: 'TypeError', message: 'cannot read\nproperty', previousBody: 'return numbers[0].valueOf();' },
    },
    'median decisions': { spec: decided, history: [] },
    'median decisions + retry': { spec: specWithDecisions(median, [throwsDecision()]), history },
    'median ruling': {
      spec: decided,
      history: [],
      ruling: {
        body: 'return numbers[0]!;',
        decision: nanDecision(),
        gates: [gate({ gate: 'compile', status: 'pass' }), gate({ gate: 'tests', status: 'fail', counts: { passed: 1, total: 2 }, diagnostics: [{ kind: 'test', name: 'x', message: 'm', call: 'median([])', expected: 'NaN', actual: 'undefined' }] })],
      },
    },
    'median inferred return': { spec: { ...median, returns: null }, history: [] },
  };
}

const PROMPTS: Record<string, string> = {
  median: '74f6806c83c87eb332386bb37a84d0ac63a5ce095d6f008dc80e546f37bf13c3',
  slugify: '8790b07138325d315c4eb7dec29775b0e7e44f155c50a4a59c65cf07950e3bb6',
  fibonacci: 'ddf6d585b08aedf13126695f27e39b005a21cde1f9be36e10b231695546a0a4d',
  'call slugifyAll': 'e7d0da9fafadf852167ba741e125a9c14bc8656482031e32f8ecd362732fea80',
  'call no args': '59fb14a13422c8d2f7f32eae70a7be7637c663f6831a45493f9795780c6a8f51',
  'dataset topCustomersByRevenue': 'd11bf8650599bef87dab16bb69f8a3b9b52ffca04947652ad8afcd0165fe6cbf',
  'dataset with samples': '7eda0d5470034d95c70080aea3986a84ab3d45594115872b3952189d0b44c4ee',
  'median retry history': 'd93f83d364a0fe5a8b044d1e0b11bd6782b4459f2d0198ca00612342e0e960e4',
  'slugify compile retry': 'ffc38643aac2e41a928703c6b38b630595fe62a4884e23f72c0741c31e563af4',
  'median runtime fault': '6b318e933381e13fdc015916836a7161a9c20883d928c9e03a43556c93590244',
  'median decisions': '746697292f555f4ecaf142b4636a3f6417a73e1967cc9d39066227728a6eda49',
  'median decisions + retry': '1b94808598d8f119e382e1e4b7ba11c62238c6f29ad694db311568cca04cc9ba',
  'median ruling': 'da8de4a62959d9b2c9fd48cc1a6c99bd84628c5cd6b56f1fbd1e05e3941e5938',
  'median inferred return': 'd77d0cfcbf97c09b592869ff3890dc52be74c8bc5e631cb9b8e7b6fe449e73f1',
};

/** Programs whose functions call nothing: the image keeps its version and every artifact its exact shape. */
describe('zero dependencies: images and artifacts', () => {
  it('toImage of a program without deps is version 1 (2 with decisions), and no artifact gains a deps key', () => {
    const rev = (program: Program): Revision => ({ id: 1, at: 0, kind: 'init', title: 't', program, env: {} });
    const a = { body: 'return 1;', source: 's', js: 'j', returnType: 'number', specHash: 'x', testsHash: 'y', model: 'm', codexVersion: 'c', committedAt: 0, candidates: [], revision: 1 };
    const median = ex('median');
    const plain: Program = { functions: { median: { spec: median, specHash: 'x', testsHash: 'y', artifact: a } } };
    expect(toImage([rev(plain)], 1).version).toBe(1);
    expect(toImage([rev({ functions: { median: { ...plain.functions.median!, spec: specWithDecisions(median, [nanDecision()]) } } })], 1).version).toBe(2);
    expect(JSON.stringify(toImage([rev(plain)], 1).revisions)).not.toContain('"deps"');
  });
});

const SOURCES: Record<string, { source: string; js: string; returnType: string }> = {
  median: { source: '78483c39148bd131dd16a5e6608335b306700a3ff8cd991ae2714727c220bb6c', js: '524a84cee64e870b96ba1f3e9c2712a937d04adfb3b588ced10e46e4363bc4f6', returnType: 'number' },
  slugify: { source: 'b550e7f831169b6202f816840d91743b91e1f35a623a98c5678fcc7a56e0f2df', js: '9211a8c43b595fafcad33a015a56568010433724e801a892fa21deaabc948bcf', returnType: 'string' },
  fibonacci: { source: '8f3c387ac0ff83abe8814a5ac0316f6ecb85fdfe0bcb2b361b1aa7edf36ad572', js: '6a513a302fc470be2022544c76f9e6e0a3df75fcb8d67403d9ba89ea3a98c0e0', returnType: 'bigint' },
};

describe('zero other functions: prompts are byte-identical to HEAD', () => {
  for (const [name, input] of Object.entries(promptCases())) {
    it(name, () => {
      const p = buildPrompt(input);
      if (CAPTURE) {
        console.log(`PROMPT ${JSON.stringify(name)}: '${sha(p)}',`);
        return;
      }
      expect(sha(p), name).toBe(PROMPTS[name]);
      expect(p).not.toContain('OTHER FUNCTIONS');
      // an empty list of other functions is no list at all
      expect(buildPrompt({ ...input, others: [] })).toBe(p);
    });
  }
});

describe('zero other functions: compiled source and JS are byte-identical to HEAD', () => {
  beforeAll(async () => {
    await warmUp();
  }, 60_000);
  for (const id of ['median', 'slugify', 'fibonacci']) {
    it(id, async () => {
      const spec = ex(id);
      const out = await compileCandidate(spec, good(id));
      expect(out.gate.status).toBe('pass');
      const got = { source: sha(buildSource(spec, good(id)).source), js: sha(out.js ?? ''), returnType: out.returnType };
      if (CAPTURE) {
        console.log(`SOURCE ${id}: ${JSON.stringify(got)},`);
        return;
      }
      expect(got).toEqual(SOURCES[id]);
      // an empty context is no context
      const empty = await compileCandidate(spec, good(id), { others: [], unavailable: [] });
      expect([empty.js, empty.source, empty.returnType, empty.deps, empty.ambient]).toEqual([out.js, out.source, out.returnType, [], undefined]);
    });
  }
});
