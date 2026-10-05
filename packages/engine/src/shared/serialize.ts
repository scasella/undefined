/**
 * Lossless tagged JSON for runtime values (env snapshots, exported images).
 *
 * Plain JSON values encode as themselves. Everything JSON can't hold is an object with a `$t` tag:
 *   {"$t":"undefined"}  {"$t":"hole"} (sparse array slot)  {"$t":"number","v":"NaN"|"Infinity"|"-Infinity"|"-0"}
 *   {"$t":"bigint","v":"123"}  {"$t":"Date","v":<encoded time>}  {"$t":"Map","v":[[k,v],…]}  {"$t":"Set","v":[…]}
 *   {"$t":"object","v":{…}}   a plain object that itself has a "$t" key (escaped so it round-trips)
 *   {"$t":"unserializable","show":"<show(v)>"}  functions, symbols, class instances, typed arrays, errors, cycles
 * `unserializable` decodes to undefined. A cycle anywhere makes the whole top-level value unserializable.
 * Getters are never invoked: an accessor property is unserializable. Null-prototype objects decode as ordinary
 * objects; shared (non-cyclic) references decode as separate copies.
 */
import type { Json } from '../types';
import { isDate, isMap, isPlainObject, isSet, show } from './show';

type Tagged = { $t: string; v?: Json; show?: string };

class Cyclic extends Error {}

export function encodeValue(v: unknown): Json {
  return encodeReport(v).json;
}

/** Like encodeValue, plus whether anything (at any depth) was replaced by an `unserializable` placeholder. */
export function encodeReport(v: unknown): { json: Json; lossy: boolean } {
  const state = { lossy: false };
  try {
    return { json: encode(v, [], state), lossy: state.lossy };
  } catch {
    // cycles, revoked proxies, hostile objects
    return { json: unserializable(v), lossy: true };
  }
}

function unserializable(v: unknown): Json {
  return { $t: 'unserializable', show: show(v) };
}

function encode(v: unknown, ancestors: object[], state: { lossy: boolean }): Json {
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return v;
    case 'number':
      if (Object.is(v, -0)) return { $t: 'number', v: '-0' };
      return Number.isFinite(v) ? v : { $t: 'number', v: String(v) };
    case 'bigint':
      return { $t: 'bigint', v: v.toString() };
    case 'undefined':
      return { $t: 'undefined' };
    case 'function':
    case 'symbol':
      state.lossy = true;
      return unserializable(v);
  }
  if (v === null) return null;
  const obj = v as object;
  if (ancestors.includes(obj)) throw new Cyclic();
  if (isDate(obj)) return { $t: 'Date', v: encode(obj.getTime(), ancestors, state) };

  ancestors.push(obj);
  try {
    const sub = (x: unknown): Json => encode(x, ancestors, state);
    if (Array.isArray(obj)) {
      const arr = obj as unknown[];
      const out: Json[] = [];
      for (let i = 0; i < arr.length; i++) out.push(i in arr ? sub(arr[i]) : { $t: 'hole' });
      return out;
    }
    if (isMap(obj)) return { $t: 'Map', v: [...obj.entries()].map(([k, x]) => [sub(k), sub(x)]) };
    if (isSet(obj)) return { $t: 'Set', v: [...obj.values()].map(sub) };
    if (!isPlainObject(obj)) {
      state.lossy = true;
      return unserializable(obj);
    }
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(obj)) {
      const d = Object.getOwnPropertyDescriptor(obj, k);
      let value: Json;
      if (d && 'value' in d) {
        value = sub(d.value);
      } else {
        state.lossy = true;
        value = { $t: 'unserializable', show: '[Getter]' };
      }
      Object.defineProperty(out, k, { value, enumerable: true, writable: true, configurable: true });
    }
    return Object.prototype.hasOwnProperty.call(obj, '$t') ? { $t: 'object', v: out } : out;
  } finally {
    ancestors.pop();
  }
}

