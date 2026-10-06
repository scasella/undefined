/**
 * The landing stage (V3-Door-Landing 97-384): the question, the scripted check trace, the answer held then revealed,
 * and the agreement rail. Two scenarios ('pass', 'stop'); every change of scenario or "Run again" bumps `run`, which
 * restarts the playback (CheckTrace alternates its keyframe names, the answer card and the mini question remount).
 *
 * An illustration (docs/FRONT-DOOR.md, honesty rule 2): it plays a slowed-down example and says so under the trace.
 * Figures come from stageData.ts (computed from the bundled orders). While it plays, the shell's demo pill pulses.
 */
import { useEffect, useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { AgreementRail } from '../components/AgreementRail';
import { AnswerCard, HELD_CAPTION_LANDING, HELD_CAPTION_WAITING } from '../components/AnswerCard';
import { CheckTrace } from '../components/CheckTrace';
import { Segmented } from '../components/Segmented';
import { AskDiamond, Replay } from '../icons';
import type { AgreementHighlight } from '../model/agreement';
import type { ScenarioId } from '../model/traceScript';
import { shellRunning } from '../state';
import {
  CALC_SOURCE,
  ILLUSTRATION_CAPTION,
  landingStage,
  MINI_QUESTION,
  settleSeconds,
  STAGE_ASSUMPTIONS,
  STAGE_NOT_CHECKED,
  STAGE_QUESTION,
} from './stageData';
import './Stage.css';

const WATCH: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'pass', label: 'Watch it pass' },
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
    return () => {
      clearTimeout(t);
      shellRunning.value = false;
    };
  }, [scen, run]);

  const watch = (id: ScenarioId) => {
    setScen(id);
    setRun((r) => r + 1);
  };

  return (
    <section aria-labelledby="stage-h" class="fd-stage">
      <div class="fd-wrap fd-stage__wrap">
        {/* the answer card's and the agreement's h3s sit under this h2, not directly under the page's h1 */}
        <h2 id="stage-h" class="fd-sr">
          Live example: top customers by revenue
        </h2>
        <div class="fd-stage__main">
          <div class="fd-card fd-stage__ask">
            <div class="fd-stage__asked">
              <div class="fd-eyebrow">You asked</div>
              <div class="fd-stage__question">{STAGE_QUESTION}</div>
            </div>
            <div class="fd-stage__controls">
              <Segmented kind="toggle" label="Choose what to watch" items={WATCH} value={scen} onChange={watch} class="fd-stage__seg" />
              <button type="button" class="fd-btn fd-btn--secondary fd-stage__replay" onClick={() => setRun((r) => r + 1)}>
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
            held={stop}
            heldCaption={stop ? HELD_CAPTION_WAITING : HELD_CAPTION_LANDING}
            reveal={{ delay: scenario.tRev, run }}
            level="full"
            locked={locked}
            onToggleLock={() => setLocked(!locked)}
            assumptions={STAGE_ASSUMPTIONS}
            confirmed={confirmed}
            onConfirm={(id) => setConfirmed(new Set([...confirmed, id]))}
            checked={data.checked}
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
