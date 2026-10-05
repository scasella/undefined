/**
 * "Eject": a committed function as a standalone project folder — `<name>.ts`, `<name>.test.ts` (vitest +
 * fast-check, the spec's unit tests, pinned results and properties, runnable as-is), `provenance.json` and a
 * `README.md` — and as a zip of those files. Pure: no DOM, no engine; the caller passes the records and any dataset
 * rows that pins refer to.
 *
 * The test file reproduces the app's Test API (sandbox/testApi.ts, sandbox/gateExecutor.ts) in an inline prelude:
 * the same deep equality, the same `throws` matching, properties run by fast-check with the gate's seed and default
 * run count, predicates that fail only on `false` or a throw, arguments cloned before every predicate call, and
 * `matchesReference` with the same "if the reference throws, the function must throw too" rule. The "spec was
 * silent" markers (silentOn / reasonable / when) never change a verdict in the app; here they only add a sentence
 * to the failure message, under the same rule (`when` must hold at the shrunk counterexample).
 *
 * Decisions (the user's rulings where a check said the spec was silent) are their own section, each with its
 * "decided by you on <date>: <reason>" note; a check a decision replaced is waived exactly as in the app (a waived unit
 * test is skipped with a note; a waived property passes vacuously where its `when` holds, and is skipped without one).
 *
 * NOT reproduced: the Invariants gate (purity by frozen-argument replay, the per-call time budget) and the sandbox
 * itself. The README says so.
 */
import type { DatasetRef, Decision, FunctionRecord, Hash, Json, Pin, Revision, WaivedCheck } from '../types';
import { describeEvidence } from '../shared/evidence';
import { decisionsOf, decisionSummary, waivedBy } from '../decide/decisions';
import { gateSeed } from '../shared/hash';
import { isStale } from '../core/program';
import { tsLiteral, tsRowsLiteral } from './literal';
import { zipStore } from './zip';

export interface EjectFile {
  /** Path inside the eject folder, e.g. `median.test.ts`. */
  path: string;
  text: string;
}

export interface EjectInput {
  /**
   * The function to eject FIRST, then (later) the functions it depends on. Only a single function is supported
   * today; the list shape is so a closure can be passed in without changing callers.
   */
  functions: FunctionRecord[];
  /** Encoded dataset rows by hash (Image.datasets): needed only for pins with dataset arguments. */
  datasets?: Record<Hash, Json>;
  /** Bound datasets, for provenance (names, row counts, columns). */
  datasetRefs?: DatasetRef[];
  /** Revision log entries, so provenance can quote the commit's title and detail. */
  revisions?: Array<Pick<Revision, 'id' | 'at' | 'kind' | 'title' | 'detail'>>;
  /** When the eject happened (ms since epoch). */
  now: number;
  /** Versions written into the README (the repo's package.json ranges). */
  versions?: { vitest: string; fastCheck: string; typescript: string };
}

export interface EjectResult {
  name: string;
  /** Folder name used inside the zip. */
  folder: string;
  files: EjectFile[];
}

export const DEFAULT_VERSIONS = { vitest: '^4.1.11', fastCheck: '^4.10.2', typescript: '^5.9.3' };

/** Must match gateExecutor.ts DEFAULT_RUNS. */
export const DEFAULT_RUNS = 100;

/** Why `fn` cannot be ejected right now, or null when it can. */
export function ejectBlocker(rec: FunctionRecord | undefined): string | null {
  if (!rec) return 'no such function';
  if (!rec.artifact) return 'nothing is committed yet';
  if (isStale(rec)) return 'the committed function is out of date: its spec or checks changed after it was certified';
  return null;
}

export function ejectFiles(input: EjectInput): EjectResult {
  const [root, ...rest] = input.functions;
  if (!root) throw new Error('eject: no function given');
  if (rest.length > 0) throw new Error('eject: only a single function can be ejected for now');
  const blocker = ejectBlocker(root);
  if (blocker) throw new Error(`eject: cannot eject ${root.spec.name}: ${blocker}`);
  const name = root.spec.name;
  const files: EjectFile[] = [
    { path: `${name}.ts`, text: functionFile(root) },
    { path: `${name}.test.ts`, text: testFile(root, input.datasets ?? {}) },
    { path: 'provenance.json', text: `${JSON.stringify(provenance(root, input), null, 2)}\n` },
    { path: 'README.md', text: readme(root, input.versions ?? DEFAULT_VERSIONS) },
  ];
  return { name, folder: `${name}-eject`, files };
}

