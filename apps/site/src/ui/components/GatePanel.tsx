import { GATE_ORDER, type AttemptView, type Engine, type EngineState, type GateResult, type GenerationView } from '@scasella/undefined-engine/types';
import { fmtMs, sentenceCase } from '../format';
import { attribution, failingGate, gateAttempt, lastCallValue } from '../select';
import { decideAnnouncement, decideOpen, selection } from '../uiState';
import { useEffect } from 'preact/hooks';
import { DecideBlock, RegrowNote } from './Decide';
import { decidableAttempt, gapRefFor } from '../decide';
import { CopyBlock, PanelHead, StatusIcon, statusWord } from './common';
import { DiagnosticFacts, DiagnosticItem } from './Diagnostics';
import { declineCopy, GATE_CAPTION, GATE_PLAIN, GATE_QUESTION, howFound, NOT_REACHED_TEXT, plainGateText, plainHeadline, rejectionClass, shortGateStatus, splitCall, whoDecided } from '../explain';
import { committedArtifact } from '../evidence';
import { Confidence, MoreChecks } from './Evidence';
import { EjectButton } from './Eject';

/** Under a re-check's headline: why a committed function is being rejected at all. */
export const RECHECK_LINE = 'You added this check after the function was committed. The committed function fails it.';
/** The same line when the re-check was of a decision the user made after the commit. */
export const RECHECK_DECISION_LINE = 'You decided this after the function was committed. The committed function fails it.';
/** The same line when a function it calls changed after it was committed (composition). `what`: "slugify changed r4 → r7". */
export function recheckCalleeLine(what: string, names: readonly string[]): string {
  const list = names.join(', ');
  return `A function it calls changed after it was committed (${what}). With the new ${list}, its unchanged code fails its own checks, so it does not run; the next call writes it again.`;
}

const GATE_LABEL = { compile: 'Compile', tests: 'Tests', properties: 'Properties', invariants: 'Invariants' } as const;

/**
 * One check: status tile, name, a short status cell and the time. Everything else (the gate's own summary, its note,
 * what the check is) sits behind the row's disclosure, so nothing is ever truncated. The question-style caption shows
 * only before anything has run.
 */
function GateRow({ g, notRun, idle }: { g: GateResult; notRun?: boolean; idle?: boolean }) {
  let summary = g.summary ? plainGateText(g.summary) : '';
  const note = g.note ? plainGateText(g.note) : '';
  // a note that only repeats the summary is not shown twice ("no tests yet" / "no tests yet — add one …")
  if (note && summary && note.startsWith(summary)) summary = note;
  const showNote = !notRun && !!note && !summary.startsWith(note);
  const short = shortGateStatus(g, notRun);
  const notReached = !notRun && g.status === 'skipped' && short === '—';
  const time = g.status === 'pass' || g.status === 'fail' ? fmtMs(g.ms) : '';
  return (
    <li class={`gate-row g-${g.status}${notRun ? ' g-notrun' : ''}`}>
      <details class="gate-more">
        <summary class="gate-line" title={idle ? undefined : GATE_QUESTION[g.gate]}>
          <StatusIcon status={g.status} />
          <span class="gate-id">
            <span class="gate-name">{GATE_LABEL[g.gate]}</span>
            {idle && <span class="gate-q">{GATE_CAPTION[g.gate]}</span>}
          </span>
          <span class="gate-word" title={notReached ? NOT_REACHED_TEXT : undefined}>
            {notReached ? (
              <>
                <span aria-hidden="true">—</span>
                <span class="sr-only">not run</span>
              </>
            ) : (
              short
            )}
          </span>
          <span class="gate-ms">{time}</span>
        </summary>
        <div class="gate-detail">
          {notRun ? (
            <p>Not run: the model declined, so nothing was judged.</p>
          ) : notReached ? (
            <p>{NOT_REACHED_TEXT}</p>
          ) : (
            summary && (
              <p>
                {sentenceCase(summary)}
                {showNote && <span class="gate-note"> — {note}</span>}
              </p>
            )
          )}
          <p class="muted">
            {GATE_QUESTION[g.gate]} {GATE_PLAIN[g.gate]}
          </p>
        </div>
      </details>
    </li>
  );
}

/** The rejection headline: the call it starts with set as code, the rest in the serif. */
function VerdictText({ text }: { text: string }) {
  const plain = plainHeadline(text);
  const split = splitCall(plain);
  if (!split) return <>{plain}</>;
  return (
    <>
      <code class="vh-call">{split.call}</code>
      {split.rest}
    </>
  );
}

