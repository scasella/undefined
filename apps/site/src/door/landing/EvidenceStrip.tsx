/**
 * Landing · evidence strip (V3-Door-Landing 386-453): four tiles under the example answer, the "Why" behind the thrown-out
 * draft, and the expandable stress-test strip. Every tile reports the outcome of a run that was not recorded, so each
 * carries the ILLUSTRATIVE badge (./evidenceView.ts says which parts are computed); the thrown-out draft's figures in
 * the "Why" are computed from the real orders by model/figures.ts.
 */
import { useRef, useState } from 'preact/hooks';
import { bundledOrders } from '../../data/orders';
import { AskDiamond, CheckDisc, ThrownOut } from '../icons';
import { MADE_UP_TABLES } from '../model/agreements';
import { DEFAULT_MADE_UP_TABLE, ILLUSTRATIVE_BREAKS, madeUpTableLabel, madeUpTableNote, thrownOutDraft } from '../model/figures';
import { exampleCount } from './teamFileView';
import { dotGridKey } from './dotGrid';
import { EVIDENCE_FOOT, evidenceTiles, ILLUSTRATIVE, type EvidenceTile } from './evidenceView';
import './EvidenceStrip.css';

const DRAFT = thrownOutDraft(bundledOrders());
const MISSED = ILLUSTRATIVE_BREAKS.length - 1;
const TILES = evidenceTiles();
const tile = (id: EvidenceTile['id']): EvidenceTile => TILES.find((t) => t.id === id)!;

/** A tile's headline figure, its plain line and (for a figure from an unrecorded run) the badge, always in that order. */
function Head({ t }: { t: EvidenceTile }) {
  return (
    <>
      <div class="fd-ev-big fd-mono">{t.big}</div>
      <div class="fd-ev-sub">{t.sub}</div>
      {t.illustrative && <span class="fd-ev-badge">{ILLUSTRATIVE}</span>}
    </>
  );
}

function Dots() {
  const [dot, setDot] = useState(DEFAULT_MADE_UP_TABLE);
  const grid = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const next = dotGridKey(dot, e.key, MADE_UP_TABLES);
    if (next === null) return;
    e.preventDefault();
    setDot(next);
    (grid.current?.children[next] as HTMLButtonElement | undefined)?.focus();
  };
  return (
    <>
      <div
        ref={grid}
        role="group"
        aria-label={`${MADE_UP_TABLES} of ${MADE_UP_TABLES} made-up tables held up. Pick one to see it.`}
        class="fd-ev-dots"
        onKeyDown={onKey}
      >
        {Array.from({ length: MADE_UP_TABLES }, (_, i) => (
          <button
            type="button"
            key={i}
            aria-label={madeUpTableLabel(i)}
            aria-pressed={i === dot ? 'true' : 'false'}
            tabIndex={i === dot ? 0 : -1}
            class={'fd-ev-dot' + (i === dot ? ' is-on' : '')}
            onClick={() => setDot(i)}
          >
            <span />
          </button>
        ))}
      </div>
      <div class="fd-ev-note" aria-live="polite">
        <span class="fd-ev-note__tag">MADE-UP · </span>
        {madeUpTableNote(dot)}
      </div>
    </>
  );
}

function StressStrip() {
  const [added, setAdded] = useState(false);
  return (
    <div class="fd-ev-stress">
      <span class="fd-ev-badge fd-ev-stress__badge">{ILLUSTRATIVE}</span>
      <h3 class="fd-ev-stress__h">
        We broke this calculation {ILLUSTRATIVE_BREAKS.length} small ways on purpose. Your checks caught {MISSED}.
      </h3>
      <div class="fd-ev-breaks">
        {ILLUSTRATIVE_BREAKS.map((name, i) => {
          const missed = i === MISSED;
          return (
            <div key={name} class={'fd-ev-break' + (missed ? ' is-missed' : '')} style={{ animationDelay: `${0.07 * i}s` }}>
              <span class="fd-ev-break__n">{(i < 9 ? '0' : '') + (i + 1)}</span>
              {missed ? <AskDiamond solid size={14} /> : <CheckDisc size={14} />}
              <span class="fd-ev-break__name">{name}</span>
              <span class="fd-ev-break__word">{missed ? 'Missed' : 'Caught'}</span>
            </div>
          );
        })}
      </div>
      <div class="fd-ev-missed">
        <p>
          <span class="fd-ev-missed__lead">The one they missed:</span> a version that forgot the discount on single-item orders
          would still pass. Add an example with a discounted single order and we'll catch it.
        </p>
        <button type="button" class={'fd-ev-add' + (added ? ' is-added' : '')} onClick={() => setAdded(!added)}>
          {added ? 'Added · re-checking' : 'Add that example'}
        </button>
      </div>
    </div>
  );
}

export function EvidenceStrip() {
  const [stress, setStress] = useState(false);
  const [why, setWhy] = useState(false);
  return (
    <section aria-labelledby="ev-h" class="fd-ev">
      <div class="fd-wrap">
        <h2 id="ev-h" class="fd-sr">The evidence behind this answer</h2>
        <div class="fd-ev-grid">
          <div class="fd-ev-tile">
            <Head t={tile('examples')} />
            <div aria-hidden="true" class="fd-ev-ticks">
              {Array.from({ length: exampleCount() }, (_, i) => <span key={i} />)}
            </div>
          </div>
          <div class="fd-ev-tile">
            <Head t={tile('tables')} />
            <Dots />
          </div>
          <div class="fd-ev-tile">
            <Head t={tile('breaks')} />
            <div aria-hidden="true" class="fd-ev-ticks fd-ev-ticks--stress">
              {ILLUSTRATIVE_BREAKS.map((_, i) => (i === MISSED ? <span key={i} class="is-missed">?</span> : <span key={i} />))}
            </div>
            <button type="button" class="fd-ev-link fd-ev-link--block" aria-expanded={stress ? 'true' : 'false'} onClick={() => setStress(!stress)}>
              {stress ? `Hide the ${ILLUSTRATIVE_BREAKS.length} breaks` : `See all ${ILLUSTRATIVE_BREAKS.length} and the one they missed`}
            </button>
          </div>
          <div class="fd-ev-tile">
            <Head t={tile('thrown')} />
            <div class="fd-ev-thrown">
              <ThrownOut tone="light" />
              <span class="fd-ev-thrown__word">Thrown out</span>
              <button type="button" class="fd-ev-link" aria-expanded={why ? 'true' : 'false'} onClick={() => setWhy(!why)}>
                Why
              </button>
            </div>
            {why && DRAFT && <p class="fd-ev-why">{DRAFT.why}</p>}
          </div>
        </div>
        <p class="fd-ev-foot">{EVIDENCE_FOOT}</p>
        {stress && <StressStrip />}
      </div>
    </section>
  );
}
