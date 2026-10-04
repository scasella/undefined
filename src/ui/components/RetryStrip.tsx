import type { GenerationView } from '../../types';
import { chipText, resolveAttempt } from '../select';
import { selection } from '../uiState';
import { PanelHead } from './common';

const ICON = { rejected: '✕', accepted: '✓', aborted: '–', generating: '…', typing: '…', gating: '◌' } as const;

export function RetryStrip({ gen }: { gen: GenerationView | null }) {
  const shown = resolveAttempt(gen, selection.value);
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
      <div class="panel-body">
        {!gen ? (
          <p class="empty small">Every candidate the model proposes lands here — the rejected ones too.</p>
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
                      const latest = gen.attempts[gen.attempts.length - 1].attempt === a.attempt;
                      selection.value = latest ? null : { genId: gen.id, attempt: a.attempt };
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
