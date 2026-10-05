/**
 * First run · the run: the live check trace, then (between them) any non-happy outcome, then the answer card
 * (V3-Door-FirstRun 208-324). Everything is the session's: session.trace feeds <CheckTrace/>, session.answer feeds
 * <AnswerCard variant="start"/>. Confirming an assumption is the viewer's own note on this answer (local state, reset
 * when a new run starts); locking is the engine's (session.toggleLock).
 */
import { useEffect, useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { AnswerCard } from '../components/AnswerCard';
import { CheckTrace } from '../components/CheckTrace';
import { Button } from '../components/LinkButton';
import { downloadBytes, HANDOFF_LABEL, handoffView, handoffZip, loadEject, type EjectModule } from '../model/handoff';
import { LIVE_TIMING } from '../model/traceScript';
import { RunStates } from './RunStates';
import { sessionFor, type Session } from './session';
import './RunPanel.css';

/** 'Add a house rule' goes to the landing's "It asks instead of guessing" (router: '#/' then '#asks'). */
export const HOUSE_RULE_HREF = '#/#asks';

/** The key confirmations are kept under: a new run (or another question) starts with none confirmed. */
export function confirmKey(run: { id: number; questionId: string } | null): string {
  return run ? `${run.id}:${run.questionId}` : '';
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
        <CheckTrace lanes={t.lanes} ghost={t.ghost} header={t.header} footer={t.footer} liveText={t.liveText} {...(onSettled ? { onSettled } : {})} />
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
