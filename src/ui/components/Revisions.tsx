import type { Engine, EngineState } from '../../types';
import { relativeTime } from '../format';
import { useNow } from '../uiState';

export function Revisions({ state, engine }: { state: EngineState; engine: Engine }) {
  const now = useNow(true, 30_000);
  const rows = [...state.revisions].reverse();
  return (
    <ol class="revlog" aria-label="Revision log, newest first">
      {rows.map((r) => {
        const head = r.id === state.headRevision;
        return (
          <li key={r.id} class={`rev${head ? ' is-head' : ''}`}>
            <span class="rev-id mono">r{r.id}</span>
            <span class="rev-time muted small" title={new Date(r.at).toLocaleString()}>
              {relativeTime(r.at, now)}
            </span>
            <span class={`chip kind-${r.kind}`}>{r.kind}</span>
            <span class="rev-title">
              {r.title}
              {r.restoredFrom !== undefined && <span class="muted"> · restored from r{r.restoredFrom}</span>}
              {r.detail && <span class="rev-detail muted small">{r.detail}</span>}
            </span>
            <span class="rev-counts muted small mono">
              {r.artifacts}/{r.fns} certified
            </span>
            <span class="rev-action">
              {head ? (
                <span class="chip chip-head">current</span>
              ) : (
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  disabled={state.busy}
                  onClick={() => void engine.rollback(r.id)}
                >
                  Roll back to r{r.id}
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
