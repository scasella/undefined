/**
 * The landing stage (V3-Door-Landing 97-384): the question, the scripted check trace, the answer held then revealed,
 * and the agreement rail. Two scenarios ('pass', 'stop'); every change of scenario or "Run again" bumps `run`, which
 * restarts the playback (CheckTrace alternates its keyframe names, the answer card and the mini question remount).
 *
 * An illustration (docs/FRONT-DOOR.md, honesty rule 2): it plays a slowed-down example and says so under the trace.
 * Figures come from stageData.ts (computed from the bundled orders). While it plays, the shell's demo pill pulses.
 *
 * The answer card is HELD (a compact skeleton: five bars and a caption, its body out of layout and out of the accessibility
 * tree) until the playback reaches its reveal, then released at its natural height with its row-by-row reveal. The release is a
 * state change made here, at `scenario.tRev`, not a CSS delay on an already tall card, so the held card does not reserve the
 * answer's height while the illustration plays. It restarts held whenever the playback does ("Run again", the other scenario).
 * Under reduced motion there is no playback to wait for: the pass scenario's card is released at once; the stop scenario's stays held.
 * The release moves everything under the card down once. A viewer whose window starts below the card's top is moved back by that distance
 * (stageData.ts keepsPlaceAtRelease, placeCorrection) so what they are reading does not jump; a viewer who can see the card's start watches it fill.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { AgreementRail } from '../components/AgreementRail';
import { AnswerCard, HELD_CAPTION_LANDING, HELD_CAPTION_WAITING } from '../components/AnswerCard';
import { CheckTrace } from '../components/CheckTrace';
import { Segmented } from '../components/Segmented';
import { AskDiamond, Replay } from '../icons';
import type { AgreementHighlight } from '../model/agreement';
import { SCRIPT_STRESS, type ScenarioId } from '../model/traceScript';
import { shellRunning } from '../state';
import {
  CALC_SOURCE,
  cardHeld,
  cardReleaseMs,
  ILLUSTRATION_CAPTION,
  keepsPlaceAtRelease,
  landingStage,
  MINI_QUESTION,
  placeCorrection,
  settleSeconds,
  STAGE_ASSUMPTIONS,
  STAGE_NOT_CHECKED,
  STAGE_QUESTION,
  STAGE_SEAL,
  WATCH_PASS_LABEL,
} from './stageData';
import './Stage.css';

const WATCH: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'pass', label: WATCH_PASS_LABEL },
  { id: 'stop', label: 'Watch it stop and ask' },
];

function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// `engine` is accepted for the landing's section contract; the stage is an illustration and reads no engine state.
export function Stage(_props: { engine?: Engine }) {
  const data = landingStage();
  const [scen, setScen] = useState<ScenarioId>('pass');
  const [run, setRun] = useState(0);
  const [hl, setHl] = useState<AgreementHighlight | ''>('');
  const [locked, setLocked] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(() => new Set());
  // the playback has reached the reveal and the card is released (under reduced motion: from the start, there is nothing to wait for)
  const [released, setReleased] = useState<boolean>(reducedMotion);
  const section = useRef<HTMLElement>(null);
  // where the page below the stage was just before the release, so the one jump the release makes is taken out when the viewer is past it
  const below = useRef<{ el: Element; top: number } | null>(null);

  const stop = scen === 'stop';
  const scenario = data.scenarios[scen];
  const view = data.views[scen];

  // the shell's "running" pulse: on while the playback runs, off once it is at rest (and when the page goes away)
  useEffect(() => {
    if (reducedMotion()) return;
    shellRunning.value = true;
    const t = setTimeout(() => {
      shellRunning.value = false;
    }, settleSeconds(scenario) * 1000);
    // the card's release: the playback has reached its reveal (the stop scenario never releases: it waits on the viewer)
    const at = cardReleaseMs(scenario);
    const rel =
      at === null
        ? null
        : setTimeout(() => {
            // The card grows from a skeleton to the whole answer, so everything under it moves down once. A viewer who has scrolled
            // past where the card begins (its top is above the top of the window: reading the evidence, or the agreement under the card on
            // a phone) must not see their line jump: note where the section under the stage is now, and put the scroll back by however far
            // it moved (the layout effect below). Everything under the card moves by the same distance, so one line stands for all of it.
            // A viewer who can see where the card begins is watching it, and sees it fill from there.
            const el = section.current;
            const card = el?.querySelector('.fd-ac') ?? null;
            const next = el?.nextElementSibling ?? null;
            below.current = card && next && keepsPlaceAtRelease(card.getBoundingClientRect().top) ? { el: next, top: next.getBoundingClientRect().top } : null;
            setReleased(true);
          }, at);
    return () => {
      clearTimeout(t);
      if (rel !== null) clearTimeout(rel);
      shellRunning.value = false;
    };
  }, [scen, run]);

  // after the release is drawn, before it is painted: cancel the section below's move (a no-op where the browser already did, as Chrome's scroll anchoring can)
  useLayoutEffect(() => {
    const was = below.current;
    below.current = null;
    if (!released || !was) return;
    const moved = placeCorrection(was.top, was.el.getBoundingClientRect().top);
    if (moved === 0) return;
    window.scrollBy({ top: moved, behavior: 'instant' }); // the page's `scroll-behavior: smooth` is for links, not for putting a line back where it was
  }, [released]);

  // every restart is held again in the same render (no frame of the full-height card): the playback is restarting, so the card goes back to its skeleton
  const restart = (id: ScenarioId) => {
    setScen(id);
    setRun((r) => r + 1);
    setReleased(reducedMotion());
  };

  return (
    <section ref={section} aria-labelledby="stage-h" class="fd-stage">
      <div class="fd-wrap fd-stage__wrap">
        {/* the answer card's and the agreement's h3s sit under this h2, not directly under the page's h1 */}
        <h2 id="stage-h" class="fd-sr">
          Example: top customers by revenue
        </h2>
        <div class="fd-stage__main">
          <div class="fd-card fd-stage__ask">
            <div class="fd-stage__asked">
              <div class="fd-eyebrow">You asked</div>
              <div class="fd-stage__question">{STAGE_QUESTION}</div>
            </div>
            <div class="fd-stage__controls">
              <Segmented kind="toggle" label="Choose what to watch" items={WATCH} value={scen} onChange={restart} class="fd-stage__seg" />
              <button type="button" class="fd-btn fd-btn--secondary fd-stage__replay" onClick={() => restart(scen)}>
                <Replay />
                Run again
              </button>
            </div>
          </div>

          <div class="fd-stage__trace">
            <CheckTrace
              lanes={view.lanes}
              ghost={view.ghost}
              header={view.header}
              footer={view.footer}
              liveText={view.liveText}
              draftLabel={view.draftLabel}
              listLabel="Checks on the draft you'll see"
              script={{ scenario, run }}
              highlight={hl || null}
            />
            <p class="fd-stage__caption fd-mono">{ILLUSTRATION_CAPTION}</p>
          </div>

          <AnswerCard
            variant="landing"
            view={data.answer}
            held={cardHeld(scenario, released)}
            heldCaption={stop ? HELD_CAPTION_WAITING : HELD_CAPTION_LANDING}
            reveal={{ delay: 0, run }}
            level="full"
            seal={STAGE_SEAL}
            stress={SCRIPT_STRESS}
            locked={locked}
            onToggleLock={() => setLocked(!locked)}
            assumptions={STAGE_ASSUMPTIONS}
            confirmed={confirmed}
            onConfirm={(id) => setConfirmed(new Set([...confirmed, id]))}
            checked={data.checked}
            checkedAsk={data.checkedAsk}
            notChecked={[...STAGE_NOT_CHECKED]}
            calc={{ open: calcOpen, onToggle: () => setCalcOpen(!calcOpen), source: CALC_SOURCE }}
          />
        </div>

        <AgreementRail variant="landing" view={data.agreement} highlight={hl} onPick={(id) => setHl(hl === id ? '' : id)}>
          {stop && (
            <div key={run} class="fd-stage__q" style={`--fd-qi-delay:${MINI_QUESTION.delay}s;--fd-qi-dur:${MINI_QUESTION.dur}s`}>
              <div class="fd-stage__q-eyebrow">
                <AskDiamond size={14} solid />
                {MINI_QUESTION.eyebrow}
              </div>
              <div class="fd-stage__q-head">{MINI_QUESTION.head}</div>
              <p class="fd-stage__q-body">{MINI_QUESTION.body}</p>
              <a href={MINI_QUESTION.href} class="fd-stage__q-cta">
                {MINI_QUESTION.cta}
              </a>
            </div>
          )}
        </AgreementRail>
      </div>
    </section>
  );
}
