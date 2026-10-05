/**
 * Spec-gap questions as decisions a reviewer can answer by adding one test (docs/WORKSPACE-DESIGN.md §4.4).
 *
 * For each selectable alternative of a GapQuestion (engine decide/gaps.ts), the exact test that records the ruling:
 * in the site's Test API (engine decide/decisions.ts decisionTest, the same text the site stores for a decision) and,
 * when the checks came from a vitest file, as a vitest `it(...)`. Nothing is written to disk: the reviewer decides.
 */
import type { GapAlternative, GapQuestion, Json } from '@scasella/undefined-engine/types';
import { callLabel, callSource, decisionName, decisionTest, type RulingSpec } from '@scasella/undefined-engine/decide/decisions';
import { decodeValue } from '@scasella/undefined-engine/shared/serialize';
import { tsLiteral } from '@scasella/undefined-engine/shared/literal';

export interface GapChoice {
  /** GapAlternative.id */
  id: string;
  /** `NaN`, `throws`, `same as median([2])` */
  label: string;
  /** Where the alternative comes from: your tests, the code, a common choice, the declared return type. */
  from: GapAlternative['source'];
  /** Choosing it agrees with what the failing check expects (adds a test, waives nothing). */
  agrees: boolean;
  /** The test to add, Test API syntax (undefined-spec files). */
  testApi: string;
  /** The same ruling as a vitest test (for checks that came from a vitest file). */
  vitest: string;
}

export interface GapDecision {
  fn: string;
  call: string;
  silentOn: string;
  reasonable?: string;
  check: GapQuestion['check'];
  expected: string;
  actual: string;
  choices: GapChoice[];
}

function ruling(a: GapAlternative): RulingSpec | null {
  if (a.relational) return { kind: 'relational', args: a.relational.args };
  if (a.outcome) return { kind: 'outcome', outcome: a.outcome };
  return null;
}

function vitestExpectation(fn: string, args: readonly Json[], r: RulingSpec): string {
  const call = callSource(fn, args);
  if (r.kind === 'relational') return `expect(${call}).toEqual(${callSource(fn, r.args)});`;
  if (r.kind === 'expr') return `expect(${call}).toEqual(${r.expr});`;
  const o = r.outcome;
  if ('throws' in o) return `expect(() => ${call}).toThrow();`;
  let v: unknown;
  try {
    v = decodeValue(o.returns);
  } catch {
    v = Symbol('undecodable');
  }
  if (typeof v === 'number' && Number.isNaN(v)) return `expect(${call}).toBeNaN();`;
  if (v === undefined) return `expect(${call}).toBeUndefined();`;
  if (v === null) return `expect(${call}).toBeNull();`;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string' || typeof v === 'boolean') return `expect(${call}).toBe(${tsLiteral(o.returns)});`;
  return `expect(${call}).toEqual(${tsLiteral(o.returns, '  ')});`;
}

/** A vitest `it` that records the ruling, named like the site's decision tests. */
export function vitestDecision(fn: string, args: readonly Json[], r: RulingSpec): string {
  return `it(${JSON.stringify(decisionName(fn, args, r))}, () => {\n  ${vitestExpectation(fn, args, r)}\n});`;
}

export function gapDecision(q: GapQuestion): GapDecision {
  const choices: GapChoice[] = [];
  for (const a of q.alternatives) {
    if (a.disabled) continue;
    const r = ruling(a);
    if (!r) continue;
    choices.push({
      id: a.id,
      label: a.relational ? a.relational.label : a.label,
      from: a.source,
      agrees: a.agrees,
      testApi: decisionTest(q.fn, q.args, r),
      vitest: vitestDecision(q.fn, q.args, r),
    });
  }
  return {
    fn: q.fn,
    call: q.call || callLabel(q.fn, q.args),
    silentOn: q.silentOn,
    ...(q.reasonable ? { reasonable: q.reasonable } : {}),
    check: q.check,
    expected: q.expectedShown,
    actual: q.actualShown,
    choices,
  };
}

const FROM: Record<GapAlternative['source'], string> = {
  tests: 'what your check expects',
  candidate: 'what the code does',
  common: 'a common choice',
  declared: 'from the declared return type',
};

/** The question and the tests to add, as text (human output). `style` follows where the checks came from. */
export function renderGap(d: GapDecision, style: 'test-api' | 'vitest', indent = '  '): string {
  const lines: string[] = [];
  lines.push(`${indent}? ${d.call}: the spec didn't say ${d.silentOn}.`);
  lines.push(`${indent}  Check "${d.check.name}" (${d.check.gate}) expects ${d.expected}; the code ${d.actual.startsWith('threw') ? d.actual : `returns ${d.actual}`}.`);
  if (d.reasonable) lines.push(`${indent}  ${d.reasonable}`);
  lines.push(`${indent}  To decide, add one of these ${style === 'vitest' ? 'to the test file' : 'to the spec\'s tests'}:`);
  for (const c of d.choices) {
    lines.push(`${indent}  - ${c.label} (${FROM[c.from]}):`);
    const text = style === 'vitest' ? c.vitest : c.testApi;
    for (const l of text.split('\n')) lines.push(`${indent}      ${l}`);
  }
  return lines.join('\n');
}
