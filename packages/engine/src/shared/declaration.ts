import type { FunctionSpec } from '../types';

/**
 * The one-line declaration of a function (`function name(p: T): R`). Shared by the prompt builder (the site's
 * shared/prompt.ts re-exports it) and the dependency graph (compose/graph.ts); it lives here so the engine never
 * imports the prompt builder.
 */
export function declarationLine(spec: FunctionSpec, opts: { forceInferredReturn?: string } = {}): string {
  const params = spec.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const ret = spec.returns ?? opts.forceInferredReturn;
  return `function ${spec.name}(${params})${ret ? `: ${ret}` : ''}`;
}
