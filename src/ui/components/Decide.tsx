/**
 * Decide (docs/DECIDE-DESIGN.md §6): where a check said the spec was silent, the user rules on the case. The block
 * sits collapsed at the foot of the rejection card (the card stays the hero). Everything it offers comes from the
 * engine's GapQuestion: a fixed table, the check's own answer, the draft's observed answer and what the check
 * declared; the model never proposes an alternative.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DecideChoice, Engine, EngineState, ExpectationPreview, GapQuestion, GapRef, GenerationView } from '../../types';
import { decisionNote, decisionsOf, decisionSummary, waiverText } from '../../decide/decisions';
import { shortHash } from '../format';
import { functionStatus } from '../select';
import { decideAnnouncement, decideOpen, decidePrefill, lowerTab, runLiveOpen } from '../uiState';
import {
  altParts,
  consequenceLines,
  decisionOutcome,
  decisionTestName,
  questionLine,
  REPLAY_NEEDS_LIVE,
  removalMessage,
  rulingAgrees,
  rulingFor,
  sourceTag,
  testPreview,
  type DecideSelection,
} from '../decide';

let uid = 0;

/**
 * Move focus once the next render has landed. The control that was pressed is often gone by then (the Decide button
 * disables while it works, a banner's Remove unmounts, Repo's Remove becomes a confirmation), and focus left on a
 * removed or disabled element falls back to <body>. A non-interactive target is made programmatically focusable.
 */
export function focusLater(pick: () => HTMLElement | null | undefined, delay = 60): void {
  setTimeout(() => {
    const el = pick();
    if (!el || !el.isConnected) return;
    if (!el.matches('button, summary, input, a[href], select, textarea, [tabindex]')) el.tabIndex = -1;
    el.focus();
  }, delay);
}

/** After a decision is removed (Repo or the banner): say what became of the function and keep focus on the page. */
export function afterRemoval(engine: Engine, fn: string, summary: string, focusTarget?: () => HTMLElement | null | undefined): void {
  setTimeout(() => {
    decideAnnouncement.value = removalMessage(engine.state.value.program, fn, summary);
  }, 30);
  if (focusTarget) focusLater(focusTarget);
}

