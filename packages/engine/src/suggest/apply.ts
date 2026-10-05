/**
 * One-click "add this property" for suggestions (see suggest.ts). Pure: returns new specs, never mutates.
 */
import type { FunctionSpec } from '../types';
import { hasMarker, type Suggestion } from './suggest';

/** True iff the suggestion's `// suggested:<id>` marker line is already in spec.properties. */
export function isAdded(spec: FunctionSpec, s: Suggestion): boolean {
  return hasMarker(spec.properties, s.id);
}

/**
 * spec with `s.source` appended to its properties after a blank line (no leading blank line when there were none).
 * Idempotent: appending a suggestion that is already there returns the spec unchanged (the same object).
 */
export function appendProperty(spec: FunctionSpec, s: Suggestion): FunctionSpec {
  if (isAdded(spec, s)) return spec;
  const existing = spec.properties.replace(/\s+$/, '');
  const properties = existing === '' ? `${s.source}\n` : `${existing}\n\n${s.source}\n`;
  return { ...spec, properties };
}
