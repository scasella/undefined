/**
 * Column coercion for CSV rows, and merged-shape TypeScript type inference for a whole dataset.
 *
 * Unlike shared/inferType.ts (which unions the distinct types of array elements), inferDataset merges ALL rows into
 * one object type: keys missing from some rows become optional, each key's observed types are unioned (with
 * `null` last), arrays merge their elements, nested objects merge recursively.
 */
import type { ColumnInfo } from '@scasella/undefined-engine/types';

export type CoercedKind = 'number' | 'boolean' | 'string';

/**
 * Plain decimals: `0`, `-12`, `3.14`, `.5`, `-0.25`, `1e6`, `2.5E-3`. Rejected: leading-zero ids (`007`),
 * thousands separators (`1,000`), a leading `+` (`+1 555…`), `1.`, hex, `Infinity`, `NaN`.
 */
const NUMERIC = /^-?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER = /^-?\d+$/;
const BOOLEAN = /^(?:true|false)$/i;

function toNumber(raw: string): number | null {
  const s = raw.trim();
  if (!NUMERIC.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null; // 1e999
  // An integer too large to be exact (e.g. a 20-digit id) would silently change: keep the column a string.
  if (INTEGER.test(s) && !Number.isSafeInteger(n)) return null;
  return n === 0 ? 0 : n; // never -0
}

/**
 * Per column (keys in first-seen order across rows): every non-empty value numeric → numbers; every non-empty value
 * `true`/`false` (any case) → booleans; empty or whitespace-only cells in a coerced column → null. Columns with no
 * non-empty value, and every other column, stay strings ('' kept). Values are compared after trimming for the
 * numeric/boolean test only. Dates stay strings.
 */
export function coerceCsvRows(rows: Array<Record<string, string>>): {
  rows: Array<Record<string, unknown>>;
  coerced: Record<string, CoercedKind>;
} {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
    }
  }
  const coerced: Record<string, CoercedKind> = {};
  for (const col of columns) {
    let nonEmpty = 0;
    let allNumber = true;
    let allBoolean = true;
    for (const r of rows) {
      if (!Object.prototype.hasOwnProperty.call(r, col)) continue;
      const v = r[col]!;
      if (v.trim() === '') continue;
      nonEmpty++;
      if (allNumber && toNumber(v) === null) allNumber = false;
      if (allBoolean && !BOOLEAN.test(v.trim())) allBoolean = false;
      if (!allNumber && !allBoolean) break;
    }
    const kind: CoercedKind = nonEmpty === 0 ? 'string' : allNumber ? 'number' : allBoolean ? 'boolean' : 'string';
    define(coerced, col, kind);
  }
  const out = rows.map((r) => {
    const row: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      const v = r[k]!;
      const kind = coerced[k]!;
      let value: unknown = v;
      if (kind === 'number') value = v.trim() === '' ? null : toNumber(v);
      else if (kind === 'boolean') value = v.trim() === '' ? null : v.trim().toLowerCase() === 'true';
      define(row, k, value);
    }
    return row;
  });
  return { rows: out, coerced };
}

// ───────────────────────── merged shape inference ─────────────────────────

type Prim = 'string' | 'number' | 'boolean' | 'null' | 'bigint' | 'undefined' | 'Date' | 'unknown';

interface Shape {
  /** Member kinds in first-seen order: a primitive name, 'array' or 'object'. */
  order: Array<Prim | 'array' | 'object'>;
  /** Merged element shape; null while every array seen was empty. */
  elements: Shape | null;
  object: ObjShape | null;
}

interface ObjShape {
  /** Number of objects merged into this shape. */
  count: number;
  keys: Map<string, { shape: Shape; present: number }>;
}

function emptyShape(): Shape {
  return { order: [], elements: null, object: null };
}

function note(s: Shape, kind: Shape['order'][number]): void {
  if (!s.order.includes(kind)) s.order.push(kind);
}

function addValue(s: Shape, v: unknown, ancestors: object[]): void {
  switch (typeof v) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined':
      note(s, typeof v as Prim);
      return;
    case 'function':
    case 'symbol':
      note(s, 'unknown');
      return;
  }
  if (v === null) {
    note(s, 'null');
    return;
  }
  const obj = v as object;
  if (ancestors.includes(obj)) {
    note(s, 'unknown');
    return;
  }
  if (Array.isArray(obj)) {
    note(s, 'array');
    ancestors.push(obj);
    for (const x of obj as unknown[]) {
      s.elements ??= emptyShape();
      addValue(s.elements, x, ancestors);
    }
    ancestors.pop();
    return;
  }
  if (obj instanceof Date) {
    note(s, 'Date');
    return;
  }
  const proto: unknown = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    note(s, 'unknown'); // Map, Set, class instances: not dataset values
    return;
  }
  note(s, 'object');
  s.object ??= { count: 0, keys: new Map() };
  ancestors.push(obj);
  addObject(s.object, obj as Record<string, unknown>, ancestors);
  ancestors.pop();
}

