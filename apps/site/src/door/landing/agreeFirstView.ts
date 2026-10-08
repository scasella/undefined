/**
 * Landing · "It asks before it writes the checks" (#agree-first): what the section quotes, read from the demo's recorded draft
 * (model/recordedDraft.ts, written by `npm run record:draft`). Pure. Nothing here is typed in: the questions, the answers, the terms,
 * the checks and the limits are the recording's own words, read through the same parser the live draft uses, so the section can only
 * say what the recorded run said. When no draft is bundled the section is not drawn (null).
 */
import { RECORDED_DRAFT, recordedDay, recordedStory, type RecordedDraft } from '../model/recordedDraft';

export { recordedDay };

export interface AgreeFirstView {
  question: string;
  /** Every question the AI asked, round by round, with the answer given. */
  asked: Array<{ ask: string; answer: string; round: number }>;
  rounds: number;
  /** The first terms of the drafted contract, and how many more there are. */
  terms: string[];
  moreTerms: number;
  /** The drafted checks in plain words. */
  examples: string[];
  rules: string[];
  limits: string;
  /** `Recorded run · gpt-6-luna · 8 Oct 2026` */
  provenance: string;
}

/** The contract's sentences, split as AgreementDraft clausesOf splits them (kept here so this view stays free of components). */
function sentences(t: string): string[] {
  return t
    .split(/(?<=[.;])\s+(?=[A-Z“"(])/)
    .map((c) => c.trim())
    .filter((c) => c !== '');
}

export const SHOWN_TERMS = 3;

export function agreeFirstView(d: RecordedDraft | null = RECORDED_DRAFT): AgreeFirstView | null {
  if (!d) return null;
  const s = recordedStory(d);
  if (!s || s.asked.length === 0) return null;
  const all = sentences(s.final.contract);
  return {
    question: d.question,
    asked: s.asked.flatMap((a, r) => a.questions.map((q, i) => ({ ask: q.ask, answer: a.answers[i]?.answer ?? '', round: r + 1 }))),
    rounds: s.asked.length,
    terms: all.slice(0, SHOWN_TERMS),
    moreTerms: Math.max(0, all.length - SHOWN_TERMS),
    examples: s.final.examples.map((x) => x.plain),
    rules: s.final.rules.map((x) => x.plain),
    limits: s.final.limits,
    provenance: `Recorded run · ${d.model} · ${recordedDay(d.recordedOn)}`,
  };
}

/** How the recorded run's answers were chosen, said under it (the recording's title says the same, scripts/record-draft.mjs). */
export const AGREE_FIRST_CURATION =
  'The AI’s questions and drafts are its own words, verbatim. The answers were chosen to match this site’s agreed definition of revenue: paid orders only, after discount.';
