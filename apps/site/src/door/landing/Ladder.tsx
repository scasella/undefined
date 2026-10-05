/**
 * Landing · definition ladder, Fig. 2 (V3-Door-Landing 485-587): two house-rule switches, the #1 under them, and three
 * top-5 columns joined by connector lines. Every name and amount is computed from the real orders.csv rows by
 * model/figures.ts; the lines come from landing/ladderPaths.ts.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { bundledOrders } from '../../data/orders';
import { Switch } from '../components/Switch';
import { HOUSE_RULES } from '../model/agreements';
import { definitionLadder, ladderLeader, offLadderNote, type LadderColumn } from '../model/figures';
import { LADDER_EXIT, ladderConnectors, type Connectors } from './ladderPaths';
import './Ladder.css';

const ROWS = bundledOrders();
const LADDER = definitionLadder(ROWS);
const OFF_NOTE = offLadderNote(ROWS);
const names = (c: LadderColumn) => c.rows.map((r) => r.name);
const HIGHLIGHT = LADDER.fall?.name ?? null;
const LINKS: [Connectors, Connectors] = [
  ladderConnectors(names(LADDER.columns[0]), names(LADDER.columns[1]), HIGHLIGHT),
  ladderConnectors(names(LADDER.columns[1]), names(LADDER.columns[2]), HIGHLIGHT),
];
/** Design copy: who switched the rule on and when (the demo's seeded provenance, as in the agreement). */
const ON_STATE = 'On · you · 5 Oct 2026';

function Links({ links }: { links: Connectors }) {
  return (
    <svg aria-hidden="true" width="64" height="344" viewBox="0 0 96 344" preserveAspectRatio="none" fill="none" class="fd-ld-links">
      {links.paths.map((p) => (
        <path
          key={p.name}
          vector-effect="non-scaling-stroke"
          d={p.d}
          stroke={p.kind === 'fall' ? 'var(--fd-indigo)' : 'var(--fd-line-2)'}
          stroke-width={p.kind === 'fall' ? 2 : 1}
          stroke-dasharray={p.kind === 'leave' || p.kind === 'enter' ? '3 3' : undefined}
        />
      ))}
      {links.exitDot && <circle cx={LADDER_EXIT.x} cy={LADDER_EXIT.y} r="3.5" fill="#FFFFFF" stroke="var(--fd-ink-3)" stroke-width="1.5" />}
    </svg>
  );
}

function Column({ col, lit, locked, onLock }: { col: LadderColumn; lit: boolean; locked: boolean; onLock: () => void }) {
  return (
    <div class={'fd-ld-col' + (lit ? ' is-lit' : '')}>
      <div class="fd-ld-col__head">
        <div class="fd-eyebrow fd-ld-col__tag">{col.tag}</div>
        <div class="fd-ld-col__title">{col.head}</div>
      </div>
      {col.rows.map((r, j) => (
        <div key={r.name} class={'fd-ld-row' + (j === 0 ? ' is-first' : '')}>
          <span class="fd-ld-row__rank">{r.rank}</span>
          <span class="fd-ld-row__name">
            {r.name}
            {r.note && <span class="fd-ld-row__note">{r.note}</span>}
          </span>
          <span class="fd-ld-row__amt fd-mono">{r.amount}</span>
        </div>
      ))}
      {lit && (
        <button type="button" class={'fd-ld-lock' + (locked ? ' is-locked' : '')} onClick={onLock}>
          {locked ? 'Locked · every later version has to give this top 5' : 'This is the one I mean. Lock this answer'}
        </button>
      )}
    </div>
  );
}

/**
 * Below 900px the figure scrolls sideways in its own box. Then (and only then) the box is a named, focusable region so
 * keyboard users can scroll it with the arrow keys; at full width it is no tab stop.
 */
function useScrollRegion() {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, []);
  return { ref, scrolls };
}

export function Ladder() {
  const scroller = useScrollRegion();
  const [paid, setPaid] = useState(true);
  const [once, setOnce] = useState(true);
  const [locked, setLocked] = useState(false);
  const leader = ladderLeader(ROWS, { paidOnly: paid, once });
  const lit = leader.column;
  const rule = (label: string, on: boolean, flip: (v: boolean) => void) => (
    <div class="fd-ld-rule">
      <span>
        <span class="fd-ld-rule__name">{label}</span>
        <span class="fd-ld-rule__state">{on ? ON_STATE : 'Off'}</span>
      </span>
      <Switch
        checked={on}
        label={label}
        onChange={(v) => {
          flip(v);
          setLocked(false);
        }}
      />
    </div>
  );
  const col = (i: 0 | 1 | 2) => (
    <Column col={LADDER.columns[i]} lit={lit === i} locked={locked} onLock={() => setLocked(!locked)} />
  );

  return (
    <section aria-labelledby="ladder-h" class="fd-ld">
      <div class="fd-wrap">
        <div class="fd-eyebrow">FIG. 2 · SAME FILE, THREE MEANINGS</div>
        <h2 id="ladder-h" class="fd-ld-h">Who's #1 depends on what you mean by revenue.</h2>
        <p class="fd-ld-lede">
          Writing the formula is the easy part. Saying what you mean is the hard part. Flip the rules and watch the leader
          change on the real sample file.
        </p>

        <div class="fd-ld-controls">
          {rule(HOUSE_RULES[0]!.name, paid, setPaid)}
          {rule(HOUSE_RULES[1]!.name, once, setOnce)}
          <div class="fd-ld-leader" aria-live="polite" aria-atomic="true">
            <span>#1 under these rules</span>
            <span class="fd-ld-leader__name">{leader.name}</span>
            <span class="fd-ld-leader__amt fd-mono">{leader.amount}</span>
          </div>
        </div>
        {lit === null && <p class="fd-ld-off">{OFF_NOTE}</p>}

        <div
          ref={scroller.ref}
          class="fd-ld-scroll"
          {...(scroller.scrolls
            ? { role: 'region', tabIndex: 0, 'aria-label': 'Fig. 2, three top-5 lists side by side. Scrolls sideways.' }
            : {})}
        >
          <div class="fd-ld-grid">
            {col(0)}
            <Links links={LINKS[0]} />
            {col(1)}
            <Links links={LINKS[1]} />
            {col(2)}
          </div>
        </div>
        <p class="fd-ld-caption">{LADDER.caption}</p>
      </div>
    </section>
  );
}
