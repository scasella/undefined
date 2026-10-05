/**
 * Strict validators for specs and the parts of them stored or exchanged as JSON (decisions, pins), with path-addressed
 * errors (`image.revisions[0]…budgetMs must be a number`). Lifted unchanged from the site's core/store.ts, which now
 * imports them, so the site's image/recording reader and the CLI's spec-file reader are one validator, not a fork.
 */
import type { Decision, FunctionSpec, Json, Outcome, Pin } from '../types';

/** A validation failure; its message is `<path> <what>`. */
export class Invalid extends Error {}

export type Obj = Record<string, unknown>;

export function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isJson(v: unknown): v is Json {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJson);
  return isObject(v) && Object.values(v).every(isJson);
}

export function key(path: string, k: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
}

export function bad(path: string, what: string): never {
  throw new Invalid(`${path} ${what}`);
}

export function obj(v: unknown, path: string): Obj {
  return isObject(v) ? v : bad(path, 'must be an object');
}

export function str(o: Obj, k: string, path: string): string {
  const v = o[k];
  return typeof v === 'string' ? v : bad(key(path, k), 'must be a string');
}

export function optStr(o: Obj, k: string, path: string): string | undefined {
  return o[k] === undefined ? undefined : str(o, k, path);
}

export function num(o: Obj, k: string, path: string): number {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : bad(key(path, k), 'must be a number');
}

export function int(o: Obj, k: string, path: string, min = 0): number {
  const v = num(o, k, path);
  return Number.isInteger(v) && v >= min ? v : bad(key(path, k), `must be an integer >= ${min}`);
}

export function oneOf<T extends string>(o: Obj, k: string, path: string, allowed: readonly T[]): T {
  const v = o[k];
  return allowed.includes(v as T) ? (v as T) : bad(key(path, k), `must be one of ${allowed.join(', ')}`);
}

export function arr(o: Obj, k: string, path: string): unknown[] {
  const v = o[k];
  return Array.isArray(v) ? v : bad(key(path, k), 'must be an array');
}

/** Copies only the given optional fields that are present (keeps `undefined` keys out of the result). */
export function opt<T extends object>(base: T, extra: Obj): T {
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) (base as Obj)[k] = v;
  return base;
}

export const GAP_KINDS = ['empty', 'non-finite', 'negative', 'non-integer', 'duplicates', 'non-ascii', 'symbols', 'other'] as const;

export function vSpec(v: unknown, path: string): FunctionSpec {
  const o = obj(v, path);
  const name = str(o, 'name', path);
  const params = arr(o, 'params', path).map((p, i) => {
    const pp = obj(p, `${path}.params[${i}]`);
    return { name: str(pp, 'name', `${path}.params[${i}]`), type: str(pp, 'type', `${path}.params[${i}]`) };
  });
  const returns = o.returns === null ? null : str(o, 'returns', path);
  return opt(
    {
      name,
      params,
      returns,
      doc: str(o, 'doc', path),
      tests: str(o, 'tests', path),
      properties: str(o, 'properties', path),
      budgetMs: num(o, 'budgetMs', path),
      maxAttempts: int(o, 'maxAttempts', path, 1),
      origin: oneOf(o, 'origin', path, ['call', 'user', 'example'] as const),
    } as FunctionSpec,
    {
      exampleId: optStr(o, 'exampleId', path),
      typeDecls: optStr(o, 'typeDecls', path),
      pins: o.pins === undefined ? undefined : vPins(o.pins, `${path}.pins`),
      // an empty list is normalised to absent: a spec without decisions hashes and serialises as before them
      decisions: o.decisions === undefined ? undefined : nonEmpty(vDecisions(o.decisions, `${path}.decisions`)),
    },
  );
}

export function nonEmpty<T>(xs: T[]): T[] | undefined {
  return xs.length > 0 ? xs : undefined;
}

export function vOutcome(v: unknown, path: string): Outcome {
  const o = obj(v, path);
  if (o.throws !== undefined) {
    if (o.throws !== true || Object.keys(o).length !== 1) bad(path, 'must be { throws: true } or { returns: <encoded value> }');
    return { throws: true };
  }
  if (!('returns' in o) || Object.keys(o).length !== 1 || !isJson(o.returns)) bad(path, 'must be { throws: true } or { returns: <encoded value> }');
  return { returns: structuredClone(o.returns) as Json };
}

