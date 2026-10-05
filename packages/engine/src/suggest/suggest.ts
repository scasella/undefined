/**
 * Property-suggestion engine. After a function's first commit the UI shows grey "available" rows; each one adds a
 * fast-check property to `spec.properties` with one click (see apply.ts).
 *
 * Pure: reads only the spec and the program. Evidence is the function NAME (split into camelCase/snake_case words),
 * the parameter / return TYPE TEXT, and the doc. Conservative by design: a rule fires only when the evidence is
 * specific, every arbitrary is integer-only for numbers (so `Object.is`-based `eq` cannot trip over -0 or NaN on a
 * correct implementation), and at most MAX_SUGGESTIONS are returned.
 *
 * Every `source` is self-contained: its first line is the `// suggested:<id>` marker and everything else lives inside
 * an IIFE, so appending several snippets cannot collide on a const name.
 *
 * Determinism and argument non-mutation are NOT suggested: the Invariants gate already replays calls on deep-frozen
 * arguments, twice. `alwaysChecked` describes those for "already checked" rows.
 */
import type { FunctionSpec, Program } from '../types';
import { listTestNames } from '../shared/specInfo';

export type SuggestionKind =
  | 'idempotence'
  | 'shape'
  | 'roundTrip'
  | 'sorted'
  | 'sameElements'
  | 'length'
  | 'bounds'
  | 'commutative'
  | 'identity'
  | 'nonNegative';

export interface Suggestion {
  /** Stable id; `// suggested:<id>` is the first line of `source`. */
  id: string;
  kind: SuggestionKind;
  /** Short plain-English claim. */
  title: string;
  /** One sentence on why it was suggested. */
  why: string;
  /** TypeScript (Test API) to append to spec.properties. */
  source: string;
  /** The evidence, compactly, e.g. `name "normalizeEmail" · (string) => string`. */
  applies: string;
}

export const MAX_SUGGESTIONS = 6;

/** Checked on every candidate by the Invariants gate; shown as "already checked", never suggested. */
export const alwaysChecked: Array<{ title: string; by: string }> = [
  { title: 'Same input twice gives the same result', by: 'Invariants' },
  { title: 'The arguments are not modified', by: 'Invariants' },
];

export const SUGGESTION_MARKER = '// suggested:';

// ───────────────────────── evidence helpers ─────────────────────────

/** `normalizeEmail` → ['normalize', 'email']; `to_snake_case` → ['to', 'snake', 'case']; `encodeURL` → ['encode', 'url']. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase());
}

/** Whitespace-collapsed type text; `Array<T>` → `T[]`; a leading `readonly` dropped. */
export function normType(t: string | null | undefined): string | null {
  if (t === null || t === undefined) return null;
  let s = t.replace(/\s+/g, ' ').trim();
  s = s.replace(/^readonly /, '');
  const arr = /^(?:Readonly)?Array<(.+)>$/.exec(s);
  if (arr) s = `${wrapUnion(arr[1]!.trim())}[]`;
  return s;
}

function wrapUnion(t: string): string {
  return /[|&]/.test(t) && !/^\(.*\)$/.test(t) ? `(${t})` : t;
}

/** Element type of an array type text, or null. */
function elementType(t: string | null): string | null {
  if (t === null || !t.endsWith('[]')) return null;
  let el = t.slice(0, -2).trim();
  if (/^\(.*\)$/.test(el)) el = el.slice(1, -1).trim();
  return el;
}

/** Return type: declared, or the type the checker inferred at the last commit. */
function returnTypeOf(spec: FunctionSpec, program: Program): string | null {
  return normType(spec.returns ?? program.functions[spec.name]?.artifact?.returnType ?? null);
}

const STRING_ARB =
  "fc.oneof(fc.string({ unit: 'grapheme' }), fc.string({ unit: fc.constantFrom('a', 'Z', 'é', 'Ü', 'ß', 'ø', 'İ', '7', ' ', '  ', '\\t', '-', '_', '.', ',', '!', '&', \"'\", '@') }))";
const INT_ARB = 'fc.integer({ min: -1000, max: 1000 })';

/**
 * fast-check arbitrary source for a type text, or null when the type is not one this engine can generate
 * (named types from typeDecls, tuples, unions, functions, nested objects…).
 */
