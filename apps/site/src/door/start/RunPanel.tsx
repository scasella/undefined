/**
 * First run · the run: the live check trace, then (between them) any non-happy outcome, then the answer card
 * (V3-Door-FirstRun 208-324). Everything is the session's: session.trace feeds <CheckTrace/>, session.answer feeds
 * <AnswerCard variant="start"/>. Confirming an assumption is the viewer's own note on this answer (the session keeps it for
 * the life of the run, so Step by step's Back and Forward do not lose it; a new run starts with none; never sent anywhere);
 * locking is the engine's (session.toggleLock). The hand-off is the answer
 * card's one filled control (its `primaryAction` slot): the product's real outcome is the checked calculation going to the
 * data team, so it is the action the card leads with.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine, GenerationView } from '@scasella/undefined-engine/types';
import { AnswerCard } from '../components/AnswerCard';
import { CheckTrace } from '../components/CheckTrace';
import { Button } from '../components/LinkButton';
import { answerLead, versionNoteFor } from '../model/answer';
import { downloadBytes, HANDOFF_LABEL, handoffView, handoffZip, loadEject, type EjectModule } from '../model/handoff';
import { LIVE_TIMING } from '../model/traceScript';
import { giveUpOnStress, matchRun, STRESS_PATIENCE_MS, traceSummary, type TraceView } from './derive';
import { RunStates } from './RunStates';
import { sessionFor, type Session } from './session';
import './RunPanel.css';

/** 'Add a house rule' goes to the landing's "It asks instead of guessing" (router: '#/' then '#asks'). */
export const HOUSE_RULE_HREF = '#/#asks';


export interface DraftingView {
  /** The timer word while the AI is still writing. */
  runningText: string;
  footer: { text: string; meta: string };
  liveText: string;
}

/**
 * What the trace says aloud once the run is over, on a page that does NOT put the answer beside it (Step by step's
 * "Checking" pane: the answer comes only when the viewer asks). The trace's own sentence ends "… Showing the answer.", which
 * is true on `#/start` and not there, so the words are the pane's own one-line summary (traceSummary: the seal's words and the
 * real run). Anything that is not a run that passed keeps the trace's sentence as it is; so does a run still going.
 */
export function settledLiveText(t: Pick<TraceView, 'header' | 'footer' | 'liveText'>): string {
  if (!t.header.done) return t.liveText;
  return traceSummary(t) ?? t.liveText.replace(/\s*Showing the answer\.$/, '');
}

/**
 * The trace's sentence with the answer's lead said in it: "… Showing the answer." becomes "… Showing the answer: Chef Ravioli
 * Starbright, $2,252.07.", so a viewer who cannot see the page hears the verdict and the answer once, in one sentence. Only
 * a sentence that says the answer is showing gets it, and only when there is a lead to say.
 */
export function sayAnswer(sentence: string, lead: string | null): string {
  // a replacer function: the lead holds `$` ("$2,252.07"), which a replacement string would read as a pattern
  return lead ? sentence.replace(/Showing the answer\.$/, () => `Showing the answer: ${lead}.`) : sentence;
}

/**
 * The sentence the trace's live region speaks, by where the trace is. While the AI is still writing: the drafting words (the
 * checks have not started). On Step by step's "Checking" pane (`zen` and part 'run'): once the run is over, settledLiveText,
 * because the answer is not beside the trace there. EVERYWHERE ELSE the trace's own sentence goes through, the Full
 * view above all: "… Showing the answer." is true on `#/start`, where the answer card is on the same page, so it names the
 * answer's lead too (`lead`, model/answer.ts answerLead; absent when the answer has none or is not shown).
 */
export function traceLiveText(
  t: Pick<TraceView, 'header' | 'footer' | 'liveText'>,
  where: { drafting: DraftingView | null; zen: boolean; part: 'all' | 'run' | 'answer'; lead?: string | null },
): string {
  if (where.drafting) return where.drafting.liveText;
  return where.zen && where.part === 'run' ? settledLiveText(t) : sayAnswer(t.liveText, where.lead ?? null);
}

