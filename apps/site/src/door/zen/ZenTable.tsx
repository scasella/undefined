/**
 * Step by step · the whole table, scrollable. Rows are windowed (only the ones in view are drawn, on a fixed row height) so a
 * 20,000-row file scrolls as smoothly as the 48-row sample. Sticky header with each column's worked-out type.
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import type { DatasetRef } from '@scasella/undefined-engine/types';
import { formatCount, type DataRow } from '../model/figures';
import { cellFormatter, describeColumns } from '../model/samples';
import './ZenTable.css';

export const ROW_H = 32;
const VIEW_H = 320;
const OVERSCAN = 8;

/** Pure: which rows to draw for a scroll position. */
export function windowOf(scrollTop: number, total: number, viewH = VIEW_H): { from: number; to: number } {
  const from = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const to = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  return { from, to };
}

export function ZenTable({ dataset, rows, name }: { dataset: Pick<DatasetRef, 'columns' | 'rowCount'>; rows: readonly DataRow[]; name: string }) {
  const [top, setTop] = useState(0);
  const raf = useRef(0);
  const cols = useMemo(() => describeColumns(dataset.columns, rows), [dataset, rows]);
  const fmt = useMemo(() => cellFormatter(cols, rows), [cols, rows]);
  const { from, to } = windowOf(top, rows.length);
  return (
    <div class="zt">
      <div
        class="zt__scroll"
        tabIndex={0}
        role="region"
        aria-label={`All ${formatCount(rows.length)} rows of ${name}. Scroll to read them.`}
        style={{ maxHeight: `${VIEW_H}px` }}
        onScroll={(e) => {
          const y = e.currentTarget.scrollTop;
          cancelAnimationFrame(raf.current);
          raf.current = requestAnimationFrame(() => setTop(y));
        }}
      >
        <table class="zt__table">
          <caption class="fd-sr">{name}</caption>
          <thead>
            <tr>
              <th scope="col" class="zt__idx fd-mono" aria-label="Row number">
                #
              </th>
              {cols.map((c) => (
                <th key={c.name} scope="col" class={c.type === 'Number' ? 'is-r' : undefined}>
                  {c.name}
                  <span class="zt__type fd-mono">{c.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody class="fd-mono">
            {from > 0 && (
              <tr aria-hidden="true" style={{ height: `${from * ROW_H}px` }}>
                <td colSpan={cols.length + 1} />
              </tr>
            )}
            {rows.slice(from, to).map((r, i) => (
              <tr key={from + i} style={{ height: `${ROW_H}px` }}>
                <td class="zt__idx">{from + i + 1}</td>
                {fmt(r).map((v, k) => (
                  <td key={k} class={(cols[k]!.type === 'Number' ? 'is-r' : '') + (v === 'empty' ? ' is-empty' : '') || undefined}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
            {to < rows.length && (
              <tr aria-hidden="true" style={{ height: `${(rows.length - to) * ROW_H}px` }}>
                <td colSpan={cols.length + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p class="zt__foot">
        {formatCount(rows.length)} {rows.length === 1 ? 'row' : 'rows'} · types worked out from the values · nothing in your file is changed
      </p>
    </div>
  );
}
