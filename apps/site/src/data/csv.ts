/**
 * CSV → rows of strings. RFC 4180 style, lenient, never throws on text input.
 *
 * - Quoted fields: `"a,b"`, `"say ""hi"""`, embedded newlines/delimiters inside quotes.
 * - Line endings: CRLF, LF and lone CR all end a record. A leading UTF-8 BOM is dropped.
 * - Delimiter: sniffed among `,` `;` TAB `|` over the first 20 non-blank records (see sniffDelimiter), unless
 *   `opts.delimiter` is given.
 * - Header: first record. Names are trimmed; blank names become `col_N` (N = 1-based column index); duplicates
 *   become `a`, `a_2`, `a_3`… (never colliding with another real header).
 * - Ragged rows: short rows are padded with ''. Long rows keep their extra values under new `col_N` columns
 *   (with a warning), and every row is padded so all rows share exactly the same keys.
 * - Blank (or whitespace-only) lines are skipped: leading/trailing ones silently, interior ones with one summary
 *   warning. Exception: in a single-column file an interior blank line is a row whose value is ''.
 * - A quote that is never closed is a warning; the field runs to the end of the input.
 *
 * Values are never trimmed or coerced here (see infer.ts coerceCsvRows).
 */

export interface CsvOptions {
  /** Force a delimiter instead of sniffing. */
  delimiter?: string;
}

export interface CsvResult {
  rows: Array<Record<string, string>>;
  headers: string[];
  delimiter: string;
  warnings: string[];
}

export const CSV_DELIMITERS: readonly string[] = [',', ';', '\t', '|'];

const SNIFF_RECORDS = 20;
const MAX_ROW_WARNINGS = 5;

interface RawRecord {
  fields: string[];
  /** 1-based physical line on which the record starts. */
  line: number;
  /** A record that is a single empty (or whitespace-only), unquoted field: a blank line. */
  blank: boolean;
}

export function parseCsv(text: string, opts: CsvOptions = {}): CsvResult {
  const warnings: string[] = [];
  const src = typeof text === 'string' ? text : String(text);
  const body = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  const delimiter =
    opts.delimiter !== undefined && opts.delimiter.length === 1 && opts.delimiter !== '"' && !/[\r\n]/.test(opts.delimiter)
      ? opts.delimiter
      : sniffDelimiter(body);
  if (opts.delimiter !== undefined && opts.delimiter !== delimiter) {
    warnings.push(`Ignored delimiter ${JSON.stringify(opts.delimiter)}: it must be one character, not a quote or newline.`);
  }

  const records = tokenize(body, delimiter, warnings);

  // Drop trailing blank records silently; interior blank records are skipped with one warning.
  while (records.length > 0 && records[records.length - 1]!.blank) records.pop();
  // Leading blank lines before the header are skipped too.
  while (records.length > 0 && records[0]!.blank) records.shift();
  if (records.length === 0) {
    if (body.trim() === '') warnings.push('The input is empty.');
    return { rows: [], headers: [], delimiter, warnings };
  }

  const header = records[0]!;
  const headers = makeHeaders(header.fields);
  const taken = new Set(headers);

  let skippedBlank = 0;
  const dataRecords: RawRecord[] = [];
  for (let i = 1; i < records.length; i++) {
    const r = records[i]!;
    if (r.blank && headers.length !== 1) {
      skippedBlank++;
      continue;
    }
    dataRecords.push(r);
  }
  if (skippedBlank > 0) {
    warnings.push(`Skipped ${skippedBlank} blank line${skippedBlank === 1 ? '' : 's'} between rows.`);
  }

  // Long rows: add extra columns (col_N), then every row is padded to the final width.
  let longRows = 0;
  for (const r of dataRecords) {
    if (r.fields.length > header.fields.length) {
      longRows++;
      if (longRows <= MAX_ROW_WARNINGS) {
        warnings.push(
          `Row on line ${r.line} has ${r.fields.length} values but the header has ${header.fields.length} columns; the extra values were kept as extra columns.`,
        );
      }
      while (headers.length < r.fields.length) {
        const name = uniqueName(`col_${headers.length + 1}`, taken, taken);
        taken.add(name);
        headers.push(name);
      }
    }
  }
  if (longRows > MAX_ROW_WARNINGS) {
    warnings.push(`…and ${longRows - MAX_ROW_WARNINGS} more row${longRows - MAX_ROW_WARNINGS === 1 ? '' : 's'} with too many values.`);
  }

  const rows: Array<Record<string, string>> = dataRecords.map((r) => {
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      // defineProperty, not assignment: a "__proto__" header must stay an own data property.
      Object.defineProperty(row, headers[c]!, { value: r.fields[c] ?? '', enumerable: true, writable: true, configurable: true });
    }
    return row;
  });

  return { rows, headers, delimiter, warnings };
}

/**
 * Pick the delimiter whose per-record count (outside quotes) is the same on the most of the first 20 non-blank
 * records. Ties: higher count, then the order `,` `;` TAB `|`. No candidate present at all → `,`.
 */