function rowsFor(a: AttemptView | undefined, failed = false): GateResult[] {
  if (a && a.gates.length) return a.gates;
  // a grow that failed before any draft was asked for (replay with a decision no recording was checked against) has
  // no attempt at all: nothing is waiting, nothing ran
  const aborted = a?.status === 'aborted' || (!a && failed);
  return GATE_ORDER.map((gate) => ({
    gate,
    status: aborted ? ('skipped' as const) : ('pending' as const),
    ms: 0,
    summary: aborted ? 'not run — no draft arrived' : '',
    diagnostics: [],
  }));
}

/** The model said it cannot honestly write this. Not a rejection: no gate ran, nothing judged the candidate. */
function DeclineCard({ a }: { a: AttemptView }) {
  const d = a.candidate!.declined!;
  const copy = declineCopy(d);
  return (
    <div class={`headline headline-declined decline-${d.reason}`} key={`declined:${a.attempt}`}>
      <p class="headline-gate">
        <span aria-hidden="true">⊘</span> Not written · the model declined · #{a.attempt}
      </p>
      <p class="headline-text">{copy.title}</p>
      <blockquote class="decline-quote">
        <span class="decline-tag">{d.reason === 'cannot-be-pure' ? 'cannot be pure' : 'needs a spec'}</span>
        <span class="decline-msg">{d.message}</span>
      </blockquote>
      <p class="decline-next">{copy.next}</p>
      <p class="attribution">No gate ran. Your program is unchanged.</p>
    </div>
  );
}

/** The Decide block for a rejection whose check said the spec was silent: only once the grow (or re-check) is over. */
function DecideFor({ gen, a, state, engine }: { gen: GenerationView; a: AttemptView; state?: EngineState; engine?: Engine }) {
  if (!state || !engine || (gen.phase !== 'committed' && gen.phase !== 'failed') || gen.decision) return null;
  const ref = gapRefFor(gen, a, state.program);
  let q = ref ? engine.gapQuestion(ref) : null;
  let used = ref;
  // a stored candidate that no longer resolves (rolled back past it): the diagnostic itself still can
  if (ref && !q && !('diagnostic' in ref)) {
    const d = a.gates.find((g) => g.status === 'fail')?.diagnostics[0];
    used = d ? { fn: gen.fn, diagnostic: d } : null;
    q = used ? engine.gapQuestion(used) : null;
  }
  if (!used || !q) return null;
  return <DecideBlock key={`${gen.id}:${a.attempt}`} engine={engine} state={state} gapRef={used} q={q} attempt={a.attempt} openKey={`${gen.id}:${a.attempt}`} inCard />;
}

/** Under an accepted verdict: the earlier rejection the spec was silent on, and a way to rule on it. */
function SilentLine({ gen, state, engine }: { gen: GenerationView; state?: EngineState; engine?: Engine }) {
  if (!state || !engine || gen.decision) return null;
  const hit = decidableAttempt(gen, state.program, (r) => engine.gapQuestion(r));
  if (!hit) return null;
  const decided = !!hit.q.existing;
  return (
    <p class="silent-line">
      <span>
        {decided ? 'You decided what ' : 'The spec was silent on '}
        <code>{hit.q.call}</code>
        {decided ? ' should do.' : ` (draft #${hit.attempt.attempt}).`}
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-xs silent-decide"
        onClick={() => {
          selection.value = { genId: gen.id, attempt: hit.attempt.attempt };
          decideOpen.value = `${gen.id}:${hit.attempt.attempt}`;
        }}
      >
        {decided ? 'Review the decision' : 'Decide'}
      </button>
    </p>
  );
}