/** The zip the "Eject" button downloads: the files inside a `<name>-eject/` folder. */
export function ejectZip(input: EjectInput): { filename: string; bytes: Uint8Array } {
  const r = ejectFiles(input);
  const bytes = zipStore(
    r.files.map((f) => ({ name: `${r.folder}/${f.path}`, data: f.text })),
    new Date(input.now),
  );
  return { filename: `${r.folder}.zip`, bytes };
}

// ───────────────────────── <name>.ts ─────────────────────────

const DECL = /^(export\s+)?(declare\s+)?(type|interface|enum|const\s+enum|class)\s+([A-Za-z_$][\w$]*)/;

/** Top-level declarations in typeDecls, by kind (type-only names are imported with `type`). */
export function declaredNames(typeDecls: string): Array<{ name: string; typeOnly: boolean }> {
  const out: Array<{ name: string; typeOnly: boolean }> = [];
  for (const line of typeDecls.split(/\r?\n/)) {
    const m = DECL.exec(line);
    if (m && !out.some((o) => o.name === m[4])) out.push({ name: m[4]!, typeOnly: m[3] === 'type' || m[3] === 'interface' });
  }
  return out;
}

/** typeDecls with each unindented top-level declaration exported (so the test file can import it). */
export function exportedDecls(typeDecls: string): string {
  return typeDecls
    .replace(/\r\n?/g, '\n')
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => (DECL.test(line) && !/^export\s/.test(line) ? `export ${line}` : line))
    .join('\n');
}

