/**
 * Landing · evidence strip (V3-Door-Landing 386-453): four tiles under the example answer, the "Why" behind the thrown-out
 * draft, and the expandable stress-test strip. Every tile reports the outcome of a run that was not recorded, so each
 * is covered by the section's ONE label (./evidenceView.ts `evidenceLabel`, which also says which parts are computed); the
 * thrown-out draft's figures in the "Why" are computed from the real orders by model/figures.ts. The one thing that IS recorded,
 * the stress test's result on the demo's own run (8 of 12), sits inside the stress-test tile beside the illustrated 11 of 12, marked
 * "Recorded run" and linked to Step by step (`RecordedRun`).
 */
import { useRef, useState } from 'preact/hooks';
import { bundledOrders } from '../../data/orders';
import { AskDiamond, CheckDisc, ThrownOut } from '../icons';
import { MADE_UP_TABLES } from '../model/agreements';
import { deliberateBreaks } from '../model/lanes';
import { DEFAULT_MADE_UP_TABLE, ILLUSTRATIVE_BREAKS, madeUpTableLabel, madeUpTableNote, thrownOutDraft } from '../model/figures';
import { exampleCount } from './teamFileView';
import { dotGridKey } from './dotGrid';
import { EVIDENCE_FOOT, evidenceLabel, evidenceTiles, recordedRun, type EvidenceTile } from './evidenceView';
import './EvidenceStrip.css';

const DRAFT = thrownOutDraft(bundledOrders());
const MISSED = ILLUSTRATIVE_BREAKS.length - 1;
const TILES = evidenceTiles();
const LABEL = evidenceLabel(TILES);
const tile = (id: EvidenceTile['id']): EvidenceTile => TILES.find((t) => t.id === id)!;

/** A tile's headline figure and its plain line (the section's label, above the tiles, says the figures are illustrative). */
function Head({ t }: { t: EvidenceTile }) {
  return (
    <>
      <div class="fd-ev-big fd-mono">{t.big}</div>
      <div class="fd-ev-sub">{t.sub}</div>
    </>
  );
}

/**
 * The one recorded run's stress-test result, under the illustrated one it sits beside (the tiles stack at phone width, so it lives
 * inside the tile, not under all four). It is established, not illustrative: a plain solid divider, no dashed label, and the link
 * goes to the real thing. Its words and numbers are evidenceView.ts `recordedRun` (the pinned constant, replayed through the real engine).
 */
function RecordedRun() {
  const r = recordedRun();
  return (
    <div class="fd-ev-rec">
      <p class="fd-ev-rec__result">
        <strong>{r.label}</strong> {r.result}
      </p>
      <p class="fd-ev-rec__what">{r.what}</p>
      <a class="fd-ev-rec__link" href={r.link.href}>
        {r.link.label}
      </a>
    </div>
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

/**
 * The strip opens a screen or more below the section's one label on a phone (four tiles stack between them), and it states a result
 * as fact, so its own heading says "illustration" in a sentence (not a second badge): the label still appears once per section.
 */
function StressStrip() {
  const [added, setAdded] = useState(false);
  return (
    <div class="fd-ev-stress">
      <h3 class="fd-ev-stress__h">
        In this illustration, the stress test made {ILLUSTRATIVE_BREAKS.length} deliberate breaks in the calculation. Your checks caught {MISSED}.
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

/** The missed break's "?" in the stress strip, drawn (8px) rather than set in type, so the strip has no 8px text. */
const QUESTION_MARK = (
  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
    <path d="M2.2 2.6a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.8.7-.8 1.3" />
    <path d="M4 7.1v.01" />
  </svg>
);

export function EvidenceStrip() {
  const [stress, setStress] = useState(false);
  const [why, setWhy] = useState(false);
  return (
    <section aria-labelledby="ev-h" class="fd-ev">
      <div class="fd-wrap">
        <h2 id="ev-h" class="fd-sr">The evidence behind this answer</h2>
        {LABEL && <p class="fd-ev-badge fd-ev-label">{LABEL}</p>}
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
              {ILLUSTRATIVE_BREAKS.map((_, i) => (i === MISSED ? <span key={i} class="is-missed">{QUESTION_MARK}</span> : <span key={i} />))}
            </div>
            <button type="button" class="fd-ev-link fd-ev-link--block" aria-expanded={stress ? 'true' : 'false'} onClick={() => setStress(!stress)}>
              {stress ? `Hide the ${deliberateBreaks(ILLUSTRATIVE_BREAKS.length)}` : `See all ${deliberateBreaks(ILLUSTRATIVE_BREAKS.length)} and the one they missed`}
            </button>
            <RecordedRun />
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
