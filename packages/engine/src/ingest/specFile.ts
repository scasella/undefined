/**
 * The canonical spec file, `undefined-spec` v1 (docs/WORKSPACE-DESIGN.md §3.2): the site's own FunctionSpec fields per
 * function, keyed by function name, plus optional triggering calls and dataset rows.
 *
 *   { "format": "undefined-spec", "version": 1,
 *     "functions": { "median": { "doc": "…", "tests": "test('…', () => { eq(median([3, 1, 2]), 2); });",
 *                                "properties": "…", "budgetMs": 1000, "params": [{ "name": "numbers", "type": "number[]" }],
 *                                "returns": "number", "typeDecls": "…", "pins": […], "decisions": […],
 *                                "calls": [ [[3, 1, 4, 2]] ] } },
 *     "datasets": { "<sha256>": [ { "customer": "a", "total": 3 } ] } }
 *
 * `tests`/`properties` are the site's Test API source, exactly the text the site hashes. `params`/`returns`/`typeDecls`
 * are optional; when present they must equal what was read from the source file (they feed specHash and so the seed).
 * `doc` wins over the function's JSDoc. `pins`/`decisions` are validated by the same validators the site's image
 * reader uses (spec/validate.ts). `calls` are argument lists encoded with shared/serialize.ts; the first is handed to the
 * gates as the triggering call (the Invariants replay), like the site's REPL call. Not hashed, like the site. Unknown
 * keys are errors: a typo must not silently weaken a spec. Every error is path-addressed.
 */
import type { Decision, FunctionSpec, Hash, Json, ParamSpec, Pin } from '../types';
import { DEFAULT_BUDGET_MS } from '../gates/source';
import { decodeValue } from '../shared/serialize';
import { arr, bad, Invalid, isJson, nonEmpty, num, obj, optStr, str, vDecisions, vPins, type Obj } from '../spec/validate';

export const SPEC_FORMAT = 'undefined-spec';
export const SPEC_VERSION = 1;

export interface SpecFileEntry {
  doc?: string;
  tests: string;
  properties: string;
  budgetMs?: number;
  params?: ParamSpec[];
  returns?: string | null;
  typeDecls?: string;
  pins?: Pin[];
  decisions?: Decision[];
  /** Encoded argument lists (shared/serialize.ts). */
  calls?: Json[][];
}

export interface SpecFile {
  functions: Record<string, SpecFileEntry>;
  /** hash → encoded rows (as in recordings v2). */
  datasets: Record<Hash, Json>;
}

const TOP_KEYS = new Set(['format', 'version', 'functions', 'datasets', '$schema', 'note']);
const ENTRY_KEYS = new Set(['doc', 'tests', 'properties', 'budgetMs', 'params', 'returns', 'typeDecls', 'pins', 'decisions', 'calls']);

export class SpecFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecFileError';
  }
}

