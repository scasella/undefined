/**
 * Proves, with the REAL compile gate and the REAL gate executor, that every example's gates accept its known-good
 * bodies and reject each known-bad body at the stated gate with a readable "Rejected: …" headline.
 *
 * Property-derived headlines depend on the fast-check seed, which is derived from the spec/tests hashes: any edit
 * to an example's doc, tests or properties may change the shrunk counterexample, and the exact strings below must
 * then be refreshed (the printed table at the end of the run shows the new ones).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FunctionSpec, GateId, GateResult } from '@scasella/undefined-engine/types';
import { GATE_ORDER } from '@scasella/undefined-engine/types';
import { compileCandidate, transpileUserCode, warmUp } from '@scasella/undefined-engine/gates/compile';
import { executeGates, type ExecGateInput } from '@scasella/undefined-engine/sandbox/gateExecutor';
import { timeoutResults } from '../sandbox/gateRunner';
import { evalMasked } from '@scasella/undefined-engine/sandbox/mask';
import { gateSeed, hashesFor } from '@scasella/undefined-engine/shared/hash';
import { show } from '@scasella/undefined-engine/shared/show';
import { listTestNames } from '@scasella/undefined-engine/shared/specInfo';
import { brokenSpec, EXAMPLES, exampleById, INITIAL_EXAMPLE_ID, type ExampleDef } from './index';
import { ORDERS_FN, ORDERS_GOOD, ORDERS_NAIVE, ordersCallSpec } from './orders';
import { parseCsv } from '../data/csv';
import { coerceCsvRows, inferDataset } from '../data/infer';
import { BUNDLED_ORDERS_CSV } from '../data/orders';

/** Examples that carry a spec (all but the spec-less orders example, tested on its own below). */
type SpecExample = ExampleDef & { spec: FunctionSpec };
const SPEC_EXAMPLES = EXAMPLES.filter((e): e is SpecExample => e.spec !== undefined);
function specEx(id: string): SpecExample {
  const ex = exampleById(id);
  if (!ex?.spec) throw new Error(`${id} is not an example with a spec`);
  return ex as SpecExample;
}

// ───────── helpers ─────────

interface Verdict {
  gates: GateResult[];
  /** First failing gate, if any. */
  rejectedBy?: GateId;
  headline?: string;
  js: string | null;
}

/** Real arguments of the pre-typed call, e.g. `median([3, 1, 4, 2])` → [[3, 1, 4, 2]]. */
function callArgs(ex: ExampleDef): unknown[] {
  const open = `${ex.fn}(`;
  expect(ex.call.startsWith(open) && ex.call.endsWith(')')).toBe(true);
  return new Function(`return [${ex.call.slice(open.length, -1)}];`)() as unknown[];
}

function userJs(src: string): string {
  const out = transpileUserCode(src);
  expect(out.error, `spec source does not transpile: ${out.error}`).toBeUndefined();
  return out.js;
}

/** Compile gate only (used for bodies that must never run in Node). */
async function compileOnly(spec: FunctionSpec, body: string): Promise<GateResult> {
  return (await compileCandidate(spec, body)).gate;
}

/** All four gates, exactly as the browser pipeline orders them (minus the Worker watchdog). */
async function runGates(spec: FunctionSpec, body: string, args?: unknown[]): Promise<Verdict> {
  const compiled = await compileCandidate(spec, body);
  if (compiled.gate.status === 'fail' || compiled.js === null) {
    const skipped = (['tests', 'properties', 'invariants'] as const).map(
      (gate): GateResult => ({ gate, status: 'skipped', ms: 0, summary: 'not reached', diagnostics: [], note: 'not reached' }),
    );
    return { gates: [compiled.gate, ...skipped], rejectedBy: 'compile', headline: compiled.gate.headline, js: null };
  }
  const { specHash, testsHash } = await hashesFor(spec);
  const input: ExecGateInput = {
    name: spec.name,
    js: compiled.js,
    testsJs: userJs(spec.tests),
    propertiesJs: userJs(spec.properties),
    budgetMs: spec.budgetMs,
    seed: gateSeed(specHash, testsHash),
    callArgs: args,
  };
  const exec = executeGates(input, { phase: () => {}, enter: () => {}, leave: () => {} });
  const gates = [compiled.gate, ...exec];
  const failed = gates.find((g) => g.status === 'fail');
  return { gates, rejectedBy: failed?.gate, headline: failed?.headline, js: compiled.js };
}

