/**
 * The answer card (V3 boards: LANDING 212-323, FIRSTRUN 259-324). Held under a veil until every check passes, then
 * revealed with the seal line, the card shadow rising and the staggered 'ri' rows. Presentational: every figure,
 * assumption and list item comes in through props (model/answer.ts, model/assumptions.ts).
 *
 * `view === null` is always shown as held (there is nothing to reveal), whatever `held` says.
 */
import type { ComponentChildren } from 'preact';
import type { AnswerView } from '../model/answer';
import { BASIC_CHECKS, decisiveCaveat, lockedRowsPhrase, TOTAL_CHECKS, verdictLine } from '../model/answer';
import type { AssumptionList } from '../model/assumptions';
import { lockedHelp, type CheckMode } from '../model/agreement';
import type { StressStatus } from '../model/lanes';
import { AskDiamond, CheckDisc, Lock, NotChecked } from '../icons';
import './AnswerCard.css';

export const HELD_CAPTION_START = 'Held until every check passes. Ask to start the checks.';
export const HELD_CAPTION_LANDING = 'Held until every check passes.';
export const HELD_CAPTION_WAITING = 'Waiting on you. No new answer is shown until you decide.';
export const HELD_LABEL = 'Answer held until every check passes';

// the check counts and the decisive caveat live in the model (model/answer.ts: the verdict line needs them); kept importable from here
export { BASIC_CHECKS, decisiveCaveat, TOTAL_CHECKS };
export const LEVEL_FULL = 'PASSED EVERY CHECK';
export const LEVEL_BASIC = `PASSED ${BASIC_CHECKS} BASIC CHECKS · NOTHING ELSE CHECKED YET`;

export interface AnswerCardProps {
  view: AnswerView | null;
  /** Veil shown. Forced on when `view` is null. */
  held: boolean;
  /** Caption under the veil bars. Default: the start page's 'Held until every check passes. Ask to start the checks.' */
  heldCaption?: string;
  /** 'landing': table rows, lead bar, lock glyph, 'Unlock any time.'; 'start': list rows, 'Add a house rule'. */
  variant?: 'landing' | 'start';
  /**
   * Timed reveal: `delay` is the design's tRev in seconds; changing `run` restarts the animation (the design's a/b
   * keyframe parity). Omit to show the revealed state without animation.
   */
  reveal?: { delay: number; run: number } | null;
  /** 'full': PASSED EVERY CHECK; 'basic': PASSED 2 BASIC CHECKS · NOTHING ELSE CHECKED YET. */
  level: 'full' | 'basic';
  /**
   * The seal in the engine's own words for a Full-checks answer (derive.ts AnswerSeal), replacing PASSED EVERY CHECK:
   * 'Passed every check · stress test caught 11 of 12', or, when the stress test did not finish, "Passed 5 of 6 checks ·
   * stress test didn't run" with a partial ring instead of the green disc. Omitted: the level's own words.
   */
  seal?: { text: string; ran: number; of: number; complete: boolean } | null;
  /**
   * The stress test's result (lanes.ts StressStatus) for a Full-checks answer: the verdict line words it with the seal's own
   * words. Omitted: the line says nothing about the stress test.
   */
  stress?: StressStatus | null;
  locked: boolean;
  /**
   * The lock confirmation to show instead of the card's own words (derive.ts AnswerProps.lockHelp: the honest replay
   * sentence). Empty or omitted: the card's own words.
   */
  lockHelp?: string;
  /** How the checks run here. Omitted (the landing's illustration): the card's own words, unchanged. */
  mode?: CheckMode;
  /** Omit to hide the lock button (e.g. the result cannot be locked). */
  onToggleLock?: () => void;
  /** Disables the lock button (e.g. while the engine is pinning). */
  lockBusy?: boolean;
  assumptions: AssumptionList;
  /** Ids from `assumptions.items` the user confirmed. */
  confirmed: ReadonlySet<string>;
  onConfirm: (id: string) => void;
  checked: string[];
  /** Items of `checked` that take the amber glyph instead of the green disc (the stress test, when it missed or did not finish). */
  checkedAsk?: readonly string[];
  notChecked: string[];
  /** Said next to the lock button when it is locked and the lock came with the demo file (model/agreement.ts SEEDED_LOCK_NOTE: 'This lock comes with the demo file.'). */
  lockNote?: string;
  /**
   * Said right under the caption when "Version N" is not the first thing the viewer made (the demo file's set-up saves came
   * first; model/answer.ts versionNote). Omitted: nothing is added.
   */
  versionNote?: string;
  /**
   * The card's one filled control: the hand-off (start/RunPanel.tsx), first in the action row. When it is given the card takes
   * `fd-ac--handoff`, which makes the lock button a quiet ring, and the verdict line names the hand-off as the next step. Without
   * it (the landing's illustration, or a start card whose hand-off is not on offer: no eject module, or an answer it cannot eject)
   * the lock stays the card's one filled control and no next step is named.
   */
  primaryAction?: ComponentChildren;
  /** Landing only: the 'See the calculation' toggle and the code it reveals. */
  calc?: { open: boolean; onToggle: () => void; source: ComponentChildren };
  /** Start page: where 'Add a house rule' goes. */
  houseRuleHref?: string;
}

