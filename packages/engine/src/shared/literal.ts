/**
 * Encoded values (shared/serialize.ts) as TypeScript source literals, for pinned results and dataset rows in an
 * ejected test file. Works on the ENCODED form so that a value the app could not keep (`unserializable`) is written
 * as `undefined` with a comment saying what it was, instead of silently vanishing.
 */
import type { Json } from '../types';

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** Values whose one-line form is longer than this are laid out one element per line. */
const WIDTH = 100;

type Tagged = { $t: string; v?: Json; show?: string };

function isTagged(j: Json): j is Json & Tagged {
  return j !== null && typeof j === 'object' && !Array.isArray(j) && Object.prototype.hasOwnProperty.call(j, '$t');
}

function key(k: string): string {
  if (k === '__proto__') return '["__proto__"]'; // a computed key stays an own property
  return IDENT.test(k) ? k : JSON.stringify(k);
}

const LINE_SEP = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), 'g');

function str(s: string): string {
  return JSON.stringify(s).replace(LINE_SEP, '\\u2028').replace(PARA_SEP, '\\u2029');
}

function comment(text: string): string {
  return `/* ${text.replace(/\*\//g, '*\\/')} */`;
}

/** A node is either a leaf (one string) or a container that may be broken across lines. */
type Node = string | { open: string; items: Node[]; close: string };

function toNode(j: Json): Node {
  if (j === null) return 'null';
  if (typeof j === 'boolean') return String(j);
  if (typeof j === 'number') return Object.is(j, -0) ? '-0' : String(j);
  if (typeof j === 'string') return str(j);
  if (Array.isArray(j)) {
    const items: Node[] = j.map((x) => (isTagged(x) && x.$t === 'hole' ? '' : toNode(x)));
    return { open: '[', items, close: ']' };
  }
  if (isTagged(j)) {
    switch (j.$t) {
      case 'undefined':
        return 'undefined';
      case 'number':
        return j.v === '-0' ? '-0' : j.v === 'NaN' || j.v === 'Infinity' || j.v === '-Infinity' ? String(j.v) : 'undefined';
      case 'bigint':
        return typeof j.v === 'string' && /^-?\d+$/.test(j.v) ? `${j.v}n` : 'undefined';
      case 'Date': {
        const t = j.v;
        const n = typeof t === 'number' ? String(t) : isTagged(t ?? null) && (t as Tagged).$t === 'number' ? String((t as Tagged).v) : 'NaN';
        return `new Date(${n})`;
      }
      case 'Map': {
        const entries = Array.isArray(j.v) ? j.v : [];
        const items: Node[] = entries.map((e) => {
          const pair = Array.isArray(e) ? e : [];
          return { open: '[', items: [toNode(pair[0] ?? null), toNode(pair[1] ?? null)], close: ']' };
        });
        return { open: 'new Map<unknown, unknown>([', items, close: '])' };
      }
      case 'Set':
        return { open: 'new Set<unknown>([', items: (Array.isArray(j.v) ? j.v : []).map(toNode), close: '])' };
      case 'object':
        return j.v !== null && typeof j.v === 'object' && !Array.isArray(j.v) ? objectNode(j.v) : 'undefined';
      case 'unserializable':
        return `undefined ${comment(`not kept by Undefined: ${typeof j.show === 'string' ? j.show : 'a value it could not serialize'}`)}`;
      default:
        return `undefined ${comment(`unknown encoded value ${j.$t}`)}`;
    }
  }
  return objectNode(j as { [k: string]: Json });
}

function objectNode(o: { [k: string]: Json }): Node {
  const items: Node[] = Object.keys(o).map((k) => prefix(`${key(k)}: `, toNode(o[k]!)));
  return { open: '{', items, close: '}' };
}

function prefix(p: string, n: Node): Node {
  return typeof n === 'string' ? p + n : { ...n, open: p + n.open };
}

function flat(n: Node): string {
  if (typeof n === 'string') return n;
  if (n.items.length === 0) return n.open + n.close;
  // a trailing hole needs its own comma to count
  const inner = n.items.map(flat).join(', ') + (n.items[n.items.length - 1] === '' ? ',' : '');
  return n.open === '{' || n.open.endsWith(': {') ? `${n.open} ${inner} ${n.close}` : `${n.open}${inner}${n.close}`;
}

function layout(n: Node, indent: string): string {
  const one = flat(n);
  if (typeof n === 'string' || one.length + indent.length <= WIDTH || n.items.length === 0) return one;
  const inner = indent + '  ';
  const lines = n.items.map((x) => `${inner}${layout(x, inner)},`);
  return `${n.open}\n${lines.join('\n')}\n${indent}${n.close}`;
}

/** TypeScript source for an encoded value, laid out from column `indent`. */
export function tsLiteral(j: Json, indent = ''): string {
  return layout(toNode(j), indent);
}

/**
 * Dataset rows: one row per line (each row on a single line however long), so a few hundred rows stay readable and
 * diffable. Anything that is not an array falls back to tsLiteral.
 */
export function tsRowsLiteral(j: Json): string {
  if (!Array.isArray(j) || j.length === 0) return tsLiteral(j);
  const n = toNode(j);
  if (typeof n === 'string') return n;
  return `[\n${n.items.map((x) => `  ${flat(x)},`).join('\n')}\n]`;
}
