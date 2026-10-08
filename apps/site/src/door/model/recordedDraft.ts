/**
 * The demo's recorded draft: one real live session of "Make the checks stricter" (start/draft.ts) on orders.csv, written by
 * `npm run record:draft` (scripts/record-draft.mjs) with the author's own Codex login, bundled here so the public demo can
 * play it back and the landing can quote it. Nothing in it is typed by hand: every model reply is kept verbatim, in order, with
 * the answers given after each round of questions.
 *
 * The answer to the question, under the approved checks, is a normal recording (public/recordings/orders-draft.json). The two
 * meet at `key`: the spec that approving this draft installs (model/specDraft.ts draftToSpec, every check kept) must hash to the
 * recorded session's key, or the demo does not offer the draft at all (`recordedDraftReplays`). A test pins it.
 */
import type { FunctionSpec } from '@scasella/undefined-engine/types';
import { hashesFor } from '@scasella/undefined-engine/shared/hash';
import raw from './recordedDraft.json';
import type { SampleId } from './samples';
import { draftToSpec, parseDraft, type DraftQuestion, type SettledPoint, type SpecDraft } from './specDraft';

export interface RecordedDraftRound {
  /** Every model reply of the round, in order (a reply that could not be used and its retry are both kept). */
  bodies: string[];
  /** What was answered after this round's questions (empty when the round drafted). */
  answers: SettledPoint[];
}

export interface RecordedDraft {
  /** `orders-draft`, also the answer recording's id. */
  id: string;
  /** How it was obtained, curation included (tries, rounds of questions, how the answers were chosen). */
  title: string;
  sampleId: SampleId;
  questionId: string;
  fn: string;
  question: string;
  model: string;
  /** YYYY-MM-DD */
  recordedOn: string;
  rounds: RecordedDraftRound[];
  /** The hashes of the approved spec: the answer recording's session key. */
  key: { specHash: string; testsHash: string };
}

function valid(v: unknown): v is RecordedDraft {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Partial<RecordedDraft>;
  return (
    typeof o.id === 'string' &&
    typeof o.fn === 'string' &&
    typeof o.questionId === 'string' &&
    Array.isArray(o.rounds) &&
    o.rounds.every((r) => Array.isArray(r?.bodies) && r.bodies.every((b) => typeof b === 'string') && Array.isArray(r.answers)) &&
    typeof o.key?.specHash === 'string' &&
    typeof o.key?.testsHash === 'string'
  );
}

/** The bundled recorded draft, or null when there is none (the file holds `{}` until one is recorded). */
export const RECORDED_DRAFT: RecordedDraft | null = valid(raw) ? raw : null;

export function recordedDraftFor(sampleId: SampleId | null, questionId: string | null): RecordedDraft | null {
  const d = RECORDED_DRAFT;
  return d && sampleId === d.sampleId && questionId === d.questionId ? d : null;
}

/** What the recording says, read back through the same parser the live draft uses. */
export interface RecordedDraftStory {
  /** The questions of each round that asked, with the answers given. */
  asked: Array<{ questions: DraftQuestion[]; answers: SettledPoint[] }>;
  /** The draft that was approved (every check kept). */
  final: SpecDraft;
  /** Everything settled, in order. */
  settled: SettledPoint[];
}

export function recordedStory(d: RecordedDraft): RecordedDraftStory | null {
  const asked: RecordedDraftStory['asked'] = [];
  let final: SpecDraft | null = null;
  for (const r of d.rounds) {
    // the round's last reply is the one that was used (an earlier one could not be, and was sent back)
    const last = r.bodies[r.bodies.length - 1];
    if (last === undefined) return null;
    const p = parseDraft(last, d.fn);
    if (!p.ok) return null;
    if (p.draft.questions.length > 0) asked.push({ questions: p.draft.questions, answers: r.answers });
    else final = p.draft;
  }
  if (!final) return null;
  return { asked, final, settled: asked.flatMap((a) => a.answers) };
}

/** The spec approving the recorded draft installs (every check kept), on the question's base spec. */
export function recordedSpec(d: RecordedDraft, base: FunctionSpec): FunctionSpec | null {
  const s = recordedStory(d);
  if (!s) return null;
  const keep = new Set([...s.final.examples, ...s.final.rules].map((x) => x.id));
  return draftToSpec(base, s.final, keep, s.settled, d.question);
}

/** Whether approving the recorded draft on `base` installs exactly the spec its answer was recorded for. */
export async function recordedDraftReplays(d: RecordedDraft, base: FunctionSpec): Promise<boolean> {
  const spec = recordedSpec(d, base);
  if (!spec) return false;
  const h = await hashesFor(spec);
  return h.specHash === d.key.specHash && h.testsHash === d.key.testsHash;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2026-10-08` → `8 Oct 2026`, from the date string itself (a recorded day, not a clock reading: no timezone moves it). */
export function recordedDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}
