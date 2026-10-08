/**
 * "Agree what the answer must pass": the AI drafts the checks for a question, asks first where the question leaves something open,
 * says in plain words what passing them would and would not show, and nothing counts until the viewer approves it. The product's
 * headline feature, on Step by step's pane 3 and the Full view (start/draft.ts runs it; model/specDraft.ts holds its words).
 *
 * Built from the system's own pieces, one per phase (DESIGN.md):
 *   idle      an invitation card, lit with the answer card's indigo-tinted lift (the one thing to do here), and the three beats
 *   drafting  a strip that quotes the check trace: night ground, pin dots, the pen-lime drafting ticks and a counter
 *   asking    the stop-and-ask card (Ask Wash, 1px amber, the diamond): 48px option rings
 *   review    the agreement as a document: the contract in clauses, what you settled, every check in plain words beside its
 *             keep box (the code behind a disclosure), what passing shows, and what it would not show on a dashed panel
 *   approved  the saved card (Passed Wash, 1px green, the disc)
 * Nothing here says "proof": the site's claim is "checked, not proven". In the demo the replies and the answers are a recorded run,
 * said in plain words where they are shown.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { AskDiamond, CheckDisc } from '../icons';
import { Button } from './LinkButton';
import type { Session } from '../start/session';
import { draftFor, type DraftState } from '../start/draft';
import { RECORDED_DRAFT, recordedDay } from '../model/recordedDraft';
import { keptCount, type DraftItem, type DraftQuestion, type SettledPoint, type SpecDraft } from '../model/specDraft';
import './AgreementDraft.css';

export const AGREEMENT_DRAFT_ID = 'agreement-draft';
const OTHER = '__other__';

/** The demo's one sentence about the recording, said where the recorded words are shown. */
export const DEMO_DRAFT_NOTE = 'In this demo the AI’s replies are a recorded run, played back; on your computer it drafts for your own question.';
export const DEMO_ANSWERS_NOTE = 'In this demo the answers are the ones given in the recording. On your computer you choose.';
export const DEMO_KEEP_NOTE = 'In this demo every drafted check is kept, as in the recording. On your computer you can drop any of them.';