const statuses = (gs: GateResult[]): string[] => gs.map((g) => `${g.gate}:${g.status}`);

const printed: string[] = [];

// ───────── exact headlines produced by the bad bodies (keep in sync; see header comment) ─────────

const EXPECTED_HEADLINES: Record<string, string[]> = {
  median: [
    'Rejected: median([2, 0, 100]) returned 100, expected 2', // property (seed-dependent)
    'Rejected: median([1, 2]) returned 2, expected 1.5',
    'Rejected: median([]) threw Error: empty list, expected NaN',
    'Rejected: median([3, 1, 4, 2]) mutated its argument (pure)',
  ],
  slugify: [
    'Rejected: slugify("Straße") returned "stra-e", expected "strasse"',
    'Rejected: slugify("Smørrebrød") returned "sm-rrebr-d", expected "smorrebrod"',
    'Rejected: slugify("Don\'t Stop") returned "don-t-stop", expected "dont-stop"',
    'Rejected: slugify("  ...Hello, World!!  ") returned "-hello-world-", expected "hello-world"',
    'Rejected: property "output is lowercase letters and digits joined by single hyphens" failed for slugify("_")', // property (seed-dependent)
  ],
  fibonacci: [
    // browser-only (simulated below): the O(n) loop → 'Rejected: fibonacci(1000000) did not return within 1500 ms (bounded)'
    // and the naive recursion → 'Rejected: fibonacci(90) did not return within 1500 ms (bounded)'
    'Rejected: fibonacci(90) returned 2880067194370816000n, expected 2880067194370816120n',
    "Rejected: line 6: Type 'number' is not assignable to type 'bigint'.",
    'Rejected: fibonacci(0) returned 1n, expected 0n',
  ],
};

// ───────── tests ─────────

beforeAll(async () => {
  await warmUp();
}, 60_000);

afterAll(() => {
  // One readable table of what the gates say, for humans reviewing the examples.
  console.log(`\nExample rejection headlines:\n${printed.join('\n')}\n`);
});

