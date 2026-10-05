/**
 * The decision snippets do what the comment says: pasted into the spec, each answer settles the gap. Real engine,
 * real Node gate host.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { certify, parseSpecFile, type CertifyInput } from '@scasella/undefined-engine';
import { createNodeGateHost, type NodeGateHost } from '@scasella/undefined-engine/node';
import { reportGap } from './gaps';

let host: NodeGateHost;
beforeAll(async () => {
  host = await createNodeGateHost();
});

const MEDIAN = `/** Returns the median of a list of numbers. */
export function median(numbers: number[]): number {
  const s = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
`;
const run = (spec: CertifyInput['spec']) => certify({ source: MEDIAN, sourceFile: 'stats.ts', host, mutation: false, ...(spec ? { spec } : {}) });

describe('undefined-spec: the snippet is a Decision for functions.<fn>.decisions', () => {
  const specDoc = (decisions?: unknown[]) =>
    JSON.stringify({
      format: 'undefined-spec',
      version: 1,
      functions: {
        median: {
          tests: "test('odd', () => { eq(median([3, 1, 2]), 2); });\ntest('empty', () => { eq(median([]), 0); }, { silentOn: 'what the median of nothing is' });",
          ...(decisions ? { decisions } : {}),
        },
      },
    });

  it('every answer validates as a decision; the code\'s answer settles the gap, the check\'s answer rejects the code', async () => {
    const first = await run({ kind: 'undefined-spec', text: specDoc(), file: 'stats.undefined.json' });
    const f = first.functions[0]!;
    expect(f.verdict).toBe('gaps');
    const gap = reportGap(f.gapQuestions[0]!, { kind: 'undefined-spec', specFile: 'stats.undefined.json', decidedAt: Date.UTC(2026, 9, 5) });
    expect(gap.target).toBe('the decisions array of functions.median in stats.undefined.json');
    expect(gap.choices.map((c) => [c.label, c.agrees, c.lang])).toEqual([
      ["Keep the check's answer (0): the code has to change, and this test pins it", true, 'json'],
      ["Accept the code's answer (NaN)", false, 'json'],
      ['Something else: throws', false, 'json'],
    ]);
    for (const c of gap.choices) expect(() => parseSpecFile(specDoc([JSON.parse(c.snippet)]), 's.json')).not.toThrow();

    const acceptCode = await run({ kind: 'undefined-spec', text: specDoc([JSON.parse(gap.choices[1]!.snippet)]), file: 'stats.undefined.json' });
    expect(acceptCode.functions[0]!.verdict).toBe('accepted');
    const keepCheck = await run({ kind: 'undefined-spec', text: specDoc([JSON.parse(gap.choices[0]!.snippet)]), file: 'stats.undefined.json' });
    expect(keepCheck.functions[0]!.verdict).toBe('rejected');
  });
});

describe('vitest: the snippet is an it() the engine runs', () => {
  const head = "import { it, expect } from 'vitest';\nimport { median } from './stats';\nit('odd', () => { expect(median([3, 1, 2])).toBe(2); });\n";
  const marked = "/** @silentOn what the median of nothing is */\nit('empty', () => { expect(median([])).toBe(0); });\n";
  const vitest = (text: string): CertifyInput['spec'] => ({ kind: 'vitest', text, file: 'stats.test.ts', isSourceModule: (s) => s === './stats' });

  it("accepting the code's answer = its test plus removing the marked check (as the note says); each snippet runs", async () => {
    const f = (await run(vitest(head + marked))).functions[0]!;
    expect(f.verdict).toBe('gaps');
    const gap = reportGap(f.gapQuestions[0]!, { kind: 'vitest', specFile: 'stats.test.ts', decidedAt: 0 });
    expect(gap.choices.map((c) => c.snippet)).toEqual([
      'it("decided: median([]) returns 0", () => {\n  expect(median([])).toBe(0);\n});',
      'it("decided: median([]) returns NaN", () => {\n  expect(median([])).toBe(NaN);\n});',
      'it("decided: median([]) throws", () => {\n  expect(() => median([])).toThrow();\n});',
    ]);
    expect(gap.choices[1]!.note).toMatch(/^Also change or remove the check "empty"/);
    expect(gap.choices[0]!.note).toBeUndefined();
    const [keep, accept, throws] = gap.choices.map((c) => c.snippet);
    expect((await run(vitest(`${head}${accept}\n`))).functions[0]!.verdict).toBe('accepted');
    expect((await run(vitest(`${head}${keep}\n`))).functions[0]!.verdict).toBe('rejected');
    expect((await run(vitest(`${head}${throws}\n`))).functions[0]!.verdict).toBe('rejected');
  });
});
