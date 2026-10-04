/**
 * Turn imported rows into a content-addressed DatasetRef plus its encoded rows.
 *
 * hash  = sha256 of the canonical JSON (object keys sorted, no whitespace) of encodeValue(rows).
 * bytes = UTF-8 byte length of that same canonical JSON string.
 */
import type { DatasetRef, Json } from '../types';
import { encodeValue } from '../shared/serialize';
import { sha256Hex } from '../shared/hash';
import { MASKED_NAMES } from '../sandbox/mask';
import { inferDataset } from './infer';

export const DATASET_LIMITS = { maxRows: 20_000, maxBytes: 1_000_000 } as const;

export type BuildDatasetResult =
  | { ref: DatasetRef; encoded: Json }
  | { error: 'too-large'; message: string }
  | { error: 'bad-name'; message: string };

export async function buildDataset(
  name: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  meta: { source: DatasetRef['source']; filename?: string; typeName?: string },
): Promise<BuildDatasetResult> {
  const bad = validateVariableName(name);
  if (bad !== null) return { error: 'bad-name', message: bad };

  if (rows.length > DATASET_LIMITS.maxRows) {
    return {
      error: 'too-large',
      message: `That is ${fmt(rows.length)} rows; the limit is ${fmt(DATASET_LIMITS.maxRows)}. Trim it (for example keep the first ${fmt(DATASET_LIMITS.maxRows)} rows, or filter it before pasting) and import again.`,
    };
  }
  const encoded = encodeValue(rows);
  const canonical = canonicalJson(encoded);
  const bytes = utf8Length(canonical);
  if (bytes > DATASET_LIMITS.maxBytes) {
    return {
      error: 'too-large',
      message: `The ${fmt(rows.length)} rows take ${fmt(bytes)} bytes; the limit is ${fmt(DATASET_LIMITS.maxBytes)} bytes. Trim it (drop columns or rows you don't need) and import again.`,
    };
  }
  const { typeName, typeDecl, columns } = inferDataset(rows, { typeName: meta.typeName });
  const ref: DatasetRef = {
    name,
    hash: await sha256Hex(canonical),
    typeName,
    typeDecl,
    rowCount: rows.length,
    columns,
    source: meta.source,
    bytes,
  };
  if (meta.filename !== undefined) ref.filename = meta.filename;
  return { ref, encoded };
}

/** JSON with object keys sorted by UTF-16 code unit order and no whitespace. Same value ⇒ same string. */
export function canonicalJson(j: Json): string {
  if (j === null || typeof j !== 'object') return JSON.stringify(j);
  if (Array.isArray(j)) return `[${j.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(j).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(j[k]!)}`).join(',')}}`;
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

const RESERVED = new Set([
  // ES reserved words
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  // strict mode / contextual
  'let', 'static', 'yield', 'await', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'enum',
  'arguments',
]);

const SPECIAL = new Set(['undefined', 'NaN', 'Infinity', 'eval', 'Function']);

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** null when `name` can be bound as a REPL variable; otherwise a precise, user-facing reason. */
export function validateVariableName(name: string): string | null {
  if (typeof name !== 'string' || name === '') return 'A variable name is required, e.g. rows.';
  if (!IDENT.test(name)) {
    if (/^\d/.test(name)) return `${JSON.stringify(name)} starts with a digit; a variable name must start with a letter, _ or $.`;
    const bad = [...name].find((c) => !/[\w$]/.test(c));
    return `${JSON.stringify(name)} contains ${JSON.stringify(bad)}; a variable name may only use letters, digits, _ and $ (ASCII).`;
  }
  if (RESERVED.has(name)) return `${JSON.stringify(name)} is a reserved word in JavaScript; pick another name, e.g. rows.`;
  if (SPECIAL.has(name)) return `${JSON.stringify(name)} is a built-in global; binding data to it would break code that relies on it.`;
  if (MASKED_NAMES.includes(name)) {
    return `${JSON.stringify(name)} is masked inside generated functions (it is a purity trap), so data bound to it could not be read there.`;
  }
  return null;
}

function fmt(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
