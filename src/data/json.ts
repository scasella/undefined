/**
 * JSON / JSON Lines → rows. Never throws.
 *
 * Accepted shapes:
 *   'array'             `[{…}, {…}]`
 *   'object-with-array' `{ "orders": [{…}], "meta": … }` — exactly one property holds a non-empty array whose
 *                       elements are all objects; it is taken and named in a warning.
 *   'jsonl'             one JSON value per line (blank lines ignored).
 * Elements that are not plain objects (numbers, strings, arrays, null) are wrapped as `{ value: x }` with a warning.
 * Values are kept exactly as JSON.parse produced them (numbers, booleans, null, nested objects/arrays).
 */

export type JsonShape = 'array' | 'object-with-array' | 'jsonl';

export type JsonDataResult =
  | { rows: Array<Record<string, unknown>>; warnings: string[]; shape: JsonShape }
  | { error: string };

export function parseJsonData(text: string): JsonDataResult {
  try {
    return parse(typeof text === 'string' ? text : String(text));
  } catch (e) {
    // defensive: nothing below is expected to throw
    return { error: `Could not read the JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function parse(text: string): JsonDataResult {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.trim() === '') return { error: 'Nothing to import: the input is empty.' };

  let value: unknown;
  let wholeError: string | null = null;
  try {
    value = JSON.parse(body);
  } catch (e) {
    wholeError = describeSyntaxError(e, body);
  }

  if (wholeError === null) {
    if (Array.isArray(value)) return fromElements(value, 'array', [], 'element');
    if (isObject(value)) return fromObject(value);
    return {
      error: `The JSON is ${describeKind(value)}, not an array of objects. Paste an array like [{"id": 1}, {"id": 2}], an object with one such array, or JSON Lines.`,
    };
  }

  // JSON Lines: every non-blank line must be a complete JSON value.
  const lines = body.split(/\r\n|\n|\r/);
  const nonBlank = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim() !== '');
  if (nonBlank.length >= 2) {
    const parsed: unknown[] = [];
    let firstBad: string | null = null;
    let goodLines = 0;
    for (const { l, i } of nonBlank) {
      try {
        parsed.push(JSON.parse(l));
        goodLines++;
      } catch (e) {
        if (firstBad === null) firstBad = `line ${i + 1}: ${describeSyntaxError(e, l, false)}`;
      }
    }
    if (firstBad === null) return fromElements(parsed, 'jsonl', [], 'line');
    // Mostly-valid JSON Lines: report the bad line, not the whole-document error.
    if (goodLines > 0 && goodLines >= nonBlank.length / 2 && looksLikeJsonl(nonBlank[0]!.l)) {
      return { error: `This looks like JSON Lines, but ${firstBad}` };
    }
  }
  return { error: `This is not valid JSON: ${wholeError}` };
}

function looksLikeJsonl(firstLine: string): boolean {
  try {
    JSON.parse(firstLine);
    return true;
  } catch {
    return false;
  }
}

function fromObject(obj: Record<string, unknown>): JsonDataResult {
  const keys = Object.keys(obj);
  const candidates = keys.filter((k) => {
    const v = obj[k];
    return Array.isArray(v) && v.length > 0 && v.every(isObject);
  });
  if (candidates.length === 1) {
    const key = candidates[0]!;
    const others = keys.filter((k) => k !== key);
    const warnings = [
      `Used the ${JSON.stringify(key)} property (${plural((obj[key] as unknown[]).length, 'row')})` +
        (others.length > 0 ? `; ignored ${others.map((k) => JSON.stringify(k)).join(', ')}.` : '.'),
    ];
    return fromElements(obj[key] as unknown[], 'object-with-array', warnings, 'element');
  }
  if (candidates.length === 0) {
    const listed = keys.length === 0 ? 'it has no properties' : `its properties are ${keys.map((k) => JSON.stringify(k)).join(', ')}`;
    return {
      error: `The JSON is an object, but none of its properties is a non-empty array of objects (${listed}). Paste an array of objects, or an object with exactly one such array.`,
    };
  }
  return {
    error: `The JSON object has ${candidates.length} arrays of objects (${candidates.map((k) => JSON.stringify(k)).join(', ')}); it is ambiguous which one to import. Paste just the one you want.`,
  };
}

function fromElements(
  elements: unknown[],
  shape: JsonShape,
  warnings: string[],
  unit: 'element' | 'line',
): JsonDataResult {
  const wrapped: number[] = [];
  const rows = elements.map((x, i) => {
    if (isObject(x)) return x;
    wrapped.push(i);
    return { value: x };
  });
  if (wrapped.length > 0) {
    const shown = wrapped.slice(0, 5).map((i) => i + 1);
    warnings.push(
      `${wrapped.length} of ${elements.length} ${unit}s ${wrapped.length === 1 ? 'was' : 'were'} not an object (row${wrapped.length === 1 ? '' : 's'} ${shown.join(', ')}${wrapped.length > 5 ? ', …' : ''}); each was wrapped as { value: … }.`,
    );
  }
  if (elements.length === 0) warnings.push('The array is empty: there are no rows.');
  return { rows, warnings, shape };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeKind(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return 'a string';
  if (typeof v === 'number') return 'a number';
  if (typeof v === 'boolean') return 'a boolean';
  return 'not an array';
}

/** The engine's SyntaxError message, plus line:column when the engine only gives a character position. */
function describeSyntaxError(e: unknown, text: string, withLocation = true): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (!withLocation || /line \d+ column \d+/i.test(msg)) return msg;
  const m = /position (\d+)/.exec(msg);
  if (!m) return msg;
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  const line = before.split(/\r\n|\n|\r/).length;
  const col = pos - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
  return `${msg} (line ${line}, column ${col})`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
