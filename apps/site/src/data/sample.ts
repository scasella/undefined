/**
 * The small, deterministic slice of a dataset that is shown to the model, and the sentence that tells the user
 * exactly what leaves their browser.
 */
import type { DatasetRef } from '@scasella/undefined-engine/types';

export interface SampleOptions {
  /** Rows to pick, evenly spaced (first, …, last). */
  count: number;
  /** Max code points per string value; longer strings end in '…'. */
  maxCell: number;
  /** Max UTF-8 bytes of `text`. */
  maxBytes: number;
}

export interface ModelSample {
  rows: unknown[];
  /** True when any row was left out, any string was cut, or any array was shortened. */
  truncated: boolean;
  /** True when a string was cut or an array shortened (a subset of `truncated`). */
  valuesCut: boolean;
  /** Exactly the text that would be sent: compact JSON of `rows`. */
  text: string;
}

export const DEFAULT_SAMPLE: SampleOptions = { count: 3, maxCell: 80, maxBytes: 1500 };

const CELL_FLOOR = 24;
const MIN_CELL = 8;
const MAX_ITEMS = 10;

/** Evenly spaced indices over [0, n): first and last always included when k ≥ 2. */
export function sampleIndices(n: number, k: number): number[] {
  const count = Math.max(0, Math.min(Math.floor(k), n));
  if (count === 0) return [];
  if (count === 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * (n - 1)) / (count - 1));
    if (!out.includes(idx)) out.push(idx);
  }
  return out;
}

/**
 * Pick `count` evenly spaced rows, cut long strings to `maxCell`, and keep the JSON text under `maxBytes`:
 * first shorten cells (down to 24 code points), then drop rows (keeping the spread), then shorten cells to 8 and
 * arrays to 1 item, and finally send no rows (`[]`). `text` is guaranteed ≤ maxBytes whenever maxBytes ≥ 2.
 */
export function sampleForModel(rows: readonly unknown[], opts: Partial<SampleOptions> = {}): ModelSample {
  const o: SampleOptions = { ...DEFAULT_SAMPLE, ...opts };
  const maxCell = Math.max(1, Math.floor(o.maxCell));
  let count = Math.max(0, Math.min(Math.floor(o.count), rows.length));
  let cell = maxCell;
  let items = MAX_ITEMS;

  const attempt = (): { picked: unknown[]; text: string; cut: boolean } => {
    const state = { cut: false };
    const picked = sampleIndices(rows.length, count).map((i) => clip(rows[i], cell, items, state, []));
    return { picked, text: JSON.stringify(picked), cut: state.cut };
  };

  for (;;) {
    const { picked, text, cut } = attempt();
    if (utf8Length(text) <= o.maxBytes || count === 0) {
      return { rows: picked, truncated: cut || picked.length < rows.length, valuesCut: cut, text };
    }
    if (cell > CELL_FLOOR) cell = Math.max(CELL_FLOOR, Math.floor(cell / 2));
    else if (count > 1) count--;
    else if (cell > MIN_CELL || items > 1) {
      cell = Math.min(cell, MIN_CELL);
      items = 1;
    } else count = 0;
  }
}

/** A JSON-safe copy with strings cut to `cell` code points and arrays to `items`. Never throws. */
function clip(v: unknown, cell: number, items: number, state: { cut: boolean }, ancestors: object[]): unknown {
  switch (typeof v) {
    case 'string': {
      const cps = Array.from(v);
      if (cps.length <= cell) return v;
      state.cut = true;
      return cps.slice(0, Math.max(0, cell - 1)).join('') + '…';
    }
    case 'number':
      return Number.isFinite(v) ? v : String(v);
    case 'boolean':
      return v;
    case 'bigint':
      return `${v}n`;
    case 'undefined':
    case 'function':
    case 'symbol':
      return null;
  }
  if (v === null) return null;
  const obj = v as object;
  if (ancestors.includes(obj)) return '[Circular]';
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString();
  ancestors.push(obj);
  try {
    if (Array.isArray(obj)) {
      const arr = obj as unknown[];
      if (arr.length > items) state.cut = true;
      return arr.slice(0, items).map((x) => clip(x, cell, items, state, ancestors));
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      const d = Object.getOwnPropertyDescriptor(obj, k);
      if (!d || !('value' in d) || d.value === undefined) continue;
      Object.defineProperty(out, k, {
        value: clip(d.value, cell, items, state, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  } finally {
    ancestors.pop();
  }
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

function fmt(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Plain-English "what leaves your browser" sentence for a dataset and its model sample. */
export function describeSend(ref: DatasetRef, sample: ModelSample): string {
  const typeBytes = utf8Length(ref.typeDecl);
  const sampleBytes = utf8Length(sample.text);
  const n = sample.rows.length;
  const total = `${fmt(ref.rowCount)} row${ref.rowCount === 1 ? '' : 's'}`;
  const typePart = `Sent to the model: the type ${ref.typeName} (${fmt(typeBytes)} bytes: \`${ref.typeDecl}\`)`;
  if (n === 0) return `${typePart} and no sample rows. All ${total} in ${ref.name} stay in your browser.`;
  const rest = ref.rowCount - n;
  return (
    `${typePart} and ${n} sample row${n === 1 ? '' : 's'} (${fmt(sampleBytes)} bytes of JSON${sample.valuesCut ? ', long values cut' : ''}) ` +
    `of the ${total} in ${ref.name}. ` +
    (rest > 0 ? `The other ${fmt(rest)} row${rest === 1 ? '' : 's'} stay in your browser.` : 'That is every row.')
  );
}
