/**
 * An in-realm `structuredClone` for the Node host's `node:vm` realm (packages/engine/src/node/harness.ts).
 *
 * Why it exists: the gate code (gateExecutor.ts, testApi.ts) clones candidate arguments with `structuredClone`, and the
 * Node realm has none. Handing it the worker's own native function would give candidate code an outer-realm
 * `Function` (`structuredClone.constructor('return process')()`), the classic `vm` escape, and the native clone would
 * also return outer-realm objects. So the realm gets this implementation, bundled into the harness and evaluated
 * inside the realm. The browser keeps its native `structuredClone`; this module is imported only by the Node harness.
 *
 * It follows the HTML structured clone algorithm for every value a candidate can see in the gates: primitives
 * (including -0, NaN and bigint), arrays (length, holes and extra own properties kept), plain objects and class
 * instances (own enumerable string keys, getters invoked, result is a plain object), Boolean/Number/String/BigInt
 * wrappers, Date, RegExp (lastIndex reset), Map, Set, ArrayBuffer, typed arrays and DataView (shared buffers stay
 * shared), Error and its six native subclasses (name, message, stack, cause), and shared references and cycles (the
 * copy has the same shape). Functions, symbols, WeakMap/WeakSet/WeakRef and Promise throw a `DataCloneError`, as the
 * native one does; every caller in the gates already catches that (`cloneOrSelf`). Known differences, all outside what
 * the gates hand to candidates: a Proxy is cloned through its traps (the native clone throws), and `Error` subclasses
 * defined by user code clone as `Error` (as natively).
 */

// Intrinsics captured at load: candidate code runs in this realm and could replace the globals.
const objectKeys = Object.keys;
const defineProp = Object.defineProperty;
const hasOwn = Object.prototype.hasOwnProperty;
const toStringTag = Object.prototype.toString;
const isArray = Array.isArray;
const isView = ArrayBuffer.isView;
const RealMap = Map;
const RealSet = Set;
const RealDate = Date;
const RealRegExp = RegExp;
const RealArrayBuffer = ArrayBuffer;
const RealDataView = DataView;
const mapEntries = Map.prototype.entries;
const setValues = Set.prototype.values;
const mapSet = Map.prototype.set;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;
const setAdd = Set.prototype.add;
const dateGetTime = Date.prototype.getTime;
const bufferSlice = ArrayBuffer.prototype.slice;
const weakMapHas = WeakMap.prototype.has;
const weakSetHas = WeakSet.prototype.has;
const regExpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get!;
const regExpFlags = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags')!.get!;
const booleanValueOf = Boolean.prototype.valueOf;
const numberValueOf = Number.prototype.valueOf;
const stringValueOf = String.prototype.valueOf;
const bigintValueOf = BigInt.prototype.valueOf;

const ERRORS: Record<string, ErrorConstructor> = {
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
};

type TypedCtor = new (buffer: ArrayBuffer, byteOffset: number, length: number) => ArrayBufferView;
const TYPED: Record<string, TypedCtor> = {
  Int8Array: Int8Array as unknown as TypedCtor,
  Uint8Array: Uint8Array as unknown as TypedCtor,
  Uint8ClampedArray: Uint8ClampedArray as unknown as TypedCtor,
  Int16Array: Int16Array as unknown as TypedCtor,
  Uint16Array: Uint16Array as unknown as TypedCtor,
  Int32Array: Int32Array as unknown as TypedCtor,
  Uint32Array: Uint32Array as unknown as TypedCtor,
  Float32Array: Float32Array as unknown as TypedCtor,
  Float64Array: Float64Array as unknown as TypedCtor,
  BigInt64Array: BigInt64Array as unknown as TypedCtor,
  BigUint64Array: BigUint64Array as unknown as TypedCtor,
};

function dataCloneError(what: string): Error {
  const e = new Error(`${what} could not be cloned.`);
  e.name = 'DataCloneError';
  return e;
}

function tagOf(v: object): string {
  return (toStringTag.call(v) as string).slice(8, -1);
}

function brand(v: object, check: (this: object, k: object) => boolean): boolean {
  try {
    check.call(v, {});
    return true;
  } catch {
    return false;
  }
}

/** Define (never assign: a "__proto__" key must stay an own data property, as in the native clone). */
function put(target: object, key: string, value: unknown): void {
  defineProp(target, key, { value, writable: true, enumerable: true, configurable: true });
}

