/**
 * Rule behaviour of the property-suggestion engine: which rules fire on which specs (and which must not), the cap,
 * the marker comments, de-duplication against existing properties, and the pure, idempotent append.
 * Execution of every generated snippet through the real gates lives in suggest.exec.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { FunctionSpec, Program } from '@scasella/undefined-engine/types';
import { brokenSpec, specExample } from '../examples/index';
import { appendProperty, isAdded } from '@scasella/undefined-engine/suggest/apply';
import { makeRecord, makeSpec, programOf } from '@scasella/undefined-engine/suggest/fixtures';
import {
  alwaysChecked,
  arbitraryFor,
  MAX_SUGGESTIONS,
  nameWords,
  suggestProperties,
  type Suggestion,
} from '@scasella/undefined-engine/suggest/suggest';

// ───────── helpers ─────────

function suggest(spec: FunctionSpec, program: Program = programOf(makeRecord(spec))): Suggestion[] {
  return suggestProperties(spec, program);
}
const kinds = (ss: Suggestion[]): string[] => ss.map((s) => s.kind);

const ENCODE_JS = 'function encodeBase64(text) { return text; }';
const DECODE_JS = 'function decodeBase64(encoded) { return encoded; }';

// ───────── tests ─────────

describe('nameWords / arbitraryFor', () => {
  it('splits camelCase, PascalCase acronyms, snake and kebab case', () => {
    expect(nameWords('normalizeEmail')).toEqual(['normalize', 'email']);
    expect(nameWords('encodeURLPath')).toEqual(['encode', 'url', 'path']);
    expect(nameWords('to_snake-case')).toEqual(['to', 'snake', 'case']);
  });

  it('derives arbitraries only for types it can generate', () => {
    expect(arbitraryFor('string')).toContain("fc.string({ unit: 'grapheme' })");
    expect(arbitraryFor('number[]')).toBe('fc.array(fc.integer({ min: -1000, max: 1000 }))');
    expect(arbitraryFor('Array<number>')).toBe('fc.array(fc.integer({ min: -1000, max: 1000 }))');
    expect(arbitraryFor('readonly string[]')).toMatch(/^fc\.array\(fc\.oneof/);
    expect(arbitraryFor('{ x: number; y: number }')).toBe(
      'fc.record({ "x": fc.integer({ min: -1000, max: 1000 }), "y": fc.integer({ min: -1000, max: 1000 }) })',
    );
    expect(arbitraryFor('Row')).toBeNull();
    expect(arbitraryFor('[number, string]')).toBeNull();
    expect(arbitraryFor('string | null')).toBeNull();
    expect(arbitraryFor('(x: number) => number')).toBeNull();
  });
});

describe('every rule fires on a realistic spec', () => {
  it('idempotence: normalizeEmail (name says normalize, string → string)', () => {
    const ss = suggest(makeSpec('normalizeEmail', [['email', 'string']], 'string', { doc: 'Lowercases and trims an email address.' }));
    expect(kinds(ss)).toEqual(['idempotence']);
    expect(ss[0]!.title).toBe('Running normalizeEmail on its own output changes nothing');
    expect(ss[0]!.why).toContain('"normalize"');
    expect(ss[0]!.why).toContain('takes and returns a string');
    expect(ss[0]!.applies).toBe('name word "normalize" · (string) => string');
  });

  it('idempotence from the doc when the name is silent', () => {
    const ss = suggest(makeSpec('toKey', [['s', 'string']], 'string', { doc: 'Returns the canonical form of a tag.' }));
    expect(kinds(ss)).toEqual(['idempotence']);
    expect(ss[0]!.applies).toContain('doc "canonical"');
  });

  it('shape + idempotence: slugify with its properties removed', () => {
    const spec = { ...specExample('slugify').spec, properties: '' };
    const ss = suggest(spec);
    expect(kinds(ss)).toEqual(['shape', 'idempotence']);
    expect(ss[0]!.source).toContain('/^([a-z0-9]+(-[a-z0-9]+)*)?$/');
  });

  it('shape follows the doc when it says underscores, and is skipped when the doc names both separators', () => {
    const broken = { ...brokenSpec(specExample('slugify')), properties: '' };
    const shape = suggest(broken).find((s) => s.kind === 'shape')!;
    expect(shape.source).toContain('/^([a-z0-9]+(_[a-z0-9]+)*)?$/');
    expect(shape.title).toContain('underscores');
    expect(kinds(suggest(makeSpec('slugify', [['t', 'string']], 'string', { doc: 'A URL slug: words joined by single hyphens; underscores are dropped.' })))[0]).toBe('shape');
    expect(suggest(makeSpec('slugify', [['t', 'string']], 'string', { doc: 'A URL slug: words joined by single hyphens; underscores are dropped.' }))[0]!.source).toContain('(-[a-z0-9]+)');
    const both = makeSpec('slugify', [['t', 'string']], 'string', { doc: 'Slug with hyphens, or underscores for file names.' });
    expect(kinds(suggest(both))).toEqual(['idempotence']);
  });

  it('sorted + sameElements + length: sortDescending on number[]', () => {
    const ss = suggest(makeSpec('sortDescending', [['xs', 'number[]']], 'number[]'));
    expect(kinds(ss)).toEqual(['sorted', 'sameElements', 'length']);
    expect(ss[0]!.title).toBe('Each number in the output is at most the one before it');
    expect(ss[0]!.source).toContain('out[i - 1] < out[i]');
  });

  it('ascending sort gets the non-decreasing claim', () => {
    const ss = suggest(makeSpec('sortNumbers', [['xs', 'Array<number>']], 'number[]'));
    expect(ss[0]!.title).toBe('Each number in the output is at least the one before it');
    expect(ss[0]!.source).toContain('out[i - 1] > out[i]');
  });

  it('string sorts get sameElements and length but no sortedness (string order is a convention)', () => {
    expect(kinds(suggest(makeSpec('sortWords', [['words', 'string[]']], 'string[]')))).toEqual(['sameElements', 'length']);
  });

  it('length only for reverse / map / shuffle', () => {
    expect(kinds(suggest(makeSpec('reverseList', [['xs', 'number[]']], 'number[]')))).toEqual(['length']);
    expect(kinds(suggest(makeSpec('mapToLabels', [['xs', 'number[]']], 'string[]')))).toEqual(['length']);
  });

  it('bounds: median without its properties, mean, max over a list', () => {
    const median = { ...specExample('median').spec, properties: '' };
    expect(kinds(suggest(median))).toEqual(['bounds']);
    expect(kinds(suggest(makeSpec('mean', [['values', 'number[]']], 'number')))).toEqual(['bounds']);
    expect(kinds(suggest(makeSpec('maxOf', [['values', 'number[]']], 'number')))).toEqual(['bounds']);
  });

  it('bounds: clamp(value, min, max) in any parameter order, only with recognisable bound names', () => {
    const ss = suggest(makeSpec('clamp', [['value', 'number'], ['min', 'number'], ['max', 'number']], 'number'));
    expect(kinds(ss)).toEqual(['bounds']);
    expect(ss[0]!.title).toBe('The result always lies between min and max');
    expect(ss[0]!.source).toContain('clamp(x, lo, hi)');
    const cssOrder = suggest(makeSpec('clamp', [['lo', 'number'], ['preferred', 'number'], ['hi', 'number']], 'number'));
    expect(cssOrder[0]!.source).toContain('clamp(lo, x, hi)');
    expect(suggest(makeSpec('clamp', [['a', 'number'], ['b', 'number'], ['c', 'number']], 'number'))).toEqual([]);
  });

  it('roundTrip: decodeBase64 when encodeBase64 is committed with matching types', () => {
    const dec = makeSpec('decodeBase64', [['encoded', 'string']], 'string');
    const enc = makeSpec('encodeBase64', [['text', 'string']], 'string');
    const program = programOf(makeRecord(dec), makeRecord(enc, { js: ENCODE_JS, returnType: 'string' }));
    const ss = suggestProperties(dec, program);
    expect(kinds(ss)).toEqual(['roundTrip']);
    expect(ss[0]!.title).toBe('decodeBase64 undoes encodeBase64: decoding what was encoded gives back the original');
    expect(ss[0]!.source).toContain('function encodeBase64(text) { return text; }');
    expect(ss[0]!.source).toContain('eq(decodeBase64(encodeBase64(value)), value);');
    // from the encoder's side, the decoder is embedded
    const program2 = programOf(makeRecord(enc), makeRecord(dec, { js: DECODE_JS, returnType: 'string' }));
    const ss2 = suggestProperties(enc, program2);
    expect(kinds(ss2)).toEqual(['roundTrip']);
    expect(ss2[0]!.source).toContain('function decodeBase64(encoded)');
  });

  it('roundTrip id changes when the partner is regenerated (the embedded code is a snapshot)', () => {
    const dec = makeSpec('decodeBase64', [['encoded', 'string']], 'string');
    const enc = makeSpec('encodeBase64', [['text', 'string']], 'string');
    const a = suggestProperties(dec, programOf(makeRecord(dec), makeRecord(enc, { js: ENCODE_JS, returnType: 'string' })));
    const b = suggestProperties(dec, programOf(makeRecord(dec), makeRecord(enc, { js: ENCODE_JS.replace('text;', 'text ;'), returnType: 'string' })));
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });

  it('roundTrip pairs: serialize/deserialize, toX/fromX, stringify/parse, compress/decompress, escape/unescape', () => {
    const pairs: Array<[string, string, string, string]> = [
      ['serializeTags', 'deserializeTags', 'string[]', 'string'],
      ['toCsv', 'fromCsv', 'number[]', 'string'],
      ['stringifyQuery', 'parseQuery', '{ q: string; page: number }', 'string'],
      ['compressRuns', 'decompressRuns', 'string', 'string'],
      ['escapeHtml', 'unescapeHtml', 'string', 'string'],
    ];
    for (const [encName, decName, a, b] of pairs) {
      const enc = makeSpec(encName, [['x', a]], b);
      const dec = makeSpec(decName, [['y', b]], a);
      const ss = suggestProperties(dec, programOf(makeRecord(dec), makeRecord(enc, { js: `function ${encName}(x) { return x; }`, returnType: b })));
      expect(kinds(ss).filter((k) => k === 'roundTrip'), decName).toEqual(['roundTrip']);
    }
  });

  it('commutative + identity: add(a, b) and multiply(a, b); commutative only for max(a, b) and gcd', () => {
    expect(kinds(suggest(makeSpec('add', [['a', 'number'], ['b', 'number']], 'number')))).toEqual(['commutative', 'identity']);
    const mul = suggest(makeSpec('multiply', [['x', 'number'], ['y', 'number']], 'number'));
    expect(kinds(mul)).toEqual(['commutative', 'identity']);
    expect(mul[1]!.title).toBe('Multiplying by one gives back the same number');
    expect(kinds(suggest(makeSpec('max', [['a', 'number'], ['b', 'number']], 'number')))).toEqual(['commutative']);
    expect(kinds(suggest(makeSpec('gcd', [['a', 'number'], ['b', 'number']], 'number')))).toEqual(['commutative']);
    expect(kinds(suggest(makeSpec('addNumbers', [['a', 'number'], ['b', 'number']], 'number')))).toEqual(['commutative', 'identity']);
  });

  it('nonNegative: distance, countWords, variance, magnitude of a point', () => {
    expect(kinds(suggest(makeSpec('distance', [['a', 'number'], ['b', 'number']], 'number')))).toEqual(['nonNegative']);
    expect(kinds(suggest(makeSpec('countWords', [['text', 'string']], 'number')))).toEqual(['nonNegative']);
    expect(kinds(suggest(makeSpec('variance', [['xs', 'number[]']], 'number')))).toEqual(['nonNegative']);
    const mag = suggest(makeSpec('magnitude', [['p', '{ x: number; y: number }']], 'number'));
    expect(kinds(mag)).toEqual(['nonNegative']);
    expect(mag[0]!.source).toContain('fc.record(');
  });

  it('abs gets both idempotence and nonNegative', () => {
    expect(kinds(suggest(makeSpec('abs', [['x', 'number']], 'number')))).toEqual(['idempotence', 'nonNegative']);
  });

  it('uses the inferred return type of the committed artifact when the spec has none', () => {
    const spec = makeSpec('normalizeEmail', [['arg0', 'string']], null);
    expect(suggest(spec, programOf(makeRecord(spec)))).toEqual([]);
    expect(kinds(suggest(spec, programOf(makeRecord(spec, { js: 'function normalizeEmail(arg0) { return arg0; }', returnType: 'string' }))))).toEqual(['idempotence']);
  });
});

describe('rules do NOT fire without real evidence', () => {
  it('median never gets idempotence (number[] → number) and its shipped bounds property suppresses bounds', () => {
    const ss = suggest(specExample('median').spec);
    expect(ss).toEqual([]);
    expect(kinds(suggest({ ...specExample('median').spec, properties: '' }))).not.toContain('idempotence');
  });

  it('fibonacci gets nothing: no evidence words, and bigint is not a non-negative-by-name result', () => {
    expect(suggest(specExample('fibonacci').spec)).toEqual([]);
    expect(suggest({ ...specExample('fibonacci').spec, properties: '' })).toEqual([]);
  });

  it('shipped slugify already has the shape and idempotence properties', () => {
    expect(suggest(specExample('slugify').spec)).toEqual([]);
  });

  it('unrelated or look-alike names stay silent', () => {
    const none: FunctionSpec[] = [
      makeSpec('greet', [['name', 'string']], 'string'),
      makeSpec('abstractName', [['s', 'string']], 'string'), // "abs" only as a whole word
      makeSpec('addPercent', [['x', 'number'], ['pct', 'number']], 'number'), // not a bare op name
      makeSpec('addDays', [['date', 'string'], ['n', 'number']], 'string'),
      makeSpec('subtract', [['a', 'number'], ['b', 'number']], 'number'),
      makeSpec('sortBy', [['xs', 'number[]'], ['key', 'string']], 'number[]'), // two params
      makeSpec('normalizeRows', [['rows', 'Row[]']], 'Row[]'), // no arbitrary for typeDecls types
      makeSpec('normalize', [['v', 'number[]']], 'string'), // types differ
      makeSpec('total', [['xs', 'number[]']], 'number'),
      makeSpec('encodeBase64', [['text', 'string']], 'string'), // partner absent
      makeSpec('topology', [['xs', 'number[]']], 'number[]'), // "to" prefix needs a capital after it
    ];
    for (const spec of none) expect(suggest(spec), spec.name).toEqual([]);
  });

  it('roundTrip needs the partner committed and the types to line up', () => {
    const dec = makeSpec('decodeBase64', [['encoded', 'string']], 'string');
    const enc = makeSpec('encodeBase64', [['text', 'string']], 'string');
    expect(suggestProperties(dec, programOf(makeRecord(dec), makeRecord(enc)))).toEqual([]); // not committed
    const encBytes = makeSpec('encodeBase64', [['bytes', 'number[]']], 'string');
    expect(suggestProperties(dec, programOf(makeRecord(dec), makeRecord(encBytes, { js: ENCODE_JS, returnType: 'string' })))).toEqual([]);
  });

  it('never suggests determinism or non-mutation; exports them as already-checked rows instead', () => {
    expect(alwaysChecked).toEqual([
      { title: 'Same input twice gives the same result', by: 'Invariants' },
      { title: 'The arguments are not modified', by: 'Invariants' },
    ]);
    const all = [
      suggest(makeSpec('sortDescending', [['xs', 'number[]']], 'number[]')),
      suggest(makeSpec('add', [['a', 'number'], ['b', 'number']], 'number')),
      suggest({ ...specExample('slugify').spec, properties: '' }),
    ].flat();
    for (const s of all) expect(s.title).not.toMatch(/same input|twice gives|not modified|mutat|determin/i);
  });
});

describe('cap, markers and de-duplication', () => {
  it('never returns more than 6, ids unique, over a sweep of names × signatures', () => {
    const names = [
      'toSortedUnique', 'normalizeSortedCounts', 'sortAbs', 'clampedMaxDistance', 'dedupeSorted', 'add', 'maxSlug',
      'cleanSlug', 'fromSortedUnique', 'countSorted', 'encodeSorted', 'decodeSorted', 'uniqueSort', 'meanAbs',
    ];
    const sigs: Array<[Array<[string, string]>, string]> = [
      [[['x', 'number[]']], 'number[]'], [[['x', 'string']], 'string'], [[['x', 'number']], 'number'],
      [[['a', 'number'], ['b', 'number']], 'number'], [[['x', 'number[]']], 'number'], [[['xs', 'string[]']], 'string[]'],
    ];
    const specs = names.flatMap((n) => sigs.map(([p, r]) => makeSpec(n, p, r, { doc: 'Normalizes into a canonical slug, sorted descending.' })));
    const program = programOf(...specs.map((s) => makeRecord(s, { js: `function ${s.name}(x) { return x; }`, returnType: s.returns! })));
    for (const spec of specs) {
      const ss = suggestProperties(spec, program);
      expect(ss.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
      expect(new Set(ss.map((s) => s.id)).size).toBe(ss.length);
    }
  });

  it('every source starts with its // suggested:<id> marker and has a title, why and applies', () => {
    const ss = [
      ...suggest(makeSpec('sortDescending', [['xs', 'number[]']], 'number[]')),
      ...suggest({ ...specExample('slugify').spec, properties: '' }),
      ...suggest(makeSpec('add', [['a', 'number'], ['b', 'number']], 'number')),
    ];
    for (const s of ss) {
      expect(s.source.split('\n')[0]).toBe(`// suggested:${s.id}`);
      expect(s.source).toMatch(/\n\(\(\) => \{\n[\s\S]*\n\}\)\(\);$/);
      expect(s.title.length).toBeGreaterThan(10);
      expect(s.why).toMatch(/\.$/);
      expect(s.applies).not.toBe('');
    }
  });

  it('drops a suggestion whose title or meaning is already among the spec properties', () => {
    const base = makeSpec('sortDescending', [['xs', 'number[]']], 'number[]');
    const withSorted = { ...base, properties: "property('output is in descending order', [fc.array(fc.integer())], (xs: number[]) => true);" };
    expect(kinds(suggest(withSorted))).toEqual(['sameElements', 'length']);
    const withTitle = { ...base, properties: "property('The output has as many items as the input!', [fc.array(fc.integer())], () => true);" };
    expect(kinds(suggest(withTitle))).toEqual(['sorted', 'sameElements']);
  });

  it('adding one suggestion never hides a sibling suggestion', () => {
    const dec = makeSpec('decodeBase64', [['encoded', 'string']], 'string');
    const enc = makeSpec('encodeBase64', [['text', 'string']], 'string');
    const cases: Array<[FunctionSpec, Program | undefined]> = [
      [makeSpec('sortDescending', [['xs', 'number[]']], 'number[]'), undefined],
      [makeSpec('sortWords', [['xs', 'string[]']], 'string[]'), undefined],
      [makeSpec('add', [['a', 'number'], ['b', 'number']], 'number'), undefined],
      [makeSpec('abs', [['x', 'number']], 'number'), undefined],
      [makeSpec('lowercaseSlug', [['t', 'string']], 'string'), undefined],
      [{ ...specExample('slugify').spec, properties: '' }, undefined],
      [dec, programOf(makeRecord(dec), makeRecord(enc, { js: ENCODE_JS, returnType: 'string' }))],
    ];
    for (const [spec, program] of cases) {
      const all = suggest(spec, program);
      for (const s of all) {
        const added = appendProperty(spec, s);
        const rest = suggest(added, program).map((x) => x.id);
        expect(rest, `${spec.name} after adding ${s.kind}`).toEqual(all.filter((x) => x !== s).map((x) => x.id));
      }
    }
  });

  it('a hand-written decoder property that merely mentions decoding does not hide the round trip', () => {
    const dec = makeSpec('decodeBase64', [['encoded', 'string']], 'string', {
      properties: "property('decodes padding', [fc.constant('YQ==')], (s: string) => decodeBase64(s) === 'a');",
    });
    const enc = makeSpec('encodeBase64', [['text', 'string']], 'string');
    const ss = suggestProperties(dec, programOf(makeRecord(dec), makeRecord(enc, { js: ENCODE_JS, returnType: 'string' })));
    expect(kinds(ss)).toEqual(['roundTrip']);
    const roundTripByHand = { ...dec, properties: "property('decoding an encoded string gives back the original', [fc.string()], () => true);" };
    expect(suggestProperties(roundTripByHand, programOf(makeRecord(roundTripByHand), makeRecord(enc, { js: ENCODE_JS, returnType: 'string' })))).toEqual([]);
  });

  it('drops a suggestion once its marker is in the properties (the UI then shows it as added)', () => {
    const spec = makeSpec('sortDescending', [['xs', 'number[]']], 'number[]');
    const [first] = suggest(spec);
    const added = appendProperty(spec, first!);
    expect(isAdded(added, first!)).toBe(true);
    expect(kinds(suggest(added))).toEqual(['sameElements', 'length']);
  });
});

describe('appendProperty / isAdded', () => {
  const spec = makeSpec('sortDescending', [['xs', 'number[]']], 'number[]');
  const [sorted, same] = suggest(spec) as [Suggestion, Suggestion];

  it('appends without a leading blank line to empty properties, after one blank line otherwise', () => {
    const one = appendProperty(spec, sorted);
    expect(one.properties).toBe(`${sorted.source}\n`);
    const two = appendProperty(one, same);
    expect(two.properties).toBe(`${sorted.source}\n\n${same.source}\n`);
    const userWritten = { ...spec, properties: "property('x', [fc.integer()], () => true);\n\n\n" };
    expect(appendProperty(userWritten, sorted).properties).toBe(`property('x', [fc.integer()], () => true);\n\n${sorted.source}\n`);
  });

  it('is pure and idempotent', () => {
    const before = JSON.stringify(spec);
    const once = appendProperty(spec, sorted);
    expect(JSON.stringify(spec)).toBe(before);
    expect(once).not.toBe(spec);
    const twice = appendProperty(once, sorted);
    expect(twice).toBe(once);
    expect(twice.properties).toBe(once.properties);
  });

  it('isAdded matches the whole marker line only', () => {
    const fake: Suggestion = { ...sorted, id: 'sorted:sortDescending' };
    const longer: Suggestion = {
      ...sorted,
      id: 'sorted:sortDescendingFast',
      source: sorted.source.replace('// suggested:sorted:sortDescending', '// suggested:sorted:sortDescendingFast'),
    };
    const s = appendProperty(spec, longer);
    expect(isAdded(s, longer)).toBe(true);
    expect(isAdded(s, fake)).toBe(false);
    expect(isAdded({ ...spec, properties: '  // suggested:sorted:sortDescending  \n' }, fake)).toBe(true);
    expect(isAdded({ ...spec, properties: 'x // suggested:sorted:sortDescending' }, fake)).toBe(false);
  });
});