describe('EXAMPLES registry', () => {
  it('lists median, slugify, fibonacci, orders in order and starts with median', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(['median', 'slugify', 'fibonacci', 'orders']);
    expect(SPEC_EXAMPLES.map((e) => e.id)).toEqual(['median', 'slugify', 'fibonacci']);
    expect(INITIAL_EXAMPLE_ID).toBe('median');
    expect(exampleById(INITIAL_EXAMPLE_ID)).toBe(EXAMPLES[0]);
    expect(exampleById('nope')).toBeUndefined();
  });

  for (const ex of SPEC_EXAMPLES) {
    describe(ex.id, () => {
      it('is a well-formed example spec', () => {
        expect(ex.fn).toBe(ex.spec.name);
        expect(ex.title).not.toBe('');
        expect(ex.blurb).not.toBe('');
        expect(ex.breakIt.label).toMatch(/^Break it/);
        expect(ex.breakIt.description).not.toBe('');
        expect(ex.spec.origin).toBe('example');
        expect(ex.spec.exampleId).toBe(ex.id);
        expect(ex.spec.maxAttempts).toBe(3);
        // Docs may be terse; where the hidden checks hold a convention the doc does not state, the check is marked
        // silentOn (asserted per bad body below). Never empty.
        expect(ex.spec.doc.trim()).not.toBe('');
        expect(ex.call.startsWith(`${ex.fn}(`)).toBe(true);
        expect(ex.goodBodies.length).toBeGreaterThanOrEqual(1);
        expect(ex.badBodies.length).toBeGreaterThanOrEqual(2);
        expect(ex.goodBodiesAfterBreak.length).toBeGreaterThanOrEqual(1);
        for (const b of ex.badBodies) expect(b.why).not.toBe('');
        // Bodies are bodies: no signature, no fences.
        for (const body of [...ex.goodBodies, ...ex.goodBodiesAfterBreak, ...ex.badBodies.map((b) => b.body)]) {
          expect(body).not.toMatch(/^\s*(export\s+)?function\s+\w+\s*\(/);
          expect(body).not.toContain('```');
        }
      });

      it('has named unit tests and properties that listTestNames finds, before and after the break', () => {
        for (const spec of [ex.spec, brokenSpec(ex)]) {
          const tests = listTestNames(spec.tests);
          const props = listTestNames(spec.properties);
          expect(tests.length).toBeGreaterThanOrEqual(3);
          expect(props.length).toBeGreaterThanOrEqual(2);
          for (const n of [...tests, ...props]) expect(n.trim()).not.toBe('');
          expect(new Set([...tests, ...props]).size).toBe(tests.length + props.length);
        }
      });

      it('"break it" changes a hash and the documented contract', async () => {
        const before = await hashesFor(ex.spec);
        const after = await hashesFor(brokenSpec(ex));
        expect(before.specHash !== after.specHash || before.testsHash !== after.testsHash).toBe(true);
        expect(ex.breakPatch.doc).toBeDefined();
        expect(ex.breakPatch.doc).not.toBe(ex.spec.doc);
        expect(brokenSpec(ex).exampleId).toBe(ex.id);
      });

      it('accepts every good body through all four gates, and the pre-typed call gives the right value', async () => {
        const args = callArgs(ex);
        for (const body of ex.goodBodies) {
          const v = await runGates(ex.spec, body, args);
          expect(statuses(v.gates), `${ex.id} good body rejected: ${v.headline}\n${body}`).toEqual(
            GATE_ORDER.map((g) => `${g}:pass`),
          );
          const fn = evalMasked<(...a: unknown[]) => unknown>(v.js!, ex.fn);
          expect(show(fn(...args))).toBe(PRETYPED_RESULT[ex.id]);
        }
      }, 60_000);

      it('rejects every bad body at the stated gate with a "Rejected: …" headline', async () => {
        const args = callArgs(ex);
        const headlines: string[] = [];
        for (const bad of ex.badBodies) {
          if (bad.browserOnly) {
            // A hang can only be stopped by the Worker watchdog; in Node we prove it is not a compile problem.
            const gate = await compileOnly(ex.spec, bad.body);
            expect(gate.status, `${ex.id} browser-only bad body must compile: ${gate.headline}`).toBe('pass');
            printed.push(`  ${ex.id.padEnd(9)} ${bad.rejectedBy.padEnd(10)} (browser only, not run in Node: ${bad.why})`);
            continue;
          }
          const v = await runGates(ex.spec, bad.body, args);
          expect(v.rejectedBy, `${ex.id}: expected ${bad.rejectedBy} to reject (${bad.why}); got ${statuses(v.gates).join(' ')}\n${bad.body}`).toBe(bad.rejectedBy);
          expect(v.headline).toMatch(/^Rejected: /);
          // Exactly one gate fails; the ones before it passed.
          expect(v.gates.filter((g) => g.status === 'fail').map((g) => g.gate)).toEqual([bad.rejectedBy]);
          const at = GATE_ORDER.indexOf(bad.rejectedBy);
          for (const g of v.gates.slice(0, at)) expect(g.status === 'pass' || g.status === 'skipped').toBe(true);
          // Who held the contract: the marker is on the rejecting diagnostic exactly when this body's mistake is a
          // convention the doc is silent on, and never otherwise.
          const diag = v.gates.find((g) => g.status === 'fail')!.diagnostics[0]!;
          const silentOn = 'silentOn' in diag ? diag.silentOn : undefined;
          expect(silentOn, `${ex.id}: silentOn on the rejection of\n${bad.body}`).toBe(bad.silentOn);
          if (silentOn !== undefined) {
            expect('reasonable' in diag && typeof diag.reasonable === 'string' && diag.reasonable !== '').toBe(true);
            expect(v.headline).not.toContain(silentOn); // the headline is never rewritten
          }
          headlines.push(v.headline!);
          printed.push(`  ${ex.id.padEnd(9)} ${bad.rejectedBy.padEnd(10)} ${v.headline}`);
        }
        expect(headlines).toEqual(EXPECTED_HEADLINES[ex.id]);
      }, 60_000);

      it('after "break it": new good bodies pass, the old good bodies are genuinely wrong', async () => {
        const spec = brokenSpec(ex);
        const args = callArgs(ex);
        for (const body of ex.goodBodiesAfterBreak) {
          const v = await runGates(spec, body, args);
          expect(statuses(v.gates), `${ex.id} after-break body rejected: ${v.headline}\n${body}`).toEqual(
            GATE_ORDER.map((g) => `${g}:pass`),
          );
        }
        for (const body of ex.goodBodies) {
          const v = await runGates(spec, body, args);
          expect(v.rejectedBy, `${ex.id}: old good body still passes the broken spec\n${body}`).toBe('tests');
          printed.push(`  ${ex.id.padEnd(9)} after break, old artifact: ${v.headline}`);
        }
      }, 60_000);
    });
  }
});

