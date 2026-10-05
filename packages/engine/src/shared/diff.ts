/**
 * Where two values first differ, for diagnostics whose `show()` renderings are identical because show() truncates
 * (long arrays, deep objects, long strings). Mirrors the equality of testApi.deepEqual: Object.is for primitives,
 * brand checks (not instanceof) for Date/Map/Set, own enumerable keys for objects.
 *
 *   firstDifference([0, …, 22, …], [0, …, 99, …])  →  { path: '[22]', actual: '22', expected: '99' }
 *   firstDifference('…250 chars…X…', '…250 chars…Y…') →  { path: '[250]', actual: '"…cdefX…"', expected: '"…cdefY…"' }
 *
 * Never throws; returns null when the values are equal or no informative difference can be named.
 */
import { isDate, isMap, isSet, show } from './show';

export interface Difference {
  /** e.g. `[22]`, `.a.b[3]`, `.get("k")`, `.length`; '' for the value itself. */
  path: string;
  actual: string;
  expected: string;
}

const MAX_DEPTH = 64;
const WINDOW = 12;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const objectIs = Object.is;
const hasOwn = Object.prototype.hasOwnProperty;
const toStringTag = Object.prototype.toString;

export function firstDifference(actual: unknown, expected: unknown): Difference | null {
  try {
    const d = diff(actual, expected, '', [], 0);
    return d && d.actual !== d.expected ? d : null;
  } catch {
    return null;
  }
}

/** `[22]: 22 vs 99` — the one-line form used in assertion messages. */
export function formatDifference(d: Difference): string {
  return `${d.path || 'value'}: ${d.actual} vs ${d.expected}`;
}

function leaf(path: string, a: unknown, b: unknown): Difference {
  return { path, actual: show(a), expected: show(b) };
}

function tagOf(v: object): string {
  return (toStringTag.call(v) as string).slice(8, -1);
}

function keyPath(path: string, k: string): string {
  return IDENT.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
}

function stringDiff(path: string, a: string, b: string): Difference {
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  const win = (s: string): string => {
    const from = Math.max(0, i - WINDOW);
    const to = Math.min(s.length, i + WINDOW);
    const body = JSON.stringify(s.slice(from, to)).slice(1, -1);
    return `"${from > 0 ? '…' : ''}${body}${to < s.length ? '…' : ''}"`;
  };
  return { path: `${path}[${i}]`, actual: i >= a.length ? '(end of string)' : win(a), expected: i >= b.length ? '(end of string)' : win(b) };
}

function diff(a: unknown, b: unknown, path: string, seen: Array<[object, object]>, depth: number): Difference | null {
  if (objectIs(a, b)) return null;
  if (typeof a === 'string' && typeof b === 'string') return stringDiff(path, a, b);
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return leaf(path, a, b);
  if (depth > MAX_DEPTH) return null;
  for (const [x, y] of seen) if (x === a && y === b) return null;
  seen = [...seen, [a, b]];

  if (Array.isArray(a) !== Array.isArray(b) || tagOf(a) !== tagOf(b)) return leaf(path, a, b);
  if (isDate(a)) return isDate(b) && objectIs(a.getTime(), b.getTime()) ? null : leaf(path, a, b);
  if (isMap(a)) {
    if (!isMap(b)) return leaf(path, a, b);
    for (const [k, v] of a) {
      const p = `${path}.get(${show(k)})`;
      if (!b.has(k)) return { path: p, actual: show(v), expected: '(missing)' };
      const d = diff(v, b.get(k), p, seen, depth + 1);
      if (d) return d;
    }
    for (const k of b.keys()) if (!a.has(k)) return { path: `${path}.get(${show(k)})`, actual: '(missing)', expected: show(b.get(k)) };
    return null;
  }
  if (isSet(a)) {
    if (!isSet(b)) return leaf(path, a, b);
    if (a.size !== b.size) return { path: `${path}.size`, actual: String(a.size), expected: String(b.size) };
    for (const x of a) {
      if ((typeof x !== 'object' || x === null) && !b.has(x)) return { path, actual: `contains ${show(x)}`, expected: `does not contain ${show(x)}` };
    }
    for (const x of b) {
      if ((typeof x !== 'object' || x === null) && !a.has(x)) return { path, actual: `does not contain ${show(x)}`, expected: `contains ${show(x)}` };
    }
    return null;
  }
  const tag = tagOf(a);
  if (tag === 'RegExp') return String(a) === String(b) ? null : leaf(path, a, b);
  if (tag === 'Error') {
    const ea = a as Error;
    const eb = b as Error;
    if (ea.name !== eb.name) return diff(ea.name, eb.name, `${path}.name`, seen, depth + 1);
    return ea.message === eb.message ? null : diff(ea.message, eb.message, `${path}.message`, seen, depth + 1);
  }
  if (ArrayBuffer.isView(a) || Array.isArray(a)) {
    const xa = a as unknown as ArrayLike<unknown>;
    const xb = b as unknown as ArrayLike<unknown>;
    const n = Math.min(xa.length, xb.length);
    for (let i = 0; i < n; i++) {
      const d = diff(xa[i], xb[i], `${path}[${i}]`, seen, depth + 1);
      if (d) return d;
    }
    return xa.length === xb.length ? null : { path: `${path}.length`, actual: String(xa.length), expected: String(xb.length) };
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of Object.keys(a)) {
    if (!hasOwn.call(b, k)) return { path: keyPath(path, k), actual: show(ra[k]), expected: '(missing)' };
    const d = diff(ra[k], rb[k], keyPath(path, k), seen, depth + 1);
    if (d) return d;
  }
  for (const k of Object.keys(b)) {
    if (!hasOwn.call(a, k)) return { path: keyPath(path, k), actual: '(missing)', expected: show(rb[k]) };
  }
  return null;
}
