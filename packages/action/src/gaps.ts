/**
 * Spec-gap questions as decisions the reviewer answers by adding a test (docs/WORKSPACE-DESIGN.md §4.4, §5.3).
 *
 * The engine's GapQuestion (decide/gaps.ts) lists the answers the site's Decide card offers. Each becomes a
 * paste-ready snippet built from the same pieces the site uses (decide/decisions.ts decisionName, callSource,
 * shared/literal.ts tsLiteral), in the format of the spec it came from:
 *   - vitest test file: an `it(...)` with `expect`. A plain test does not waive the check marked @silentOn, so an answer
 *     that disagrees with that check says to change or remove it too.
 *   - `undefined-spec` file: a Decision object for `functions.<fn>.decisions` (decide/decisions.ts buildDecision, the
 *     shape the site stores and the spec validator accepts). A disagreeing decision waives the check by itself.
 * Nothing is written anywhere: the reviewer decides.
 */
import type { GapQuestion, Json, Outcome } from '@scasella/undefined-engine';
import { buildDecision, callSource, decisionName, type RulingSpec } from '@scasella/undefined-engine/decide/decisions';
import { tsLiteral } from '@scasella/undefined-engine/shared/literal';
import { decodeValue } from '@scasella/undefined-engine/shared/serialize';
import type { ReportChoice, ReportGap } from './model';

export type SpecKind = 'vitest' | 'undefined-spec';

function isPrimitive(returns: Json): boolean {
  try {
    const v = decodeValue(returns);
    return v === null || (typeof v !== 'object' && typeof v !== 'function');
  } catch {
    return false;
  }
}

/** The vitest assertion for one ruling. `toBe` is Object.is (the gate's equality for primitives: NaN, -0). */
export function vitestAssertion(fn: string, args: readonly Json[], r: RulingSpec): string {
  const call = callSource(fn, args, '  ');
  if (r.kind === 'relational') return `expect(${call}).toStrictEqual(${callSource(fn, r.args, '  ')});`;
  if (r.kind === 'expr') return `expect(${call}).toStrictEqual(${r.expr});`;
  const o = r.outcome;
  if ('throws' in o) return `expect(() => ${call}).toThrow();`;
  return isPrimitive(o.returns) ? `expect(${call}).toBe(${tsLiteral(o.returns, '  ')});` : `expect(${call}).toStrictEqual(${tsLiteral(o.returns, '  ')});`;
}

export function vitestTest(fn: string, args: readonly Json[], r: RulingSpec): string {
  return `it(${JSON.stringify(decisionName(fn, args, r))}, () => {\n  ${vitestAssertion(fn, args, r)}\n});`;
}

function label(source: string, shown: string, agrees: boolean): string {
  if (agrees) return `Keep the check's answer (${shown}): the code has to change, and this test pins it`;
  if (source === 'candidate') return `Accept the code's answer (${shown})`;
  return `Something else: ${shown}`;
}

export function reportGap(q: GapQuestion, a: { kind: SpecKind; specFile: string; decidedAt: number }): ReportGap {
  const expected: Outcome | undefined = q.alternatives.find((x) => x.source === 'tests')?.outcome;
  const choices: ReportChoice[] = [];
  for (const alt of q.alternatives) {
    if (alt.disabled) continue;
    const ruling: RulingSpec | null = alt.outcome ? { kind: 'outcome', outcome: alt.outcome } : alt.relational ? { kind: 'relational', args: alt.relational.args } : null;
    if (!ruling) continue;
    const shown = alt.relational ? alt.relational.label : alt.label;
    if (a.kind === 'vitest') {
      choices.push({
        label: label(alt.source, shown, alt.agrees),
        agrees: alt.agrees,
        snippet: vitestTest(q.fn, q.args, ruling),
        lang: 'ts',
        ...(alt.agrees ? {} : { note: `Also change or remove the check "${q.check.name}" (marked @silentOn): it expects ${q.expectedShown}, and a new test does not switch it off` }),
      });
    } else {
      const d = buildDecision({
        fn: q.fn,
        kind: q.kind,
        args: q.args,
        ruling,
        answers: { check: q.check.name, checkKind: q.check.kind, silentOn: q.silentOn, gate: q.check.gate },
        ...(expected ? { expected } : {}),
        rule: null,
        decidedAt: a.decidedAt,
      });
      choices.push({
        label: label(alt.source, shown, alt.agrees),
        agrees: alt.agrees,
        snippet: JSON.stringify(d, null, 2),
        lang: 'json',
        ...(alt.agrees ? {} : { note: `This decision replaces the check "${q.check.name}" for this call` }),
      });
    }
  }
  const gap: ReportGap = {
    call: q.call,
    silentOn: q.silentOn,
    check: q.check.name,
    expected: q.expectedShown,
    actual: q.actualShown,
    target: a.kind === 'vitest' ? a.specFile : `the decisions array of functions.${q.fn} in ${a.specFile}`,
    choices,
  };
  if (q.reasonable) gap.reasonable = q.reasonable;
  if (q.onlyAgreeing) gap.onlyAgreeing = q.onlyAgreeing;
  return gap;
}
