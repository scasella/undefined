/**
 * --json: the document's shape (snapshots of the three examples, with timestamps, durations and versions replaced),
 * the provenance being the site's eject structure, determinism across runs, and what a vitest file becomes.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { cli, EXAMPLES, FIXTURES, stable } from './helpers';

type Doc = Record<string, any>;

async function json(argv: string[], cwd: string): Promise<{ code: number; doc: Doc; stderr: string }> {
  const r = await cli([...argv, '--json'], cwd);
  return { code: r.code, doc: JSON.parse(r.stdout) as Doc, stderr: r.stderr };
}

describe('--json shape', () => {
  for (const [example, file, code] of [
    ['passing', 'src/clamp.ts', 0],
    ['rejected', 'src/leap.ts', 1],
    ['spec-gap', 'src/stats.ts', 2],
  ] as const) {
    it(`examples/${example} (exit ${code})`, async () => {
      const r = await json(['certify', file], join(EXAMPLES, example));
      expect(r.code).toBe(code);
      expect(r.doc.exitCode).toBe(code);
      await expect(`${JSON.stringify(stable(r.doc), null, 2)}\n`).toMatchFileSnapshot(`./__snapshots__/${example}.json`);
    });
  }

  it('an accepted function carries the provenance the site ejects (undefined-eject v1), nothing generated', async () => {
    const { doc } = await json(['certify', 'src/clamp.ts'], join(EXAMPLES, 'passing'));
    expect(Object.keys(doc)).toEqual(['format', 'version', 'tool', 'exitCode', 'file', 'specFile', 'specSource', 'functions', 'order', 'issues', 'notes', 'unattributed']);
    expect(doc).toMatchObject({ format: 'undefined-certify', version: 1, file: 'src/clamp.ts', specFile: 'src/clamp.test.ts', specSource: 'vitest' });
    expect(Object.keys(doc.tool)).toEqual(['name', 'version', 'node', 'v8', 'icu', 'typescript', 'fastCheck', 'host']);
    const f = doc.functions.clamp;
    const p = f.provenance;
    // the keys of eject/eject.ts provenance(), in its order, plus certifiedBy
    expect(Object.keys(p)).toEqual([
      'format', 'version', 'function', 'ejectedAt', 'note', 'specHash', 'testsHash', 'gateSeed', 'model', 'codexVersion', 'committedAt', 'revision',
      'returnType', 'spec', 'evidenceLine', 'evidence', 'mutation', 'recertified', 'pins', 'decisions', 'datasets', 'candidates', 'certifiedBy',
    ]);
    expect(p).toMatchObject({ format: 'undefined-eject', version: 1, function: 'clamp', model: null, codexVersion: null, specHash: f.specHash, testsHash: f.testsHash, gateSeed: f.seed });
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0]).toMatchObject({ verdict: 'accepted', source: 'external', generationMs: null });
    expect(p.candidates[0].body).toBe('  if (value < min) return min;\n  if (value > max) return max;\n  return value;');
    expect(p.certifiedBy).toEqual(doc.tool);
    expect(p.evidenceLine).toBe(f.evidenceLine);
  });

  it('a rejected function has the CLI keys and no provenance', async () => {
    const { doc } = await json(['certify', 'src/leap.ts'], join(EXAMPLES, 'rejected'));
    const f = doc.functions.isLeapYear;
    expect(f).toMatchObject({ verdict: 'rejected', rejectedBy: 'tests', headline: 'Rejected: isLeapYear(1900) returned true, expected false', provenance: null, evidenceLine: null });
    expect(f.diagnostics[0]).toMatchObject({ kind: 'test', name: 'centuries are not leap years', call: 'isLeapYear(1900)' });
  });

  it('a spec gap carries the question and the test to add for each answer', async () => {
    const { doc } = await json(['certify', 'src/stats.ts'], join(EXAMPLES, 'spec-gap'));
    const [gap] = doc.functions.median.gaps;
    expect(gap.question).toMatchObject({ fn: 'median', call: 'median([])', silentOn: 'what the median of nothing is', expectedShown: '0', actualShown: 'NaN' });
    expect(gap.decision.choices.map((c: Doc) => [c.id, c.label, c.agrees])).toEqual([
      ['tests', '0', true],
      ['candidate', 'NaN', false],
      ['throws', 'throws', false],
    ]);
    expect(gap.decision.choices[1].testApi).toBe('test("decided: median([]) returns NaN", () => {\n  eq(median([]), NaN);\n});');
  });

  it('could not run is still one JSON document on stdout', async () => {
    const missing = await json(['certify', 'missing.ts'], FIXTURES);
    expect(missing.code).toBe(3);
    expect(missing.doc).toMatchObject({ exitCode: 3, functions: {}, issues: [{ file: 'missing.ts', message: 'missing.ts: cannot read the file' }] });
    const hooks = await json(['certify', 'hooks.ts'], FIXTURES);
    expect(hooks.doc.exitCode).toBe(3);
    expect(hooks.doc.functions.inc).toMatchObject({ verdict: 'could-not-run', provenance: null });
    expect(hooks.doc.issues.map((i: Doc) => i.line)).toEqual([1, 5, 5]);
  });
});

describe('determinism', () => {
  it('the same file and spec give the same document, twice, apart from timestamps, durations and versions', async () => {
    const cwd = join(EXAMPLES, 'passing');
    const a = await json(['certify', 'src/clamp.ts'], cwd);
    const b = await json(['certify', 'src/clamp.ts'], cwd);
    expect(stable(b.doc)).toEqual(stable(a.doc));
    // the seed is derived from the spec, not from the clock
    expect(a.doc.functions.clamp.seed).toBe(b.doc.functions.clamp.seed);
  });

  it('several functions and a spec gap: same verdicts, hashes, seeds and questions twice', async () => {
    const a = await json(['certify', 'mixed.ts'], FIXTURES);
    const b = await json(['certify', 'mixed.ts'], FIXTURES);
    expect(stable(b.doc)).toEqual(stable(a.doc));
    expect(a.doc.order).toEqual(['abs', 'sign', 'max2']);
  });
});

describe('vitest + fast-check test files', () => {
  it('become the Test API source that is hashed, shown in --json as generatedTests', async () => {
    const { doc } = await json(['certify', 'src/clamp.ts'], join(EXAMPLES, 'passing'));
    const g = doc.functions.clamp.generatedTests;
    // it → test, with the describe name as a prefix; expect → the shim (prepended, versioned, hashed)
    expect(g.tests).toContain('test("clamp > keeps a value inside the range", () => {');
    expect(g.tests).toContain('expect(clamp(5, 0, 10)).toBe(5);');
    // fc.assert(fc.property(...)) → property(name, [arbitraries], predicate): the gate owns the seed
    expect(g.properties).toContain('property("clamp > always lands inside the range", [fc.integer(), fc.integer(), fc.integer()], (v, a, b) => {');
    expect(g.properties).not.toContain('fc.assert');
    expect(doc.functions.clamp.gates.map((x: Doc) => [x.gate, x.status, x.summary])).toEqual([
      ['compile', 'pass', '0 errors'],
      ['tests', 'pass', '4/4 tests passed'],
      ['properties', 'pass', '2/2 properties held (200 runs: "clamp > always lands inside the range" 100, "clamp > leaves values already in range unchanged" 100)'],
      ['invariants', 'pass', expect.stringMatching(/^pure ✓ bounded ✓/)],
    ]);
  });

  it('JSDoc @silentOn / @reasonable on an `it` become the gap marker', async () => {
    const { doc } = await json(['certify', 'src/stats.ts'], join(EXAMPLES, 'spec-gap'));
    expect(doc.functions.median.generatedTests.tests).toContain('{ silentOn: "what the median of nothing is", reasonable: "NaN (nothing to take the middle of) and throwing are also defensible." }');
  });

  it('--spec points at a test file that is not next to the source', async () => {
    const r = await cli(['certify', 'examples/passing/src/clamp.ts', '--spec', 'examples/passing/src/clamp.test.ts', '--quiet', '--no-mutation'], join(EXAMPLES, '..'));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ACCEPTED      clamp  examples/passing/src/clamp.ts:5');
  });
});