/** Parse and validate an `undefined-spec` v1 document. Throws SpecFileError(`<file>: <path> <problem>`). */
export function parseSpecFile(text: string, file: string): SpecFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SpecFileError(`${file}: not JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  try {
    return validateSpecFile(raw);
  } catch (e) {
    if (e instanceof Invalid) throw new SpecFileError(`${file}: ${e.message}`);
    throw e;
  }
}

export function validateSpecFile(raw: unknown): SpecFile {
  const o = obj(raw, 'spec');
  if (o.format !== SPEC_FORMAT) bad('format', `must be "${SPEC_FORMAT}"`);
  if (o.version !== SPEC_VERSION) bad('version', `must be ${SPEC_VERSION} (this tool reads version ${SPEC_VERSION})`);
  for (const k of Object.keys(o)) if (!TOP_KEYS.has(k)) bad(k, `is not a key of an ${SPEC_FORMAT} file (allowed: format, version, functions, datasets)`);
  const fo = obj(o.functions, 'functions');
  const functions: Record<string, SpecFileEntry> = {};
  for (const name of Object.keys(fo)) {
    const path = `functions.${name}`;
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) bad(path, 'must be keyed by a function name');
    functions[name] = vEntry(fo[name], path);
  }
  const datasets: Record<Hash, Json> = {};
  if (o.datasets !== undefined) {
    const d = obj(o.datasets, 'datasets');
    for (const h of Object.keys(d)) {
      if (!/^[0-9a-f]{64}$/.test(h)) bad(`datasets.${h}`, 'dataset keys must be sha256 hashes');
      const rows = d[h];
      if (!Array.isArray(rows) || !isJson(rows)) bad(`datasets.${h}`, 'must be a JSON array of rows');
      datasets[h] = rows as Json;
    }
  }
  return { functions, datasets };
}

function vEntry(v: unknown, path: string): SpecFileEntry {
  const o: Obj = obj(v, path);
  for (const k of Object.keys(o)) if (!ENTRY_KEYS.has(k)) bad(`${path}.${k}`, `is not a spec field (allowed: ${[...ENTRY_KEYS].join(', ')})`);
  const entry: SpecFileEntry = {
    tests: o.tests === undefined ? '' : str(o, 'tests', path),
    properties: o.properties === undefined ? '' : str(o, 'properties', path),
  };
  const doc = optStr(o, 'doc', path);
  if (doc !== undefined) entry.doc = doc;
  if (o.budgetMs !== undefined) {
    const b = num(o, 'budgetMs', path);
    if (b <= 0) bad(`${path}.budgetMs`, 'must be a positive number of milliseconds');
    entry.budgetMs = b;
  }
  if (o.params !== undefined) {
    entry.params = arr(o, 'params', path).map((p, i) => {
      const pp = obj(p, `${path}.params[${i}]`);
      return { name: str(pp, 'name', `${path}.params[${i}]`), type: str(pp, 'type', `${path}.params[${i}]`) };
    });
  }
  if (o.returns !== undefined) entry.returns = o.returns === null ? null : str(o, 'returns', path);
  const typeDecls = optStr(o, 'typeDecls', path);
  if (typeDecls !== undefined) entry.typeDecls = typeDecls;
  if (o.pins !== undefined) entry.pins = vPins(o.pins, `${path}.pins`);
  if (o.decisions !== undefined) {
    const ds = nonEmpty(vDecisions(o.decisions, `${path}.decisions`));
    if (ds) entry.decisions = ds;
  }
  if (o.calls !== undefined) {
    entry.calls = arr(o, 'calls', path).map((c, i) => {
      if (!Array.isArray(c) || !isJson(c)) bad(`${path}.calls[${i}]`, 'must be an array of encoded arguments');
      return c as Json[];
    });
  }
  return entry;
}

/** What the source file says about a function (ingest/source.ts ExtractedFunction, the fields a spec needs). */
export interface SignatureFromSource {
  name: string;
  params: ParamSpec[];
  returns: string | null;
  doc: string;
  typeDecls: string;
}

/**
 * The FunctionSpec for one function: the signature from the source, the checks from the entry (if any). A
 * params/returns/typeDecls in the entry that differs from the source is an error naming both. `budgetMs` defaults to
 * `defaultBudgetMs` (1000, gates/source.ts) when the entry does not set it.
 */
export function specFor(sig: SignatureFromSource, entry: SpecFileEntry | undefined, opts: { defaultBudgetMs?: number; file?: string } = {}): FunctionSpec {
  const where = `${opts.file ? `${opts.file}: ` : ''}functions.${sig.name}`;
  if (entry?.params !== undefined && JSON.stringify(entry.params) !== JSON.stringify(sig.params)) {
    throw new SpecFileError(`${where}.params ${JSON.stringify(entry.params)} differs from the source signature ${JSON.stringify(sig.params)}`);
  }
  if (entry?.returns !== undefined && entry.returns !== sig.returns) {
    throw new SpecFileError(`${where}.returns ${JSON.stringify(entry.returns)} differs from the source's ${JSON.stringify(sig.returns)}`);
  }
  if (entry?.typeDecls !== undefined && entry.typeDecls.trim() !== sig.typeDecls.trim()) {
    throw new SpecFileError(`${where}.typeDecls differs from the type declarations the source function uses:\n${sig.typeDecls || '(none)'}`);
  }
  const spec: FunctionSpec = {
    name: sig.name,
    params: sig.params,
    returns: sig.returns,
    doc: entry?.doc ?? sig.doc,
    tests: entry?.tests ?? '',
    properties: entry?.properties ?? '',
    budgetMs: entry?.budgetMs ?? opts.defaultBudgetMs ?? DEFAULT_BUDGET_MS,
    maxAttempts: 1,
    origin: 'user',
  };
  const typeDecls = entry?.typeDecls ?? sig.typeDecls;
  if (typeDecls.trim() !== '') spec.typeDecls = typeDecls;
  if (entry?.pins && entry.pins.length > 0) spec.pins = entry.pins;
  if (entry?.decisions && entry.decisions.length > 0) spec.decisions = entry.decisions;
  return spec;
}

/** Decoded dataset rows by hash. */
export function decodeDatasets(datasets: Record<Hash, Json>): Record<Hash, unknown> {
  const out: Record<Hash, unknown> = {};
  for (const h of Object.keys(datasets)) out[h] = decodeValue(datasets[h]!);
  return out;
}

/** The first encoded call, decoded (the triggering call handed to the gates), or undefined. */
export function triggeringCall(entry: SpecFileEntry | undefined): unknown[] | undefined {
  const first = entry?.calls?.[0];
  return first ? first.map((a) => decodeValue(a)) : undefined;
}
