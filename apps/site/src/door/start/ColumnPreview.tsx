/** "Your columns" (V3-Door-FirstRun 137-186): the bound file's columns, their worked-out types and the first 3 rows. */
import type { Engine } from '@scasella/undefined-engine/types';
import { sessionFor } from './session';
import { PREVIEW_EMPTY, PREVIEW_FOOTNOTE, previewModel } from './startView';
import './ColumnPreview.css';

export function ColumnPreview({ engine }: { engine: Engine }) {
  const s = sessionFor(engine);
  const m = previewModel({
    sampleId: s.sampleId.value,
    dataset: s.dataset.value,
    rows: s.rows.value,
    fileName: s.fileName.value,
  });
  return (
    <div class="fd-cols fd-card">
      <div class="fd-cols__head">
        <h2 class="fd-cols__h">Your columns</h2>
        {m && <span class="fd-cols__cap">{m.caption}</span>}
      </div>
      {m ? (
        <div class="fd-cols__scroll" tabIndex={0} role="region" aria-label={m.srCaption}>
          <table class="fd-cols__table">
            <caption class="fd-sr">{m.srCaption}</caption>
            <thead>
              <tr>
                {m.columns.map((c, i) => (
                  <th key={i} scope="col" class={c.right ? 'is-r' : undefined}>
                    {c.name}
                    <span class="fd-cols__type fd-mono">{c.type}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody class="fd-mono">
              {m.cells.map((row, r) => (
                <tr key={r}>
                  {row.map((v, i) => (
                    <td key={i} class={(m.columns[i]?.right ? 'is-r' : '') + (v === 'empty' ? ' is-empty' : '') || undefined}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="fd-cols__empty">{PREVIEW_EMPTY}</p>
      )}
      <p class="fd-cols__foot">{PREVIEW_FOOTNOTE}</p>
    </div>
  );
}