/** '4 s', '1 min 5 s': whole seconds, the way the counter under the trace reads. */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min ${total % 60} s`;
}

/**
 * While the AI is still writing a draft (the engine's generation phase 'generating': the model's writing time, replayed
 * from the recording in the demo) no check has run on that draft, so the trace must not say "checking…". Returns the
 * words for that wait, or null once the checks are running (phase 'gating') or the run is over. The phase is the
 * engine's own.
 *
 * `elapsedMs` is how long this wait has lasted on the viewer's clock (the run panel counts it from the moment the draft
 * began), shown as a counter so the wait is not a still picture. It is the time the viewer has waited, never a measured
 * model time: in the demo the draft is replayed from the recording (which the replay may compress, core/generator.ts
 * ReplayGenerator), so the words say it is a replay and that the seconds count the replay. The recorded duration itself
 * is only known after the attempt (Candidate.generationMs), so none is claimed. Without `elapsedMs` there is no counter.
 */
export function draftingView(gen: Pick<GenerationView, 'phase' | 'mode' | 'kind' | 'attempt'> | null, elapsedMs?: number): DraftingView | null {
  if (!gen || gen.phase !== 'generating' || gen.kind === 'recheck') return null;
  const draft = gen.attempt > 0 ? `draft ${gen.attempt}` : 'a draft';
  const trust = 'Nothing it writes is trusted until it passes the checks.';
  const secs = elapsedMs === undefined ? null : elapsedText(elapsedMs);
  if (gen.mode === 'replay') {
    return {
      runningText: secs === null ? 'drafting · from the recording' : `replaying the recorded draft · ${secs}`,
      footer: {
        text: `Replaying the AI's recorded ${draft}. The checks on it start next. ${trust}${secs === null ? '' : " The seconds count this replay, not the AI's own writing time."}`,
        meta: 'drafting · checks start next',
      },
      liveText: `Replaying the recorded ${draft}. Checking starts when it is done.`,
    };
  }
  return {
    runningText: secs === null ? 'drafting…' : `drafting · ${secs}`,
    footer: { text: `The AI is writing ${draft}. The checks on it start next. ${trust}`, meta: 'drafting · checks start next' },
    liveText: `The AI is writing ${draft}. Checking starts when it is done.`,
  };
}

/**
 * Milliseconds since `key` first became active (0 while inactive), re-read every second while it is. The count restarts
 * when the key changes (a new draft) and the interval is gone as soon as the draft is, so nothing ticks after checking
 * starts. Text only: no animation, so reduced motion needs nothing.
 */
function useElapsed(active: boolean, key: string): number {
  const since = useRef<{ key: string; at: number } | null>(null);
  const [, tick] = useState(0);
  if (active && since.current?.key !== key) since.current = { key, at: performance.now() };
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active, key]);
  return active && since.current ? performance.now() - since.current.at : 0;
}

