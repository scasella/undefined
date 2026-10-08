/**
 * The first run's right rail (V3-Door-FirstRun 327-385): "What the AI will see", "Your agreement" and the mode note.
 * Everything comes from the session (start/session.ts): `privacy`, `lastPrompt`, `agreement`, `seed`, `seedState`;
 * the example-rows switch is state.ts setSendRows (Engine.setSendSamples). Nothing here is scripted.
 *
 * - No file bound yet: `privacy` is null, so the first card is a calm placeholder in the same chrome (the switch still
 *   works: it is an engine preference, not a property of a file). The agreement card is already the design's
 *   "no agreement" state (session.agreement is emptyAgreement() until a question exists).
 * - "This agreement comes with the demo file." (model/agreement.ts SEEDED_NOTE) shows only while the agreement IS the installed
 *   demo seed (seedShown): installed, and still the same counts and locked answers (a ruling or an unlock makes it the user's).
 */
import type { Engine, FunctionSpec, Program } from '@scasella/undefined-engine/types';
import { AgreementRail } from '../components/AgreementRail';
import { DemoNote } from '../components/DemoNote';
import { PrivacyRail } from '../components/PrivacyRail';
import { Switch } from '../components/Switch';
import { heldNote, isHeldBack, type AgreementView } from '../model/agreement';
import type { AgreementSummary } from '../model/agreements';
import { FOOTER_REST, OFF_TEXT, REPLAY_ROWS_NOTE } from '../model/privacy';
import { setSendRows } from '../state';
import { agreementFor } from './derive';
import { sessionFor, type Session } from './session';
import './RightRail.css';

export interface RightRailProps {
  engine: Engine;
  /** Defaults to sessionFor(engine). The rail never disposes it (the page owns the session). */
  session?: Session;
}

export function RightRail({ engine, session }: RightRailProps) {
  const s = session ?? sessionFor(engine);
  const st = engine.state.value;
  const privacy = s.privacy.value;
  const view = s.agreement.value;
  const seed = s.seed.value;
  const shown = seedShown({ view, seed: seed?.spec ?? null, seedState: s.seedState.value, program: st.program });
  const agreement = shown && seed ? seedDressed(view, seed.summary) : view.seeded ? { ...view, seeded: false } : view;
  // what will really run (levelFor) against what is set: the same sentence the ask line and the check trace stand on
  const held = isHeldBack(s.question.value?.level ?? 'basic', agreement);

  return (
    <aside class="fd-rrail" aria-label="What the AI will see and your agreement">
      {privacy ? (
        <PrivacyRail view={privacy} onToggleRows={setSendRows} lastPrompt={s.lastPrompt.value} />
      ) : (
        <PrivacyPlaceholder rowsOn={st.send.samples} sampleRows={st.send.sampleRows} replay={st.mode === 'replay'} />
      )}
      <AgreementRail variant="start" view={agreement} {...(held ? { note: heldNote(st.mode) } : {})} />
      <DemoNote mode={st.mode} />
    </aside>
  );
}

export interface SeedShownInput {
  /** session.agreement */
  view: AgreementView;
  /** session.seed?.spec (null: no seed for this question, or seeding is off) */
  seed: FunctionSpec | null;
  /** session.seedState */
  seedState: 'none' | 'installing' | 'installed' | 'failed';
  /** engine state.program */
  program: Program;
}

const pinIds = (spec: FunctionSpec | undefined): string => (spec?.pins ?? []).map((p) => p.id).sort().join('\n');

/**
 * Pure: is the agreement on screen the demo's seeded one, installed in the program and untouched since? Not while it
 * is only a preview (installing / failed), and not once a ruling, a new lock or an unlock changed it.
 */
export function seedShown({ view, seed, seedState, program }: SeedShownInput): boolean {
  if (!view.seeded || view.empty || !seed || seedState !== 'installed') return false;
  const rec = program.functions[seed.name];
  if (!rec) return false;
  if (pinIds(rec.spec) !== pinIds(seed)) return false;
  // the seed's own agreement, as the rail would draw it before it was installed
  const { [seed.name]: _drop, ...rest } = program.functions;
  const pristine = agreementFor({ ...program, functions: rest }, seed.name, seed, true);
  return pristine.counts === view.counts;
}

/**
 * Pure: the installed seed's chips in the design's words (V3-Door-FirstRun agreeChips): the locked answer as
 * `Chef Ravioli Starbright = $2,252.07` (the pin's real meta kept), each house rule with its saved reason. Only call it
 * when seedShown() is true, i.e. the agreement on screen IS the seed this summary describes.
 */
export function seedDressed(view: AgreementView, summary: AgreementSummary): AgreementView {
  const locked = summary.locked[0];
  const locks =
    locked && view.locks.length === 1
      ? view.locks.map((c) => ({ ...c, t: locked.name, label: locked.customer, value: locked.amount }))
      : view.locks;
  const rules = view.rules.map((c) => {
    const h = summary.houseRules.find((r) => r.name === c.t);
    return h ? { ...c, p: h.note } : c;
  });
  return { ...view, seeded: true, locks, rules };
}

/** "What the AI will see" before any file is bound: the same card, saying what will be listed once there is one. */
function PrivacyPlaceholder({ rowsOn, sampleRows, replay }: { rowsOn: boolean; sampleRows: number; replay: boolean }) {
  const rows = `${sampleRows} example row${sampleRows === 1 ? '' : 's'}`;
  return (
    <div class="fd-priv fd-card">
      <div class="fd-label-line">What the AI will see</div>
      <ol class="fd-priv__list">
        <li>
          <span class="fd-priv__k">Your question</span>
          <span class="fd-priv__v fd-rrail__none">Not asked yet.</span>
        </li>
        <li>
          <span class="fd-priv__k">Column names and types</span>
          <span class="fd-priv__v fd-rrail__none">Bring a file or pick a sample to see them here.</span>
        </li>
        <li>
          <span class="fd-priv__row">
            <span class={'fd-priv__k' + (rowsOn ? '' : ' is-off')}>{rows}</span>
            <span class="fd-priv__switch">
              {rowsOn ? 'On' : 'Off'}
              <Switch checked={rowsOn} onChange={setSendRows} label={`Send ${rows} to the AI`} />
            </span>
          </span>
          {rowsOn && <span class="fd-priv__note">{rows} picked evenly from your file (first to last), shown here once you bring one.</span>}
          {rowsOn && replay && <span class="fd-priv__note">{REPLAY_ROWS_NOTE}</span>}
          {!rowsOn && <span class="fd-priv__off">{OFF_TEXT}</span>}
        </li>
      </ol>
      <div class="fd-priv__foot">
        Nothing from a file has been sent: there is no file yet. {FOOTER_REST}
      </div>
    </div>
  );
}
