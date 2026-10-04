/**
 * TypeScript type text inferred from a real value (used to build a spec from a never-seen call).
 * Arrays are always `T[]` (never tuples); unions keep first-seen order.
 */
import { isDate, isMap, isPlainObject, isSet } from './show';

const IDENT = /^[A-Za-z_$][\w$]*$/;

export function inferType(v: unknown): string {
  return infer(v, []);
}

/**
 * Type text for a function passed directly as an argument of a never-seen call (`compose(x => x + 1, f)`). Explicit
 * `any` is allowed under strict TypeScript, and nothing more precise can be known from a function value.
 */
export const FUNCTION_ARG_TYPE = '(...args: any[]) => any';

/**
 * inferType for one ARGUMENT of a REPL call: a top-level function value is accepted as FUNCTION_ARG_TYPE (the real
 * function is passed through at runtime). Everything else, including a function nested inside an argument, is
 * exactly inferType (and throws where it throws).
 */
export function inferArgType(v: unknown): string {
  return typeof v === 'function' ? FUNCTION_ARG_TYPE : inferType(v);
}

function unsupported(what: string): Error {
  return new Error(`${what} arguments are not supported`);
}

function infer(v: unknown, ancestors: object[]): string {
  switch (typeof v) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'bigint':
    case 'undefined':
      return typeof v;
    case 'function':
    case 'symbol':
      throw unsupported(typeof v);
  }
  if (v === null) return 'null';
  const obj = v as object;
  if (ancestors.includes(obj)) throw unsupported('cyclic');
  if (isDate(obj)) return 'Date';

  ancestors.push(obj);
  try {
    const union = (values: Iterable<unknown>): string[] => {
      const types: string[] = [];
      for (const x of values) {
        const t = infer(x, ancestors);
        if (!types.includes(t)) types.push(t);
      }
      return types;
    };
    if (Array.isArray(obj)) {
      const types = union(obj as unknown[]);
      if (types.length === 0) return 'unknown[]';
      return types.length === 1 ? `${types[0]}[]` : `(${types.join(' | ')})[]`;
    }
    if (isMap(obj)) {
      if (obj.size === 0) return 'Map<unknown, unknown>';
      return `Map<${union(obj.keys()).join(' | ')}, ${union(obj.values()).join(' | ')}>`;
    }
    if (isSet(obj)) {
      return obj.size === 0 ? 'Set<unknown>' : `Set<${union(obj.values()).join(' | ')}>`;
    }
    if (!isPlainObject(obj)) throw unsupported(`class instance (${className(obj)})`);
    const fields = Object.keys(obj).map((k) => {
      const key = IDENT.test(k) ? k : JSON.stringify(k);
      return `${key}: ${infer((obj as Record<string, unknown>)[k], ancestors)}`;
    });
    return fields.length === 0 ? '{}' : `{ ${fields.join('; ')} }`;
  } finally {
    ancestors.pop();
  }
}

function className(obj: object): string {
  const ctor = (Object.getPrototypeOf(obj) as { constructor?: unknown } | null)?.constructor;
  return typeof ctor === 'function' && ctor.name ? ctor.name : Object.prototype.toString.call(obj).slice(8, -1);
}