export function sniffDelimiter(text: string): string {
  const counts: number[][] = CSV_DELIMITERS.map(() => []);
  let current = CSV_DELIMITERS.map(() => 0);
  let inQuotes = false;
  let lineHasContent = false;
  let records = 0;
  const endRecord = (): void => {
    if (lineHasContent) {
      current.forEach((n, d) => counts[d]!.push(n));
      records++;
    }
    current = CSV_DELIMITERS.map(() => 0);
    lineHasContent = false;
  };
  for (let i = 0; i < text.length && records < SNIFF_RECORDS; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      lineHasContent = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
    } else {
      const d = CSV_DELIMITERS.indexOf(ch);
      if (d >= 0) current[d]!++;
      if (ch.trim() !== '' || d >= 0) lineHasContent = true;
    }
  }
  if (records < SNIFF_RECORDS) endRecord();

  let best = { d: -1, consistency: 0, count: 0 };
  CSV_DELIMITERS.forEach((_, d) => {
    const cs = counts[d]!;
    // mode of the non-zero counts
    const freq = new Map<number, number>();
    for (const n of cs) if (n > 0) freq.set(n, (freq.get(n) ?? 0) + 1);
    let modeCount = 0;
    let consistency = 0;
    for (const [n, f] of freq) {
      if (f > consistency || (f === consistency && n > modeCount)) {
        consistency = f;
        modeCount = n;
      }
    }
    if (consistency === 0) return;
    if (consistency > best.consistency || (consistency === best.consistency && modeCount > best.count)) {
      best = { d, consistency, count: modeCount };
    }
  });
  return best.d < 0 ? ',' : CSV_DELIMITERS[best.d]!;
}

function tokenize(text: string, delimiter: string, warnings: string[]): RawRecord[] {
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let fieldQuoted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  let strayWarned = false;
  const n = text.length;

  const endField = (): void => {
    fields.push(field);
    field = '';
  };
  const endRecord = (): void => {
    const blank = fields.length === 1 && fields[0]!.trim() === '' && !fieldQuoted;
    records.push({ fields, line: recordLine, blank });
    fields = [];
    fieldQuoted = false;
  };

  while (i < n) {
    // start of a field
    fieldQuoted = false;
    if (text[i] === '"') {
      fieldQuoted = true;
      const quoteLine = line;
      i++;
      let closed = false;
      while (i < n) {
        const ch = text[i]!;
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        if (ch === '\r') {
          if (text[i + 1] === '\n') {
            field += '\r\n';
            i += 2;
          } else {
            field += '\r';
            i++;
          }
          line++;
          continue;
        }
        if (ch === '\n') line++;
        field += ch;
        i++;
      }
      if (!closed) {
        warnings.push(`Unterminated quote starting on line ${quoteLine}: the rest of the input was read as one value.`);
        endField();
        endRecord();
        return records;
      }
      // Characters between a closing quote and the next delimiter/newline are kept (lenient), with one warning.
      const after = i;
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') {
        field += text[i];
        i++;
      }
      if (i > after && !strayWarned) {
        strayWarned = true;
        warnings.push(`Line ${line}: text after a closing quote was kept as part of the value.`);
      }
    } else {
      // unquoted field: quotes inside are literal
      const start = i;
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') i++;
      field = text.slice(start, i);
    }

    if (i >= n) {
      endField();
      endRecord();
      return records;
    }
    const ch = text[i]!;
    if (ch === delimiter) {
      endField();
      i++;
      if (i >= n) {
        // trailing delimiter at EOF: one more empty field
        fields.push('');
        endRecord();
        return records;
      }
      continue;
    }
    // newline
    endField();
    endRecord();
    i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    line++;
    recordLine = line;
  }
  return records;
}

function makeHeaders(raw: string[]): string[] {
  const bases = raw.map((h, i) => {
    const t = h.trim();
    return t === '' ? `col_${i + 1}` : t;
  });
  const reserved = new Set(bases);
  const taken = new Set<string>();
  const out: string[] = new Array<string>(bases.length);
  // pass 1: first occurrence of each base keeps it
  bases.forEach((b, i) => {
    if (!taken.has(b)) {
      taken.add(b);
      out[i] = b;
    }
  });
  // pass 2: duplicates get the first free `base_k`, avoiding every real header
  bases.forEach((b, i) => {
    if (out[i] !== undefined) return;
    const name = uniqueName(b, taken, reserved, 2);
    taken.add(name);
    out[i] = name;
  });
  return out;
}

function uniqueName(base: string, taken: Set<string>, reserved: Set<string>, firstSuffix = 0): string {
  if (firstSuffix === 0 && !taken.has(base)) return base;
  for (let k = Math.max(firstSuffix, 2); ; k++) {
    const name = `${base}_${k}`;
    if (!taken.has(name) && !reserved.has(name)) return name;
  }
}
