/**
 * First run · the run: the live check trace, then (between them) any non-happy outcome, then the answer card
 * (V3-Door-FirstRun 208-324). Everything is the session's: session.trace feeds <CheckTrace/>, session.answer feeds
 * <AnswerCard variant="start"/>. Confirming an assumption is the viewer's own note on this answer (local state, reset
 * when a new run starts); locking is the engine's (session.toggleLock).
 */
import { useEffect, useState } from 'preact/hooks';
import type { Engine, GenerationView } from '@scasella/undefined-engine/types';
import { AnswerCard } from '../components/AnswerCard';
import { CheckTrace } from '../components/CheckTrace';
import { Button } from '../components/LinkButton';
import { downloadBytes, HANDOFF_LABEL, handoffView, handoffZip, loadEject, type EjectModule } from '../model/handoff';
import { LIVE_TIMING } from '../model/traceScript';
import { matchRun } from './derive';
import { RunStates } from './RunStates';
import { sessionFor, type Session } from './session';
import './RunPanel.css';

/** 'Add a house rule' goes to the landing's "It asks instead of guessing" (router: '#/' then '#asks'). */
export const HOUSE_RULE_HREF = '#/#asks';

/** The key confirmations are kept under: a new run (or another question) starts with none confirmed. */
export function confirmKey(run: { id: number; questionId: string } | null): string {
  return run ? `${run.id}:${run.questionId}` : '';
}

export interface DraftingView {
  /** The timer word while the AI is still writing. */
  runningText: string;
  footer: { text: string; meta: string };
  liveText: string;
}

/**
 * While the AI is still writing a draft (the engine's generation phase 'generating': the model's writing time, replayed
 * from the recording in the demo) no check has run on that draft, so the trace must not say "checking…". Returns the
 * words for that wait, or null once the checks are running (phase 'gating') or the run is over. The phase is the
 * engine's own. No duration and no "recorded pace" is claimed: the replay compresses a recording longer than its cap
 * (core/generator.ts ReplayGenerator), the view cannot say whether that happened, and the recorded duration is only
 * known after the attempt (Candidate.generationMs).
 */
export function draftingView(gen: Pick<GenerationView, 'phase' | 'mode' | 'kind' | 'attempt'> | null): DraftingView | null {
  if (!gen || gen.phase !== 'generating' || gen.kind === 'recheck') return null;
  const draft = gen.attempt > 0 ? `draft ${gen.attempt}` : 'a draft';
  const trust = 'Nothing it writes is trusted until it passes the checks.';
  if (gen.mode === 'replay') {
    return {
      runningText: 'drafting · from the recording',
      footer: { text: `Replaying the AI's recorded ${draft}. The checks on it start next. ${trust}`, meta: 'drafting · checks start next' },
      liveText: `Replaying the recorded ${draft}. Checking starts when it is done.`,
    };
  }
  return {
    runningText: 'drafting…',
    footer: { text: `The AI is writing ${draft}. The checks on it start next. ${trust}`, meta: 'drafting · checks start next' },
    liveText: `The AI is writing ${draft}. Checking starts when it is done.`,
  };
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
  const key = confirmKey(run);
  const drafting = o.kind === 'running' ? draftingView(matchRun(s.engine.state.value, run).generation) : null;
  const [confirmed, setConfirmed] = useState<{ key: string; ids: ReadonlySet<string> }>({ key, ids: new Set() });
  const ids = confirmed.key === key ? confirmed.ids : new Set<string>();
  useEffect(() => {
    if (confirmed.key !== key) setConfirmed({ key, ids: new Set() });
  }, [key]);

  // keep the button while the engine is busy (canLock goes false then): removing it would drop focus to <body>
  const lock = s.lock.value;
  const lockable = !!a.view && (a.canLock || a.locked || lock.entryId !== null || lock.pin !== null);
  return (
    <div class="fd-run">
      {part !== 'answer' && (
        <CheckTrace
          lanes={t.lanes}
          ghost={t.ghost}
          header={t.header}
          footer={drafting ? drafting.footer : t.footer}
          liveText={drafting ? drafting.liveText : t.liveText}
          {...(drafting ? { runningText: drafting.runningText } : {})}
          {...(onSettled ? { onSettled } : {})}
        />
      )}
      {part !== 'answer' && <RunStates engine={engine} session={s} />}
      {part !== 'run' && <AnswerCard
        variant="start"
        view={a.view}
        held={a.held}
        heldCaption={a.heldCaption}
        reveal={o.kind === 'committed' && run ? { delay: LIVE_TIMING.dur, run: run.id } : null}
        level={a.level}
        locked={a.locked}
        lockHelp={a.lockHelp}
        mode={s.engine.state.value.mode}
        {...(lockable ? { onToggleLock: () => void s.toggleLock() } : {})}
        // not `disabled` while busy: that would drop focus to <body> on click; session.toggleLock ignores a busy click
        lockBusy={false}
        assumptions={a.assumptions}
        confirmed={ids}
        onConfirm={(id) => setConfirmed({ key, ids: new Set([...ids, id]) })}
        checked={a.checked}
        notChecked={a.notChecked}
        {...(zen ? {} : { houseRuleHref: HOUSE_RULE_HREF })}
      />}
      {part !== 'run' && a.view && run && (o.kind === 'committed' || o.kind === 'cached') && <Handoff engine={engine} fn={run.fn} runId={run.id} />}
    </div>
  );
}

/** Under a committed answer: download the function with its checks (the engine's eject), with a spoken result. */
function Handoff({ engine, fn, runId }: { engine: Engine; fn: string; runId: number }) {
  const st = engine.state.value;
  const [mod, setMod] = useState<EjectModule | null>(null);
  const [msg, setMsg] = useState<{ run: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void loadEject().then((m) => live && setMod(() => m), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!mod) return null;
  const view = handoffView(mod, st.program, fn);
  if (!view.ok) return null;
  return (
    <div class="fd-run__handoff">
      <Button
        variant="secondary"
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
    </div>
  );
}