describe('"the spec was silent" markers name only the case the doc did not cover', () => {
  const badBody = (id: string, pattern: RegExp): string => {
    const matches = specEx(id).badBodies.filter((b) => pattern.test(b.body));
    expect(matches).toHaveLength(1);
    return matches[0]!.body;
  };
  const rejection = async (spec: FunctionSpec, body: string) => {
    const v = await runGates(spec, body, callArgs(specEx(spec.exampleId!)));
    const gate = v.gates.find((g) => g.status === 'fail')!;
    return { headline: v.headline!, diag: gate.diagnostics[0]! as { silentOn?: string; reasonable?: string; call?: string; name: string } };
  };

  it('median: throwing on [] is labelled silent; the headline is unchanged', async () => {
    const ex = specEx('median');
    const { headline, diag } = await rejection(ex.spec, badBody('median', /throw new Error\('empty list'\)/));
    expect(headline).toBe('Rejected: median([]) threw Error: empty list, expected NaN');
    expect(diag.silentOn).toBe('what the median of nothing is');
    expect(diag.reasonable).toBe('Throwing on an empty list is a common, defensible choice; so is returning NaN.');
  });

  it('median: the even-length bug is NOT labelled silent, even when the same reference property is what catches it', async () => {
    const ex = specEx('median');
    const body = badBody('median', /return sorted\[Math\.floor\(sorted\.length \/ 2\)\];/);
    const viaTest = await rejection(ex.spec, body);
    expect(viaTest.diag.name).toBe('even-length list');
    expect(viaTest.diag.silentOn).toBeUndefined();
    // Without the unit tests, the marked reference property catches it at a non-empty counterexample: `when` is false.
    const viaProperty = await rejection({ ...ex.spec, tests: '' }, body);
    expect(viaProperty.diag.name).toBe('agrees with a sort-based reference');
    expect(viaProperty.diag.call).toMatch(/^median\(\[.+\]\)$/);
    expect(viaProperty.diag.silentOn).toBeUndefined();
    expect(viaProperty.diag.reasonable).toBeUndefined();
    printed.push(`  median    properties (tests removed, even-length bug) ${viaProperty.headline}`);
  });

  it('median: sorting as strings, caught by the marked property at a non-empty list, is NOT labelled silent', async () => {
    const ex = specEx('median');
    const { diag } = await rejection(ex.spec, badBody('median', /\.sort\(\);/));
    expect(diag.name).toBe('agrees with a sort-based reference');
    expect(diag.silentOn).toBeUndefined();
  });

  it('slugify: splitting on the apostrophe is labelled silent; never trimming is not', async () => {
    const ex = specEx('slugify');
    const apostrophe = await rejection(ex.spec, badBody('slugify', /^(?![\s\S]*['’]\]\/g)[\s\S]*' and '\)/));
    expect(apostrophe.diag.name).toBe('apostrophes');
    expect(apostrophe.diag.silentOn).toBe('whether an apostrophe splits a word');
    expect(apostrophe.diag.reasonable).toBe('Both don-t-stop and dont-stop are common slug conventions.');
    const untrimmed = await rejection(ex.spec, badBody('slugify', /\.replace\(\/\[\^a-z0-9\]\+\/g, '-'\);$/));
    expect(untrimmed.diag.name).toBe('leading and trailing punctuation');
    expect(untrimmed.diag.silentOn).toBeUndefined();
  });

  it('fibonacci: no check is marked silent (the doc states what the tests check)', () => {
    const ex = specEx('fibonacci');
    for (const src of [ex.spec.tests, ex.spec.properties, ex.breakPatch.tests ?? '', ex.breakPatch.properties ?? '']) {
      expect(src).not.toContain('silentOn');
    }
    expect(ex.spec.doc).toContain('1,000,000');
    expect(ex.breakPatch.doc).toContain('-1,000,000 to 1,000,000');
    expect(ex.breakPatch.doc).toContain('negafibonacci');
  });
}, 60_000);

const PRETYPED_RESULT: Record<string, string> = {
  median: '2.5',
  slugify: '"hello-world-creme-brulee"',
  fibonacci: '2880067194370816120n',
};

// F(0)…F(90), from an independent source (exact integer arithmetic outside this project).
const FIB_TABLE: readonly bigint[] = [
  0n, 1n, 1n, 2n, 3n, 5n, 8n, 13n, 21n, 34n, 55n, 89n, 144n, 233n, 377n, 610n, 987n, 1597n, 2584n, 4181n, 6765n,
  10946n, 17711n, 28657n, 46368n, 75025n, 121393n, 196418n, 317811n, 514229n, 832040n, 1346269n, 2178309n, 3524578n,
  5702887n, 9227465n, 14930352n, 24157817n, 39088169n, 63245986n, 102334155n, 165580141n, 267914296n, 433494437n,
  701408733n, 1134903170n, 1836311903n, 2971215073n, 4807526976n, 7778742049n, 12586269025n, 20365011074n,
  32951280099n, 53316291173n, 86267571272n, 139583862445n, 225851433717n, 365435296162n, 591286729879n,
  956722026041n, 1548008755920n, 2504730781961n, 4052739537881n, 6557470319842n, 10610209857723n, 17167680177565n,
  27777890035288n, 44945570212853n, 72723460248141n, 117669030460994n, 190392490709135n, 308061521170129n,
  498454011879264n, 806515533049393n, 1304969544928657n, 2111485077978050n, 3416454622906707n, 5527939700884757n,
  8944394323791464n, 14472334024676221n, 23416728348467685n, 37889062373143906n, 61305790721611591n,
  99194853094755497n, 160500643816367088n, 259695496911122585n, 420196140727489673n, 679891637638612258n,
  1100087778366101931n, 1779979416004714189n, 2880067194370816120n,
];

/**
 * Runs a browser-only fibonacci bad body through the real gate executor, but refuses (via the enter hook, right
 * before the call) to start any fibonacci(n) with n > maxN, plus every call after it, so nothing ever hangs here.
 * Returns where it stopped and the slowest call that was allowed to run.
 */
async function simulateWatchdog(body: string, maxN: number) {
  const ex = specEx('fibonacci');
  const compiled = await compileCandidate(ex.spec, body);
  expect(compiled.gate.status).toBe('pass');
  const { specHash, testsHash } = await hashesFor(ex.spec);
  const STOP = 'simulated watchdog stop';
  let phase = '';
  let stoppedAt: { label: string; phase: string } | null = null;
  let enteredAt = 0;
  const slowest: number[] = [];
  const exec = executeGates(
    {
      name: 'fibonacci',
      js: compiled.js!,
      testsJs: userJs(ex.spec.tests),
      propertiesJs: userJs(ex.spec.properties),
      budgetMs: ex.spec.budgetMs,
      seed: gateSeed(specHash, testsHash),
      callArgs: callArgs(ex),
    },
    {
      phase: (p) => (phase = p),
      enter: (label) => {
        const n = Number(/^fibonacci\((-?\d+)\)$/.exec(label)?.[1]);
        if (stoppedAt || n > maxN) {
          stoppedAt ??= { label, phase };
          throw new Error(STOP);
        }
        enteredAt = performance.now();
      },
      leave: () => slowest.push(performance.now() - enteredAt),
    },
  );
  expect(exec[0]!.status).toBe('fail'); // only because of the simulated stop
  return { ex, stoppedAt: stoppedAt as { label: string; phase: string } | null, slowestMs: Math.max(...slowest) };
}

describe('fibonacci browser-only bad bodies, simulated without hanging', () => {
  const bodyWith = (pattern: RegExp): string => {
    const ex = specEx('fibonacci');
    const matches = ex.badBodies.filter((b) => b.browserOnly && pattern.test(b.body));
    expect(matches).toHaveLength(1);
    expect(matches[0]!.rejectedBy).toBe('invariants');
    return matches[0]!.body;
  };

  it('the O(n) loop: small calls are fast, fibonacci(1000000) in the Tests phase is the call the watchdog stops', async () => {
    const loop = bodyWith(/for \(let i = 0; i < n; i\+\+\)/);
    const { ex, stoppedAt, slowestMs } = await simulateWatchdog(loop, 90);
    expect(stoppedAt).toEqual({ label: 'fibonacci(1000000)', phase: 'tests' });
    expect(slowestMs).toBeLessThan(ex.spec.budgetMs / 10); // every unit-test call up to n = 90 is fast
    const verdict = timeoutResults([], { reason: 'call', label: stoppedAt!.label, phase: 'tests', elapsedMs: 1510, phaseMs: 1520 }, ex.spec.budgetMs, 15_000);
    expect(statuses(verdict)).toEqual(['tests:skipped', 'properties:skipped', 'invariants:fail']);
    expect(verdict[2]!.headline).toBe('Rejected: fibonacci(1000000) did not return within 1500 ms (bounded)');
    printed.push(`  fibonacci invariants (simulated watchdog, loop) ${verdict[2]!.headline}`);
  });

  it('the naive recursion: reaches fibonacci(90) in the Tests phase after quick small calls; the watchdog verdict reads as intended', async () => {
    const naive = bodyWith(/fibonacci\(n - 1\)/);
    const { ex, stoppedAt, slowestMs } = await simulateWatchdog(naive, 30);
    expect(stoppedAt).toEqual({ label: 'fibonacci(90)', phase: 'tests' });
    expect(slowestMs).toBeLessThan(ex.spec.budgetMs / 10); // the small unit-test calls are fast
    const verdict = timeoutResults([], { reason: 'call', label: stoppedAt!.label, phase: 'tests', elapsedMs: 1525, phaseMs: 1530 }, ex.spec.budgetMs, 15_000);
    expect(statuses(verdict)).toEqual(['tests:skipped', 'properties:skipped', 'invariants:fail']);
    expect(verdict[2]!.headline).toBe('Rejected: fibonacci(90) did not return within 1500 ms (bounded)');
    printed.push(`  fibonacci invariants (simulated watchdog, recursion) ${verdict[2]!.headline}`);
  });
});

describe('fibonacci good body', () => {
  it('is iterative fast-doubling BigInt code, matches the known table for n = 0..90 and handles n = 1,000,000 well within budget', async () => {
    const ex = specEx('fibonacci');
    const body = ex.goodBodies[0]!;
    expect(body).toMatch(/\bfor\s*\(const bit of n\.toString\(2\)\)/); // fast doubling over the bits of n, O(log n) steps
    expect(body).toContain('0n');
    expect(body).not.toMatch(/fibonacci\s*\(/); // no recursion
    const compiled = await compileCandidate(ex.spec, body);
    expect(compiled.gate.status).toBe('pass');
    const fib = evalMasked<(n: number) => bigint>(compiled.js!, 'fibonacci');
    expect(FIB_TABLE.length).toBe(91);
    for (let n = 0; n <= 90; n++) expect(fib(n), `fibonacci(${n})`).toBe(FIB_TABLE[n]);
    expect(FIB_TABLE[90]! > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    const t0 = performance.now();
    const big = fib(1_000_000);
    expect(performance.now() - t0).toBeLessThan(ex.spec.budgetMs / 3);
    expect(big % 1000000007n).toBe(918091266n);
    expect(big.toString().length).toBe(208988);
  });

  it('the browser-only O(n) loop is correct (only too slow): it matches the known table for n = 0..90', async () => {
    const ex = specEx('fibonacci');
    const loop = ex.badBodies.find((b) => b.browserOnly && !/fibonacci\s*\(/.test(b.body))!;
    const compiled = await compileCandidate(ex.spec, loop.body);
    expect(compiled.gate.status).toBe('pass');
    const fib = evalMasked<(n: number) => bigint>(compiled.js!, 'fibonacci');
    for (let n = 0; n <= 90; n++) expect(fib(n), `fibonacci(${n})`).toBe(FIB_TABLE[n]);
  });
});

// ───────── orders: the spec-less example over the bundled data ─────────

describe('orders (spec-less, over the bundled orders.csv)', () => {
  const ex = exampleById('orders')!;
  // exactly what the engine binds: CSV parsed, columns coerced, type inferred from every row
  const rows = coerceCsvRows(parseCsv(BUNDLED_ORDERS_CSV()).rows).rows;
  const { typeDecl } = inferDataset(rows);
  const spec = ordersCallSpec(typeDecl);
  const broken = brokenSpec(ex, spec);

  // Computed by hand-independent means once (a plain JS run of each body over the 332 rows) and frozen here.
  const RIGHT = [
    { customer: 'Puddlesworth Inc', revenue: 2507.13 },
    { customer: 'Brambleskate Ltd', revenue: 2355.91 },
    { customer: 'Chef Ravioli Starbright', revenue: 2252.07 },
    { customer: 'Grommet & Gasket LLC', revenue: 2175.72 },
    { customer: 'Kettlewhistle Farms', revenue: 2034.13 },
  ];
  const NAIVE = [
    { customer: 'Puddlesworth Inc', revenue: 2601.63 },
    { customer: 'Madame Fizzlecrumb', revenue: 2595.18 },
    { customer: 'Brambleskate Ltd', revenue: 2397.59 },
    { customer: 'Kettlewhistle Farms', revenue: 2386.6 },
    { customer: 'Chef Ravioli Starbright', revenue: 2277.27 },
  ];

  async function gateWith(s: FunctionSpec, body: string, pinned?: ExecGateInput['pinned']): Promise<Verdict & { result: unknown }> {
    const compiled = await compileCandidate(s, body);
    if (compiled.gate.status === 'fail' || compiled.js === null) {
      return { gates: [compiled.gate], rejectedBy: 'compile', headline: compiled.gate.headline, js: null, result: undefined };
    }
    const { specHash, testsHash } = await hashesFor(s);
    const input: ExecGateInput = {
      name: s.name,
      js: compiled.js,
      testsJs: '',
      propertiesJs: '',
      budgetMs: s.budgetMs,
      seed: gateSeed(specHash, testsHash),
      callArgs: [rows],
      ...(pinned ? { pinned } : {}),
    };
    const exec = executeGates(input, { phase: () => {}, enter: () => {}, leave: () => {} });
    const gates = [compiled.gate, ...exec];
    const failed = gates.find((g) => g.status === 'fail');
    // the value the call really gives (only for candidates the gates let through: a rejected one may throw)
    const result = failed && failed.gate === 'invariants' ? undefined : evalMasked<(r: unknown[]) => unknown>(compiled.js, s.name)(structuredClone(rows));
    return { gates, rejectedBy: failed?.gate, headline: failed?.headline, js: compiled.js, result };
  }

  it('is spec-less, binds the bundled data to rows, and its call-derived spec is tagged for "Break it"', () => {
    expect(ex.spec).toBeUndefined();
    expect(ex.dataset).toEqual({ name: 'rows', filename: 'orders.csv' });
    expect(ex.call).toBe('topCustomersByRevenue(rows)');
    expect(ex.fn).toBe(ORDERS_FN);
    expect(ex.breakIt.label).toMatch(/^Break it/);
    expect(ex.blurb).toMatch(/no spec/i);
    expect(rows).toHaveLength(332);
    expect(typeDecl).toBe(
      'type Row = { id: number; orderDate: string; customer: string; email: string; country: string; product: string; quantity: number; unitPrice: number; discount: number | null; status: string }',
    );
    expect(spec).toMatchObject({ name: ORDERS_FN, params: [{ name: 'arg0', type: 'Row[]' }], returns: null, doc: '', tests: '', properties: '', origin: 'call', exampleId: 'orders', typeDecls: typeDecl });
    expect(() => brokenSpec(ex)).toThrow(/no spec until its call grows one/);
  });

  it('"break it" states the contract (doc only) and changes the spec hash', async () => {
    expect(ex.breakPatch).toEqual({ doc: expect.stringContaining('"refunded" do not count') });
    expect(broken.doc).toContain('quantity × unitPrice × (1 − discount)');
    expect((await hashesFor(spec)).specHash).not.toBe((await hashesFor(broken)).specHash);
    expect(broken.exampleId).toBe('orders');
  });

  it('without a spec only Compile and Invariants judge: both good bodies pass on the real rows', async () => {
    for (const body of ex.goodBodies) {
      const v = await gateWith(spec, body);
      expect(statuses(v.gates), `${v.headline}\n${body}`).toEqual(['compile:pass', 'tests:skipped', 'properties:skipped', 'invariants:pass']);
    }
  }, 60_000);

  it('rejects each bad body at the stated gate', async () => {
    for (const bad of ex.badBodies) {
      const v = await gateWith(spec, bad.body);
      expect(v.rejectedBy, `${bad.why}\n${statuses(v.gates).join(' ')}`).toBe(bad.rejectedBy);
      expect(v.headline).toMatch(/^Rejected: /);
      printed.push(`  ${'orders'.padEnd(9)} ${bad.rejectedBy.padEnd(10)} ${v.headline}`);
    }
  }, 60_000);

  it('after "break it": the good body computes the right top 5 on the real data; the naive one differs', async () => {
    const good = await gateWith(broken, ORDERS_GOOD);
    expect(statuses(good.gates)).toEqual(['compile:pass', 'tests:skipped', 'properties:skipped', 'invariants:pass']);
    expect(good.result).toEqual(RIGHT);
    const naive = await gateWith(broken, ORDERS_NAIVE);
    expect(naive.result).toEqual(NAIVE);
    expect(naive.result).not.toEqual(good.result);
    // refunds and discounts change the ranking itself, not just the amounts
    expect((naive.result as typeof NAIVE).map((r) => r.customer)).not.toEqual(RIGHT.map((r) => r.customer));
  }, 60_000);

  it('a pinned right answer makes the Tests gate reject the naive body with the pinned headline, and accept the good one', async () => {
    const pinned = [{ label: 'topCustomersByRevenue(rows)', args: [rows], expected: RIGHT }];
    const good = await gateWith(broken, ORDERS_GOOD, pinned);
    expect(statuses(good.gates)).toEqual(['compile:pass', 'tests:pass', 'properties:skipped', 'invariants:pass']);
    expect(good.gates[1]!.summary).toBe('1 pinned passed');
    const naive = await gateWith(broken, ORDERS_NAIVE, pinned);
    expect(naive.rejectedBy).toBe('tests');
    expect(naive.headline).toMatch(/^Rejected: topCustomersByRevenue\(rows\) returned \[\{ customer: "Puddlesworth Inc", revenue: 2601\.63 \}/);
    expect(naive.headline).toContain('expected [{ customer: "Puddlesworth Inc", revenue: 2507.13 }');
    const d = naive.gates[1]!.diagnostics[0]!;
    expect(d.kind === 'test' && d.name).toBe('pinned: topCustomersByRevenue(rows)');
    printed.push(`  ${'orders'.padEnd(9)} after break, pinned: ${naive.headline}`);
  }, 60_000);
});
