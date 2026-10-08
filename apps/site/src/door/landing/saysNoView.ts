/**
 * Pure view-models for the landing's "It says no" + "Your data stays in your browser" cards (V3-Door-Landing,
 * SAYS NO + DATA STAYS). The three declines are the design's illustration of the decline protocol
 * (GenerationView.declined); the column line and the example rows are computed from the real orders sample
 * (model/samples.ts, the exact rows sampleForModel sends), never typed in.
 */
import { FOOTER_REST } from '../model/privacy';
import { sampleFile } from '../model/samples';

export type DeclineId = 'susp' | 'week' | 'clean';

export interface Decline {
  id: DeclineId;
  /** The chip label, also the "You asked · …" line. */
  label: string;
  why: string;
  help: string;
}

export const DECLINES: readonly Decline[] = [
  {
    id: 'susp',
    label: 'Flag suspicious orders',
    why: "\"Suspicious\" isn't written down anywhere in your file or your rules, so there is nothing to check a draft against. It could mean large amounts, repeat refunds, a new customer or a country that doesn't match.",
    help: 'Say what counts, for example "orders over $500 that were later refunded". Then it becomes a rule we can check.',
  },
  {
    id: 'week',
    label: 'Orders from the last 7 days',
    why: "The answer would depend on today's date. It would change every day, so no check could hold it steady.",
    help: 'Give the dates, for example "orders from 1 Dec to 7 Dec 2024".',
  },
  {
    id: 'clean',
    label: 'Clean up this file',
    why: '"Clean up" could mean a dozen things, and we never change your file.',
    help: 'Name the column and what clean means, for example "trim spaces from email". You get a new result; your file stays as it is.',
  },
];

export const DEFAULT_DECLINE: DeclineId = 'susp';

export function declineById(id: DeclineId): Decline {
  return DECLINES.find((d) => d.id === id) ?? DECLINES[0]!;
}

/** The example question of the privacy card (design copy). */
export const PRIVACY_QUESTION = 'Who are our top customers by revenue?';
/** The landing's off-state copy (shorter than the first run's). */
export const LANDING_OFF_TEXT = 'Off. The AI sees no rows from your file, only the column names and types.';
/** The one sentence added for replay mode: nothing is sent in this demo. */
export const LANDING_REPLAY_NOTE = 'In this demo nothing is sent at all: answers are recorded, so the AI sees nothing until you run it on your computer.';

export interface PrivacyCardView {
  question: string;
  /** `id Number · orderDate Date · customer Text · …` */
  columnsLine: string;
  /** `3 example rows` (the real sample size) */
  rowsTitle: string;
  /** aria-label of the switch */
  switchLabel: string;
  /** 'On · one click to turn off' / 'Off' */
  rowsWord: string;
  rowsOn: boolean;
  /** The example rows, one line each (always computed; shown only when on). */
  exampleRows: string[];
  offText: string;
  /** The fine print under the list. */
  finePrint: string;
  /** Replay only: the added sentence. */
  replayNote: string | null;
}

export function privacyCardView(rowsOn: boolean, mode: 'live' | 'replay'): PrivacyCardView {
  const orders = sampleFile('orders');
  const n = orders.exampleRows.length;
  const rows = `${n} example row${n === 1 ? '' : 's'}`;
  return {
    question: PRIVACY_QUESTION,
    columnsLine: orders.columnsLine,
    rowsTitle: rows,
    switchLabel: `Send ${rows} to the AI`,
    rowsWord: rowsOn ? 'On · one click to turn off' : 'Off',
    rowsOn,
    exampleRows: orders.exampleRows,
    offText: LANDING_OFF_TEXT,
    finePrint: 'Everything else in your file stays in this browser. ' + FOOTER_REST,
    replayNote: mode === 'replay' ? LANDING_REPLAY_NOTE : null,
  };
}
