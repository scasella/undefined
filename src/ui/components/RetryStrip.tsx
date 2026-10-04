import type { AttemptView, GenerationView } from '../../types';
import { plainHeadline } from '../explain';
import { chipText, codeAttempt, headlineOf, rejectingGateOf } from '../select';
import { selection } from '../uiState';
import { PanelHead } from './common';

const GATE_NAME = { compile: 'Compile', tests: 'Tests', properties: 'Properties', invariants: 'Invariants' } as const;

/** The verdict line and the one-line reason on an index card. */
function cardWords(a: AttemptView, committedAs: number | undefined): { mark: string; verdict: string; reason: string } {
  if (a.candidate?.declined) return { mark: '⊘', verdict: 'Declined', reason: a.candidate.declined.message };
  switch (a.status) {
    case 'rejected': {
      const gate = rejectingGateOf(a);
      const h = headlineOf(a);
      return { mark: '✕', verdict: `Rejected by ${gate ? GATE_NAME[gate] : 'a gate'}`, reason: h ? plainHeadline(h) : '' };
    }
    case 'accepted':
      return { mark: '✓', verdict: committedAs !== undefined ? `Accepted as r${committedAs}` : 'Accepted', reason: 'passed every gate' };
    case 'aborted':
      return { mark: '–', verdict: 'Stopped', reason: 'no candidate arrived' };
    case 'generating':
      return { mark: '', verdict: 'Writing', reason: 'drafting…' };
    case 'typing':
      return { mark: '', verdict: 'Arriving', reason: 'coming in…' };
    case 'gating':
      return { mark: '', verdict: 'At the gates', reason: 'being checked…' };
  }
}

/** "attempt 2 of 3 · 1 rejected · 1 in reserve" */
function ledger(gen: GenerationView, unusedWord: string, unused: number): string {
  const rejected = gen.attempts.filter((a) => a.status === 'rejected').length;
  const parts = [`attempt ${gen.attempts.length} of ${gen.maxAttempts}`];
  if (rejected) parts.push(`${rejected} rejected`);
  if (unused) parts.push(`${unused} ${unusedWord}`);
  return parts.join(' · ');
}

export function RetryStrip({ gen }: { gen: GenerationView | null }) {
  // the active card is the candidate the code pane is showing (it may hold the previous one over)
  const shown = codeAttempt(gen, selection.value)?.attempt;
  const following = gen ? codeAttempt(gen, null)?.attempt.attempt : undefined;
  const unused = gen ? Math.max(0, gen.maxAttempts - gen.attempts.length) : 0;
  const unusedWord = gen?.phase === 'committed' ? 'not needed' : gen?.phase === 'failed' ? 'unused' : 'in reserve';
  const committedAs = gen?.phase === 'committed' ? gen.revision : undefined;

  return (
    <section class="panel panel-strip" aria-label="Candidates">
      <PanelHead ch="04" title="Candidates" sub="every draft, kept">
        {gen && gen.kind !== 'recheck' && <span class="ledger">{ledger(gen, unusedWord, unused)}</span>}
      </PanelHead>
      <div class="panel-body">
        {gen?.kind === 'recheck' ? (
          <p class="empty small">
            No new drafts: the model was not asked. The committed function was re-checked against the check you added; the
            next call writes it again.
          </p>
        ) : !gen ? (
          <p class="empty small">Every draft the model writes lands here as a card, turned-away ones too.</p>
        ) : (
          <>
            <ol class="cards">
              {gen.attempts.map((a) => {
                const active = shown?.attempt === a.attempt;
                const w = cardWords(a, committedAs);
                const kind = a.candidate?.declined ? 'declined' : a.status;
                return (
                  <li key={a.attempt}>
                    <button
                      type="button"
                      class={`cand cand-${a.status}${a.candidate?.declined ? ' cand-declined' : ''}${active ? ' is-active' : ''}`}
                      data-attempt={a.attempt}
                      data-status={kind}
                      aria-pressed={active}
                      aria-label={chipText(a)}
                      title="Show this candidate's code and gate results"
                      onClick={() => {
                        // back to "follow the newest" when following would show exactly this card, or when the
                        // card is already pinned (second click unpins); otherwise pin this candidate
                        const latest = gen.attempts[gen.attempts.length - 1].attempt === a.attempt;
                        const pinned = selection.value?.genId === gen.id && selection.value.attempt === a.attempt;
                        selection.value = pinned || (latest && following === a.attempt) ? null : { genId: gen.id, attempt: a.attempt };
                      }}
                    >
                      <span class="card-top">
                        <span class="card-no">
                          <span class="card-no-label">No.</span>
                          <span class="card-num">{a.attempt}</span>
                        </span>
                        <span class="card-mark" aria-hidden="true">
                          {w.mark}
                        </span>
                      </span>
                      <span class="card-verdict">{w.verdict}</span>
                      <span class="card-reason">{w.reason}</span>
                    </button>
                  </li>
                );
              })}
              {Array.from({ length: unused }, (_, i) => (
                <li key={`u${i}`}>
                  <span class="cand cand-unused" data-attempt={gen.attempts.length + i + 1}>
                    <span class="card-top">
                      <span class="card-no">
                        <span class="card-no-label">No.</span>
                        <span class="card-num">{gen.attempts.length + i + 1}</span>
                      </span>
                    </span>
                    <span class="card-verdict">{unusedWord}</span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