export function structuredClonePolyfill<T>(value: T): T {
  const memo = new RealMap<object, unknown>();
  const copy = (v: unknown): unknown => {
    switch (typeof v) {
      case 'function':
        throw dataCloneError(String((v as { name?: unknown }).name ? `function ${String((v as { name: unknown }).name)}` : 'function'));
      case 'symbol':
        throw dataCloneError('Symbol()');
      case 'object':
        break;
      default:
        return v;
    }
    if (v === null) return v;
    const o = v as object;
    if (mapHas.call(memo, o)) return mapGet.call(memo, o);
    const tag = tagOf(o);

    if (isArray(o)) {
      const arr = o as unknown[];
      const out = new Array(arr.length);
      mapSet.call(memo, o, out);
      for (const k of objectKeys(arr)) put(out, k, copy(arr[k as unknown as number]));
      return out;
    }
    if (tag === 'Date') {
      try {
        const out = new RealDate(dateGetTime.call(o as Date));
        mapSet.call(memo, o, out);
        return out;
      } catch {
        /* not a real Date (spoofed tag): cloned as an object below */
      }
    }
    if (tag === 'RegExp') {
      try {
        const out = new RealRegExp(regExpSource.call(o) as string, regExpFlags.call(o) as string);
        mapSet.call(memo, o, out);
        return out;
      } catch {
        /* spoofed tag */
      }
    }
    if (tag === 'Map') {
      let entries: Iterable<[unknown, unknown]> | undefined;
      try {
        entries = [...(mapEntries.call(o as Map<unknown, unknown>) as Iterable<[unknown, unknown]>)];
      } catch {
        entries = undefined;
      }
      if (entries) {
        const out = new RealMap();
        mapSet.call(memo, o, out);
        for (const [k, x] of entries) mapSet.call(out, copy(k), copy(x));
        return out;
      }
    }
    if (tag === 'Set') {
      let values: unknown[] | undefined;
      try {
        values = [...(setValues.call(o as Set<unknown>) as Iterable<unknown>)];
      } catch {
        values = undefined;
      }
      if (values) {
        const out = new RealSet();
        mapSet.call(memo, o, out);
        for (const x of values) setAdd.call(out, copy(x));
        return out;
      }
    }
    if (tag === 'ArrayBuffer') {
      const out = bufferSlice.call(o as ArrayBuffer, 0) as ArrayBuffer;
      mapSet.call(memo, o, out);
      return out;
    }
    if (isView(o)) {
      const view = o as ArrayBufferView & { length?: number };
      const buffer = copy(view.buffer) as ArrayBuffer;
      const out =
        tag === 'DataView'
          ? new RealDataView(buffer, view.byteOffset, view.byteLength)
          : new (TYPED[tag] ?? (TYPED.Uint8Array as TypedCtor))(buffer, view.byteOffset, TYPED[tag] ? (view.length as number) : view.byteLength);
      mapSet.call(memo, o, out);
      return out;
    }
    if (tag === 'Error') {
      const e = o as Error & { cause?: unknown };
      const rawName = e.name;
      const name = typeof rawName === 'string' && hasOwn.call(ERRORS, rawName) ? rawName : 'Error';
      const out = new ERRORS[name]!();
      mapSet.call(memo, o, out);
      if (hasOwn.call(e, 'message')) defineProp(out, 'message', { value: String(e.message), writable: true, enumerable: false, configurable: true });
      if (typeof e.stack === 'string') defineProp(out, 'stack', { value: e.stack, writable: true, enumerable: false, configurable: true });
      if (hasOwn.call(e, 'cause')) defineProp(out, 'cause', { value: copy(e.cause), writable: true, enumerable: false, configurable: true });
      return out;
    }
    if (tag === 'Boolean' || tag === 'Number' || tag === 'String' || tag === 'BigInt') {
      try {
        const inner =
          tag === 'Boolean' ? booleanValueOf.call(o) : tag === 'Number' ? numberValueOf.call(o) : tag === 'String' ? stringValueOf.call(o) : bigintValueOf.call(o);
        const out = Object(inner) as object;
        mapSet.call(memo, o, out);
        return out;
      } catch {
        /* spoofed tag */
      }
    }
    if (brand(o, weakMapHas as (this: object, k: object) => boolean)) throw dataCloneError('#<WeakMap>');
    if (brand(o, weakSetHas as (this: object, k: object) => boolean)) throw dataCloneError('#<WeakSet>');
    if (tag === 'WeakRef' || tag === 'Promise' || tag === 'FinalizationRegistry') throw dataCloneError(`#<${tag}>`);

    // plain objects and class instances: own enumerable string keys (getters invoked); the copy is a plain object
    const out: Record<string, unknown> = {};
    mapSet.call(memo, o, out);
    for (const k of objectKeys(o)) put(out, k, copy((o as Record<string, unknown>)[k]));
    return out;
  };
  return copy(value) as T;
}