/** A key whose value is `undefined` counts as absent (→ optional), like JSON.stringify would drop it. */
function addObject(o: ObjShape, obj: Record<string, unknown>, ancestors: object[]): void {
  o.count++;
  for (const k of Object.keys(obj)) {
    const d = Object.getOwnPropertyDescriptor(obj, k);
    const v = d && 'value' in d ? d.value : undefined;
    if (v === undefined) continue;
    let entry = o.keys.get(k);
    if (!entry) {
      entry = { shape: emptyShape(), present: 0 };
      o.keys.set(k, entry);
    }
    entry.present++;
    addValue(entry.shape, v, ancestors);
  }
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

function renderKey(k: string): string {
  return IDENT.test(k) ? k : JSON.stringify(k);
}

/** Union members, `null` (then `undefined`) last. Empty shape (never observed) → `unknown`. */
function members(s: Shape): string[] {
  const out: string[] = [];
  let hasNull = false;
  let hasUndefined = false;
  for (const kind of s.order) {
    if (kind === 'null') hasNull = true;
    else if (kind === 'undefined') hasUndefined = true;
    else if (kind === 'array') out.push(renderArray(s));
    else if (kind === 'object') out.push(renderObject(s.object!));
    else out.push(kind);
  }
  if (out.includes('unknown')) return ['unknown'];
  if (hasNull) out.push('null');
  if (hasUndefined) out.push('undefined');
  return out.length === 0 ? ['unknown'] : out;
}

function render(s: Shape): string {
  return members(s).join(' | ');
}

function renderArray(s: Shape): string {
  if (s.elements === null) return 'unknown[]';
  const m = members(s.elements);
  return m.length === 1 ? `${m[0]}[]` : `(${m.join(' | ')})[]`;
}

/**
 * Keys every object inherits (TypeScript's `Object` interface). TypeScript checks an object literal that LACKS such
 * an optional key against the inherited member (e.g. `{}` has `toString: () => string`), so `{ toString?: boolean }`
 * rejects `{}`. At runtime, too, reading `row.toString` on a row without that key yields the inherited function. So
 * for these keys, when optional, the honest type also includes the inherited member: `boolean | Object["toString"]`.
 */
const INHERITED = new Set([
  'constructor', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
]);

function fieldMembers(k: string, shape: Shape, optional: boolean): string[] {
  const m = members(shape);
  if (optional && INHERITED.has(k) && !m.includes('unknown')) m.push(`Object[${JSON.stringify(k)}]`);
  return m;
}

function renderObject(o: ObjShape): string {
  const fields = [...o.keys].map(([k, { shape, present }]) => {
    const optional = present < o.count;
    return `${renderKey(k)}${optional ? '?' : ''}: ${fieldMembers(k, shape, optional).join(' | ')}`;
  });
  return fields.length === 0 ? '{}' : `{ ${fields.join('; ')} }`;
}

export interface InferredDataset {
  typeName: string;
  /** e.g. `type Row = { id: number; coupon?: string | null }` */
  typeDecl: string;
  /** Top-level columns in first-seen order. Optional columns include `| undefined` in their type. */
  columns: ColumnInfo[];
}

/**
 * Merged type of every row. `opts.typeName` must be an identifier; anything else falls back to `Row`.
 * Zero rows → `type Row = {}` with no columns.
 */
export function inferDataset(rows: ReadonlyArray<Record<string, unknown>>, opts: { typeName?: string } = {}): InferredDataset {
  const typeName = opts.typeName !== undefined && IDENT.test(opts.typeName) ? opts.typeName : 'Row';
  const top: ObjShape = { count: 0, keys: new Map() };
  for (const r of rows) {
    if (typeof r === 'object' && r !== null && !Array.isArray(r)) addObject(top, r, [r]);
    else top.count++; // not an object: every key becomes optional (the declared type is still honest for objects)
  }
  const columns: ColumnInfo[] = [...top.keys].map(([k, { shape, present }]) => {
    const optional = present < top.count;
    const m = fieldMembers(k, shape, optional);
    if (optional && !m.includes('undefined') && !m.includes('unknown')) m.push('undefined');
    return { name: k, type: m.join(' | ') };
  });
  return { typeName, typeDecl: `type ${typeName} = ${renderObject(top)}`, columns };
}

function define(o: Record<string, unknown>, k: string, value: unknown): void {
  Object.defineProperty(o, k, { value, enumerable: true, writable: true, configurable: true });
}
