/**
 * The connector lines between two columns of the definition ladder (Fig. 2), computed from who is where in each top 5
 * so they always agree with the figures. Pure. Geometry is the design's (V3-Door-Landing 528-536, 552-558): an SVG of
 * viewBox 0 0 96 344 drawn 64px wide; the row centres sit at 114 + 44·j (76px column head + 16px padding + half of a
 * 44px row); a customer who leaves the list curves down into a dot at (64, 330); one who joins rises from (40, 336).
 */

export const LADDER_ROW_Y0 = 114;
export const LADDER_ROW_STEP = 44;
export const LADDER_EXIT = { x: 64, y: 330 } as const;

export type ConnectorKind = 'move' | 'fall' | 'leave' | 'enter';

export interface Connector {
  kind: ConnectorKind;
  /** The customer the line follows. */
  name: string;
  d: string;
}

export interface Connectors {
  /** Drawn in this order: plain moves, leavers, joiners, then the highlighted fall on top. */
  paths: Connector[];
  /** True when someone left the list: draw the exit dot. */
  exitDot: boolean;
}

const rowY = (j: number): number => LADDER_ROW_Y0 + LADDER_ROW_STEP * j;

/**
 * Lines from the `before` column to the `after` column (names in rank order). `highlight` (the customer who fell the
 * furthest on the ladder) is drawn as the bold indigo line wherever it appears in both columns.
 */
export function ladderConnectors(before: readonly string[], after: readonly string[], highlight: string | null): Connectors {
  const moves: Connector[] = [];
  const leaves: Connector[] = [];
  const top: Connector[] = [];
  before.forEach((name, i) => {
    const j = after.indexOf(name);
    const y1 = rowY(i);
    if (j < 0) {
      leaves.push({ kind: 'leave', name, d: `M0 ${y1} C40 ${y1} 40 ${LADDER_EXIT.y} ${LADDER_EXIT.x} ${LADDER_EXIT.y}` });
      return;
    }
    const y2 = rowY(j);
    const d = `M0 ${y1} C48 ${y1} 48 ${y2} 96 ${y2}`;
    if (name === highlight) top.push({ kind: 'fall', name, d });
    else moves.push({ kind: 'move', name, d });
  });
  const enters: Connector[] = after
    .map((name, j) => ({ name, j }))
    .filter(({ name }) => !before.includes(name))
    .map(({ name, j }) => ({ kind: 'enter' as const, name, d: `M40 336 C70 336 66 ${rowY(j)} 96 ${rowY(j)}` }));
  return { paths: [...moves, ...leaves, ...enters, ...top], exitDot: leaves.length > 0 };
}