function Headline({ gen, a, value, state, engine }: { gen: GenerationView; a: AttemptView; value: string | null; state?: EngineState; engine?: Engine }) {
  if (a.candidate?.declined) return <DeclineCard a={a} />;
  const fail = failingGate(a.gates);
  if (fail) {
    const first = fail.diagnostics[0];
    const recheck = gen.kind === 'recheck';
    const how = first ? howFound(first) : null;
    const headline = fail.headline ?? a.candidate?.headline ?? `Rejected by ${fail.gate}`;
    return (
      <article class={`headline headline-fail${recheck ? ' headline-recheck' : ''}`} key={`${gen.id}:${a.attempt}`} aria-label="Rejection">
        <p class="headline-gate">
          <span class="stamp">
            <span aria-hidden="true">✕ </span>Rejected
          </span>
          <span>by {GATE_LABEL[fail.gate]}</span>
          <span class="hg-class">— {recheck && gen.recheck?.callees ? `${gen.recheck.callees.names.join(', ')} changed` : rejectionClass(fail)}</span>
          <span class="hg-sep" aria-hidden="true">·</span>
          <span>{recheck ? 're-check of the committed function' : `#${a.attempt}`}</span>
          {fail.note && fail.note !== 'spec error' && (
            <>
              <span class="hg-sep" aria-hidden="true">·</span>
              <span class="spec-error">{plainGateText(fail.note)}</span>
            </>
          )}
        </p>
        <p class="headline-text">
          <VerdictText text={headline} />
        </p>
        {recheck && (
          <p class="recheck-line">
            {gen.recheck?.callees ? recheckCalleeLine(gen.recheck.callees.what, gen.recheck.callees.names) : gen.recheck?.decision ? RECHECK_DECISION_LINE : RECHECK_LINE}
          </p>
        )}
        <div class="who" aria-label="Who decided">
          {whoDecided(fail, a.attempt).map((line, i) => (
            <p key={i} class={i === 0 ? 'who-line' : 'who-line who-fair'}>
              {line}
            </p>
          ))}
        </div>
        {first && <DiagnosticFacts d={first} headline={plainHeadline(headline)} />}
        {first && (
          <details class="how">
            <summary>How it was found</summary>
            {how && <p>{how}</p>}
            <p class="attribution">{attribution(first, fail.gate)}</p>
          </details>
        )}
        <DecideFor gen={gen} a={a} state={state} engine={engine} />
      </article>
    );
  }
  if (a.status === 'accepted') {
    const committed = gen.phase === 'committed' && gen.revision !== undefined;
    return (
      <div class="headline headline-pass">
        <p class="headline-gate">
          <span aria-hidden="true">✓ </span>{gen.ungated ? 'Every check that ran passed' : 'All four gates passed'} · #{a.attempt}
        </p>
        <p class="headline-text">
          Accepted{committed ? ` · saved as r${gen.revision}` : ''}
          {committed && value !== null && (
            <span class="hp-value">
              {' '}
              · returned <code>{value}</code>
            </span>
          )}
        </p>
        {committed && <SilentLine gen={gen} state={state} engine={engine} />}
      </div>
    );
  }
  return null;
}

/** The one sentence a screen reader hears when a verdict lands (and only then). */
function verdictAnnouncement(gen: GenerationView | null, a: AttemptView | undefined, value: string | null): string {
  if (!gen || !a) return '';
  if (a.candidate?.declined) return `Candidate ${a.attempt} declined: ${declineCopy(a.candidate.declined).title}`;
  const fail = failingGate(a.gates);
  if (fail) {
    const h = fail.headline ?? a.candidate?.headline;
    // a re-check judges the committed function (after a spec edit or a decision), not a new candidate
    if (gen.kind === 'recheck') {
      const callees = gen.recheck?.callees ? ` with the new ${gen.recheck.callees.names.join(', ')}` : '';
      return `The committed ${gen.fn} failed ${GATE_LABEL[fail.gate]}${callees}${h ? `: ${plainHeadline(h)}` : '.'}`;
    }
    return `Candidate ${a.attempt} rejected by ${GATE_LABEL[fail.gate]}${h ? `: ${plainHeadline(h)}` : '.'}`;
  }
  if (a.status === 'accepted' && gen.phase === 'committed' && gen.revision !== undefined) {
    return `${gen.ungated ? 'Every check that ran passed' : 'All four gates passed'}. Accepted as r${gen.revision}${value !== null ? `, result ${value}` : ''}.`;
  }
  return '';
}

/** The one status word at the right of the Checks head. */
function headStatus(gen: GenerationView | null, a: AttemptView | undefined): { word: string; tone: string } | null {
  if (!gen || !a) return null;
  if (a.candidate?.declined) return { word: 'Declined', tone: 'muted' };
  if (failingGate(a.gates)) return { word: 'Rejected', tone: 'fail' };
  if (a.status === 'accepted') return { word: 'Accepted', tone: 'ok' };
  if (a.status === 'gating') return { word: 'Checking…', tone: 'live' };
  if (a.status === 'generating' || a.status === 'typing') return { word: 'Writing…', tone: 'live' };
  if (a.status === 'aborted') return { word: 'Stopped', tone: 'muted' };
  return null;
}