/** The contract as clauses: one sentence each (a sentence ends at . ; or : before a capital), so it reads as terms, not a paragraph. */
export function clausesOf(contract: string): string[] {
  return contract
    .split(/(?<=[.;])\s+(?=[A-Z“"(])/)
    .map((c) => c.trim())
    .filter((c) => c !== '');
}

/** The seconds since the phase began, beside (never inside) a live region: a region that changed every second would be read every second. */
function Seconds() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span class="fd-ad__secs">{n} s</span>;
}

/** The trace's own tick as a dashed outline: a check that will run but has not (ZenPanes WillRun, the same drawing). */
function WillRun({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 18 18" class="fd-ad__will">
      <rect x="4.75" y="2.75" width="8.5" height="12.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.4 1.8" />
    </svg>
  );
}

/** An indigo ring with a tick: "you approve", the selected-state colour, never green (green is a verdict). */
function YouApprove({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 18 18" class="fd-ad__you">
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M5.8 9.2l2.2 2.2 4.2-4.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** The three beats, said once on the invitation (and on the landing): each with the system's own mark. */
export const BEATS: ReadonlyArray<{ id: 'ask' | 'draft' | 'approve'; title: string; body: string }> = [
  { id: 'ask', title: 'It asks first', body: 'Where your question leaves something open, the AI asks you instead of guessing.' },
  { id: 'draft', title: 'It drafts the checks', body: 'Examples worked out by hand and house rules tried on made-up tables, each said in plain words.' },
  { id: 'approve', title: 'You agree to them', body: 'You read what passing them would and would not show. Nothing counts until you approve it.' },
];

export function BeatMark({ id }: { id: 'ask' | 'draft' | 'approve' }) {
  if (id === 'ask') return <AskDiamond size={18} solid />;
  if (id === 'draft') return <WillRun />;
  return <YouApprove />;
}

function Beats() {
  return (
    <ol class="fd-ad__beats" aria-label="How it works">
      {BEATS.map((b) => (
        <li key={b.id} class={`fd-ad__beat fd-ad__beat--${b.id}`}>
          <span class="fd-ad__beat-mark">
            <BeatMark id={b.id} />
          </span>
          <span class="fd-ad__beat-t">{b.title}</span>
          <span class="fd-ad__beat-b">{b.body}</span>
        </li>
      ))}
    </ol>
  );
}

/** The AI's questions: a choice each, or the viewer's own words. In the demo the recorded answer is picked and nothing else can be. */
function Questions({
  qs,
  rounds,
  demo,
  onSend,
  onAway,
}: {
  qs: DraftQuestion[];
  rounds: number;
  demo: SettledPoint[] | null;
  onSend: (p: SettledPoint[]) => void;
  onAway: () => void;
}) {
  // the demo's recorded answer for each question: an option, or "Something else" with the recorded words
  const recorded = (q: DraftQuestion): { pick: string; own: string } | null => {
    const a = demo?.find((p) => p.ask === q.ask)?.answer ?? demo?.[qs.indexOf(q)]?.answer;
    if (a === undefined) return null;
    return q.options.includes(a) ? { pick: a, own: '' } : { pick: OTHER, own: a };
  };
  const [pick, setPick] = useState<Record<string, string>>(() => Object.fromEntries(qs.flatMap((q) => (recorded(q) ? [[q.id, recorded(q)!.pick]] : []))));
  const [own, setOwn] = useState<Record<string, string>>(() => Object.fromEntries(qs.flatMap((q) => (recorded(q) ? [[q.id, recorded(q)!.own]] : []))));
  const answerOf = (q: DraftQuestion): string => (pick[q.id] === OTHER ? (own[q.id] ?? '').trim() : (pick[q.id] ?? ''));
  const ready = qs.every((q) => answerOf(q) !== '');
  const send = (e: Event) => {
    e.preventDefault();
    if (ready) onSend(qs.map((q) => ({ ask: q.ask, answer: answerOf(q) })));
  };
  const locked = demo !== null;
  return (
    <form class="fd-ad__card fd-ad__card--ask fd-ad__enter" onSubmit={send} aria-labelledby="fd-ad-ask-h">
      <div class="fd-ad__head">
        <h2 id="fd-ad-ask-h" class="fd-ad__h fd-ad__h--ask" tabIndex={-1}>
          <AskDiamond size={20} solid />
          The AI asks before it drafts
        </h2>
        <span class="fd-ad__meta">
          Round {rounds} of at most 2
        </span>
      </div>
      <p class="fd-ad__lead">
        Your question leaves {qs.length === 1 ? 'one thing' : `${qs.length} things`} open that would change the answer. Your answers become part of the agreement.
      </p>
      {qs.map((q, i) => (
        <fieldset key={q.id} class="fd-ad__q" style={{ '--fd-ad-i': i } as Record<string, number>}>
          <legend class="fd-ad__ask">
            <span class="fd-ad__qn" aria-hidden="true">
              {i + 1}
            </span>
            {q.ask}
          </legend>
          {q.why && <p class="fd-ad__why">{q.why}</p>}
          <div class="fd-ad__opts">
            {[...q.options, OTHER].map((o) => {
              const on = pick[q.id] === o;
              const off = locked && !on;
              return (
                <label key={o} class={'fd-ad__opt' + (on ? ' is-on' : '') + (off ? ' is-disabled' : '')}>
                  <input
                    type="radio"
                    class="fd-ad__radio"
                    name={`fd-ad-${q.id}`}
                    value={o}
                    checked={on}
                    aria-disabled={off || undefined}
                    // a locked choice stays focusable (it is read), but a click must not flip the native radio: the recording's answer stays picked
                    onClick={(e) => locked && e.preventDefault()}
                    onChange={() => !locked && setPick((p) => ({ ...p, [q.id]: o }))}
                  />
                  <span class="fd-ad__opt-t">{o === OTHER ? 'Something else:' : o}</span>
                  {o === OTHER && (
                    <input
                      type="text"
                      class="fd-ad__own"
                      aria-label={`Your answer: ${q.ask}`}
                      maxLength={200}
                      readOnly={locked}
                      value={own[q.id] ?? ''}
                      onFocus={() => !locked && setPick((p) => ({ ...p, [q.id]: OTHER }))}
                      onInput={(e) => {
                        const v = e.currentTarget.value;
                        setOwn((p) => ({ ...p, [q.id]: v }));
                      }}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      {locked && <p class="fd-ad__demo">{DEMO_ANSWERS_NOTE}</p>}
      <div class="fd-ad__acts">
        <Button type="submit" variant="primary" icon="arrow" aria-disabled={ready ? undefined : 'true'}>
          Send answers
        </Button>
        <Button variant="secondary" onClick={onAway}>
          Put the draft away
        </Button>
      </div>
    </form>
  );
}

function Item({ it, n, on, locked, onToggle }: { it: DraftItem; n: number; on: boolean; locked: boolean; onToggle: () => void }) {
  return (
    <li class={'fd-ad__item' + (on ? '' : ' is-off')} style={{ '--fd-ad-i': n } as Record<string, number>}>
      <label class="fd-ad__keep">
        <input
          type="checkbox"
          class="fd-ad__box"
          checked={on}
          aria-disabled={locked || undefined}
          // locked (the demo): focusable, but a click must not untick the native box while the row still says Kept
          onClick={(e) => locked && e.preventDefault()}
          onChange={() => !locked && onToggle()}
        />
        <span class="fd-ad__plain">{it.plain}</span>
        <span class="fd-ad__state">{on ? 'Kept' : 'Dropped'}</span>
      </label>
      {it.assumption && (
        <p class="fd-ad__assume">
          <AskDiamond size={14} solid />
          <span>
            <strong>Not settled by you:</strong> {it.assumption}
          </span>
        </p>
      )}
      <details class="fd-ad__code">
        <summary>
          <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12" class="fd-ad__chev">
            <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Show the check
        </summary>
        <pre>{it.source}</pre>
      </details>
    </li>
  );
}

function Review({
  s,
  draft,
  replay,
  canChange,
  onToggle,
  onRevise,
  onApprove,
  onAway,
}: {
  s: DraftState;
  draft: SpecDraft;
  replay: boolean;
  canChange: boolean;
  onToggle: (id: string) => void;
  onRevise: (request: string) => Promise<void>;
  onApprove: () => void;
  onAway: () => void;
}) {
  const [request, setRequest] = useState('');
  const clauses = clausesOf(draft.contract);
  const can = s.keep.size > 0 && canChange;
  return (
    <section class="fd-ad__card fd-ad__card--doc fd-ad__enter" aria-labelledby="fd-ad-doc-h">
      <div class="fd-ad__head">
        <h2 id="fd-ad-doc-h" class="fd-ad__h" tabIndex={-1}>
          The AI’s draft of your agreement
        </h2>
        <span class="fd-ad__pill">Not agreed yet</span>
      </div>
      <p class="fd-ad__lead">Read it, drop any check you disagree with, and approve it. Until you do, none of it is a check.</p>

      <h3 class="fd-ad__h3">What the answer must be</h3>
      <ol class="fd-ad__clauses">
        {clauses.map((c, i) => (
          <li key={i} class="fd-ad__clause" style={{ '--fd-ad-i': i } as Record<string, number>}>
            {c}
          </li>
        ))}
      </ol>
      <p class="fd-ad__returns">
        <span>Returns</span> <code>{draft.returns}</code>
      </p>

      {s.settled.length > 0 && (
        <>
          <h3 class="fd-ad__h3">What you settled</h3>
          <ul class="fd-ad__settled">
            {s.settled.map((p) => (
              <li key={p.ask}>
                <YouApprove size={16} />
                <span>
                  {p.ask} <strong>{p.answer}</strong>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 class="fd-ad__h3">
        Examples <span class="fd-ad__h3-n">worked out by hand on made-up rows</span>
      </h3>
      <ul class="fd-ad__items">
        {draft.examples.map((it, i) => (
          <Item key={it.id} it={it} n={i} on={s.keep.has(it.id)} locked={replay} onToggle={() => onToggle(it.id)} />
        ))}
      </ul>
      {draft.rules.length > 0 && (
        <>
          <h3 class="fd-ad__h3">
            House rules <span class="fd-ad__h3-n">tried on many made-up tables</span>
          </h3>
          <ul class="fd-ad__items">
            {draft.rules.map((it, i) => (
              <Item key={it.id} it={it} n={draft.examples.length + i} on={s.keep.has(it.id)} locked={replay} onToggle={() => onToggle(it.id)} />
            ))}
          </ul>
        </>
      )}
      {replay && <p class="fd-ad__demo">{DEMO_KEEP_NOTE}</p>}

      <div class="fd-ad__means">
        <h3 class="fd-ad__h3">If an answer passes all of these</h3>
        <p>{draft.shows || 'It matches every example and keeps every house rule on the made-up tables tried.'}</p>
      </div>
      <div class="fd-ad__limits">
        <h3 class="fd-ad__h3">What that would not show</h3>
        <p>{draft.limits || 'That the answer is right for every possible table: the checks try made-up tables, not all of them.'}</p>
      </div>

      {!replay && (
        <form
          class="fd-ad__revise"
          onSubmit={(e) => {
            e.preventDefault();
            if (request.trim() === '') return;
            void onRevise(request).then(() => setRequest(''));
          }}
        >
          <label for="fd-ad-revise" class="fd-ad__label">
            Ask for a change
          </label>
          <div class="fd-ad__row">
            <input
              id="fd-ad-revise"
              class="fd-ad__field"
              type="text"
              maxLength={300}
              placeholder="e.g. Count partly refunded orders too"
              value={request}
              onInput={(e) => setRequest(e.currentTarget.value)}
            />
            <Button type="submit" variant="secondary" aria-disabled={request.trim() === '' ? 'true' : undefined}>
              Redraft
            </Button>
          </div>
        </form>
      )}

      <div class="fd-ad__acts fd-ad__acts--sign">
        <Button variant="primary" aria-disabled={can ? undefined : 'true'} onClick={() => can && onApprove()}>
          Approve {keptCount(draft, s.keep)}
        </Button>
        <Button variant="secondary" onClick={onAway}>
          Put the draft away
        </Button>
      </div>
    </section>
  );
}

/**
 * `lead`: the invitation's button is the page's primary action (Step by step); false beside another primary (the Full view's Ask).
 * `forwardId`: the page's way forward ("Run the checks" on Step by step, "Ask" on the Full view): focus goes there when the control
 * the viewer pressed goes away with the draft (approve, put away), as `try it` and the sample picker do.
 */
export function AgreementDraft({ session, forwardId, lead = true }: { session: Session; forwardId: string; lead?: boolean }) {
  const d = draftFor(session);
  const s = d.state.value;
  const replay = d.replay.value;
  const box = useRef<HTMLDivElement>(null);
  const canChange = session.canChange.value;
  const q = session.question.value;
  const agreed = session.agreement.value.n;

  // a new phase that waits on the viewer is introduced by its heading (questions, the draft); the rest keep focus where it is
  const prev = useRef(s.phase);
  useEffect(() => {
    if (prev.current !== s.phase && (s.phase === 'asking' || s.phase === 'review')) {
      box.current?.querySelector<HTMLElement>('.fd-ad__h')?.focus({ preventScroll: false });
    }
    prev.current = s.phase;
  }, [s.phase]);

  const toForward = () => document.getElementById(forwardId)?.focus();
  const putAway = () => {
    d.discard();
    requestAnimationFrame(toForward);
  };

  if (s.phase === 'idle' && !d.offered.value) return null;

  return (
    <div class="fd-ad" id={AGREEMENT_DRAFT_ID} ref={box}>
      {s.phase === 'idle' && (
        <section class="fd-ad__card fd-ad__card--invite" aria-labelledby="fd-ad-h">
          <h2 id="fd-ad-h" class="fd-ad__h">
            Have the AI draft the checks, then agree to them
          </h2>
          <p class="fd-ad__lead">
            {q?.level === 'basic' || !q
              ? 'Right now this question gets only the two checks that always run. '
              : ''}
            The AI can write the examples and house rules your answer has to pass.
          </p>
          <Beats />
          <div class="fd-ad__acts">
            {/* the page's one primary action on Step by step (Run steps back while this is offered); beside Ask on the Full view, secondary */}
            <Button variant={lead ? 'primary' : 'secondary'} aria-disabled={canChange ? undefined : 'true'} onClick={() => canChange && void d.start()}>
              Draft the checks with the AI
            </Button>
          </div>
          <p class="fd-ad__small">
            {replay ? DEMO_DRAFT_NOTE : 'It sends what asking sends: the question, the column types and, if you share them, a few sample rows.'}
          </p>
        </section>
      )}

      {s.phase === 'drafting' && (
        <section class="fd-ad__trace fd-ad__enter" aria-label="The AI is drafting">
          <div class="fd-ad__trace-head">
            <span class="fd-ad__trace-t">
              AGREEMENT DRAFT{q ? ` · ${q.text}` : ''}
            </span>
            <Seconds />
          </div>
          <div class="fd-ad__trace-body">
            <span class="fd-ad__pen" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span role="status" class="fd-ad__trace-s">
              {s.rounds > 0 ? 'Drafting with your answers' : 'Reading your question'}
              {replay ? ' · replaying the recorded draft' : ''}
            </span>
          </div>
          <p class="fd-ad__trace-note">Nothing it writes counts until you approve it.</p>
          <div class="fd-ad__trace-acts">
            <button type="button" class="fd-ad__cancel" onClick={putAway}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {s.phase === 'asking' && s.draft && <Questions key={`${s.rounds}`} qs={s.draft.questions} rounds={s.rounds} demo={s.demoAnswers} onSend={(p) => void d.answer(p)} onAway={putAway} />}

      {s.phase === 'error' && (
        <section class="fd-ad__card fd-ad__card--plain" aria-labelledby="fd-ad-err-h">
          <h2 id="fd-ad-err-h" class="fd-ad__h">
            The draft didn’t come through
          </h2>
          <p class="fd-ad__lead" role="alert">
            {s.error}
          </p>
          <div class="fd-ad__acts">
            <Button variant="secondary" onClick={() => void d.start()}>
              Try again
            </Button>
            <Button variant="secondary" onClick={putAway}>
              Put the draft away
            </Button>
          </div>
        </section>
      )}

      {s.phase === 'review' && s.draft && (
        <Review
          s={s}
          draft={s.draft}
          replay={replay}
          canChange={canChange}
          onToggle={(id) => d.toggle(id)}
          onRevise={(r) => d.revise(r)}
          onApprove={() => void d.approve().then((ok) => ok && requestAnimationFrame(toForward))}
          onAway={putAway}
        />
      )}

      {s.phase === 'approved' && s.approved && (
        <section class="fd-ad__card fd-ad__card--saved" aria-labelledby="fd-ad-ok-h">
          <h2 id="fd-ad-ok-h" class="fd-ad__h fd-ad__h--saved">
            <CheckDisc size={20} />
            {/* the program's own count, not the approval's snapshot: a check dropped later ("This check may be wrong") leaves this card true */}
            Agreed: {agreed.examples} {agreed.examples === 1 ? 'example' : 'examples'} and {agreed.rules} {agreed.rules === 1 ? 'house rule' : 'house rules'}
          </h2>
          <p class="fd-ad__lead" role="status">
            The AI drafted them and you approved them. Every version of this answer has to pass them, along with the checks that always run.
          </p>
          <p class="fd-ad__meta fd-ad__meta--saved">{replay && RECORDED_DRAFT ? `Drafted by ${RECORDED_DRAFT.model} · recorded ${recordedDay(RECORDED_DRAFT.recordedOn)}` : 'Drafted by the AI · approved by you'}</p>
        </section>
      )}
    </div>
  );
}
