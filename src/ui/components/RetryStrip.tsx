import type { GenerationView } from '../../types';
import { chipText, codeAttempt } from '../select';
import { selection } from '../uiState';
import { PanelHead } from './common';

const ICON = { rejected: '✕', accepted: '✓', aborted: '–', generating: '…', typing: '…', gating: '◌' } as const;

export function RetryStrip({ gen }: { gen: GenerationView | null }) {
  // the active chip is the candidate the code pane is showing (it may hold the previous one over)
  const shown = codeAttempt(gen, selection.value)?.attempt;
  const following = gen ? codeAttempt(gen, null)?.attempt.attempt : undefined;
  const unused = gen ? Math.max(0, gen.maxAttempts - gen.attempts.length) : 0;
  const unusedWord = gen?.phase === 'committed' ? 'not needed' : gen?.phase === 'failed' ? 'unused' : 'in reserve';

  return (
    <section class="panel panel-strip" aria-label="Candidates">
      <PanelHead ch="04" title="Candidates">
        {gen && (
          <span class="muted mono small">
            {gen.fn} · {gen.attempts.length}/{gen.maxAttempts} used
          </span>
        )}
      </PanelHead>
      <p class="strip-caption muted small">Every candidate the model proposes lands here, rejected ones too.</p>
      <div class="panel-body">
        {!gen ? (
          <p class="empty small">Nothing proposed yet.</p>
        ) : (
          <ol class="chips">
            {gen.attempts.map((a) => {
              const active = shown?.attempt === a.attempt;
              return (
                <li key={a.attempt}>
                  <button
                    type="button"
                    class={`cand cand-${a.status}${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    title="Show this candidate's code and gate results"
                    onClick={() => {
                      // back to "follow the newest" when following would show exactly this chip, or when the
                      // chip is already pinned (second click unpins); otherwise pin this candidate
                      const latest = gen.attempts[gen.attempts.length - 1].attempt === a.attempt;
                      const pinned = selection.value?.genId === gen.id && selection.value.attempt === a.attempt;
                      selection.value = pinned || (latest && following === a.attempt) ? null : { genId: gen.id, attempt: a.attempt };
                    }}
                  >
                    <span class="cand-icon" aria-hidden="true">
                      {ICON[a.status]}
                    </span>
                    <span class="cand-text">{chipText(a)}</span>
                  </button>
                </li>
              );
            })}
            {Array.from({ length: unused }, (_, i) => (
              <li key={`u${i}`}>
                <span class="cand cand-unused">
                  #{gen.attempts.length + i + 1} {unusedWord}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