export function GatePanel({ gen, state, engine }: { gen: GenerationView | null; state?: EngineState; engine?: Engine }) {
  const a = gateAttempt(gen, selection.value);
  const recheck = gen?.kind === 'recheck';
  // after a commit (never before): what ran against the committed function, and the checks that could still be added
  const committed = state && a?.status === 'accepted' ? committedArtifact(gen, state.program) : undefined;
  const checksFor = state && engine && gen && (committed || recheck) ? gen.fn : null;
  const rows = rowsFor(a, gen?.phase === 'failed');
  const failing = a ? failingGate(a.gates) : undefined;
  const diags = a ? a.gates.filter((g) => g.diagnostics.length > 0) : [];
  const declined = !!a?.candidate?.declined;
  const diagCount = diags.reduce((n, g) => n + g.diagnostics.length, 0);

  const value = state && a?.status === 'accepted' && gen?.phase === 'committed' ? lastCallValue(state.repl) : null;
  const hs = headStatus(gen, a);
  const idle = !gen;
  // the one announcer: a decision in progress speaks through it; moving to another generation clears that
  const genId = gen?.id;
  useEffect(() => {
    decideAnnouncement.value = null;
  }, [genId]);
  const decisionGone = !!gen?.decision && !!state && !(state.program.functions[gen.fn]?.spec.decisions ?? []).some((d) => d.id === gen.decision!.id);

  return (
    <section class="panel panel-gates" aria-labelledby="h-checks" data-verdict={failing ? 'fail' : a?.status === 'accepted' ? 'pass' : 'none'}>
      <PanelHead title="Checks" id="h-checks" status={hs?.word} tone={hs?.tone} />
      <p class="sr-only" role="status">
        {decideAnnouncement.value ?? verdictAnnouncement(gen, a, value)}
      </p>
      <div class="panel-body gates-body">
        {gen?.ungated && !gen.declined && (
          <p class="ungated" role="note">
            <span class="ungated-mark" aria-hidden="true">!</span>
            <span>
              No tests yet, so nothing checks that it does what you meant. <span class="muted">Only Compile and Invariants run. Add a test to make the checks stricter.</span>
            </span>
          </p>
        )}
        <ol class="gate-rows" aria-label="The four checks">
          {rows.map((g) => (
            <GateRow key={g.gate} g={g} notRun={declined} idle={idle} />
          ))}
        </ol>

        {gen?.decision && gen.phase !== 'failed' && state && engine && <RegrowNote gen={gen} state={state} engine={engine} />}
        <div class="verdict">
          {gen?.error && decisionGone ? null : gen?.error ? (
            <div class="headline headline-error" role="alert">
              <p class="headline-gate">
                <span aria-hidden="true">! </span>The model could not be asked · <span class="mono-inline">{gen.error.code}</span>
              </p>
              <p class="headline-text">{gen.error.message}</p>
              {gen.error.fix && gen.error.fix.length > 0 && (
                <div class="fix">
                  <p class="muted small">To fix it, run:</p>
                  {gen.error.fix.map((line) => (
                    <CopyBlock key={line} text={line} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            gen?.phase === 'failed' &&
            !gen.declined &&
            !recheck && (
              <p class="exhausted">
                {gen.attempts.length === 1 ? 'The only attempt was' : `All ${gen.attempts.length} attempts were`} turned away. Your program is
                unchanged.
              </p>
            )
          )}
          {gen && a && <Headline gen={gen} a={a} value={value} state={state} engine={engine} />}
        </div>
        {gen?.decision && gen.phase === 'failed' && state && engine && <RegrowNote gen={gen} state={state} engine={engine} />}
        {committed && gen && <Confidence a={committed} fn={gen.fn} mutation={state?.mutation} />}
        {committed && gen && state && engine && gen.phase === 'committed' && (
          <p class="eject-row">
            <EjectButton state={state} engine={engine} fn={gen.fn} />
          </p>
        )}
        {checksFor && state && engine && <MoreChecks state={state} engine={engine} fn={checksFor} />}

        {diags.length > 0 && (
          // a single diagnostic is already spelled out in the headline block, so its list starts collapsed
          <details class="diags" open={!!failing && diagCount > 1} key={`${gen?.id}:${a?.attempt}`}>
            <summary>Evidence ({diagCount})</summary>
            <ul>
              {diags.flatMap((g) => g.diagnostics.map((d, i) => <DiagnosticItem key={`${g.gate}${i}`} d={d} gate={g.gate} />))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
