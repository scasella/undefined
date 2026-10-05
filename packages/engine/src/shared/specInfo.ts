import type { FunctionSpec } from '../types';

/**
 * Static extraction of test names from user-written test/property source.
 *
 * A small scanner rather than a bare regexp: it skips comments, string/template literals and regular expression
 * literals (a `/` where an expression may start; body with escapes and character classes) so that
 * `// test("old")` or `"test('x')"` are not counted and a quote, backtick or `//` inside a regex such as `/["'`]/`
 * does not swallow the tests after it. It decodes escapes in the name literal. Not handled: regex literals inside
 * `${…}` template interpolations, and the rare `/` after `)` that starts a regex (e.g. `if (x) /re/.test(s)`).
 * A call is recognised when one of the names below appears as a standalone identifier (not after `.`,
 * so `fc.property(...)` is ignored) followed by `(` and a string literal without interpolation.
 */
const CALLEES = new Set(['test', 'property', 'matchesReference']);

/**
 * A `/` that is not a comment starts a regular expression literal when an expression may start there, i.e. when
 * the previous significant token is one of these punctuators or keywords (or there is none). After an identifier,
 * a number, a string, `)` or `]` it is division. (`}` is ambiguous in JS; treating it as regex context is right
 * after a block, which is what test files contain.)
 */
const REGEX_AFTER_PUNCT = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);

export function listTestNames(src: string): string[] {
  const names: string[] = [];
  let i = 0;
  const n = src.length;
  let prev = ''; // previous significant token: an identifier/keyword, or one punctuation/quote/digit char

  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '/' && regexAllowed(prev)) {
      const end = skipRegex(src, i);
      if (end !== null) {
        i = end;
        prev = '/regex/';
        continue;
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      i = c === '`' ? skipTemplate(src, i) : readQuoted(src, i).end;
      prev = c;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(src[j]!)) j++;
      const word = src.slice(i, j);
      if (CALLEES.has(word) && prev !== '.') {
        const name = nameArgument(src, j);
        if (name !== null) names.push(name);
      }
      i = j;
      prev = word;
      continue;
    }
    if (/[0-9]/.test(c)) {
      // a number (incl. 1e3, 0x1F, 1_000, 1.5): division may follow it
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j]!)) j++;
      i = j;
      prev = '0';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return names;
}

function regexAllowed(prev: string): boolean {
  return prev === '' || REGEX_AFTER_PUNCT.has(prev) || REGEX_AFTER_WORD.has(prev);
}

/**
 * Skips a regular expression literal starting at the `/` at `start` (body with escapes and character classes,
 * then flags). Returns the index after it, or null when it is not one (a line break before the closing `/`).
 */
function skipRegex(src: string, start: number): number | null {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\n' || c === '\r') return null;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') {
      inClass = true;
    } else if (c === '/') {
      i++;
      while (i < src.length && isIdentPart(src[i]!)) i++; // flags
      return i;
    }
    i++;
  }
  return null;
}

export function testNamesOf(spec: Pick<FunctionSpec, 'tests' | 'properties'>): { tests: string[]; properties: string[] } {
  return { tests: listTestNames(spec.tests), properties: listTestNames(spec.properties) };
}

/** After a callee identifier ending at `pos`: `(` then a plain string literal, with whitespace/comments allowed between. */
function nameArgument(src: string, pos: number): string | null {
  let i = skipTrivia(src, pos);
  if (src[i] !== '(') return null;
  i = skipTrivia(src, i + 1);
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  const lit = readQuoted(src, i);
  return lit.interpolated || !lit.closed ? null : lit.value;
}

function skipTrivia(src: string, i: number): number {
  for (;;) {
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      return i;
    }
  }
}

/** Reads a '…', "…" or `…` literal starting at `start` (the quote). For templates, stops at the first `${`. */
function readQuoted(src: string, start: number): { value: string; end: number; closed: boolean; interpolated: boolean } {
  const quote = src[start]!;
  let value = '';
  let i = start + 1;
  while (i < src.length) {
    const c = src[i]!;
    if (c === quote) return { value, end: i + 1, closed: true, interpolated: false };
    if (quote === '`' && c === '$' && src[i + 1] === '{') return { value, end: i, closed: false, interpolated: true };
    if (quote !== '`' && c === '\n') break; // unterminated string literal
    if (c === '\\') {
      const esc = decodeEscape(src, i + 1);
      value += esc.text;
      i = esc.end;
      continue;
    }
    value += c;
    i++;
  }
  return { value, end: i, closed: false, interpolated: false };
}

/** Skips a template literal including nested `${ … }` expressions (which may contain strings/templates). */
function skipTemplate(src: string, start: number): number {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') {
      i += 2;
    } else if (c === '`') {
      return i + 1;
    } else if (c === '$' && src[i + 1] === '{') {
      i = skipExpression(src, i + 2);
    } else {
      i++;
    }
  }
  return i;
}

/** Skips to just past the `}` closing an interpolation that started at `i`. */
function skipExpression(src: string, i: number): number {
  let depth = 1;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'") i = readQuoted(src, i).end;
    else if (c === '`') i = skipTemplate(src, i);
    else if (src.startsWith('//', i) || src.startsWith('/*', i)) i = skipTrivia(src, i);
    else {
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return i + 1;
      i++;
    }
  }
  return i;
}

const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

function decodeEscape(src: string, i: number): { text: string; end: number } {
  const c = src[i];
  if (c === undefined) return { text: '', end: i };
  if (c === '\r' && src[i + 1] === '\n') return { text: '', end: i + 2 }; // line continuation
  if (c === '\n' || c === '\r' || c === ' ' || c === ' ') return { text: '', end: i + 1 };
  if (c in SIMPLE_ESCAPES && !(c === '0' && /[0-9]/.test(src[i + 1] ?? ''))) return { text: SIMPLE_ESCAPES[c]!, end: i + 1 };
  if (c === 'x') {
    const hex = src.slice(i + 1, i + 3);
    if (/^[0-9a-fA-F]{2}$/.test(hex)) return { text: String.fromCharCode(parseInt(hex, 16)), end: i + 3 };
  }
  if (c === 'u') {
    if (src[i + 1] === '{') {
      const close = src.indexOf('}', i + 2);
      const hex = close === -1 ? '' : src.slice(i + 2, close);
      if (/^[0-9a-fA-F]{1,6}$/.test(hex) && parseInt(hex, 16) <= 0x10ffff) {
        return { text: String.fromCodePoint(parseInt(hex, 16)), end: close + 1 };
      }
    } else {
      const hex = src.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) return { text: String.fromCharCode(parseInt(hex, 16)), end: i + 5 };
    }
  }
  return { text: c, end: i + 1 };
}

function isIdentStart(c: string): boolean {
  return /[\p{ID_Start}_$]/u.test(c);
}

function isIdentPart(c: string): boolean {
  return /[\p{ID_Continue}$\u200c\u200d]/u.test(c);
}