export function arbitraryFor(type: string | null, opts: { nonEmpty?: boolean } = {}): string | null {
  const t = normType(type);
  if (t === null) return null;
  if (t === 'string') return STRING_ARB;
  if (t === 'number') return INT_ARB;
  if (t === 'boolean') return 'fc.boolean()';
  if (t === 'bigint') return 'fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n })';
  const el = elementType(t);
  if (el !== null) {
    const inner = arbitraryFor(el);
    if (inner === null) return null;
    return opts.nonEmpty ? `fc.array(${inner}, { minLength: 1 })` : `fc.array(${inner})`;
  }
  const rec = flatRecord(t);
  if (rec) {
    const fields: string[] = [];
    for (const [k, ft] of rec) {
      if (elementType(normType(ft)) === null && flatRecord(normType(ft)!) !== null) return null;
      const a = arbitraryFor(ft);
      if (a === null) return null;
      fields.push(`${JSON.stringify(k)}: ${a}`);
    }
    return `fc.record({ ${fields.join(', ')} })`;
  }
  return null;
}

/** `{ x: number; y: number }` → [['x','number'],['y','number']]; null for anything nested, optional or indexed. */
function flatRecord(t: string): Array<[string, string]> | null {
  const m = /^\{(.*)\}$/.exec(t);
  if (!m) return null;
  const inner = m[1]!;
  if (/[{}()<>]/.test(inner)) return null;
  const parts = inner.split(/[;,]/).map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) return null;
  const out: Array<[string, string]> = [];
  for (const p of parts) {
    const f = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*:\s*(.+)$/.exec(p);
    if (!f) return null;
    out.push([f[1]!, f[2]!.trim()]);
  }
  return out;
}

function signatureText(spec: FunctionSpec, ret: string | null): string {
  return `(${spec.params.map((p) => normType(p.type)).join(', ')}) => ${ret ?? 'unknown'}`;
}

function article(t: string): string {
  if (t === 'string') return 'a string';
  if (t === 'number') return 'a number';
  if (t.endsWith('[]')) return `an array (${t})`;
  return `a value of type ${t}`;
}

const hasWord = (words: string[], stems: readonly string[]): string | undefined =>
  words.find((w) => stems.some((s) => w === s || w.startsWith(s)));
const hasExactWord = (words: string[], set: readonly string[]): string | undefined =>
  words.find((w) => set.includes(w) || (w.endsWith('s') && set.includes(w.slice(0, -1))));

/** Small sync string hash (FNV-1a, 32 bit) for suggestion ids that must change with embedded code. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function snippet(id: string, lines: string[]): string {
  return [`${SUGGESTION_MARKER}${id}`, '(() => {', ...lines.map((l) => (l === '' ? '' : `  ${l}`)), '})();'].join('\n');
}

const q = (s: string): string => JSON.stringify(s);

// ───────────────────────── rules ─────────────────────────

interface Ctx {
  spec: FunctionSpec;
  program: Program;
  name: string;
  words: string[];
  params: Array<{ name: string; type: string | null }>;
  ret: string | null;
  doc: string;
  sig: string;
}

type Rule = (c: Ctx) => Suggestion[];

const NORMALIZER_STEMS = [
  'slug', 'normaliz', 'normalis', 'clean', 'trim', 'saniti', 'sanitis', 'canonical', 'lower', 'upper', 'dedup',
  'unique', 'uniq', 'capitaliz', 'capitalis', 'titlecase', 'squish', 'collapse', 'strip',
] as const;
/** Normalizer words that must match a whole name word (as prefixes they would catch "abstract", …). */
const NORMALIZER_EXACT = ['abs'] as const;
const DOC_NORMALIZER = /\b(normali[sz](e|es|ed|ing)|canonical(i[sz]e[sd]?)?|slug|idempotent)\b/i;

