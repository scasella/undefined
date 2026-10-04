/**
 * A tiny TypeScript tokenizer for display only. It must tolerate truncated input (the typewriter
 * reveals a body character by character), so unterminated strings/comments run to end of input.
 */

export type TokenKind = 'kw' | 'type' | 'str' | 'num' | 'com' | 'punc' | 'ident' | 'ws';

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set([
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from',
  'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of',
  'readonly', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof',
  'undefined', 'var', 'void', 'while', 'yield', 'keyof',
]);

const TYPES = new Set([
  'number', 'string', 'boolean', 'bigint', 'symbol', 'unknown', 'any', 'never', 'object',
  'Array', 'ReadonlyArray', 'Record', 'Map', 'Set', 'Promise', 'Partial', 'Readonly',
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

function readQuoted(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (c === '\n' && quote !== '`') return i; // unterminated single-line string stops at newline
    i++;
  }
  return src.length;
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string): void => {
    const last = out[out.length - 1];
    // merge adjacent punctuation/whitespace to keep the DOM small
    if (last && last.kind === kind && (kind === 'punc' || kind === 'ws')) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      push('com', src.slice(i, stop));
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      push('com', src.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      const stop = readQuoted(src, i, c);
      push('str', src.slice(i, stop));
      i = stop;
    } else if (/\d/.test(c) || (c === '.' && next !== undefined && /\d/.test(next))) {
      const m = /^(0[xXbBoO][\da-fA-F_]+n?|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?n?|\.\d[\d_]*([eE][+-]?\d+)?)/.exec(
        src.slice(i),
      );
      const text = m ? m[0] : c;
      push('num', text);
      i += text.length;
    } else if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < src.length && IDENT_PART.test(src[j])) j++;
      const word = src.slice(i, j);
      push(KEYWORDS.has(word) ? 'kw' : TYPES.has(word) ? 'type' : 'ident', word);
      i = j;
    } else if (/\s/.test(c)) {
      push('ws', c);
      i++;
    } else {
      push('punc', c);
      i++;
    }
  }
  return out;
}

/** Split a token stream into lines (tokens that contain newlines are split). */
export function tokenLines(src: string): Token[][] {
  const lines: Token[][] = [[]];
  for (const tok of tokenize(src)) {
    const parts = tok.text.split('\n');
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ kind: tok.kind, text: part });
    });
  }
  return lines;
}

export interface MarkedToken extends Token {
  marked?: boolean;
}

/**
 * Split a line's tokens so columns [col, endCol) (1-based) are flagged `marked`, for underlining a compile
 * diagnostic span. An empty or inverted span marks one character so the underline is still visible.
 */
export function markRange(line: Token[], col: number, endCol: number): MarkedToken[] {
  const start = col - 1;
  const end = Math.max(endCol - 1, start + 1);
  const out: MarkedToken[] = [];
  let pos = 0;
  for (const tok of line) {
    const tStart = pos;
    const tEnd = pos + tok.text.length;
    pos = tEnd;
    const a = Math.max(start, tStart);
    const b = Math.min(end, tEnd);
    if (a >= b) {
      out.push(tok);
      continue;
    }
    if (a > tStart) out.push({ kind: tok.kind, text: tok.text.slice(0, a - tStart) });
    out.push({ kind: tok.kind, text: tok.text.slice(a - tStart, b - tStart), marked: true });
    if (b < tEnd) out.push({ kind: tok.kind, text: tok.text.slice(b - tStart) });
  }
  return out;
}