function jsDoc(lines: string[]): string {
  const safe = lines.flatMap((l) => l.replace(/\*\//g, '*\\/').split('\n'));
  return ['/**', ...safe.map((l) => (l === '' ? ' *' : ` * ${l}`)), ' */'].join('\n');
}

function wrapText(text: string, width = 110): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (para.trim() === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function functionFile(rec: FunctionRecord): string {
  const { spec } = rec;
  const a = rec.artifact!;
  const params = spec.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const ret = spec.returns ?? (a.returnType !== '' ? a.returnType : null);
  const doc = spec.doc.trim() !== '' ? wrapText(spec.doc) : ['(The spec has no doc: this function was grown from a call alone.)'];
  const by = `${a.model || 'an unknown model'}${a.codexVersion ? ` via Codex ${a.codexVersion}` : ''}`;
  const header = jsDoc([
    ...doc,
    '',
    `Generated by ${by} and certified by Undefined at revision r${a.revision}, ${new Date(a.committedAt).toISOString()}.`,
    'The body is exactly as the model wrote it. See provenance.json and README.md.',
  ]);
  const decls = exportedDecls(spec.typeDecls ?? '');
  const body = a.body.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  return `${decls ? `${decls}\n\n` : ''}${header}\nexport function ${spec.name}(${params})${ret === null ? '' : `: ${ret}`} {\n${body}\n}\n`;
}

// ───────────────────────── <name>.test.ts ─────────────────────────

/** Names the test code sees, as in sandbox/testApi.ts API_NAMES. */
const API_NAMES = ['test', 'eq', 'throws', 'property', 'matchesReference', 'fc'] as const;

/**
 * The inline Test API. Internal helpers are prefixed `__u` so they cannot collide with the function or with
 * identifiers in the spec's test code. `omit` is an API name the function itself takes (it then shadows it, as in
 * the app).
 */
function prelude(omit: string | null, waived: readonly WaivedCheck[]): string {
  const api = (n: (typeof API_NAMES)[number], code: string): string => (n === omit ? `// (\`${n}\` is the function under test, so the API's ${n} is not defined)\n` : code);
  return String.raw`// ───────── Undefined's Test API, inlined (src/sandbox/testApi.ts) ─────────
// test(name, body, marker?)         a unit test (synchronous)
// eq(actual, expected, message?)    deep equality: Object.is for primitives (NaN equals NaN, -0 differs from 0),
//                                   arrays, plain objects (own enumerable keys), Map, Set, Date, RegExp, Error, typed arrays
// throws(fn, match?)                fn must throw; match is a substring of the message or a RegExp
// property(name, [arbs], predicate, opts?)
//                                   fast-check property: fails when the predicate returns false or throws;
//                                   arguments are cloned before every call; opts.numRuns (default ${DEFAULT_RUNS})
// matchesReference(name, [arbs], reference, opts?)
//                                   the function must equal the reference on every input (eq's equality); where the
//                                   reference throws, the function must throw too (any error)
// Markers (opts / third argument of test): { silentOn, reasonable, when }. silentOn completes "The spec didn't say
// ___": the check holds a convention the doc is silent on; reasonable says why a different choice is defensible;
// when (properties only) limits the marker to counterexamples where it returns true. Markers never change whether a
// check passes; in Undefined they label the rejection, here they are appended to the failure message.
// Not reproduced here: the Invariants gate (purity by frozen-argument replay, the per-call time budget).

interface __uMarker {
  silentOn?: string;
  reasonable?: string;
}
interface __uPropertyOpts extends __uMarker {
  numRuns?: number;
  when?: (...args: any[]) => unknown;
}

declare const structuredClone: <T>(value: T) => T;

const __uIs = Object.is;
const __uTag = (v: object): string => (Object.prototype.toString.call(v) as string).slice(8, -1);

function __uDeepEqual(a: unknown, b: unknown, seen: Array<[object, object]> = []): boolean {
  if (__uIs(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (seen.some(([x, y]) => x === a && y === b)) return true;
  seen = [...seen, [a, b]];
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const tag = __uTag(a);
  if (tag !== __uTag(b)) return false;
  if (a instanceof Date) return b instanceof Date && __uIs(a.getTime(), b.getTime());
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !__uDeepEqual(v, b.get(k), seen)) return false;
    return true;
  }
  if (a instanceof Set) {
    if (!(b instanceof Set) || a.size !== b.size) return false;
    const unmatched = [...b].filter((x) => !a.has(x));
    for (const x of a) {
      if (b.has(x)) continue;
      if (typeof x !== 'object' || x === null) return false;
      const i = unmatched.findIndex((y) => __uDeepEqual(x, y, seen));
      if (i < 0) return false;
      unmatched.splice(i, 1);
    }
    return true;
  }
  if (tag === 'RegExp') return String(a) === String(b);
  if (tag === 'Error') return (a as Error).name === (b as Error).name && (a as Error).message === (b as Error).message;
  if (ArrayBuffer.isView(a)) {
    const xa = a as unknown as ArrayLike<unknown>;
    const xb = b as unknown as ArrayLike<unknown>;
    if (xa.length !== xb.length) return false;
    for (let i = 0; i < xa.length; i++) if (!__uIs(xa[i], xb[i])) return false;
    return true;
  }
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!__uDeepEqual(a[i], bb[i], seen)) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && __uDeepEqual(ra[k], rb[k], seen));
}

function __uShow(v: unknown, depth = 0): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'bigint') return ${'`${v}n`'};
  if (typeof v === 'number') return __uIs(v, -0) ? '-0' : String(v);
  if (typeof v === 'function') return ${'`[Function ${v.name || "anonymous"}]`'};
  if (typeof v !== 'object' || v === null) return String(v);
  if (depth > 3) return '…';
  const list = (xs: unknown[]): string => {
    const shown = xs.slice(0, 20).map((x) => __uShow(x, depth + 1));
    return shown.join(', ') + (xs.length > 20 ? ${'`, … (${xs.length} items)`'} : '');
  };
  if (Array.isArray(v)) return ${'`[${list(v)}]`'};
  if (v instanceof Date) return ${'`Date(${Number.isNaN(v.getTime()) ? "Invalid" : v.toISOString()})`'};
  if (v instanceof Map) return ${'`Map {${list([...v].map(([k, x]) => `${__uShow(k, depth + 1)} => ${__uShow(x, depth + 1)}`))}}`'};
  if (v instanceof Set) return ${'`Set {${list([...v])}}`'};
  if (v instanceof Error) return ${'`${v.name}: ${v.message}`'};
  const o = v as Record<string, unknown>;
  return ${'`{ ${Object.keys(o).slice(0, 20).map((k) => `${k}: ${__uShow(o[k], depth + 1)}`).join(", ")} }`'};
}

class __uAssertionFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionFailure';
  }
}

function __uMarkerText(m: __uMarker | undefined): string {
  if (!m || (m.silentOn === undefined && m.reasonable === undefined)) return '';
  const said = m.silentOn !== undefined ? ${'` The spec didn\'t say ${m.silentOn}; this check holds a convention.`'} : '';
  const why = m.reasonable !== undefined ? ${'` ${m.reasonable}`'} : '';
  return ${'`\\n[spec was silent]${said}${why}`'};
}

function __uWithMarker(e: unknown, marker: string): unknown {
  if (marker === '') return e;
  if (e instanceof Error) {
    e.message += marker;
    return e;
  }
  return new Error(${'`${__uShow(e)}${marker}`'});
}

function __uClone<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return v;
  }
}