const idempotence: Rule = (c) => {
  if (c.params.length !== 1) return [];
  const p = c.params[0]!;
  if (p.type === null || c.ret === null || p.type !== c.ret) return [];
  const word = hasWord(c.words, NORMALIZER_STEMS) ?? hasExactWord(c.words, NORMALIZER_EXACT);
  const docHit = word ? undefined : DOC_NORMALIZER.exec(c.doc)?.[0];
  if (!word && !docHit) return [];
  const arb = arbitraryFor(p.type);
  if (arb === null) return [];
  const id = `idempotence:${c.name}`;
  const isSlug = c.words.some((w) => w.startsWith('slug'));
  const noun = isSlug ? 'slug' : p.type === 'string' ? 'text' : p.type === 'number' ? 'number' : 'result';
  const title = `Running ${c.name} on its own output changes nothing`;
  const ev = word ? `the name says "${word}"` : `the doc says "${docHit}"`;
  return [{
    id,
    kind: 'idempotence',
    title,
    why: `${cap(ev)} and it takes and returns ${article(p.type)}, so applying it to an already-${isSlug ? 'slugified' : 'processed'} ${noun} should give the same ${noun} back.`,
    applies: `${word ? `name word "${word}"` : `doc "${docHit}"`} · ${c.sig}`,
    source: snippet(id, [
      `property(${q(title)}, [${arb}], (input: ${p.type}) => {`,
      `  const once = ${c.name}(input);`,
      `  eq(${c.name}(once), once);`,
      '});',
    ]),
  }];
};

const shape: Rule = (c) => {
  if (c.params.length !== 1 || c.params[0]!.type !== 'string' || c.ret !== 'string') return [];
  const nameSlug = c.words.find((w) => w.startsWith('slug'));
  const docSlug = /\bslug/i.exec(c.doc)?.[0];
  if (!nameSlug && !docSlug) return [];
  // The separator: what the doc says words are joined by; otherwise the only one it mentions; hyphen by default.
  const joined = /\b(?:joined|separated|connected|delimited|linked)\s+(?:by|with)\s+(?:a\s+)?(?:single\s+)?(underscore|hyphen|dash)/i.exec(c.doc)?.[1];
  const mentionsUnder = /underscore/i.test(c.doc);
  const mentionsHyph = /hyphen|dash/i.test(c.doc);
  if (!joined && mentionsUnder && mentionsHyph) return []; // both named, neither as the joiner: not ours to guess
  const under = joined ? /underscore/i.test(joined) : mentionsUnder;
  const sep = under ? '_' : '-';
  const sepName = under ? 'underscores' : 'hyphens';
  const id = `shape:${c.name}`;
  const title = `The output is lowercase letters and digits joined by single ${sepName} (or empty)`;
  const ev = nameSlug ? `the name says "${nameSlug}"` : `the doc says "${docSlug}"`;
  return [{
    id,
    kind: 'shape',
    title,
    why: `${cap(ev)} and it turns a string into a string, so every output should look like a URL slug${under ? ' (the doc says underscores)' : ''}.`,
    applies: `${nameSlug ? `name word "${nameSlug}"` : `doc "${docSlug}"`} · ${c.sig}`,
    source: snippet(id, [
      `const slugShape = /^([a-z0-9]+(${sep}[a-z0-9]+)*)?$/;`,
      `property(${q(title)}, [${STRING_ARB}], (input: string) => slugShape.test(${c.name}(input)));`,
    ]),
  }];
};

/** [forward prefix, backward prefix]: backward(forward(x)) === x. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['encode', 'decode'],
  ['serialize', 'deserialize'],
  ['serialise', 'deserialise'],
  ['stringify', 'parse'],
  ['compress', 'decompress'],
  ['escape', 'unescape'],
  ['to', 'from'],
];

/** For a name, the [encoder, decoder] names it could pair with, and which side it is. */
function pairCandidates(name: string): Array<{ encoder: string; decoder: string }> {
  const out: Array<{ encoder: string; decoder: string }> = [];
  const restOk = (rest: string): boolean => rest === '' || /^[A-Z0-9_]/.test(rest);
  for (const [f, b] of PAIRS) {
    if (name.startsWith(b) && restOk(name.slice(b.length))) {
      const rest = name.slice(b.length);
      if (f === 'to' && rest === '') continue;
      out.push({ encoder: f + rest, decoder: name });
      continue;
    }
    if (name.startsWith(f) && restOk(name.slice(f.length))) {
      const rest = name.slice(f.length);
      if (f === 'to' && rest === '') continue;
      out.push({ encoder: name, decoder: b + rest });
    }
  }
  return out;
}

