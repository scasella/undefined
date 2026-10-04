import type { Engine, EngineState, Revision } from '../../types';
import { relativeTime } from '../format';
import { useNow } from '../uiState';

/**
 * Rollback brackets for the ledger (rows newest first): each rollback row is joined to the row it restored, drawn in
 * its own lane so overlapping brackets never cross. Returns, per row index, the segment each lane draws there.
 */
export type BracketPiece = 'start' | 'mid' | 'end' | null;
export function rollbackBrackets(rows: Pick<Revision, 'id' | 'restoredFrom'>[]): { lanes: number; pieces: BracketPiece[][] } {
  const index = new Map(rows.map((r, i) => [r.id, i]));
  const spans: Array<{ from: number; to: number }> = [];
  rows.forEach((r, i) => {
    if (r.restoredFrom === undefined) return;
    const j = index.get(r.restoredFrom);
    if (j !== undefined && j > i) spans.push({ from: i, to: j });
  });
  const laneEnds: number[] = []; // last row index each lane is busy until
  const laneOf = spans.map((s) => {
    let lane = laneEnds.findIndex((end) => end < s.from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = s.to;
    return lane;
  });
  const pieces: BracketPiece[][] = rows.map(() => Array.from({ length: laneEnds.length }, () => null));
  spans.forEach((s, k) => {
    const lane = laneOf[k]!;
    pieces[s.from]![lane] = 'start';
    for (let i = s.from + 1; i < s.to; i++) pieces[i]![lane] = 'mid';
    pieces[s.to]![lane] = 'end';
  });
  return { lanes: laneEnds.length, pieces };
}

const KIND_WORD: Partial<Record<Revision['kind'], string>> = { 'spec-edit': 'spec edit', recertify: 're-certified' };

export function Revisions({ state, engine }: { state: EngineState; engine: Engine }) {
  const now = useNow(true, 30_000);
  const rows = [...state.revisions].reverse();
  const { lanes, pieces } = rollbackBrackets(rows);
  return (
    <ol class="revlog" aria-label="Revision log, newest first" style={`--lanes: ${lanes}`}>
      {rows.map((r, i) => {
        const head = r.id === state.headRevision;
        return (
          <li key={r.id} class={`rev kind-${r.kind}${head ? ' is-head' : ''}`}>
            <span class="rev-id" aria-label={`revision ${r.id}`}>
              <span class="rev-r" aria-hidden="true">
                r
              </span>
              {r.id}
            </span>
            <span class="rev-rail" aria-hidden="true">
              <span class="rev-dot" />
            </span>
            <span class="rev-brackets" aria-hidden="true">
              {pieces[i]!.map((p, lane) => (p ? <span key={lane} class={`br br-${p}`} style={`--lane: ${lane}`} /> : null))}
            </span>
            <span class="rev-body">
              <span class="rev-title">{r.title}</span>
              <span class="rev-meta">
                <span class="rev-kind">{KIND_WORD[r.kind] ?? r.kind}</span>
                <span class="rev-time" title={new Date(r.at).toLocaleString()}>
                  {relativeTime(r.at, now)}
                </span>
                <span class="rev-counts" title="functions whose code passed the gates under their current spec / all functions">
                  {r.artifacts}/{r.fns} certified
                </span>
                {r.restoredFrom !== undefined && <span class="rev-restored">restored from r{r.restoredFrom}</span>}
              </span>
              {r.detail && <span class="rev-detail">{r.detail}</span>}
            </span>
            <span class="rev-action">
              {head ? (
                <span class="rev-current">current</span>
              ) : (
                <button
                  type="button"
                  class="btn btn-ghost btn-xs rev-restore"
                  disabled={state.busy}
                  aria-label={`Restore r${r.id}`}
                  title={`Roll back to r${r.id}: a new revision with the program as it was then`}
                  onClick={() => void engine.rollback(r.id)}
                >
                  Restore
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