/** The gate's fixed fast-check seed: gateSeed(specHash, testsHash) of the certified spec. */
const __uSEED = __SEED__;

/**
 * Checks replaced by your decisions (see "your decisions" below): a unit test here is skipped; a property here passes
 * where its "when" holds (the case the spec was silent on, which your decision now rules) and is skipped without one.
 */
const __uWaived: Array<{ kind: 'test' | 'property'; name: string }> = ${JSON.stringify(waived)};
const __uIsWaived = (kind: 'test' | 'property', name: string): boolean => __uWaived.some((w) => w.kind === kind && w.name === name);

${api('test', `function test(name: string, body: () => void, marker?: __uMarker): void {
  if (__uIsWaived('test', name)) {
    __uIt.skip(\`\${name} (replaced by your decision)\`, () => {});
    return;
  }
  __uIt(name, () => {
    try {
      const r = body() as unknown;
      if (typeof r === 'object' && r !== null && typeof (r as { then?: unknown }).then === 'function') {
        throw new Error('async tests are not supported; the test body must be synchronous');
      }
    } catch (e) {
      throw __uWithMarker(e, __uMarkerText(marker));
    }
  });
}
`)}
${api('eq', `function eq(actual: unknown, expected: unknown, message?: string): void {
  if (!__uDeepEqual(actual, expected)) {
    throw new __uAssertionFailure(message ?? \`expected \${__uShow(expected)}, got \${__uShow(actual)}\`);
  }
}
`)}
${api('throws', `function throws(fn: () => unknown, match?: RegExp | string): void {
  let error: unknown;
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    error = e;
  }
  const wanted = match === undefined ? 'an error' : \`an error matching \${typeof match === 'string' ? JSON.stringify(match) : String(match)}\`;
  if (!threw) throw new __uAssertionFailure(\`expected \${wanted}, but nothing was thrown\`);
  if (match === undefined) return;
  const text =
    error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)
      ? String((error as { message: unknown }).message)
      : String(error);
  const ok = typeof match === 'string' ? text.includes(match) : match.test(text);
  if (!ok) throw new __uAssertionFailure(\`expected \${wanted}, got \${__uShow(error)}\`);
}
`)}
function __uRunProperty(name: string, arbs: unknown[], predicate: (...args: any[]) => unknown, opts: __uPropertyOpts = {}): void {
  const waivedWhen = __uIsWaived('property', name) ? opts.when : undefined;
  if (__uIsWaived('property', name) && waivedWhen === undefined) {
    __uIt.skip(${'`${name} (replaced by your decision)`'}, () => {});
    return;
  }
  __uIt(name, () => {
    const pred = (...args: unknown[]): boolean => {
      if (waivedWhen !== undefined) {
        let inDomain = false;
        try {
          inDomain = waivedWhen(...args.map(__uClone)) === true;
        } catch {
          inDomain = false;
        }
        if (inDomain) return true; // replaced by your decision where the spec was silent
      }
      const r = predicate(...args.map(__uClone));
      if (typeof r === 'object' && r !== null && typeof (r as { then?: unknown }).then === 'function') {
        throw new Error('async predicates are not supported');
      }
      return r !== false;
    };
    const prop = (__ufc.property as unknown as (...a: unknown[]) => __ufc.IProperty<unknown[]>)(...arbs, pred);
    const details = __ufc.check(prop, { seed: __uSEED, numRuns: opts.numRuns ?? ${DEFAULT_RUNS} });
    if (!details.failed) return;
    const cx = details.counterexample as unknown[] | null;
    let applies = opts.when === undefined;
    if (cx && opts.when !== undefined) {
      try {
        applies = opts.when(...cx.map(__uClone)) === true;
      } catch {
        applies = false;
      }
    }
    let report = __ufc.defaultReportMessage(details) ?? ${'`property "${name}" failed`'};
    const error = details.errorInstance;
    if (error !== null && error !== undefined && !report.includes(String((error as { message?: unknown }).message ?? error))) {
      report += ${'`\\nGot ${__uShow(error)}`'};
    }
    throw new __uAssertionFailure(report + (applies ? __uMarkerText(opts) : ''));
  });
}