const roundTrip: Rule = (c) => {
  const out: Suggestion[] = [];
  for (const { encoder, decoder } of pairCandidates(c.name)) {
    const partnerName = encoder === c.name ? decoder : encoder;
    const partner = c.program.functions[partnerName];
    if (!partner || partner.artifact === null || partnerName === c.name) continue;
    const encSpec = encoder === c.name ? c.spec : partner.spec;
    const decSpec = decoder === c.name ? c.spec : partner.spec;
    if (encSpec.params.length !== 1 || decSpec.params.length !== 1) continue;
    const encIn = normType(encSpec.params[0]!.type);
    const encOut = encoder === c.name ? c.ret : normType(encSpec.returns ?? partner.artifact.returnType);
    const decIn = normType(decSpec.params[0]!.type);
    const decOut = decoder === c.name ? c.ret : normType(decSpec.returns ?? partner.artifact.returnType);
    if (!encIn || !encOut || !decIn || !decOut || encOut !== decIn || decOut !== encIn) continue;
    const arb = arbitraryFor(encIn);
    if (arb === null) continue;
    const js = partner.artifact.js.replace(/^\s*["']use strict["'];?\s*$/m, '').replace(/\/\/# sourceMappingURL=.*$/m, '').trim();
    const id = `roundTrip:${c.name}<${partnerName}@${fnv(js)}`;
    const title = `${decoder} undoes ${encoder}: decoding what was encoded gives back the original`;
    out.push({
      id,
      kind: 'roundTrip',
      title,
      why: `${c.name} and ${partnerName} are a named pair in this program with matching types (${encIn} → ${encOut} → ${decIn}), so one should undo the other; the snippet embeds ${partnerName}'s current committed code, so re-add it if ${partnerName} is regenerated.`,
      applies: `pair ${encoder}/${decoder} · ${encoder}: (${encIn}) => ${encOut} · ${decoder}: (${decIn}) => ${decOut}`,
      source: snippet(id, [
        `// ${partnerName} as committed (revision ${partner.artifact.revision}); only ${c.name} is in scope here.`,
        `const ${partnerName} = (() => {`,
        ...js.split('\n').map((l) => `  ${l}`),
        `  return ${partnerName};`,
        '})();',
        `property(${q(title)}, [${arb}], (value: ${encIn}) => {`,
        `  eq(${decoder}(${encoder}(value)), value);`,
        '});',
      ]),
    });
  }
  return out;
};

const SORT_WORDS = ['sort', 'sorted', 'order', 'ordered'] as const;
const LENGTH_WORDS = [...SORT_WORDS, 'reverse', 'reversed', 'map', 'mapped', 'shuffle', 'shuffled'] as const;
const DESC_WORDS = ['desc', 'descending', 'decreasing', 'reverse', 'reversed', 'largest', 'biggest', 'highest'] as const;

function arrayToArray(c: Ctx): { p: { name: string; type: string }; inEl: string; outEl: string } | null {
  if (c.params.length !== 1) return null;
  const p = c.params[0]!;
  const inEl = elementType(p.type);
  const outEl = elementType(c.ret);
  if (p.type === null || inEl === null || outEl === null) return null;
  return { p: { name: p.name, type: p.type }, inEl, outEl };
}

const lengthPreserved: Rule = (c) => {
  const a = arrayToArray(c);
  const word = hasExactWord(c.words, LENGTH_WORDS);
  if (!a || !word) return [];
  const arb = arbitraryFor(a.p.type);
  if (arb === null) return [];
  const id = `length:${c.name}`;
  const title = 'The output has as many items as the input';
  return [{
    id,
    kind: 'length',
    title,
    why: `The name says "${word}" and it turns an array into an array, so it should rearrange or transform items without adding or dropping any.`,
    applies: `name word "${word}" · ${c.sig}`,
    source: snippet(id, [
      `property(${q(title)}, [${arb}], (input: ${a.p.type}) => {`,
      '  const inputLength = input.length;',
      `  eq(${c.name}(input).length, inputLength);`,
      '});',
    ]),
  }];
};

const sortRules: Rule = (c) => {
  const a = arrayToArray(c);
  const word = hasExactWord(c.words, SORT_WORDS);
  if (!a || !word || a.inEl !== a.outEl || (a.inEl !== 'number' && a.inEl !== 'string')) return [];
  const arb = arbitraryFor(a.p.type);
  if (arb === null) return [];
  const out: Suggestion[] = [];
  const desc = hasExactWord(c.words, DESC_WORDS) ?? (/\b(descending|largest first|biggest first|highest first|decreasing)\b/i.exec(c.doc)?.[0]);
  if (a.inEl === 'number') {
    // String order is a convention (code units vs localeCompare), so sortedness is only claimed for numbers.
    const id = `sorted:${c.name}`;
    const title = desc ? 'Each number in the output is at most the one before it' : 'Each number in the output is at least the one before it';
    const bad = desc ? '<' : '>';
    out.push({
      id,
      kind: 'sorted',
      title,
      why: `The name says "${word}"${desc ? ` (and "${desc}")` : ''} and it returns a number[], so the output should be in ${desc ? 'descending' : 'ascending'} order.`,
      applies: `name word "${word}"${desc ? ` + "${desc}"` : ''} · ${c.sig}`,
      source: snippet(id, [
        `property(${q(title)}, [${arb}], (input: number[]) => {`,
        `  const out = ${c.name}(input);`,
        '  for (let i = 1; i < out.length; i++) {',
        `    if (out[i - 1] ${bad} out[i]) return false;`,
        '  }',
        '  return true;',
        '});',
      ]),
    });
  }
  const id = `sameElements:${c.name}`;
  const title = 'The output has exactly the same items as the input, just reordered';
  const cmp = a.inEl === 'number' ? '(x, y) => x - y' : '';
  out.push({
    id,
    kind: 'sameElements',
    title,
    why: `The name says "${word}" and it takes and returns ${a.p.type}, so it should only reorder: nothing lost, nothing added, nothing duplicated.`,
    applies: `name word "${word}" · ${c.sig}`,
    source: snippet(id, [
      `const canonical = (items: ${a.inEl}[]): ${a.inEl}[] => [...items].sort(${cmp});`,
      `property(${q(title)}, [${arb}], (input: ${a.p.type}) => {`,
      '  const expected = canonical(input);',
      `  eq(canonical(${c.name}(input)), expected);`,
      '});',
    ]),
  });
  return out;
};

const AGG_WORDS = ['median', 'mean', 'average', 'avg', 'min', 'max', 'minimum', 'maximum', 'midrange', 'mode'] as const;

const bounds: Rule = (c) => {
  if (c.ret !== 'number') return [];
  // aggregate of one number[]
  if (c.params.length === 1 && c.params[0]!.type === 'number[]') {
    const word = hasExactWord(c.words, AGG_WORDS);
    if (!word) return [];
    const id = `bounds:${c.name}`;
    const title = 'The result lies between the smallest and largest number in the list';
    return [{
      id,
      kind: 'bounds',
      title,
      why: `The name says "${word}" and it reduces a number[] to one number, so the result can never be outside the input's range.`,
      applies: `name word "${word}" · ${c.sig} · non-empty lists`,
      source: snippet(id, [
        `property(${q(title)}, [fc.array(${INT_ARB}, { minLength: 1 })], (input: number[]) => {`,
        '  const lo = Math.min(...input);',
        '  const hi = Math.max(...input);',
        `  const r = ${c.name}(input);`,
        '  return r >= lo && r <= hi;',
        '});',
      ]),
    }];
  }
  // clamp(value, lo, hi) with recognisable bound names, in any order
  if (c.params.length === 3 && c.params.every((p) => p.type === 'number') && hasWord(c.words, ['clamp'])) {
    const loIdx = c.params.findIndex((p) => /^(min|lo|low|lower|lowerbound|minimum|floor|from|start)$/i.test(p.name));
    const hiIdx = c.params.findIndex((p) => /^(max|hi|high|upper|upperbound|maximum|ceil|ceiling|to|end)$/i.test(p.name));
    if (loIdx < 0 || hiIdx < 0 || loIdx === hiIdx) return [];
    const vIdx = 3 - loIdx - hiIdx;
    const args = ['', '', ''];
    args[loIdx] = 'lo';
    args[hiIdx] = 'hi';
    args[vIdx] = 'x';
    const id = `bounds:${c.name}`;
    const title = `The result always lies between ${c.params[loIdx]!.name} and ${c.params[hiIdx]!.name}`;
    return [{
      id,
      kind: 'bounds',
      title,
      why: `The name says "clamp" and its parameters are named ${c.params[loIdx]!.name} and ${c.params[hiIdx]!.name}, so whenever ${c.params[loIdx]!.name} ≤ ${c.params[hiIdx]!.name} the result must lie between them.`,
      applies: `name "clamp" · params ${c.params.map((p) => p.name).join(', ')} · ${c.sig}`,
      source: snippet(id, [
        `property(${q(title)}, [${INT_ARB}, ${INT_ARB}, ${INT_ARB}], (x: number, a: number, b: number) => {`,
        '  const lo = Math.min(a, b);',
        '  const hi = Math.max(a, b);',
        `  const r = ${c.name}(${args.join(', ')});`,
        '  return r >= lo && r <= hi;',
        '});',
      ]),
    }];
  }
  return [];
};

const COMMUTATIVE_OPS = ['add', 'sum', 'plus', 'multiply', 'times', 'product', 'max', 'min', 'gcd', 'lcm'] as const;
const GENERIC_TAIL = new Set(['number', 'numbers', 'num', 'nums', 'int', 'ints', 'integer', 'integers', 'value', 'values', 'two', 'of', 'both', 'pair']);
const IDENTITY: Record<string, { value: string; label: string }> = {
  add: { value: '0', label: 'zero' },
  sum: { value: '0', label: 'zero' },
  plus: { value: '0', label: 'zero' },
  multiply: { value: '1', label: 'one' },
  times: { value: '1', label: 'one' },
  product: { value: '1', label: 'one' },
};

const arithmetic: Rule = (c) => {
  if (c.params.length !== 2) return [];
  if (c.params.some((p) => p.type !== 'number')) return [];
  const [op, ...tail] = c.words;
  if (!op || !(COMMUTATIVE_OPS as readonly string[]).includes(op) || !tail.every((w) => GENERIC_TAIL.has(w))) return [];
  const out: Suggestion[] = [];
  const id = `commutative:${c.name}`;
  const title = `Swapping the two arguments gives the same result`;
  out.push({
    id,
    kind: 'commutative',
    title,
    why: `The name is the operation "${op}" on two numbers, and ${op} does not care about argument order.`,
    applies: `name "${c.name}" · ${c.sig}`,
    source: snippet(id, [
      `property(${q(title)}, [${INT_ARB}, ${INT_ARB}], (a: number, b: number) => {`,
      `  const forward = ${c.name}(a, b);`,
      `  eq(${c.name}(b, a), forward);`,
      '});',
    ]),
  });
  const ident = IDENTITY[op];
  if (ident && c.ret === 'number') {
    const iid = `identity:${c.name}`;
    const verb = ident.value === '0' ? 'Adding' : 'Multiplying by';
    const ititle = `${verb} ${ident.label} gives back the same number`;
    out.push({
      id: iid,
      kind: 'identity',
      title: ititle,
      why: `The name is the operation "${op}" on two numbers, and ${ident.label} is the number that changes nothing under ${op}.`,
      applies: `name "${c.name}" · ${c.sig}`,
      source: snippet(iid, [
        `property(${q(ititle)}, [${INT_ARB}], (a: number) => {`,
        `  eq(${c.name}(a, ${ident.value}), a);`,
        '});',
      ]),
    });
  }
  return out;
};

const NONNEG_WORDS = ['abs', 'absolute', 'distance', 'length', 'count', 'size', 'area', 'norm', 'variance', 'magnitude', 'hypot', 'stddev'] as const;

const nonNegative: Rule = (c) => {
  if (c.ret !== 'number' || c.params.length === 0) return [];
  const word = hasExactWord(c.words, NONNEG_WORDS);
  if (!word) return [];
  const arbs: string[] = [];
  for (const p of c.params) {
    const arb = arbitraryFor(p.type, { nonEmpty: true });
    if (arb === null) return [];
    arbs.push(arb);
  }
  const id = `nonNegative:${c.name}`;
  const title = 'The result is never negative';
  const sig = c.params.map((p, i) => `arg${i}: ${p.type}`).join(', ');
  const call = `${c.name}(${c.params.map((_, i) => `arg${i}`).join(', ')})`;
  return [{
    id,
    kind: 'nonNegative',
    title,
    why: `The name says "${word}" and it returns a number; a ${word} cannot be below zero.`,
    applies: `name word "${word}" · ${c.sig}${c.params.some((p) => elementType(p.type) !== null) ? ' · non-empty arrays' : ''}`,
    source: snippet(id, [
      `property(${q(title)}, [${arbs.join(', ')}], (${sig}) => !(${call} < 0));`,
    ]),
  }];
};

/** Priority order: the most specific claims first. */
const RULES: Rule[] = [shape, idempotence, roundTrip, sortRules, lengthPreserved, bounds, arithmetic, nonNegative];

// ───────────────────────── "already there" ─────────────────────────

/** Existing property names that mean the same thing as a suggestion of this kind (all patterns must match). */
const COVERS: Record<SuggestionKind, RegExp[]> = {
  idempotence: [/\b(idempotent|idempotence|twice|again|changes nothing|no change|already|stable|fixed point|own output)\b/],
  shape: [/\b(lowercase|hyphens?|underscores?|slug shape|url safe|pattern|shape|format)\b/],
  roundTrip: [/\b(round ?trip|inverse|undo|undoes|back to|gives back|original|recover|recovers)\b/],
  sorted: [/\b(sorted|ascending|descending|decreasing|increasing|non decreasing|non increasing|in order)\b/],
  sameElements: [/\b(same (items|elements|values|numbers|words)|permutation|multiset|nothing (is )?(lost|dropped|added)|keeps every)\b/],
  length: [/\b(length|as many|same number of|same size|count)\b/],
  bounds: [/\b(between|within|bounds?|range|clamped)\b/, /\b(min|max|minimum|maximum|smallest|largest|lowest|highest|lo|hi|range|bounds?)\b/],
  commutative: [/\b(commutative|commutes|swap|swapping|swapped|order of (the )?(arguments|operands|inputs)|either order)\b/],
  identity: [/\b(identity|neutral|adding zero|plus zero|times one|by one)\b/],
  nonNegative: [/\b(negative|non negative|positive|at least zero)\b/],
};

export function normaliseTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function existingNames(spec: FunctionSpec): string[] {
  try {
    return listTestNames(spec.properties);
  } catch {
    return [];
  }
}

/** True iff the spec's properties already state this suggestion (its marker, its title, or a same-meaning name). */
export function alreadyCovered(
  spec: FunctionSpec,
  s: Suggestion,
  names: string[] = existingNames(spec),
  siblingTitles: ReadonlySet<string> = new Set(),
): boolean {
  if (hasMarker(spec.properties, s.id)) return true;
  const title = normaliseTitle(s.title);
  return names.some((n) => {
    const nn = normaliseTitle(n);
    if (nn === title) return true;
    // A property this engine added for another kind says nothing about this one, whatever words it uses.
    if (siblingTitles.has(nn)) return false;
    return COVERS[s.kind].every((re) => re.test(nn));
  });
}

export function hasMarker(properties: string, id: string): boolean {
  const esc = (SUGGESTION_MARKER + id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^[ \\t]*${esc}[ \\t]*$`, 'm').test(properties);
}

// ───────────────────────── entry point ─────────────────────────

export function suggestProperties(spec: FunctionSpec, program: Program): Suggestion[] {
  const ret = returnTypeOf(spec, program);
  const ctx: Ctx = {
    spec,
    program,
    name: spec.name,
    words: nameWords(spec.name),
    params: spec.params.map((p) => ({ name: p.name, type: normType(p.type) })),
    ret,
    doc: spec.doc,
    sig: signatureText(spec, ret),
  };
  const names = existingNames(spec);
  const all = RULES.flatMap((rule) => rule(ctx));
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of all) {
    const siblings = new Set(all.filter((x) => x.kind !== s.kind).map((x) => normaliseTitle(x.title)));
    if (seen.has(s.id) || alreadyCovered(spec, s, names, siblings)) continue;
    seen.add(s.id);
    out.push(s);
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