/** Debounced "type your own" evaluation in the gate worker; stale answers are dropped. */
function useExpectationPreview(engine: Engine, fn: string, expr: string, active: boolean): { preview: ExpectationPreview | null; pending: boolean } {
  const [preview, setPreview] = useState<ExpectationPreview | null>(null);
  const [pending, setPending] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    if (!active || expr.trim() === '') {
      setPreview(null);
      setPending(false);
      return;
    }
    setPending(true);
    const t = setTimeout(() => {
      void engine.previewExpectation(fn, expr).then((p) => {
        if (seq.current !== my) return;
        setPreview(p);
        setPending(false);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [engine, fn, expr, active]);
  return { preview, pending };
}

function choiceOf(sel: DecideSelection): DecideChoice {
  if (sel.kind === 'alternative') return { alternative: sel.id };
  return sel.throws ? { throws: true } : { expr: sel.expr.trim() };
}

export function DecideBlock({
  engine,
  state,
  gapRef,
  q,
  attempt,
  openKey,
  inCard = false,
}: {
  engine: Engine;
  state: EngineState;
  gapRef: GapRef;
  q: GapQuestion;
  /** The draft whose rejection this answers (for "what draft #1 did"). */
  attempt: number;
  /** `<genId>:<attempt>`: the "Decide" button under an accepted verdict opens the block with this key. */
  openKey: string;
  /** Inside the rejection card, whose lines above already ask the question. */
  inCard?: boolean;
}) {
  const [id] = useState(() => `decide-${++uid}`);
  const prefill = decideOpen.value === openKey ? decidePrefill.value : null;
  const [sel, setSel] = useState<DecideSelection | null>(() =>
    prefill?.choice === 'custom'
      ? { kind: 'custom', expr: prefill.expr ?? '', throws: !!prefill.throws }
      : prefill?.choice
        ? { kind: 'alternative', id: prefill.choice }
        : null,
  );
  const [scope, setScope] = useState<'call' | 'rule'>('call');
  const [reason, setReason] = useState(prefill?.reason ?? '');
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<{ testsHash: string; head: number } | null>(null);
  const ref = useRef<HTMLDetailsElement>(null);

  // "Decide" under an accepted verdict (or a fixture): open, bring into view, focus the summary; then consume it
  useEffect(() => {
    if (decideOpen.value !== openKey || !ref.current) return;
    ref.current.open = true;
    const el = ref.current;
    setTimeout(() => {
      el.scrollIntoView({ block: 'nearest' });
      el.querySelector('summary')?.focus({ preventScroll: true });
    }, 16);
    decideOpen.value = null;
    decidePrefill.value = null;
  }, [decideOpen.value, openKey]);

  const rec = state.program.functions[q.fn];
  const custom = sel?.kind === 'custom' ? sel : null;
  const { preview, pending } = useExpectationPreview(engine, q.fn, custom?.expr ?? '', !!custom && !custom.throws);
  const existing = q.existing && rec ? decisionsOf(rec.spec).find((d) => d.id === q.existing) : undefined;
  const outcome = done ? decisionOutcome(state.program, state.generation, q.fn, existing) : null;

  // the outcome, said once through the panel's announcer
  useEffect(() => {
    if (!done || !existing) return;
    if (outcome === 'recertified') decideAnnouncement.value = `Decided: ${decisionSummary(existing)}. The committed ${q.fn} already does this: re-certified, nothing written again.`;
  }, [done, outcome, existing?.id]);

  if (!rec) return null;

  const ruling = rulingFor(q, sel, custom && !custom.throws ? preview : null);
  const agrees = rulingAgrees(q, ruling);
  const ruleScope = q.ruleScope && ruling && ruling.kind !== 'relational' ? scope : 'call';
  const test = ruling ? testPreview(rec.spec, q, ruling, ruleScope) : null;
  const committed = rec.artifact !== null && rec.artifact.specHash === rec.specHash;
  const { lines, needsLive } = consequenceLines(q, agrees, { committed, replay: state.mode === 'replay' });
  const busy = state.busy || working;
  const customInvalid = !!custom && !custom.throws && custom.expr.trim() !== '' && !pending && preview !== null && !preview.ok;
  // a check silent on every input can only be ruled on with its own answer (gapQuestion.onlyAgreeing)
  const blocked = !!q.onlyAgreeing && !!ruling && !agrees;

  const submit = async (ev: Event) => {
    ev.preventDefault();
    if (!sel || !ruling || busy || blocked) return;
    const before = { testsHash: rec.testsHash, head: state.headRevision };
    setWorking(true);
    setDone(null);
    decideAnnouncement.value = `Re-checking ${q.fn} against your decision…`;
    try {
      await engine.decide(gapRef, choiceOf(sel), { scope: ruleScope, ...(reason.trim() ? { reason: reason.trim() } : {}) });
    } finally {
      setWorking(false);
      setDone(before);
      // the Decide button was disabled while it worked, which drops focus to <body>: land on what happened instead
      // (the outcome here; or, when the panel moved on to writing it again / needs live mode, that banner)
      const block = ref.current;
      focusLater(() =>
        block?.isConnected
          ? (block.querySelector<HTMLElement>('.decide-outcome') ?? document.querySelector<HTMLElement>('.decide-banner') ?? block.querySelector<HTMLElement>('summary'))
          : document.querySelector<HTMLElement>('.decide-banner'),
      );
    }
  };

  return (
    <details class="decide" ref={ref} data-decide={outcome ?? (working ? 'working' : existing ? 'decided' : 'open')}>
      <summary class="decide-summary">
        {existing ? (
          <>
            <span class="decide-mark" aria-hidden="true">
              ✓
            </span>
            You decided: <code>{decisionSummary(existing)}</code>
          </>
        ) : (
          <>
            Decide what the spec should say about <code>{q.call}</code>
          </>
        )}
      </summary>
      <form class="decide-body" onSubmit={(ev) => void submit(ev)} aria-describedby={`${id}-q`}>
        <p class={inCard ? 'sr-only' : 'decide-q'} id={`${id}-q`}>
          {questionLine(q)}
        </p>
        <dl class="facts decide-facts">
          <dt>{q.check.kind === 'property' ? 'smallest failing call' : 'call'}</dt>
          <dd>
            <code>{q.call}</code>
          </dd>
          <dt>draft #{attempt}</dt>
          <dd>
            <code>{q.actualShown}</code>
          </dd>
          <dt>your tests expect</dt>
          <dd>
            <code>{q.expectedShown}</code>
          </dd>
        </dl>
        {existing && (
          <p class="decide-existing">
            You ruled <code>{decisionSummary(existing)}</code>, {decisionNote(existing)}. Deciding again replaces it.
          </p>
        )}

        <fieldset class="decide-choices">
          <legend>
            What should <code>{q.call}</code> do?
          </legend>
          {q.alternatives.map((alt) => {
            const p = altParts(alt);
            const checked = sel?.kind === 'alternative' && sel.id === alt.id;
            return (
              <label key={alt.id} class={`decide-alt${alt.disabled ? ' is-disabled' : ''}${checked ? ' is-checked' : ''}`}>
                <input
                  type="radio"
                  name={id}
                  value={alt.id}
                  checked={checked}
                  disabled={!!alt.disabled || busy}
                  aria-describedby={alt.disabled ? `${id}-${alt.id}-why` : undefined}
                  onChange={() => setSel({ kind: 'alternative', id: alt.id })}
                />
                <span class="alt-text">
                  <span class="alt-ruling">
                    {p.verb}
                    {p.value !== null && (
                      <>
                        {' '}
                        <code>{p.value}</code>
                      </>
                    )}
                  </span>
                  <span class="alt-tag">{sourceTag(alt, attempt)}</span>
                  {alt.disabled && (
                    <span class="alt-why" id={`${id}-${alt.id}-why`}>
                      {alt.disabled.replace(/`/g, '')}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          <label class={`decide-alt${custom ? ' is-checked' : ''}`}>
            <input
              type="radio"
              name={id}
              value="custom"
              checked={!!custom}
              disabled={busy}
              onChange={() => setSel({ kind: 'custom', expr: custom?.expr ?? '', throws: custom?.throws ?? false })}
            />
            <span class="alt-text">
              <span class="alt-ruling">Type your own expectation</span>
              <span class="alt-tag">any value, or another call</span>
            </span>
          </label>
          {custom && (
            <div class="decide-custom">
              <label for={`${id}-expr`} class="decide-label">
                <code>{q.call}</code> should return
              </label>
              <input
                id={`${id}-expr`}
                class="mono"
                value={custom.expr}
                disabled={custom.throws || busy}
                spellcheck={false}
                autocomplete="off"
                placeholder={'e.g. -1, "", null'}
                aria-invalid={customInvalid}
                aria-describedby={`${id}-eval`}
                onInput={(e) => setSel({ ...custom, expr: e.currentTarget.value })}
              />
              <label class="decide-throws">
                <input type="checkbox" checked={custom.throws} disabled={busy} onChange={(e) => setSel({ ...custom, throws: e.currentTarget.checked })} />
                It should throw an error instead
              </label>
              <p class={`decide-eval${customInvalid ? ' form-error' : ''}`} id={`${id}-eval`}>
                {custom.throws
                  ? `${q.call} must throw.`
                  : custom.expr.trim() === ''
                    ? 'A TypeScript expression. It runs as test code in your browser, like the tests in your spec.'
                    : pending || !preview
                      ? 'Checking…'
                      : preview.ok
                        ? (
                            <>
                              Evaluates to <code>{preview.shown}</code>
                              {preview.mentionsFn ? `, computed with ${q.fn} itself each time it is checked.` : '.'}
                            </>
                          )
                        : `Cannot use this: ${preview.error}`}
              </p>
            </div>
          )}
        </fieldset>

        {q.ruleScope && ruling && ruling.kind !== 'relational' && (
          <fieldset class="decide-choices decide-scope">
            <legend>How far does it go?</legend>
            <label class={`decide-alt${scope === 'call' ? ' is-checked' : ''}`}>
              <input type="radio" name={`${id}-scope`} checked={scope === 'call'} disabled={busy} onChange={() => setScope('call')} />
              <span class="alt-text">
                <span class="alt-ruling">Only this call</span>
              </span>
            </label>
            <label class={`decide-alt${scope === 'rule' ? ' is-checked' : ''}`}>
              <input type="radio" name={`${id}-scope`} checked={scope === 'rule'} disabled={busy} onChange={() => setScope('rule')} />
              <span class="alt-text">
                <span class="alt-ruling">{q.ruleScope.label.replace(/^for /, 'For ')}</span>
                <span class="alt-tag">a rule tried on many random inputs</span>
              </span>
            </label>
          </fieldset>
        )}

        {test && (
          <div class="decide-preview">
            <p class="decide-adds">{test.plain}</p>
            {lines.map((l) => (
              <p key={l} class="decide-then">
                {l}
              </p>
            ))}
            {needsLive && (
              <p class="decide-live">
                {REPLAY_NEEDS_LIVE}{' '}
                <button type="button" class="btn btn-ghost btn-xs" onClick={() => (runLiveOpen.value = true)}>
                  How to run live
                </button>
              </p>
            )}
            <details class="decide-source">
              <summary>{test.rule ? 'The rule it adds' : 'The test it adds'}</summary>
              <pre class="code small">
                <code>{test.source}</code>
              </pre>
            </details>
          </div>
        )}

        <label class="decide-reason">
          <span class="decide-label">
            Why <span class="muted">(optional)</span>
          </span>
          <input value={reason} maxLength={200} disabled={busy} placeholder="e.g. NaN propagates through our averages" onInput={(e) => setReason(e.currentTarget.value)} />
          <span class="muted small">Kept with the decision as "decided by you on (date): (why)". Never sent to the model.</span>
        </label>

        <div class="form-actions decide-actions">
          <button type="submit" class="btn btn-primary decide-confirm" disabled={!ruling || busy || blocked}>
            {working ? 'Deciding…' : 'Decide'}
          </button>
          {working ? (
            <span class="muted small">Re-checking the committed {q.fn} against your decision…</span>
          ) : state.busy ? (
            <span class="muted small">Available when the current work finishes.</span>
          ) : !ruling ? (
            <span class="muted small">Pick one of the answers above.</span>
          ) : blocked ? (
            <span class="muted small">{q.onlyAgreeing!.replace(/`/g, '')}</span>
          ) : null}
        </div>

        {outcome === 'recertified' && existing && done && (
          <div class="decide-outcome">
            <p class="decide-outcome-head">
              <span aria-hidden="true">✓ </span>Re-certified at r{state.headRevision}
            </p>
            <p>
              The committed {q.fn} (r{rec.artifact?.revision}) already does this, so nothing was written again.
            </p>
            <p class="muted small">
              What changed: the spec gained the test <code>{decisionTestName(existing)}</code>
              {waiverText(existing) ? `, which ${waiverText(existing)}` : ''}; its tests hash went from {shortHash(done.testsHash)} to {shortHash(rec.testsHash)}.{' '}
              <button type="button" class="btn btn-ghost btn-xs" onClick={() => (lowerTab.value = 'repo')}>
                See it in Repo
              </button>
            </p>
          </div>
        )}
        {done && !working && !existing && functionStatus(rec).kind !== 'stale' && <p class="muted small">Nothing was decided. The message above says why.</p>}
      </form>
    </details>
  );
}

/**
 * Over the gate panel while the model writes a function again because the committed one failed the user's decision,
 * and after: written, or (replay) needs live mode, with the ways forward.
 */
export function RegrowNote({ gen, state, engine }: { gen: GenerationView; state: EngineState; engine: Engine }) {
  const d = gen.decision;
  if (!d) return null;
  const rec = state.program.functions[gen.fn];
  const decision = rec ? decisionsOf(rec.spec).find((x) => x.id === d.id) : undefined;
  const label = decision ? decisionSummary(decision) : d.call;
  if (!decision) {
    const live = rec && functionStatus(rec).kind === 'certified';
    return (
      <p class="decide-banner" data-decide="removed">
        Your decision on <code>{d.call}</code> was removed.{' '}
        {live ? `${gen.fn} r${rec!.artifact!.revision} is live again.` : `${gen.fn} is written again on its next call.`}
      </p>
    );
  }
  if (gen.phase === 'generating' || gen.phase === 'gating') {
    return (
      <p class="decide-banner" data-decide="regrowing">
        Writing {gen.fn} again against your decision: <code>{label}</code>
      </p>
    );
  }
  if (gen.phase === 'committed') {
    return (
      <p class="decide-banner" data-decide="regrown">
        Written again against your decision: <code>{label}</code>
      </p>
    );
  }
  const needsLive = gen.error?.code === 'no_recording';
  return (
    <div class="decide-banner decide-stuck" data-decide={needsLive ? 'needs-live' : 'failed'}>
      <p>
        Your decision <code>{label}</code> stands. The committed {gen.fn} fails it, so {gen.fn} is out of date until it is written again
        {needsLive ? ', which needs live mode.' : '.'}
      </p>
      <div class="form-actions">
        {needsLive && (
          <button type="button" class="btn btn-primary" onClick={() => (runLiveOpen.value = true)}>
            How to run live
          </button>
        )}
        {needsLive && (
          <button type="button" class="btn" disabled={state.service.state === 'checking'} onClick={() => void engine.recheckService()}>
            Check for the live service
          </button>
        )}
        <button
          type="button"
          class="btn"
          disabled={state.busy}
          onClick={() => void engine.removeDecision(gen.fn, d.id).then(() => afterRemoval(engine, gen.fn, label, () => document.querySelector<HTMLElement>('.decide-banner')))}
        >
          Remove the decision
        </button>
      </div>
      <p class="muted small">Removing it re-checks {gen.fn} against the spec without it; the function committed before comes back if it passes.</p>
    </div>
  );
}
