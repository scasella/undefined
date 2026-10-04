import type { AttemptView, GenerationView } from '../../types';
import { plainHeadline } from '../explain';
import { chipText, codeAttempt, headlineOf, rejectingGateOf } from '../select';
import { selection } from '../uiState';
import { PanelHead } from './common';

const GATE_NAME = { compile: 'Compile', tests: 'Tests', properties: 'Properties', invariants: 'Invariants' } as const;

/** The verdict word and the one-line reason on a slim attempt card. */
function cardWords(a: AttemptView, committedAs: number | undefined): { mark: string; verdict: string; reason: string } {
  if (a.candidate?.declined) return { mark: '⊘', verdict: 'Declined', reason: a.candidate.declined.message };
  switch (a.status) {
    case 'rejected': {
      const gate = rejectingGateOf(a);
      const h = headlineOf(a);
      return { mark: '✕', verdict: 'Rejected', reason: `${gate ? GATE_NAME[gate] : 'A check'}${h ? `: ${plainHeadline(h)}` : ''}` };
    }
    case 'accepted':
      return { mark: '✓', verdict: committedAs !== undefined ? `Saved as r${committedAs}` : 'Accepted', reason: 'passed every check' };
    case 'aborted':
      return { mark: '–', verdict: 'Stopped', reason: 'no draft arrived' };
    case 'generating':
      return { mark: '', verdict: 'Writing…', reason: '' };
    case 'typing':
      return { mark: '', verdict: 'Arriving…', reason: '' };
    case 'gating':
      return { mark: '', verdict: 'Checking…', reason: '' };
  }
}

/**
 * Every draft, kept: one slim card per attempt (the rejected ones stay), the unused ones quiet. Clicking a card shows
 * that draft and its verdict. Hidden until the first draft exists.
 */
export function RetryStrip({ gen }: { gen: GenerationView | null }) {
  if (!gen) return null;
  // the active card is the candidate the code pane is showing (it may hold the previous one over)
  const shown = codeAttempt(gen, selection.value)?.attempt;
  const following = codeAttempt(gen, null)?.attempt.attempt;
  const unused = Math.max(0, gen.maxAttempts - gen.attempts.length);
  const unusedWord = gen.phase === 'committed' ? 'not needed' : gen.phase === 'failed' ? 'unused' : 'in reserve';
  const committedAs = gen.phase === 'committed' ? gen.revision : undefined;

  return (
    <section class="panel panel-strip" aria-labelledby="h-attempts">
      <PanelHead title="Attempts" id="h-attempts">
        {gen.kind !== 'recheck' && (
          <span class="ledger" title={unused ? `${unused} ${unusedWord}` : undefined}>
            {gen.attempts.length} of {gen.maxAttempts}
          </span>
        )}
      </PanelHead>
      <div class="panel-body">
        {gen.kind === 'recheck' ? (
          <p class="empty small">
            No new drafts: the model was not asked. The committed function was re-checked against the check you added; the
            next call writes it again.
          </p>
        ) : (
          <ol class="cards" style={`--n: ${gen.maxAttempts}`}>
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
                    title={`${chipText(a)}\n\nShow this draft and its verdict`}
                    onClick={() => {
                      // back to "follow the newest" when following would show exactly this card, or when the
                      // card is already pinned (second click unpins); otherwise pin this candidate
                      const latest = gen.attempts[gen.attempts.length - 1].attempt === a.attempt;
                      const pinned = selection.value?.genId === gen.id && selection.value.attempt === a.attempt;
                      selection.value = pinned || (latest && following === a.attempt) ? null : { genId: gen.id, attempt: a.attempt };
                    }}
                  >
                    <span class="card-line">
                      <span class="card-num">#{a.attempt}</span>
                      <span class="card-sep" aria-hidden="true">
                        ·
                      </span>
                      <span class="card-verdict">{w.verdict}</span>
                      <span class="card-mark" aria-hidden="true">
                        {w.mark}
                      </span>
                    </span>
                    {w.reason && <span class="card-reason">{w.reason}</span>}
                  </button>
                </li>
              );
            })}
            {Array.from({ length: unused }, (_, i) => (
              <li key={`u${i}`}>
                <span class="cand cand-unused" data-attempt={gen.attempts.length + i + 1}>
                  <span class="card-line">
                    <span class="card-num">#{gen.attempts.length + i + 1}</span>
                    <span class="card-sep" aria-hidden="true">
                      ·
                    </span>
                    <span class="card-verdict">{unusedWord}</span>
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
