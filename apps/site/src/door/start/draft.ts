/**
 * Pane 3's "Draft the contract" (docs/FRONT-DOOR.md): the state of one draft for the selected question, from the first request to
 * the viewer's approval. The words and the checks come from model/specDraft.ts; this file only runs the rounds.
 *
 *   idle ─start→ drafting ─┬→ asking ─send answers→ drafting …   (at most MAX_QUESTION_ROUNDS rounds of questions)
 *                          ├→ review ─revise→ drafting / ─approve→ approved (the spec is installed: session.applySpec)
 *                          └→ error ─start→ drafting
 *   any state ─discard→ idle (nothing is installed)
 *
 * While a draft is waiting on the viewer (drafting, asking, review) the checks cannot run (`pending`): the viewer asked for a
 * stricter contract, so the run waits until they approve it or put it away. A draft belongs to one question; selecting another
 * puts it away.
 *
 * Live mode asks the model. The demo (replay) has no model: it offers a draft only where one was recorded (model/recordedDraft.ts)
 * and only when approving it installs exactly the spec its answer was recorded for, then plays the recorded replies back in order.
 * In the demo the answers to the AI's questions are the recorded ones (`demoAnswers`), and nothing that changes the spec can be
 * changed (no unticking, no redraft): anything else would end in "no recorded answer" one pane later.
 */
import { batch, computed, signal, type ReadonlySignal } from '@preact/signals';
import type { GenerateRequest, GenerateResult, ProgressLine } from '@scasella/undefined-engine/types';
import { sampleForModel } from '../../data/sample';
import { LiveGenerator } from '../../core/generator';
import { customSpec } from '../model/questions';
import {
  buildDraftPrompt,
  draftToSpec,
  MAX_QUESTION_ROUNDS,
  parseDraft,
  syntaxProblem,
  type SettledPoint,
  type SpecDraft,
  type Transpiler,
} from '../model/specDraft';
import { recordedDraftFor, type RecordedDraft } from '../model/recordedDraft';
import { specHasAgreement } from './recorded';
import type { Session } from './session';

export type DraftPhase = 'idle' | 'drafting' | 'asking' | 'review' | 'error' | 'approved';

export interface DraftState {
  phase: DraftPhase;
  /** The question the draft is for (questionId); a draft for another question is put away. */
  forQuestion: string | null;
  draft: SpecDraft | null;
  /** Checks the viewer keeps (all of them, until they untick one). */
  keep: ReadonlySet<string>;
  /** Points settled in earlier rounds (written into the contract). */
  settled: SettledPoint[];
  /** Rounds of questions asked so far. */
  rounds: number;
  error: string | null;
  /** After approval: what was kept, for the line that says so. */
  approved: { examples: number; rules: number } | null;
  /** Demo only, while asking: the answers that were given in the recording (the only ones the demo can play on). */
  demoAnswers: SettledPoint[] | null;
}

export interface DraftDeps {
  /** The model: the local generation service (the same one that writes answers). */
  generate(req: GenerateRequest, onProgress: (p: ProgressLine) => void, signal?: AbortSignal): Promise<GenerateResult>;
  /** TypeScript, for the syntax check (the site loads it for the gates anyway). */
  loadTs(): Promise<Transpiler>;
}

export interface Draft {
  readonly state: ReadonlySignal<DraftState>;
  /** Can a draft be started for the selected question? Live mode, data bound, no seeded agreement, and no checks of its own yet. */
  readonly offered: ReadonlySignal<boolean>;
  /** A draft is waiting on the AI or the viewer: the checks wait too. */
  readonly pending: ReadonlySignal<boolean>;
  /** The demo is playing a recorded draft (the replies and the answers are the recording's). */
  readonly replay: ReadonlySignal<boolean>;
  start(): Promise<void>;
  answer(points: SettledPoint[]): Promise<void>;
  revise(request: string): Promise<void>;
  toggle(id: string): void;
  approve(): Promise<boolean>;
  discard(): void;
}

const IDLE: DraftState = { phase: 'idle', forQuestion: null, draft: null, keep: new Set(), settled: [], rounds: 0, error: null, approved: null, demoAnswers: null };