${api('property', `function property(name: string, arbs: unknown[], predicate: (...args: any[]) => unknown, opts?: __uPropertyOpts): void {
  __uRunProperty(name, arbs, predicate, opts);
}
`)}
${api('matchesReference', `function matchesReference(name: string, arbs: unknown[], reference: (...args: any[]) => unknown, opts?: __uPropertyOpts): void {
  __uRunProperty(
    name,
    arbs,
    (...args: unknown[]) => {
      let expected: unknown;
      let refError: unknown;
      let refThrew = false;
      try {
        expected = reference(...args.map(__uClone));
      } catch (e) {
        refThrew = true;
        refError = e;
      }
      if (refThrew) {
        let actual: unknown;
        try {
          actual = __uSubject(...args.map(__uClone));
        } catch {
          return;
        }
        throw new __uAssertionFailure(\`expected to throw (reference threw \${__uShow(refError)}), got \${__uShow(actual)}\`);
      }
      const actual = __uSubject(...args.map(__uClone));
      if (!__uDeepEqual(actual, expected)) throw new __uAssertionFailure(\`expected \${__uShow(expected)}, got \${__uShow(actual)}\`);
    },
    opts,
  );
}
`)}`;
}

function pinTest(pin: Pin, datasetConst: (hash: Hash) => string | null): string {
  const missing = pin.args.find((a) => a.kind === 'dataset' && datasetConst(a.hash) === null);
  const title = JSON.stringify(`pinned: ${pin.label}`);
  if (missing && missing.kind === 'dataset') {
    return `  // The rows of dataset \`${missing.name}\` (${missing.hash.slice(0, 12)}…) were not available when this was ejected.\n  __uIt.skip(${title}, () => {});\n`;
  }
  const args = pin.args.map((a) => (a.kind === 'dataset' ? datasetConst(a.hash)! : tsLiteral(a.encoded, '    ')));
  return `  __uIt(${title}, () => {
    // pinned ${new Date(pin.pinnedAt).toISOString()}; the arguments are deep-cloned before the call, as in the app
    const args: unknown[] = __uClone([${args.join(', ')}]);
    const expected: unknown = ${tsLiteral(pin.expected, '    ')};
    const actual = __uSubject(...args);
    if (!__uDeepEqual(actual, expected)) {
      throw new __uAssertionFailure(${JSON.stringify(pin.label)} + ' returned ' + __uShow(actual) + ', expected ' + __uShow(expected));
    }
  });
`;
}