/**
 * Inverse of encodeValue. Lenient: unknown tags and malformed tagged objects decode to undefined
 * (they cannot come from encodeValue, so they only appear in hand-edited or corrupted images).
 */
export function decodeValue(j: Json): unknown {
  if (j === null || typeof j !== 'object') return j;
  if (Array.isArray(j)) {
    const out: unknown[] = new Array(j.length);
    j.forEach((x, i) => {
      if (!isTag(x, 'hole')) out[i] = decodeValue(x);
    });
    return out;
  }
  if (!Object.prototype.hasOwnProperty.call(j, '$t')) return decodeObject(j);
  const t = j as Tagged;
  switch (t.$t) {
    case 'undefined':
      return undefined;
    case 'number':
      return t.v === '-0' ? -0 : t.v === 'NaN' || t.v === 'Infinity' || t.v === '-Infinity' ? Number(t.v) : undefined;
    case 'bigint':
      try {
        return typeof t.v === 'string' ? BigInt(t.v) : undefined;
      } catch {
        return undefined;
      }
    case 'Date': {
      const time = t.v === undefined ? NaN : decodeValue(t.v);
      return new Date(typeof time === 'number' ? time : NaN);
    }
    case 'Map':
      return new Map(
        Array.isArray(t.v)
          ? t.v.map((e): [unknown, unknown] => (Array.isArray(e) ? [decodeValue(e[0] ?? null), decodeValue(e[1] ?? null)] : [undefined, undefined]))
          : [],
      );
    case 'Set':
      return new Set(Array.isArray(t.v) ? t.v.map(decodeValue) : []);
    case 'object':
      return t.v !== null && typeof t.v === 'object' && !Array.isArray(t.v) ? decodeObject(t.v) : undefined;
    default:
      return undefined; // 'unserializable', 'hole' outside an array, unknown tags
  }
}

function isTag(j: Json, tag: string): boolean {
  return j !== null && typeof j === 'object' && !Array.isArray(j) && j.$t === tag;
}

function decodeObject(j: { [k: string]: Json }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(j)) {
    // defineProperty, not assignment: a "__proto__" key must stay an own data property.
    Object.defineProperty(out, k, { value: decodeValue(j[k]!), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** Encode each variable; `unserializable` lists keys whose value was (partly) replaced by a placeholder. */
export function encodeEnv(env: Record<string, unknown>): { env: Record<string, Json>; unserializable: string[] } {
  const out: Record<string, Json> = {};
  const lost: string[] = [];
  for (const k of Object.keys(env)) {
    const { json, lossy } = encodeReport(env[k]);
    Object.defineProperty(out, k, { value: json, enumerable: true, writable: true, configurable: true });
    if (lossy) lost.push(k);
  }
  return { env: out, unserializable: lost };
}

/** Decode each variable; `unserializable` lists keys that contain (at any depth) an unserializable placeholder. */
export function decodeEnv(env: Record<string, Json>): { env: Record<string, unknown>; unserializable: string[] } {
  const out: Record<string, unknown> = {};
  const lost: string[] = [];
  for (const k of Object.keys(env)) {
    Object.defineProperty(out, k, { value: decodeValue(env[k]!), enumerable: true, writable: true, configurable: true });
    if (containsUnserializable(env[k]!)) lost.push(k);
  }
  return { env: out, unserializable: lost };
}

function containsUnserializable(j: Json): boolean {
  if (j === null || typeof j !== 'object') return false;
  if (Array.isArray(j)) return j.some(containsUnserializable);
  if (!Object.prototype.hasOwnProperty.call(j, '$t')) return Object.keys(j).some((k) => containsUnserializable(j[k]!));
  if (j.$t === 'unserializable') return true;
  const inner = j.v;
  if (j.$t === 'object' && inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
    // escaped plain object: `inner` is a raw object of encoded values, not itself a tagged value
    return Object.keys(inner).some((k) => containsUnserializable(inner[k]!));
  }
  return inner !== undefined && containsUnserializable(inner);
}
