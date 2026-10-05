/**
 * The compile wrapper around a candidate body, plus spec constructors.
 *
 * Layout of the wrapper (1-based lines), with d = number of lines of `spec.typeDecls` (0 when unset or blank):
 *   1 .. d           <typeDecls, verbatim (CRLF normalised, trailing blank lines dropped)>
 *   d+1              function <name>(<params>)<: returns>
 *   d+2              {
 *   d+3 .. d+3+n-1   <body, verbatim, not indented — so body columns equal wrapper columns>
 *   d+3+n            }
 * `bodyStartLine` (= d + 3) is what keeps compile diagnostics BODY-relative.
 */
import type { FunctionSpec } from '../types';

export const DEFAULT_BUDGET_MS = 1000;
export const DEFAULT_MAX_ATTEMPTS = 3;

/** 1-based wrapper line on which the body's first line sits when the spec has no typeDecls. */
export const BODY_START_LINE = 3;

/** The spec's type declarations as they are prepended ('' when none): CRLF normalised, trailing whitespace trimmed. */
export function typeDeclsText(spec: FunctionSpec): string {
  return (spec.typeDecls ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

export function buildSource(spec: FunctionSpec, body: string): { source: string; bodyStartLine: number } {
  const params = spec.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const returns = spec.returns === null ? '' : `: ${spec.returns}`;
  const normalized = body.replace(/\r\n?/g, '\n');
  const decls = typeDeclsText(spec);
  const prefix = decls === '' ? '' : `${decls}\n`;
  const declLines = decls === '' ? 0 : decls.split('\n').length;
  const source = `${prefix}function ${spec.name}(${params})${returns}\n{\n${normalized}\n}\n`;
  return { source, bodyStartLine: BODY_START_LINE + declLines };
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

/**
 * Spec for a never-seen call: params `arg0..argN` typed from the real argument values. `opts.typeDecls` (e.g. a
 * dataset's `type Row = {…}` when an argument is typed `Row[]`) is carried into the spec when non-empty.
 */
export function specFromCall(name: string, argTypes: string[], opts: { typeDecls?: string } = {}): FunctionSpec {
  const spec: FunctionSpec = { ...emptySpec(name), params: argTypes.map((type, i) => ({ name: `arg${i}`, type })) };
  if (opts.typeDecls !== undefined && opts.typeDecls.trim() !== '') spec.typeDecls = opts.typeDecls;
  return spec;
}
