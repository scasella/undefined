import type { TablePreview } from '@scasella/undefined-engine/types';
import { formatCell, numericColumns, tableNote } from '../data';

/**
 * An array of row objects as a table: sticky header, bounded height with its own scroll, numbers right-aligned,
 * and a note when fewer rows are shown than there are.
 */
export function DataTable({ table, label, compact }: { table: TablePreview; label: string; compact?: boolean }) {
  const numeric = numericColumns(table);
  const note = tableNote(table);
  return (
    <div class={`dtable${compact ? ' is-compact' : ''}`}>
      <div class="dtable-scroll" tabIndex={0} role="region" aria-label={label}>
        <table>
          <thead>
            <tr>
              {table.columns.map((c, i) => (
                <th key={c} scope="col" class={numeric[i] ? 'num' : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, ci) => (
                  <td key={ci} class={numeric[ci] ? 'num' : undefined} title={numeric[ci] && formatCell(cell) !== cell ? cell : undefined}>
                    {numeric[ci] ? formatCell(cell) : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p class="dtable-note muted small">{note}</p>}
    </div>
  );
}
