import { GATE_ORDER, type AttemptView, type Engine, type EngineState, type GateResult, type GenerationView } from '../../types';
import { fmtMs } from '../format';
import { attribution, failingGate, gateAttempt, isLatestAttempt } from '../select';
import { selection } from '../uiState';
import { CopyBlock, PanelHead, StatusIcon, statusWord } from './common';
import { DiagnosticFacts, DiagnosticItem } from './Diagnostics';
import { declineCopy, GATE_PRECISE, GATE_QUESTION, howFound, plainGateText, plainHeadline, splitCall, whoDecided } from '../explain';
import { committedArtifact } from '../evidence';
import { Confidence, MoreChecks } from './Evidence';

/** Under a re-check's headline: why a committed function is being rejected at all. */
export const RECHECK_LINE = 'You added this check after the function was committed. The committed function fails it.';

const GATE_LABEL = { compile: 'Compile', tests: 'Tests', properties: 'Properties', invariants: 'Invariants' } as const;

function GateRow({ g, notRun }: { g: GateResult; notRun?: boolean }) {
  const counts = g.counts ? `${g.counts.passed}/${g.counts.total}` : null;
  let summary = g.summary ? plainGateText(g.summary) : '';
  const note = g.note ? plainGateText(g.note) : '';
  // a note that only repeats the summary is not shown twice ("no tests yet" / "no tests yet — add one …")
  if (note && summary && note.startsWith(summary)) summary = note;
  const showNote = !notRun && !!note && !summary.startsWith(note);
  // a declined candidate was never judged: its rows read "not run", the decline card says why
  const word = notRun ? 'not run' : statusWord(g.status);
  return (
    <li class={`gate-row g-${g.status}${notRun ? ' g-notrun' : ''}`} aria-label={`${GATE_LABEL[g.gate]}: ${word}.${notRun ? '' : ` ${summary}`}`}>
      <StatusIcon status={g.status} />
      <span class="gate-id" title={GATE_PRECISE[g.gate]}>
        <span class="gate-name">{GATE_LABEL[g.gate]}</span>
        <span class="gate-q">{GATE_QUESTION[g.gate]}</span>
      </span>
      <span class="gate-summary" title={notRun ? undefined : [g.summary, g.note].filter(Boolean).join(' — ')}>
        <span class="gate-word">{word}</span>
        {!notRun && summary && <span class="gate-detail"> · {summary}</span>}
        {showNote && <span class="gate-note"> — {note}</span>}
      </span>
      <span class="gate-ms">{g.status === 'pass' || g.status === 'fail' ? fmtMs(g.ms) : counts ?? ''}</span>
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

function rowsFor(a: AttemptView | undefined): GateResult[] {
  if (a && a.gates.length) return a.gates;
  const aborted = a?.status === 'aborted';
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
        <span aria-hidden="true">⊘</span> Not written · the model declined · candidate #{a.attempt}
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

function Headline({ gen, a }: { gen: GenerationView; a: AttemptView }) {
  if (a.candidate?.declined) return <DeclineCard a={a} />;
  const fail = failingGate(a.gates);
  if (fail) {
    const first = fail.diagnostics[0];
    const recheck = gen.kind === 'recheck';
    const how = first ? howFound(first) : null;
    return (
      <article class={`headline headline-fail${recheck ? ' headline-recheck' : ''}`} key={`${gen.id}:${a.attempt}`} aria-label="Rejection">
        <p class="headline-gate">
          <span class="stamp">
            <span aria-hidden="true">✕ </span>Rejected
          </span>
          <span class="hg-sep" aria-hidden="true">·</span>
          <span>{GATE_LABEL[fail.gate]}</span>
          <span class="hg-sep" aria-hidden="true">·</span>
          <span>{recheck ? 're-check of the committed function' : `candidate #${a.attempt}`}</span>
          {fail.note && (
            <>
              <span class="hg-sep" aria-hidden="true">·</span>
              <span class="spec-error">{plainGateText(fail.note)}</span>
            </>
          )}
        </p>
        <p class="headline-text">
          <VerdictText text={fail.headline ?? a.candidate?.headline ?? `Rejected by ${fail.gate}`} />
        </p>
        {recheck && <p class="recheck-line">{RECHECK_LINE}</p>}
        <div class="who" aria-label="Who decided">
          {whoDecided(fail, a.attempt).map((line, i) => (
            <p key={i} class={i === 0 ? 'who-line' : 'who-line who-fair'}>
              {line}
            </p>
          ))}
        </div>
        {first && <DiagnosticFacts d={first} />}
        {first && (
          <details class="how">
            <summary>How the gate found it</summary>
            {how && <p>{how}</p>}
            <p class="attribution">{attribution(first, fail.gate)}</p>
          </details>
        )}
      </article>
    );
  }
  if (a.status === 'accepted') {
    return (
      <div class="headline headline-pass">
        <p class="headline-gate">
          <span aria-hidden="true">✓ </span>All four gates passed · candidate #{a.attempt}
        </p>
        <p class="headline-text">
          Accepted{gen.phase === 'committed' && gen.revision !== undefined ? ` — committed as r${gen.revision}` : ''}
        </p>
      </div>
    );
  }
  return null;
}

export function GatePanel({ gen, state, engine }: { gen: GenerationView | null; state?: EngineState; engine?: Engine }) {
  const a = gateAttempt(gen, selection.value);
  const recheck = gen?.kind === 'recheck';
  // after a commit (never before): what ran against the committed function, and the checks that could still be added
  const committed = state && a?.status === 'accepted' ? committedArtifact(gen, state.program) : undefined;
  const checksFor = state && engine && gen && (committed || recheck) ? gen.fn : null;
  const rows = rowsFor(a);
  const failing = a ? failingGate(a.gates) : undefined;
  const diags = a ? a.gates.filter((g) => g.diagnostics.length > 0) : [];
  const declined = !!a?.candidate?.declined;
  const diagCount = diags.reduce((n, g) => n + g.diagnostics.length, 0);

  return (
    <section class="panel panel-gates" aria-label="Gates" data-verdict={failing ? 'fail' : a?.status === 'accepted' ? 'pass' : 'none'}>
      <PanelHead ch="03" title="Gates" sub="the toolchain decides" />
      <div class="panel-body gates-body">
        {gen && a && !isLatestAttempt(gen, a) && (
          <p class="showing muted small">
            showing the verdict on candidate #{a.attempt}
            {selection.value ? '' : ` while #${gen.attempts[gen.attempts.length - 1].attempt} is on its way`}
          </p>
        )}
        {gen?.ungated && !gen.declined && (
          <p class="ungated" role="note">
            <span class="ungated-mark" aria-hidden="true">!</span>
            <span>
              No tests yet, so nothing checks that it does what you meant. <span class="muted">Only Compile and Invariants run. Add a test to make the gate stricter.</span>
            </span>
          </p>
        )}
        <ol class="gate-rows">
          {rows.map((g) => (
            <GateRow key={g.gate} g={g} notRun={declined} />
          ))}
        </ol>

        <div aria-live="polite" aria-atomic="true">
          {gen?.error ? (
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
          {gen && a && <Headline gen={gen} a={a} />}
        </div>
        {committed && gen && <Confidence a={committed} fn={gen.fn} mutation={state?.mutation} />}
        {checksFor && state && engine && <MoreChecks state={state} engine={engine} fn={checksFor} />}

        {!gen && (
          <p class="empty">
            Call a function that doesn't exist and the model drafts it. These four gates decide whether the draft is kept.
          </p>
        )}

        {diags.length > 0 && (
          // a single diagnostic is already spelled out in the headline block, so its list starts collapsed
          <details class="diags" open={!!failing && diagCount > 1} key={`${gen?.id}:${a?.attempt}`}>
            <summary>All the evidence ({diagCount})</summary>
            <ul>
              {diags.flatMap((g) => g.diagnostics.map((d, i) => <DiagnosticItem key={`${g.gate}${i}`} d={d} gate={g.gate} />))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
