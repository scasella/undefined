/**
 * "What the AI will see" (V3-Door-FirstRun 328-354): the question, the columns and types, the example rows behind a
 * switch (wired by the caller to Engine.setSendSamples), what stays hidden, and a disclosure with the exact text.
 * After a run, pass `lastPrompt` (model/privacy.ts lastSentPrompt) and the disclosure shows the real prompt instead.
 */
import { useState } from 'preact/hooks';
import { REPLAY_PROMPT_NOTE, sentLabel, type PrivacyView } from '../model/privacy';
import { Switch } from './Switch';
import './PrivacyRail.css';

export interface PrivacyRailProps {
  view: PrivacyView;
  /** The switch: the caller calls engine.setSendSamples(next). */
  onToggleRows: (next: boolean) => void;
  /** The real prompt of the last candidate, once something ran (null/absent before). */
  lastPrompt?: string | null;
}

export function PrivacyRail({ view, onToggleRows, lastPrompt }: PrivacyRailProps) {
  const [open, setOpen] = useState(false);
  const afterRun = !!lastPrompt;
  const note = afterRun ? (view.sentNote ? REPLAY_PROMPT_NOTE : null) : view.sentNote;
  return (
    <div class="fd-priv fd-card">
      <div class="fd-eyebrow">WHAT THE AI WILL SEE</div>
      <ol class="fd-priv__list">
        <li>
          <span class="fd-priv__k">Your question</span>
          <span class="fd-priv__v">"{view.question}"</span>
        </li>
        <li>
          <span class="fd-priv__k">Column names and types</span>
          <span class="fd-priv__v fd-priv__cols fd-mono">{view.colsText}</span>
        </li>
        <li>
          <span class="fd-priv__row">
            <span class={'fd-priv__k' + (view.rowsOn ? '' : ' is-off')}>{view.rowsTitle}</span>
            <span class="fd-priv__switch">
              {view.rowsWord}
              <Switch checked={view.rowsOn} onChange={onToggleRows} label={view.switchLabel} />
            </span>
          </span>
          {view.rowsOn && view.exRows.length > 0 && (
            <span class="fd-priv__rows fd-mono">
              {view.exRows.map((r, i) => (
                <span key={i} class="fd-priv__ex">
                  {r}
                </span>
              ))}
            </span>
          )}
          {view.rowsOn && view.rowsNote && <span class="fd-priv__note">{view.rowsNote}</span>}
          {!view.rowsOn && <span class="fd-priv__off">{view.offText}</span>}
        </li>
      </ol>
      <div class="fd-priv__foot">
        {view.hiddenLine} {view.footerRest}
      </div>
      <button type="button" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen(!open)} class="fd-priv__disclose">
        {sentLabel(open, afterRun)}
      </button>
      {open && (
        <>
          {note && <p class="fd-priv__note fd-priv__note--sent">{note}</p>}
          <pre class="fd-priv__pre fd-mono" tabIndex={0}>{afterRun ? lastPrompt : view.sentText}</pre>
        </>
      )}
    </div>
  );
}