/**
 * What "Confirm" really does, said once under "What the AI assumed": it marks the line as read by you, in this page's own
 * state (start/RunPanel.tsx keeps it per run; the landing's card keeps its own). Nothing reaches the engine, the checks or the
 * download, so nothing is claimed beyond that.
 */
export const CONFIRM_NOTE = 'Confirming only marks a line on this page; nothing is saved, sent or checked.';

/** The demo (replay mode) cannot write a new version, so a lock is saved with the answer but never re-run here. */
export const LOCK_HELP_REPLAY =
  "You checked it. Locking saves it with the answer. This demo can't re-run with it, so asking again shows this same answer; on your computer the next version is checked against it.";

export function lockHelpText(p: { locked: boolean; variant: 'landing' | 'start'; level: 'full' | 'basic'; view: AnswerView | null; mode?: CheckMode }): string {
  if (!p.locked) return p.mode === 'replay' ? LOCK_HELP_REPLAY : 'You checked it; we hold every later version to it.';
  if (p.variant === 'landing') return `Every later version has to give ${lockedRowsPhrase(p.view)}. Unlock any time.`;
  const noun = p.view?.kind === 'ranked' ? 'list' : 'answer';
  // a mode that is known (the start and step-by-step pages) speaks for itself: the demo cannot write a later version
  const own = p.mode ? lockedHelp({ locked: true, level: p.level, mode: p.mode, noun }) : '';
  if (own) return own;
  if (p.level === 'basic') return 'Locked. The next version runs full checks, starting with this answer.';
  // live, or no mode given: the engine does hold every later version to the lock
  return `Every later version has to give this same ${noun}.`;
}

/** SVG path of arc `i` of `total` in a ring of radius `r` around (c, c): clockwise from 12 o'clock, `gap` degrees apart. */
export function ringArc(i: number, total: number, r: number, c: number, gap = 16): string {
  const span = 360 / total;
  const at = (deg: number): string => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  };
  return `M ${at(i * span + gap / 2)} A ${r} ${r} 0 0 1 ${at((i + 1) * span - gap / 2)}`;
}

/**
 * The basic-pass seal: a ring of `total` arcs of which the first `ran` are drawn solid and the rest left as an empty
 * track, in ink (not green): it reads as "this much of the work was checked", where the green disc says "all of it".
 * Decoration only; the words beside it carry the meaning.
 */
function CoverageRing({ ran, total, size = 16 }: { ran: number; total: number; size?: number }) {
  const arcs = [];
  for (let i = 0; i < total; i++) arcs.push(<path key={i} d={ringArc(i, total, 6.5, 8)} class={`fd-ac__ring-arc ${i < ran ? 'fd-ac__ring-arc--ran' : 'fd-ac__ring-arc--rest'}`} />);
  return (
    <svg aria-hidden="true" class="fd-ac__ring" width={size} height={size} viewBox="0 0 16 16">
      {arcs}
    </svg>
  );
}

const vars = (o: Record<string, string>): string => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');

export function AnswerCard(props: AnswerCardProps) {
  const variant = props.variant ?? 'start';
  const view = props.view;
  const held = props.held || view === null;
  const animate = !held && !!props.reveal;
  const delay = props.reveal?.delay ?? 0;
  const caption = props.heldCaption ?? HELD_CAPTION_START;
  // the quiet lock follows the hand-off being IN the card, not the variant: a start card without one keeps a filled lock
  const cls = ['fd-ac', `fd-ac--${variant}`, held ? 'fd-ac--held' : 'fd-ac--shown', animate ? 'fd-ac--reveal' : '', view ? '' : 'fd-ac--empty', props.primaryAction ? 'fd-ac--handoff' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      key={animate ? `r${props.reveal!.run}` : 'static'}
      class={cls}
      style={vars({ '--fd-trev': `${delay}s` })}
      aria-busy={held}
      aria-label={held || !view ? HELD_LABEL : `Answer: ${view.title}`}
    >
      <span aria-hidden="true" class="fd-ac__seal" />
      {view && <Body {...props} view={view} variant={variant} held={held} />}
      <div aria-hidden="true" class="fd-ac__veil">
        <div class="fd-ac__veil-bars">
          {[1, 2, 3, 4, 5].map((v) => (
            <div key={v} class="fd-ac__veil-bar">
              <span />
              <span />
            </div>
          ))}
        </div>
        <div class="fd-ac__veil-caption">{caption}</div>
      </div>
    </div>
  );
}