function indentCode(code: string): string {
  // Template literals in the spec's code must keep their exact text, so lines are left as written.
  return code.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

export function testFile(rec: FunctionRecord, datasets: Record<Hash, Json>): string {
  const { spec } = rec;
  const name = spec.name;
  const a = rec.artifact!;
  const seed = gateSeed(a.specHash, a.testsHash);
  const omit = (API_NAMES as readonly string[]).includes(name) ? name : null;
  const types = declaredNames(spec.typeDecls ?? '');
  const imports = [name, ...types.map((t) => (t.typeOnly ? `type ${t.name}` : t.name))].join(', ');
  const pins = spec.pins ?? [];

  const datasetHashes = [...new Set(pins.flatMap((p) => p.args.flatMap((x) => (x.kind === 'dataset' ? [x.hash] : []))))];
  const constFor = (hash: Hash): string | null => (datasets[hash] !== undefined ? `__uDATASET_${hash.slice(0, 12)}` : null);
  const datasetBlocks = datasetHashes
    .filter((h) => constFor(h) !== null)
    .map((h) => {
      const names = [...new Set(pins.flatMap((p) => p.args.flatMap((x) => (x.kind === 'dataset' && x.hash === h ? [x.name] : []))))];
      return `/** Dataset \`${names.join('`, `')}\` (sha256 ${h}), as the pins saw it. */\nconst ${constFor(h)}: unknown[] = ${tsRowsLiteral(datasets[h]!)};\n`;
    });

  const header = `/**
 * Tests for ${name}, ejected from Undefined: the spec's unit tests, pinned results and properties, as vitest +
 * fast-check tests. Run with \`npx vitest run\`. Each block below is the spec's own code, unchanged; the Test API it
 * uses (test, eq, throws, property, matchesReference, fc) is defined in the prelude.
 */
import { describe as __uDescribe, it as __uIt } from 'vitest';
import * as __ufc from 'fast-check';
${omit === 'fc' ? '' : "import * as fc from 'fast-check';\n"}import { ${imports} } from './${name}';

const __uSubject = ${name} as unknown as (...args: unknown[]) => unknown;
`;

  const sections: string[] = [];
  const hasTests = spec.tests.trim() !== '';
  const hasProps = spec.properties.trim() !== '';
  if (hasTests) sections.push(`// ───────── unit tests (spec.tests) ─────────\n__uDescribe('unit tests', () => {\n${indentCode(spec.tests)}\n});\n`);
  if (pins.length > 0) {
    sections.push(`// ───────── pinned results (spec.pins): each call must return exactly what was pinned ─────────\n__uDescribe('pinned results', () => {\n${pins.map((p) => pinTest(p, constFor)).join('\n')}});\n`);
  }
  if (hasProps) sections.push(`// ───────── properties (spec.properties) ─────────\n__uDescribe('properties', () => {\n${indentCode(spec.properties)}\n});\n`);
  const decisions = decisionsOf(spec);
  if (decisions.length > 0) sections.push(decisionsSection(decisions));
  if (sections.length === 0) {
    sections.push(`// The spec has no unit tests, no pinned results and no properties: in Undefined only the Compile and Invariants
// gates checked this function. Add tests here (or pin a result in the app and eject again).
__uIt.todo(${JSON.stringify(`${name}: no tests yet`)});\n`);
  }

  return [header, prelude(omit, waivedBy(decisions)).replace('__SEED__', String(seed)), ...datasetBlocks, ...sections].join('\n');
}

/** `2026-10-04` (UTC). */
function isoDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** One line of comment text (a reason cannot end the comment or add lines). */
function commentText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The decisions as their own section: each generated test as stored, under its "decided by you" note. */
function decisionsSection(decisions: readonly Decision[]): string {
  const blocks = decisions.map((d) => {
    const note = `// decided by you on ${isoDate(d.decidedAt)}${d.reason ? `: ${commentText(d.reason)}` : ''}`;
    const replaces = d.waives
      ? `\n// replaces the ${d.answers.checkKind === 'test' ? 'test' : 'property'} ${JSON.stringify(d.answers.check)}${d.answers.checkKind === 'property' ? ' where the spec was silent' : ''} (${commentText(d.answers.silentOn)})`
      : '';
    return `${note}${replaces}\n${indentCode(d.test)}`;
  });
  return `// ───────── your decisions (where a check said the spec was silent, you ruled) ─────────\n__uDescribe('your decisions', () => {\n${blocks.join('\n\n')}\n});\n`;
}

// ───────────────────────── provenance.json ─────────────────────────

export function provenance(rec: FunctionRecord, input: Pick<EjectInput, 'revisions' | 'datasetRefs' | 'now'>): Record<string, unknown> {
  const { spec } = rec;
  const a = rec.artifact!;
  const rev = input.revisions?.find((r) => r.id === a.revision);
  const pinHashes = new Set((spec.pins ?? []).flatMap((p) => p.args.flatMap((x) => (x.kind === 'dataset' ? [x.hash] : []))));
  return {
    format: 'undefined-eject',
    version: 1,
    function: spec.name,
    ejectedAt: new Date(input.now).toISOString(),
    note: 'Provenance, not reproducibility: the same prompt may produce a different body next time.',
    specHash: a.specHash,
    testsHash: a.testsHash,
    gateSeed: gateSeed(a.specHash, a.testsHash),
    model: a.model,
    codexVersion: a.codexVersion,
    committedAt: new Date(a.committedAt).toISOString(),
    revision: rev ? { id: rev.id, kind: rev.kind, title: rev.title, ...(rev.detail ? { detail: rev.detail } : {}), at: new Date(rev.at).toISOString() } : { id: a.revision },
    returnType: a.returnType,
    spec: {
      params: spec.params,
      returns: spec.returns,
      doc: spec.doc,
      ...(spec.typeDecls ? { typeDecls: spec.typeDecls } : {}),
      budgetMs: spec.budgetMs,
      maxAttempts: spec.maxAttempts,
      origin: spec.origin,
      ...(spec.exampleId ? { exampleId: spec.exampleId } : {}),
    },
    evidenceLine: a.evidence ? describeEvidence(a.evidence) : null,
    evidence: a.evidence ?? null,
    mutation: a.evidence?.mutation ?? null,
    recertified: a.recertified ?? [],
    pins: (spec.pins ?? []).map((p) => ({ id: p.id, label: p.label, pinnedAt: new Date(p.pinnedAt).toISOString() })),
    decisions: decisionsOf(spec).map((d) => ({
      id: d.id,
      call: d.call,
      ruling: d.ruling.label,
      summary: decisionSummary(d),
      answers: { check: d.answers.check, silentOn: d.answers.silentOn },
      replaces: d.waives ? d.answers.check : null,
      decidedAt: new Date(d.decidedAt).toISOString(),
      ...(d.reason ? { reason: d.reason } : {}),
    })),
    datasets: (input.datasetRefs ?? [])
      .filter((d) => pinHashes.has(d.hash))
      .map((d) => ({ name: d.name, hash: d.hash, rows: d.rowCount, columns: d.columns, typeDecl: d.typeDecl, source: d.source, ...(d.filename ? { filename: d.filename } : {}) })),
    candidates: a.candidates.map((c) => ({
      attempt: c.attempt,
      verdict: c.verdict,
      ...(c.rejectedBy ? { rejectedBy: c.rejectedBy } : {}),
      ...(c.headline ? { headline: c.headline } : {}),
      ...(c.declined ? { declined: c.declined } : {}),
      source: c.source,
      generationMs: c.generationMs,
      notes: c.notes,
      gates: c.gates.map((g) => ({ gate: g.gate, status: g.status, summary: g.summary, ...(g.headline ? { headline: g.headline } : {}) })),
      body: c.body,
      ...(c.prompt !== undefined ? { prompt: c.prompt } : {}),
    })),
  };
}

// ───────────────────────── README.md ─────────────────────────

export function readme(rec: FunctionRecord, v: { vitest: string; fastCheck: string; typescript: string }): string {
  const { spec } = rec;
  const a = rec.artifact!;
  const name = spec.name;
  const tests = spec.tests.trim() !== '' || spec.properties.trim() !== '' || (spec.pins ?? []).length > 0 || decisionsOf(spec).length > 0;
  const n = decisionsOf(spec).length;
  const decided =
    n === 0
      ? ''
      : ` It also holds ${n === 1 ? 'one decision' : `${n} decisions`}: where a check said the spec was silent, you ruled what ${name} should do, and each ruling is a test in the "your decisions" section (listed in \`provenance.json\`).`;
  return `# ${name}

\`${name}.ts\` is a function written by ${a.model || 'a model'}${a.codexVersion ? ` via Codex ${a.codexVersion}` : ''} and accepted by Undefined's checks at revision r${a.revision}; \`${name}.test.ts\` holds ${tests ? "the spec's unit tests, pinned results and properties" : 'a placeholder (the spec had no tests)'} as vitest + fast-check tests with Undefined's small Test API inlined at the top, and \`provenance.json\` records the spec and tests hashes, the model, the full candidate history and what was checked. To run the tests, copy the folder into a project and run \`npm install -D vitest@${v.vitest} fast-check@${v.fastCheck} typescript@${v.typescript}\` and then \`npx vitest run\`. Properties use Undefined's fixed seed, so a failure reproduces. The Invariants gate is not reproduced here: in the app every call was also replayed on frozen arguments (purity) and held to ${spec.budgetMs} ms per call (bounded runtime). A passing run means the code passes these checks, not that it is correct where the checks are silent.${decided}
`;
}
