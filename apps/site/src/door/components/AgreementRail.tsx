/**
 * "Your agreement": the examples, locked answers and house rules every future version has to pass.
 *
 * - variant 'landing' (V3-Door-Landing 326-382): the interactive rail. Each chip is a toggle (aria-pressed) that
 *   reports which check-trace lane holds it ('ex' | 'lock' | 'rules') through `onPick`; the parent owns `highlight`
 *   because the trace outlines the matching lane. `children` is the slot above the card (the "A QUESTION ONLY YOU CAN
 *   ANSWER" mini card).
 * - variant 'start' (V3-Door-FirstRun 356-378): the compact card on the first-run page, read from the real program.
 *
 * Views come from model/agreement.ts; this component holds only "show all" and "confirmed" UI state.
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Lock } from '../icons';
import { compactChips, type AgreementChip, type AgreementHighlight, type AgreementView } from '../model/agreement';
import './AgreementRail.css';

const FOOTER = "Every future version has to pass all of these. If two can't both be true, or they don't cover a case, it stops and asks you.";

export interface AgreementRailLandingProps {
  variant: 'landing';
  view: AgreementView;
  /** The lane currently outlined in the check trace ('' = none). */
  highlight: AgreementHighlight | '';
  /** Called with the chip's lane; the parent toggles (same id again clears it, as in the design). */
  onPick: (id: AgreementHighlight) => void;
  /** Slot above the card: the stop-and-ask mini card. */
  children?: ComponentChildren;
  /** How many examples show before "Show all N examples" (design: 3). */
  collapsedCount?: number;
}

export interface AgreementRailStartProps {
  variant: 'start';
  view: AgreementView;
}

export type AgreementRailProps = AgreementRailLandingProps | AgreementRailStartProps;

export function AgreementRail(props: AgreementRailProps) {
  return props.variant === 'landing' ? <LandingRail {...props} /> : <StartCard view={props.view} />;
}

function ChipText({ chip }: { chip: AgreementChip }) {
  return (
    <>
      <span class="fd-agree__t">{chip.t}</span>
      <span class="fd-agree__p fd-mono">{chip.p}</span>
    </>
  );
}

function LandingRail({ view, highlight, onPick, children, collapsedCount = 3 }: AgreementRailLandingProps) {
  const [more, setMore] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const shown = more ? view.examples : view.examples.slice(0, collapsedCount);
  const chipClass = (id: AgreementHighlight) => 'fd-agree__chip' + (highlight === id ? ' is-on' : '');
  const pressed = (id: AgreementHighlight) => (highlight === id ? 'true' : 'false');

  return (
    <aside class="fd-agree-rail" aria-labelledby="rail-h">
      {children}
      <div class="fd-agree fd-card">
        <div id="rail-h" class="fd-eyebrow">YOUR AGREEMENT</div>
        <div class="fd-agree__counts fd-mono">{view.counts}</div>
        <p class="fd-agree__hint">Pick any line to see the check that holds it.</p>

        <h3 class="fd-agree__h fd-agree__h--first">Your examples</h3>
        <div class="fd-agree__list">
          {shown.map((e) => (
            <button key={e.id} type="button" aria-pressed={pressed('ex')} onClick={() => onPick('ex')} class={chipClass('ex')}>
              <ChipText chip={e} />
            </button>
          ))}
        </div>
        {view.examples.length > collapsedCount && (
          <button type="button" aria-expanded={more ? 'true' : 'false'} onClick={() => setMore(!more)} class="fd-agree__more">
            {more ? 'Show fewer' : `Show all ${view.examples.length} examples`}
          </button>
        )}

        <h3 class="fd-agree__h fd-agree__h--locks">Your locked answers</h3>
        <div class="fd-agree__list">
          {view.locks.map((l) => (
            <button key={l.id} type="button" aria-pressed={pressed('lock')} onClick={() => onPick('lock')} class={chipClass('lock')}>
              <span class="fd-agree__t fd-agree__t--lock">
                <Lock size={14} class="fd-agree__lock" />
                {l.label !== undefined && l.value !== undefined ? (
                  <span>
                    {l.label} = <span class="fd-mono">{l.value}</span>
                  </span>
                ) : (
                  <span>{l.t}</span>
                )}
              </span>
              <LockMeta p={l.p} />
            </button>
          ))}
        </div>

        <h3 class="fd-agree__h">Your house rules</h3>
        <div class="fd-agree__list">
          {view.rules.map((h) => (
            <button key={h.id} type="button" aria-pressed={pressed('rules')} onClick={() => onPick('rules')} class={chipClass('rules')}>
              <ChipText chip={h} />
            </button>
          ))}
        </div>
        {view.assumption && (
          <div class="fd-agree__assume">
            <span class="fd-agree__assume-body">
              <span class="fd-agree__assume-t">{view.assumption.t}</span>
              <span class="fd-agree__p fd-mono">{confirmed ? view.assumption.confirmedMeta : view.assumption.pendingMeta}</span>
            </span>
            {!confirmed && (
              <button type="button" class="fd-agree__confirm" onClick={() => setConfirmed(true)}>
                Confirm
              </button>
            )}
          </div>
        )}

        <div class="fd-agree__foot fd-agree__foot--landing">{FOOTER}</div>
      </div>
    </aside>
  );
}

/** `Locked · you · …` with "Locked" in indigo, as the design sets it. */
function LockMeta({ p }: { p: string }) {
  const head = 'Locked';
  return (
    <span class="fd-agree__p fd-mono">
      {p.startsWith(head) ? (
        <>
          <span class="fd-agree__locked">{head}</span>
          {p.slice(head.length)}
        </>
      ) : (
        p
      )}
    </span>
  );
}

function StartCard({ view }: { view: AgreementView }) {
  const chips = compactChips(view);
  return (
    <div class="fd-agree fd-card">
      <div class="fd-eyebrow">YOUR AGREEMENT</div>
      <div class="fd-agree__counts fd-agree__counts--start fd-mono">{view.counts}</div>
      {!view.empty && (
        <>
          {view.seeded && <p class="fd-agree__seeded">Saved with this demo file from an earlier session.</p>}
          <div class="fd-agree__list fd-agree__list--start">
            {chips.map((c) => (
              <div key={c.id} class="fd-agree__chip fd-agree__chip--static">
                <span class="fd-agree__t fd-agree__t--lock">
                  {c.lock && <Lock size={14} class="fd-agree__lock" />}
                  {c.t}
                </span>
                <span class="fd-agree__p fd-mono">{c.p}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {view.empty && (
        <div class="fd-agree__empty">
          <div class="fd-agree__empty-t">Agree on the rules once. Every version after that has to pass all of them.</div>
          <p class="fd-agree__empty-p">
            No examples, locked answers or house rules yet, so your first answer gets basic checks only. Lock an answer you know is right, or add a house rule, and all six checks switch on.
          </p>
        </div>
      )}
      <div class="fd-agree__foot">{FOOTER}</div>
    </div>
  );
}