function Body(props: AnswerCardProps & { view: AnswerView; variant: 'landing' | 'start'; held: boolean }) {
  const { view, variant, held, level, locked } = props;
  const lead = view.lead;
  const help = props.lockHelp || lockHelpText({ locked, variant, level, view, ...(props.mode ? { mode: props.mode } : {}) });
  // the green disc says every check that applies finished and passed; a partial ring says how much of it did
  const seal = props.seal ?? null;
  const whole = level === 'full' && (!seal || seal.complete);
  const sealText = level === 'full' ? (seal ? seal.text.toUpperCase() : LEVEL_FULL) : LEVEL_BASIC;
  // whether the number can be relied on, in plain words, right under the number: how the checks went, the one thing most
  // worth knowing was not checked, and (when the card offers it) the hand-off as the next step. Said once: the list far below
  // is the full ledger, not a second copy of this line
  const verdict = (
    <p class="fd-ac__verdict fd-ac__ri" style={vars({ '--fd-ri': '0.2s' })}>
      {verdictLine({
        level,
        stress: props.stress ?? null,
        ...(seal ? { ran: seal.ran, of: seal.of } : {}),
        notChecked: props.notChecked,
        handoff: !!props.primaryAction,
      })}
    </p>
  );
  return (
    <div class="fd-ac__body" inert={held} aria-hidden={held ? true : undefined}>
      <div class="fd-ac__fig">{view.fig}</div>
      {props.versionNote && <div class="fd-ac__version">{props.versionNote}</div>}
      <div class={`fd-ac__eyebrow${whole ? '' : ' fd-ac__eyebrow--basic'}`}>
        {whole ? <CheckDisc size={16} /> : <CoverageRing ran={seal && level === 'full' ? seal.ran : BASIC_CHECKS} total={seal && level === 'full' ? seal.of : TOTAL_CHECKS} />}
        {sealText}
      </div>
      {!lead && verdict}

      {lead && lead.name && <div class="fd-ac__lead-name fd-ac__ri" style={vars({ '--fd-ri': '0.1s' })}>{lead.name}</div>}
      {lead && (
        <div class={`fd-ac__lead-num fd-mono fd-ac__ri${lead.long ? ' fd-ac__lead-num--long' : ''}`} style={vars({ '--fd-ri': '0.16s' })}>
          {lead.num}
          {lead.unit && <span class="fd-ac__unit">{lead.unit}</span>}
        </div>
      )}
      {lead && variant === 'landing' && view.kind === 'ranked' && <div class="fd-ac__lead-bar" />}
      {lead && verdict}

      {view.kind === 'ranked' && view.rest.length > 0 && <Rest view={view} variant={variant} />}
      {view.kind === 'ranked' && view.rest.length === 0 && variant === 'start' && <ol aria-label="The rest of the list" class="fd-ac__rest" />}
      {view.fallbackNote && <p class="fd-ac__fallback-note fd-ac__ri" style={vars({ '--fd-ri': '0.1s' })}>{view.fallbackNote}</p>}
      {view.table && <FallbackTable table={view.table} />}
      {view.raw !== null && <pre class="fd-ac__raw fd-mono fd-ac__ri" style={vars({ '--fd-ri': '0.16s' })}>{view.raw}</pre>}

      <div class="fd-ac__assumed">
        <h3 class="fd-ac__h3">What the AI assumed</h3>
        {!props.assumptions.empty && <p class="fd-ac__assumed-note">{CONFIRM_NOTE}</p>}
        {props.assumptions.empty ? (
          <p class="fd-ac__no-notes">{props.assumptions.empty}</p>
        ) : (
          <ul class="fd-ac__assumed-list">
            {props.assumptions.items.map((a) => {
              const done = props.confirmed.has(a.id);
              return (
                <li key={a.id} class={`fd-ac__assumption${done ? ' fd-ac__assumption--done' : ''}`}>
                  <span class="fd-ac__assumption-text">{a.text}</span>
                  {done ? (
                    // tabIndex -1: the Confirm button is replaced by this, so focus moves here instead of <body>
                    <span class="fd-ac__confirmed" tabIndex={-1}>
                      <CheckDisc size={14} />
                      Confirmed by you
                    </span>
                  ) : (
                    <button type="button" class="fd-ac__confirm" aria-label={`Confirm this assumption: ${a.text}`} onClick={(e) => {
                        const li = e.currentTarget.closest('li');
                        props.onConfirm(a.id);
                        requestAnimationFrame(() => li?.querySelector<HTMLElement>('.fd-ac__confirmed')?.focus());
                      }}
                    >
                      Confirm
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div class="fd-ac__ledger">
        <div class="fd-ac__checked">
          <h3 class="fd-ac__h3">Checked against</h3>
          <ul class="fd-ac__ledger-list">
            {props.checked.map((t) => (
              <li key={t}>
                {props.checkedAsk?.includes(t) ? <AskDiamond size={16} solid class="fd-ac__ledger-glyph" /> : <CheckDisc size={16} class="fd-ac__ledger-glyph" />}
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div class="fd-ac__not-checked">
          <h3 class="fd-ac__h3">Not checked</h3>
          <ul class="fd-ac__ledger-list">
            {props.notChecked.map((t) => (
              <li key={t}>
                <NotChecked size={16} class="fd-ac__ledger-glyph" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p class="fd-ac__honest">
        Checked, not proven. Checks lower the chance of a wrong answer. They don't prove it's right, so we show you exactly what was checked.
      </p>

      <div class="fd-ac__actions">
        {props.primaryAction}
        {props.onToggleLock && (
          <button
            type="button"
            class={`fd-ac__lock${locked ? ' fd-ac__lock--on' : ''}`}
            onClick={props.onToggleLock}
            disabled={props.lockBusy}
          >
            {locked && <Lock size={16} color="currentColor" />}
            {locked ? 'Locked' : 'Does this look right? Lock this answer'}
          </button>
        )}
        {props.calc && (
          <button type="button" class="fd-ac__calc-toggle" aria-expanded={props.calc.open} onClick={props.calc.onToggle}>
            See the calculation
          </button>
        )}
        {props.houseRuleHref && (
          <a class="fd-ac__rule-link" href={props.houseRuleHref}>
            Add a house rule
          </a>
        )}
      </div>
      {props.onToggleLock && (
        <p class="fd-ac__lock-info">
          {locked && props.lockNote && <span class="fd-ac__lock-note">{props.lockNote}</span>}
          {locked && props.lockNote ? ' ' : ''}
          <span class="fd-ac__help">{help}</span>
        </p>
      )}
      {props.calc?.open && <pre class="fd-ac__calc fd-mono">{props.calc.source}</pre>}
    </div>
  );
}

function Rest({ view, variant }: { view: AnswerView; variant: 'landing' | 'start' }) {
  const more = view.hiddenRows > 0 && (
    <p class="fd-ac__more">
      + {view.hiddenRows} more {view.hiddenRows === 1 ? 'place' : 'places'} not shown here
    </p>
  );
  if (variant === 'landing') {
    const last = view.rest[view.rest.length - 1]!.rank.replace(/^0/, '');
    return (
      <>
        <table class="fd-ac__table">
          <caption class="fd-sr">{`Places 2 to ${last}`}</caption>
          <tbody>
            {view.rest.map((r, k) => (
              <tr key={r.rank} class="fd-ac__ri" style={vars({ '--fd-ri': `${(0.22 + 0.06 * k).toFixed(2)}s` })}>
                <td class="fd-ac__td-rank fd-mono">{r.rank}</td>
                <td class="fd-ac__td-name">{r.name}</td>
                <td class="fd-ac__td-bar">
                  <div class="fd-ac__track">
                    <div class="fd-ac__fill" style={{ width: `${r.pct}%` }} />
                  </div>
                </td>
                <td class="fd-ac__td-amt fd-mono">{r.amt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {more}
      </>
    );
  }
  return (
    <>
      <ol aria-label="The rest of the list" class="fd-ac__rest">
        {view.rest.map((r, k) => (
          <li key={r.rank} class="fd-ac__row fd-ac__ri" style={vars({ '--fd-ri': `${(0.22 + 0.06 * k).toFixed(2)}s` })}>
            <span class="fd-ac__rank fd-mono">{r.rank}</span>
            <span class="fd-ac__name">{r.name}</span>
            <span class="fd-ac__track fd-ac__track--row">
              <span class="fd-ac__fill" style={{ width: `${r.pct}%` }} />
            </span>
            <span class="fd-ac__amt fd-mono">{r.amt}</span>
          </li>
        ))}
      </ol>
      {more}
    </>
  );
}

function FallbackTable({ table }: { table: NonNullable<AnswerView['table']> }) {
  return (
    <div class="fd-ac__fallback fd-ac__ri" style={vars({ '--fd-ri': '0.16s' })}>
      <table class="fd-ac__fallback-table">
        <caption class="fd-sr">The answer, as returned</caption>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} class="fd-mono">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.total > table.rows.length && (
        <p class="fd-ac__more">
          First {table.rows.length} of {table.total.toLocaleString('en-US')} rows shown
        </p>
      )}
    </div>
  );
}
