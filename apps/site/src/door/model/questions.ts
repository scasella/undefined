/**
 * Suggested questions for a loaded file. For the two samples: the design's hand-picked list, each mapped to an engine
 * call of a function whose name says what it returns. For any other file: src/data/suggest.ts suggestCalls (no model
 * asked), with a plain-words question made from DataSuggestion.what. `level` is 'full' only where a seeded agreement
 * exists (agreements.ts), so "Full checks" is never claimed for a question that has no examples, pins or rules. This is
 * the static default: the first-run session (start/session.ts) replaces it with what will really run (in the replay
 * demo the seed is only installed when a recording for it is bundled).
 */
import type { DatasetRef, FunctionSpec } from '@scasella/undefined-engine/types';
import { suggestCalls } from '../../data/suggest';
import { seedAgreement } from './agreements';
import type { DataRow } from './figures';
import type { SampleId } from './samples';

export type CheckLevel = 'full' | 'basic';

export interface SuggestedQuestion {
  id: string;
  /** Button text: `Top 5 customers by revenue` */
  label: string;
  /** The question in plain words: `Who are our top customers by revenue?` */
  text: string;
  /** The REPL call: `topCustomersByRevenue(rows)` (orders.csv is bound as `rows`, see samples.ts) */
  call: string;
  fn: string;
  level: CheckLevel;
  /** A question the viewer typed: the plain words the model is given as the function's contract. */
  doc?: string;
}

interface Picked {
  id: string;
  label: string;
  text: string;
  fn: string;
}

/** The design's hand-picked questions (FirstRun script), in order. */
const SAMPLE_QUESTIONS: Record<SampleId, readonly Picked[]> = {
  orders: [
    { id: 'status', label: 'Count orders by status', text: 'How many orders are there by status?', fn: 'countByStatus' },
    { id: 'top', label: 'Top 5 customers by revenue', text: 'Who are our top customers by revenue?', fn: 'topCustomersByRevenue' },
    { id: 'country', label: 'Revenue by country', text: 'What is our revenue by country?', fn: 'revenueByCountry' },
  ],
  sales: [
    { id: 'status', label: 'Count orders by status', text: 'How many orders are there by status?', fn: 'countByStatus' },
    { id: 'region', label: 'Total amount by region', text: 'What is the total amount by region?', fn: 'totalAmountByRegion' },
    { id: 'top', label: 'Top 5 customers by amount', text: 'Who are our top 5 customers by amount?', fn: 'top5CustomersByAmount' },
  ],
};

/** The question selected first (design: orders → top customers, sales → region). */
export const DEFAULT_QUESTION_ID: Record<SampleId, string> = { orders: 'top', sales: 'region' };

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A plain-words question from a suggestion's `what` (suggest.ts writes these five shapes):
 *   how many rows per X            → How many rows are there per X?
 *   the sum of A per B             → What is the sum of A per B?
 *   the five X values with the …   → What are the five X values with the …?
 *   the mean of X                  → What is the mean of X?
 *   the earliest and latest X      → What are the earliest and latest X?
 */
export function questionFromWhat(what: string): string {
  const w = what.trim().replace(/[.?]+$/, '');
  const per = /^how many rows per (.+)$/i.exec(w);
  if (per) return `How many rows are there per ${per[1]}?`;
  if (/^the (five|earliest|\d+ )/i.test(w) || /^the \S+ values/i.test(w)) return `What are ${w}?`;
  if (/^the /i.test(w)) return `What is ${w}?`;
  return `${capitalize(w)}?`;
}

/**
 * Suggested questions for a bound dataset. `sampleId` is the sample it is (samples.ts sampleIdFor), or null for the
 * user's own file; `rows` are the bound rows (only read for the user's own file).
 */
export function suggestedQuestions(dataset: DatasetRef, rows: readonly DataRow[], sampleId: SampleId | null): SuggestedQuestion[] {
  const level = (id: string): CheckLevel => (seedAgreement(sampleId, id, dataset) ? 'full' : 'basic');
  if (sampleId) {
    return SAMPLE_QUESTIONS[sampleId].map((q) => ({ ...q, call: `${q.fn}(${dataset.name})`, level: level(q.id) }));
  }
  return suggestCalls({ name: dataset.name, columns: dataset.columns, rows }).map((s) => ({
    id: s.fn,
    label: capitalize(s.what),
    text: questionFromWhat(s.what),
    call: s.call,
    fn: s.fn,
    level: level(s.fn),
  }));
}

// ───────────── typed questions ─────────────

export const CUSTOM_MAX = 300;

/** `How many orders were refunded?` → `howManyOrdersWereRefunded` (≤ 6 words, ASCII letters and digits; else `customQuestion`). */
export function fnNameFor(text: string): string {
  const words = (text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[A-Za-z0-9]+/g) ?? []).slice(0, 6);
  const camel = words.map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w.toLowerCase()))).join('');
  const name = /^[a-z]/.test(camel) ? camel : camel ? `question${capitalize(camel)}` : 'customQuestion';
  return name.slice(0, 48);
}

/** The viewer's own question as a REPL call on the bound table. `taken(fn)` says a function of that name means another question. */
export function customQuestion(text: string, dataset: Pick<DatasetRef, 'name'>, taken: (fn: string) => boolean = () => false): SuggestedQuestion | null {
  const t = text.trim().replace(/\s+/g, ' ').slice(0, CUSTOM_MAX);
  if (t.length < 3) return null;
  const base = fnNameFor(t);
  let fn = base;
  for (let n = 2; taken(fn) && n < 50; n++) fn = `${base}${n}`;
  return { id: `own:${fn}`, label: t, text: t, call: `${fn}(${dataset.name})`, fn, level: 'basic', doc: t };
}

/** The contract the model reads for a typed question: no checks of its own, so it is held to the basic ones. */
export function customSpec(q: SuggestedQuestion, dataset: Pick<DatasetRef, 'name' | 'typeName' | 'typeDecl'>): FunctionSpec {
  return {
    name: q.fn,
    params: [{ name: dataset.name, type: `${dataset.typeName}[]` }],
    returns: null,
    doc: `Answer this question about the table: ${q.doc ?? q.text}`,
    tests: '',
    properties: '',
    budgetMs: 1000,
    maxAttempts: 3,
    origin: 'user',
    ...(dataset.typeDecl.trim() !== '' ? { typeDecls: dataset.typeDecl } : {}),
  };
}
