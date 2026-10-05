import { describe, expect, it } from 'vitest';
import type { FunctionSpec, MutantInfo } from '@scasella/undefined-engine/types';
import { compileCandidate } from '@scasella/undefined-engine/gates/compile';
import { useNodeLibs } from '@scasella/undefined-engine/node/libs';
import { decodeMappings, mapMutantLines } from '../src/mutantLines';
import { vitestDecision } from '../src/report/gaps';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';

useNodeLibs();

const spec = (over: Partial<FunctionSpec> = {}): FunctionSpec => ({
  name: 'f',
  params: [{ name: 'n', type: 'number' }],
  returns: 'number',
  doc: '',
  tests: '',
  properties: '',
  budgetMs: 1000,
  maxAttempts: 1,
  origin: 'user',
  ...over,
});
const mutant = (line: number): MutantInfo => ({ id: `m${line}`, kind: 'comparison', line, original: '<', mutated: '<=' });

describe('decodeMappings', () => {
  it('decodes source-map v3 VLQ segments to original lines per generated line', () => {
    // AAAA = [0,0,0,0]; AACA = line +1; ;; = empty lines; AAEA = line +2; AAGD = line +3 (col -1)
    expect(decodeMappings('AAAA;AACA;;AAEA,AAGD')).toEqual([[0], [1], [], [3, 6]]);
    // negative deltas (D = -1)
    expect(decodeMappings('AAKA;AADA')).toEqual([[5], [4]]);
  });
});

describe('mapMutantLines', () => {
  it('maps compiled-body lines back to the TypeScript body and the file, through the emitter reflow', async () => {
    // `if (n < 0) return 0;` is split over two lines by the emitter, and blank lines are dropped
    const body = '  if (n < 0) return 0;\n\n  const twice = n * 2;\n  return twice;';
    const s = spec({ typeDecls: 'type Pair = [number, number];' });
    const compiled = await compileCandidate(s, body);
    expect(compiled.js).not.toBeNull();
    const lines = await mapMutantLines({ spec: s, body, js: compiled.js, mutants: [mutant(1), mutant(2), mutant(3), mutant(4)], bodyFileLine: 10, synthesised: false });
    expect(lines.map((l) => [l.compiledLine, l.bodyLine, l.fileLine])).toEqual([
      [1, 1, 10],
      [2, 1, 10],
      [3, 3, 12],
      [4, 4, 13],
    ]);
  });

  it('reports only the compiled line when the body was synthesised or the emit differs', async () => {
    const body = '  return n + 1;';
    const compiled = await compileCandidate(spec(), body);
    const synthesised = await mapMutantLines({ spec: spec(), body, js: compiled.js, mutants: [mutant(1)], bodyFileLine: 3, synthesised: true });
    expect(synthesised[0]).toMatchObject({ compiledLine: 1, bodyLine: null, fileLine: null });
    const different = await mapMutantLines({ spec: spec(), body, js: `${compiled.js!}// changed\n`, mutants: [mutant(1)], bodyFileLine: 3, synthesised: false });
    expect(different[0]).toMatchObject({ compiledLine: 1, bodyLine: null, fileLine: null });
  });
});

describe('vitestDecision', () => {
  it('renders each kind of ruling as a vitest test named like the site\'s decision tests', () => {
    const args = [encodeValue([])];
    expect(vitestDecision('median', args, { kind: 'outcome', outcome: { returns: encodeValue(NaN) } })).toBe('it("decided: median([]) returns NaN", () => {\n  expect(median([])).toBeNaN();\n});');
    expect(vitestDecision('median', args, { kind: 'outcome', outcome: { throws: true } })).toBe('it("decided: median([]) throws", () => {\n  expect(() => median([])).toThrow();\n});');
    expect(vitestDecision('median', args, { kind: 'outcome', outcome: { returns: encodeValue(undefined) } })).toContain('expect(median([])).toBeUndefined();');
    expect(vitestDecision('median', args, { kind: 'outcome', outcome: { returns: encodeValue(null) } })).toContain('expect(median([])).toBeNull();');
    expect(vitestDecision('f', [encodeValue(2.5)], { kind: 'outcome', outcome: { returns: encodeValue('x') } })).toContain('expect(f(2.5)).toBe("x");');
    expect(vitestDecision('f', [encodeValue(1)], { kind: 'outcome', outcome: { returns: encodeValue([1, 2]) } })).toContain('expect(f(1)).toEqual([1, 2]);');
    expect(vitestDecision('f', [encodeValue(1.5)], { kind: 'relational', args: [encodeValue(1)] })).toBe('it("decided: f(1.5) is the same as f(1)", () => {\n  expect(f(1.5)).toEqual(f(1));\n});');
  });
});