export function vDecisions(v: unknown, path: string): Decision[] {
  if (!Array.isArray(v)) bad(path, 'must be an array');
  const ids = new Set<string>();
  return (v as unknown[]).map((raw, i) => {
    const p = `${path}[${i}]`;
    const o = obj(raw, p);
    const id = str(o, 'id', p);
    if (ids.has(id)) bad(`${p}.id`, `must be unique (${JSON.stringify(id)} appears twice)`);
    ids.add(id);
    const args = arr(o, 'args', p);
    if (!isJson(args)) bad(`${p}.args`, 'must be JSON');
    const r = obj(o.ruling, `${p}.ruling`);
    const rk = oneOf(r, 'kind', `${p}.ruling`, ['outcome', 'expr'] as const);
    const ruling: Decision['ruling'] =
      rk === 'outcome'
        ? { kind: 'outcome', outcome: vOutcome(r.outcome, `${p}.ruling.outcome`), label: str(r, 'label', `${p}.ruling`) }
        : { kind: 'expr', expr: str(r, 'expr', `${p}.ruling`), label: str(r, 'label', `${p}.ruling`) };
    const a = obj(o.answers, `${p}.answers`);
    const answers = {
      check: str(a, 'check', `${p}.answers`),
      checkKind: oneOf(a, 'checkKind', `${p}.answers`, ['test', 'property'] as const),
      silentOn: str(a, 'silentOn', `${p}.answers`),
      gate: oneOf(a, 'gate', `${p}.answers`, ['tests', 'properties'] as const),
    };
    if (typeof o.waives !== 'boolean') bad(`${p}.waives`, 'must be a boolean');
    const test = str(o, 'test', p);
    if (test.trim() === '') bad(`${p}.test`, 'must not be empty');
    let rule: Decision['rule'];
    if (o.rule !== undefined) {
      const ro = obj(o.rule, `${p}.rule`);
      rule = { phrase: str(ro, 'phrase', `${p}.rule`), param: str(ro, 'param', `${p}.rule`) };
    }
    return opt(
      {
        id,
        kind: oneOf(o, 'kind', p, GAP_KINDS),
        call: str(o, 'call', p),
        args: structuredClone(args) as Json[],
        ruling,
        placement: oneOf(o, 'placement', p, ['tests', 'properties'] as const),
        answers,
        waives: o.waives as boolean,
        test,
        decidedAt: num(o, 'decidedAt', p),
      } as Decision,
      { rule, reason: optStr(o, 'reason', p) },
    );
  });
}

/**
 * Strict validation of a decisions list from an untrusted file (shared with the recording reader). Returns a
 * sanitised copy, or throws an Error whose message is the path-qualified problem.
 */
export function readDecisions(v: unknown, path: string): Decision[] {
  try {
    return vDecisions(v, path);
  } catch (e) {
    if (e instanceof Invalid) throw new Error(e.message);
    throw e;
  }
}

export function vPins(v: unknown, path: string): Pin[] {
  if (!Array.isArray(v)) bad(path, 'must be an array');
  return (v as unknown[]).map((raw, i) => {
    const p = `${path}[${i}]`;
    const o = obj(raw, p);
    const args = arr(o, 'args', p).map((a, j) => {
      const ao = obj(a, `${p}.args[${j}]`);
      if (ao.kind === 'dataset') return { kind: 'dataset' as const, name: str(ao, 'name', `${p}.args[${j}]`), hash: str(ao, 'hash', `${p}.args[${j}]`) };
      if (ao.kind === 'value') {
        if (!isJson(ao.encoded)) bad(`${p}.args[${j}].encoded`, 'must be JSON');
        return { kind: 'value' as const, encoded: structuredClone(ao.encoded) as Json };
      }
      return bad(`${p}.args[${j}].kind`, 'must be "dataset" or "value"');
    });
    if (!isJson(o.expected)) bad(`${p}.expected`, 'must be JSON');
    return { id: str(o, 'id', p), label: str(o, 'label', p), args, expected: structuredClone(o.expected) as Json, pinnedAt: num(o, 'pinnedAt', p) };
  });
}