/** How long the demo shows "drafting" for a recorded reply: the recording keeps the words, not the wait, so this is a pause, said as a replay. */
export const REPLAY_PAUSE_MS = 1100;

/** TypeScript, loaded lazily (gates/compile.ts does the same): CommonJS, so the namespace may live on `default`. */
export async function loadTypeScript(): Promise<Transpiler> {
  const m = (await import('typescript')) as unknown as Transpiler & { default?: Transpiler };
  return typeof m.transpileModule === 'function' ? m : (m.default as Transpiler);
}

const defaultDeps = (): DraftDeps => {
  const live = new LiveGenerator();
  return { generate: (r, p, s) => live.generate(r, p, s), loadTs: loadTypeScript };
};

export function createDraft(session: Session, deps: DraftDeps = defaultDeps(), pauseMs = REPLAY_PAUSE_MS): Draft {
  const state = signal<DraftState>(IDLE);
  let ctl: AbortController | null = null;
  let seq = 0;
  // demo: the recorded replies still to play, and which recorded round is playing
  let queue: string[] = [];
  let cursor = 0;

  // demo: the recorded draft for the bound sample and the selected question, offered only where the session says approving it leads to
  // a recorded answer (recorded.ts 'drafted': the draft reads back to the spec, and the answer for that spec is bundled)
  const demo = computed<RecordedDraft | null>(() => {
    const q = session.question.value;
    if (session.engine.state.value.mode !== 'replay' || !q) return null;
    const rd = recordedDraftFor(session.sampleId.value, q.id);
    return rd && session.availability.value[q.id] === 'drafted' ? rd : null;
  });
  const replay = computed(() => session.engine.state.value.mode === 'replay');

  const qid = session.questionId;
  // a draft is for one question: another question (or none) puts it away, and an answer in flight is dropped
  const mine = computed(() => (state.value.forQuestion === qid.value ? state.value : IDLE));

  const offered = computed(() => {
    const q = session.question.value;
    const d = session.dataset.value;
    if (!q || !d || session.seed.value) return false;
    if (session.engine.state.value.mode !== 'live' && !demo.value) return false;
    const rec = session.engine.state.value.program.functions[q.fn];
    return !specHasAgreement(rec?.spec);
  });
  const pending = computed(() => {
    const p = mine.value.phase;
    return p === 'drafting' || p === 'asking' || p === 'review';
  });

  function set(patch: Partial<DraftState>): void {
    state.value = { ...state.peek(), ...patch };
  }

  // demo: the next recorded reply, after a short pause (the recording keeps the words, not the wait)
  const replayGenerate: DraftDeps['generate'] = async (req, _p, signal) => {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(res, pauseMs);
      signal?.addEventListener('abort', () => (clearTimeout(t), rej(new Error('Cancelled'))), { once: true });
    });
    const body = queue.shift();
    if (body === undefined) throw new Error('The recorded draft has no more replies to play.');
    return { body, notes: '', model: demo.peek()?.model ?? 'recorded', codexVersion: 'recorded', durationMs: pauseMs, source: 'replay', progress: [] };
  };

  async function round(settled: SettledPoint[], extra: { revise?: { draft: SpecDraft; request: string }; rounds: number }): Promise<void> {
    const q = session.question.peek();
    const d = session.dataset.peek();
    const rows = session.rows.peek();
    if (!q || !d) return;
    ctl?.abort();
    const my = ++seq;
    const c = new AbortController();
    ctl = c;
    const rd = replay.peek() ? demo.peek() : null;
    if (replay.peek() && !rd) return;
    const roundNo = cursor++;
    const generate = rd ? replayGenerate : deps.generate;
    // a round starts clean: nothing of an earlier draft (its checks, what was kept, an approval) carries into this one
    state.value = { ...IDLE, phase: 'drafting', forQuestion: q.id, settled, rounds: extra.rounds };
    const send = session.engine.state.peek().send;
    const base = {
      question: q.text,
      fn: q.fn,
      param: d.name,
      typeName: d.typeName,
      typeDecl: d.typeDecl,
      rowCount: d.rowCount,
      ...(send.samples && rows ? { sampleText: sampleForModel(rows, { count: send.sampleRows }).text } : {}),
      settled,
      ...(extra.revise ? { revise: extra.revise } : {}),
      noMoreQuestions: extra.rounds >= MAX_QUESTION_ROUNDS,
    };
    // one retry when the draft cannot be used (a check that does not parse): the reason goes back to the model
    let fix: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let body: string;
      try {
        const r = await generate({ fn: q.fn, specHash: '', testsHash: '', attempt, prompt: buildDraftPrompt({ ...base, ...(fix ? { fix } : {}) }) }, () => undefined, c.signal);
        body = r.body;
      } catch (e) {
        if (my !== seq) return;
        set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (my !== seq) return;
      const parsed = parseDraft(body, q.fn);
      let problem: string | null;
      if (!parsed.ok) problem = parsed.error;
      // the rounds of questions are capped: questions after the last round are a draft that cannot be used, and go back once
      else if (parsed.draft.questions.length > 0) problem = base.noMoreQuestions ? 'you were told not to ask more questions; draft now and mark each choice you made with silentOn and reasonable' : null;
      else {
        try {
          problem = syntaxProblem(parsed.draft, await deps.loadTs());
        } catch (e) {
          if (my !== seq) return;
          set({ phase: 'error', error: `The checks could not be read here (${e instanceof Error ? e.message : String(e)}).` });
          return;
        }
      }
      if (my !== seq) return;
      if (parsed.ok && problem === null) {
        const draft = parsed.draft;
        if (draft.questions.length > 0) {
          set({ phase: 'asking', draft, rounds: extra.rounds + 1, demoAnswers: rd ? (rd.rounds[roundNo]?.answers ?? []) : null });
        } else {
          set({ phase: 'review', draft, keep: new Set([...draft.examples, ...draft.rules].map((x) => x.id)) });
        }
        return;
      }
      fix = problem ?? 'unknown problem';
    }
    set({ phase: 'error', error: `The AI's draft could not be used (${fix}).` });
  }

  return {
    state: mine,
    offered,
    pending,
    replay,
    start: () => {
      const rd = demo.peek();
      queue = rd ? rd.rounds.flatMap((r) => r.bodies) : [];
      cursor = 0;
      return round([], { rounds: 0 });
    },
    // the demo plays on the recorded answers only (the panel shows them picked and nothing else can be)
    answer: (points) => round([...mine.peek().settled, ...(mine.peek().demoAnswers ?? points)], { rounds: mine.peek().rounds }),
    revise: (request) => {
      const s = mine.peek();
      if (!s.draft || request.trim() === '' || replay.peek()) return Promise.resolve();
      return round(s.settled, { revise: { draft: s.draft, request: request.trim() }, rounds: s.rounds });
    },
    toggle(id) {
      const s = mine.peek();
      if (s.phase !== 'review' || replay.peek()) return;
      const keep = new Set(s.keep);
      if (keep.has(id)) keep.delete(id);
      else keep.add(id);
      set({ keep });
    },
    async approve() {
      const s = mine.peek();
      const q = session.question.peek();
      const d = session.dataset.peek();
      if (s.phase !== 'review' || !s.draft || !q || !d) return false;
      const examples = s.draft.examples.filter((x) => s.keep.has(x.id)).length;
      const rules = s.draft.rules.filter((x) => s.keep.has(x.id)).length;
      if (examples + rules === 0) return false;
      const ok = await session.applySpec(draftToSpec(customSpec(q, d), s.draft, s.keep, s.settled, q.text));
      if (ok) set({ phase: 'approved', approved: { examples, rules } });
      return ok;
    },
    discard() {
      ctl?.abort();
      seq++;
      batch(() => {
        state.value = IDLE;
      });
    },
  };
}

const drafts = new WeakMap<Session, Draft>();
/** One draft per session (the page's panes come and go; the draft stays while the question does). */
export function draftFor(session: Session): Draft {
  let d = drafts.get(session);
  if (!d) {
    d = createDraft(session);
    drafts.set(session, d);
  }
  return d;
}
