import { GATE_ORDER, type AttemptView, type Engine, type EngineState, type GateResult, type GenerationView } from '../../types';
import { fmtMs } from '../format';
import { attribution, failingGate, gateAttempt, isLatestAttempt } from '../select';
import { selection } from '../uiState';
import { CopyBlock, PanelHead, StatusIcon, statusWord } from './common';
import { DiagnosticFacts, DiagnosticItem } from './Diagnostics';
import { declineCopy, whoDecided } from '../explain';
import { committedArtifact } from '../evidence';
import { Confidence, MoreChecks } from './Evidence';

/** Under a re-check's headline: why a committed function is being rejected at all. */
export const RECHECK_LINE = 'You added this check after the function was committed. The committed function fails it.';

const GATE_LABEL = { compile: 'Compile', tests: 'Tests', properties: 'Properties', invariants: 'Invariants' } as const;
const GATE_WHAT = {
  compile: 'strict TypeScript',
  tests: 'your unit tests',
  properties: 'fast-check, fixed seed',
  invariants: 'pure · bounded',
} as const;

function GateRow({ g, notRun }: { g: GateResult; notRun?: boolean }) {
  const counts = g.counts ? `${g.counts.passed}/${g.counts.total}` : null;
  // skip a note the summary already says (e.g. both "not reached")
  const showNote = !notRun && !!g.note && !(g.summary && g.summary.startsWith(g.note));
  // a declined candidate was never judged: its rows read "not run", the decline card says why
  const word = notRun ? 'not run' : statusWord(g.status);
  return (
    <li class={`gate-row g-${g.status}${notRun ? ' g-notrun' : ''}`} aria-label={`${GATE_LABEL[g.gate]}: ${word}.${notRun ? '' : ` ${g.summary}`}`}>
      <StatusIcon status={g.status} />
      <span class="gate-name">{GATE_LABEL[g.gate]}</span>
      <span class="gate-what">{GATE_WHAT[g.gate]}</span>
      <span class="gate-summary">
        <span class="gate-word">{word}</span>
        {!notRun && g.summary && <span> · {g.summary}</span>}
        {showNote && <span class="gate-note"> — {g.note}</span>}
      </span>
      <span class="gate-ms mono">{g.status === 'pass' || g.status === 'fail' ? fmtMs(g.ms) : counts ?? ''}</span>
    </li>
  );
}

function rowsFor(a: AttemptView | undefined): GateResult[] {
  if (a && a.gates.length) return a.gates;
  const aborted = a?.status === 'aborted';
  return GATE_ORDER.map((gate) => ({
    gate,
    status: aborted ? ('skipped' as const) : ('pending' as const),
    ms: 0,
    summary: aborted ? 'not run — there was no candidate' : '',
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
        <span aria-hidden="true">⊘</span> NOT WRITTEN · the model declined
        <span class="muted"> · candidate #{a.attempt}</span>
      </p>
      <p class="headline-text">{copy.title}</p>
      <blockquote class="decline-quote">
        <span class="decline-tag mono">{d.reason === 'cannot-be-pure' ? 'cannot be pure' : 'needs a spec'}</span> {d.message}
      </blockquote>
      <p class="decline-next">{copy.next}</p>
      <p class="attribution">no gate ran · the program is unchanged</p>
    </div>
  );
}

function Headline({ gen, a }: { gen: GenerationView; a: AttemptView }) {
  if (a.candidate?.declined) return <DeclineCard a={a} />;
  const fail = failingGate(a.gates);
  if (fail) {
    const first = fail.diagnostics[0];
    const recheck = gen.kind === 'recheck';
    return (
      <div class={`headline headline-fail${recheck ? ' headline-recheck' : ''}`} key={`${gen.id}:${a.attempt}`}>
        <p class="headline-gate">
          <span aria-hidden="true">✕</span> {fail.gate.toUpperCase()}
          <span class="muted">{recheck ? ' · re-check of the committed function' : ` · candidate #${a.attempt}`}</span>
          {fail.note && <span class="spec-error"> · {fail.note}</span>}
        </p>
        <p class="headline-text">{fail.headline ?? a.candidate?.headline ?? `Rejected by ${fail.gate}`}</p>
        {recheck && <p class="recheck-line">{RECHECK_LINE}</p>}
        <div class="who" aria-label="Who decided">
          {whoDecided(fail, a.attempt).map((line, i) => (
            <p key={i} class={i === 0 ? 'who-line' : 'who-line who-fair'}>
              {line}
            </p>
          ))}
        </div>
        {first && <DiagnosticFacts d={first} />}
        {first && <p class="attribution">{attribution(first, fail.gate)}</p>}
      </div>
    );
  }
  if (a.status === 'accepted') {
    return (
      <div class="headline headline-pass">
        <p class="headline-gate">
          <span aria-hidden="true">✓</span> ALL GATES · candidate #{a.attempt}
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
    <section class="panel panel-gates" aria-label="Gates">
      <PanelHead ch="03" title="Gates">
        {gen && !recheck && (
          <span class="budget mono">
            attempt {gen.attempt} of {gen.maxAttempts}
          </span>
        )}
      </PanelHead>
      <div class="panel-body gates-body">
        {gen && a && !isLatestAttempt(gen, a) && (
          <p class="showing muted small">
            showing the verdict on candidate #{a.attempt}
            {selection.value ? '' : ` while #${gen.attempts[gen.attempts.length - 1].attempt} is on its way`}
          </p>
        )}
        {gen?.ungated && !gen.declined && (
          <p class="ungated" role="note">
            <span aria-hidden="true">⚠</span> No tests yet — add one to make the gate stricter.
            <span class="muted"> Compile and Invariants still run.</span>
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
                <span aria-hidden="true">⚠</span> GENERATION FAILED · {gen.error.code}
              </p>
              <p class="headline-text">{gen.error.message}</p>
              {gen.error.fix && gen.error.fix.length > 0 && (
                <div class="fix">
                  <p class="muted small">To fix, run:</p>
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
                Budget exhausted after {gen.attempts.length} candidate{gen.attempts.length === 1 ? '' : 's'} — the
                program is unchanged.
              </p>
            )
          )}
          {gen && a && <Headline gen={gen} a={a} />}
        </div>
        {committed && gen && <Confidence a={committed} fn={gen.fn} mutation={state?.mutation} />}
        {checksFor && state && engine && <MoreChecks state={state} engine={engine} fn={checksFor} />}

        {!gen && <p class="empty">The gates run here when a call grows a function. Nothing has been judged yet.</p>}

        {diags.length > 0 && (
          // a single diagnostic is already spelled out in the headline block, so its list starts collapsed
          <details class="diags" open={!!failing && diagCount > 1} key={`${gen?.id}:${a?.attempt}`}>
            <summary>Diagnostics ({diagCount}) — who decided, and on what evidence</summary>
            <ul>
              {diags.flatMap((g) => g.diagnostics.map((d, i) => <DiagnosticItem key={`${g.gate}${i}`} d={d} gate={g.gate} />))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
