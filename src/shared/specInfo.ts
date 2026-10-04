import type { FunctionSpec } from '../types';

/**
 * Static extraction of test names from user-written test/property source.
 *
 * A small scanner rather than a bare regexp: it skips comments and string/template literals so that
 * `// test("old")` or `"test('x')"` are not counted, and it decodes escapes in the name literal.
 * A call is recognised when one of the names below appears as a standalone identifier (not after `.`,
 * so `fc.property(...)` is ignored) followed by `(` and a string literal without interpolation.
 */
const CALLEES = new Set(['test', 'property', 'matchesReference']);

export function listTestNames(src: string): string[] {
  const names: string[] = [];
  let i = 0;
  const n = src.length;
  let prevSignificant = ''; // last non-space, non-comment char before the current token

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
    if (c === '"' || c === "'" || c === '`') {
      i = c === '`' ? skipTemplate(src, i) : readQuoted(src, i).end;
      prevSignificant = c;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(src[j]!)) j++;
      const word = src.slice(i, j);
      if (CALLEES.has(word) && prevSignificant !== '.') {
        const name = nameArgument(src, j);
        if (name !== null) names.push(name);
      }
      i = j;
      prevSignificant = word[word.length - 1]!;
      continue;
    }
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return names;
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