export function RunPanel({
  engine,
  session,
  zen = false,
  part = 'all',
  onSettled,
}: {
  engine: Engine;
  session?: Session;
  zen?: boolean;
  /** Zen's flow shows the run (trace + outcome) and the result (answer + download) on separate panes. */
  part?: 'all' | 'run' | 'answer';
  onSettled?: () => void;
}) {
  const s = session ?? sessionFor(engine);
  const t = s.trace.value;
  const a = s.answer.value;
  const o = s.outcome.value;
  const run = s.run.value;
  const match = run ? matchRun(s.engine.state.value, run) : null;
  const draftGen = o.kind === 'running' ? (match?.generation ?? null) : null;
  const drafting = draftingView(draftGen, useElapsed(draftingView(draftGen) !== null, `${run?.id ?? 0}:${draftGen?.id ?? ''}:${draftGen?.attempt ?? 0}`));
  // only the stress test is left and the answer is held for it: stop waiting after STRESS_PATIENCE_MS, so it is never held for good
  const stressOutputId = o.kind === 'running' && o.stress ? (match?.output?.id ?? null) : null;
  useEffect(() => {
    if (stressOutputId === null) return;
    const id = setTimeout(() => giveUpOnStress(stressOutputId), STRESS_PATIENCE_MS);
    return () => clearTimeout(id);
  }, [stressOutputId]);
  // keep the button while the engine is busy (canLock goes false then): removing it would drop focus to <body>
  const lock = s.lock.value;
  const lockable = !!a.view && (a.canLock || a.locked || lock.entryId !== null || lock.pin !== null);
  // the hand-off: the answer card's one filled control. Offered under the same conditions as ever (a committed or cached answer
  // the engine can eject); the verdict line names it as the next step only when the card really has it.
  const st = s.engine.state.value;
  const eject = useEject(run !== null);
  const handoffFn = a.view && run && (o.kind === 'committed' || o.kind === 'cached') ? run.fn : null;
  const handoff = eject && handoffFn !== null && handoffView(eject, st.program, handoffFn).ok ? <Handoff engine={engine} mod={eject} fn={handoffFn!} runId={run!.id} /> : null;
  // "Version 4" on the demo's first run: the saves before it were the demo being set up (model/answer.ts versionNote names exactly those,
  // and says nothing when any of them is the viewer's own, a question they typed included). versionNoteFor is the demo-only gate:
  // a copy that runs on your computer gets no new line.
  const vnote = a.view && run ? versionNoteFor(st.mode, st.revisions, st.program.functions[run.fn]?.artifact?.revision ?? null, run.fn) : null;
  return (
    <div class="fd-run">
      {part !== 'answer' && (
        <CheckTrace
          lanes={t.lanes}
          ghost={t.ghost}
          header={t.header}
          footer={drafting ? drafting.footer : t.footer}
          liveText={traceLiveText(t, { drafting, zen, part, lead: a.held ? null : answerLead(a.view) })}
          {...(drafting ? { runningText: drafting.runningText, drafting: true } : {})}
          {...(onSettled ? { onSettled } : {})}
        />
      )}
      {part !== 'answer' && <RunStates engine={engine} session={s} headingLevel={zen ? 2 : 3} />}
      {part !== 'run' && <AnswerCard
        variant="start"
        view={a.view}
        held={a.held}
        heldCaption={a.heldCaption}
        reveal={o.kind === 'committed' && run ? { delay: LIVE_TIMING.dur, run: run.id } : null}
        level={a.level}
        seal={a.seal}
        stress={a.facts.stress}
        locked={a.locked}
        lockHelp={a.lockHelp}
        {...(a.lockNote ? { lockNote: a.lockNote } : {})}
        {...(vnote ? { versionNote: vnote } : {})}
        {...(handoff ? { primaryAction: handoff } : {})}
        mode={st.mode}
        {...(lockable ? { onToggleLock: () => void s.toggleLock() } : {})}
        // not `disabled` while busy: that would drop focus to <body> on click; session.toggleLock ignores a busy click
        lockBusy={false}
        assumptions={a.assumptions}
        confirmed={s.confirmed.value}
        onConfirm={s.confirm}
        checked={a.checked}
        checkedAsk={a.checkedAsk}
        notChecked={a.notChecked}
        {...(zen ? {} : { houseRuleHref: HOUSE_RULE_HREF })}
        // the card follows Step by step's h1 directly (h2), and the Full view's "Ask a question" h2 (h3)
        headingLevel={zen ? 2 : 3}
      />}
    </div>
  );
}

/** The engine's eject module, once it has loaded (kept for the page's life, so the next card has the hand-off at once). */
let ejectLoaded: EjectModule | null = null;

/**
 * The eject module for the hand-off, loaded as soon as a run has started (`wanted`), long before an answer is released,
 * so the card shows its one filled control with the answer instead of a moment after it.
 */
function useEject(wanted: boolean): EjectModule | null {
  const [mod, setMod] = useState<EjectModule | null>(ejectLoaded);
  useEffect(() => {
    if (!wanted || mod) return;
    let live = true;
    void loadEject().then((m) => {
      ejectLoaded = m;
      if (live) setMod(() => m);
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [wanted, mod]);
  return mod;
}

/**
 * In the answer card's action row: download the function with its checks (the engine's eject), with a spoken result. The button
 * is the card's one filled control; its progress and errors are said in a status line that wraps under the row.
 */
function Handoff({ engine, mod, fn, runId }: { engine: Engine; mod: EjectModule; fn: string; runId: number }) {
  const [msg, setMsg] = useState<{ run: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const view = handoffView(mod, engine.state.value.program, fn);
  if (!view.ok) return null;
  return (
    <>
      <Button
        variant="primary"
        class="fd-btn--wrap"
        title={view.title}
        aria-disabled={busy ? 'true' : undefined}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          handoffZip(mod, engine, engine.state.peek(), fn)
            .then(({ filename, bytes }) => {
              downloadBytes(filename, bytes);
              setMsg({ run: runId, text: `Downloaded ${filename}: ${fn}.ts, its checks, provenance.json and a README.` });
            })
            .catch((e: unknown) => setMsg({ run: runId, text: `Could not build the download: ${e instanceof Error ? e.message : String(e)}` }))
            .finally(() => setBusy(false));
        }}
      >
        {HANDOFF_LABEL}
      </Button>
      <p class="fd-run__handoff-msg" role="status">
        {msg && msg.run === runId ? msg.text : ''}
      </p>
    </>
  );
}
