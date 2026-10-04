/**
 * The compile wrapper around a candidate body, plus spec constructors.
 *
 * Layout of the wrapper (1-based lines):
 *   1            function <name>(<params>)<: returns>
 *   2            {
 *   3 .. 3+n-1   <body, verbatim, not indented — so body columns equal wrapper columns>
 *   3+n          }
 */
import type { FunctionSpec } from '../types';

export const DEFAULT_BUDGET_MS = 1000;
export const DEFAULT_MAX_ATTEMPTS = 3;

/** 1-based wrapper line on which the body's first line sits. */
export const BODY_START_LINE = 3;

export function buildSource(spec: FunctionSpec, body: string): { source: string; bodyStartLine: number } {
  const params = spec.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const returns = spec.returns === null ? '' : `: ${spec.returns}`;
  const normalized = body.replace(/\r\n?/g, '\n');
  const source = `function ${spec.name}(${params})${returns}\n{\n${normalized}\n}\n`;
  return { source, bodyStartLine: BODY_START_LINE };
}

export function emptySpec(name: string): FunctionSpec {
  return {
    name,
    params: [],
    returns: null,
    doc: '',
    tests: '',
    properties: '',
    budgetMs: DEFAULT_BUDGET_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    origin: 'call',
  };
}

/** Spec for a never-seen call: params `arg0..argN` typed from the real argument values. */
export function specFromCall(name: string, argTypes: string[]): FunctionSpec {
  return { ...emptySpec(name), params: argTypes.map((type, i) => ({ name: `arg${i}`, type })) };
}
