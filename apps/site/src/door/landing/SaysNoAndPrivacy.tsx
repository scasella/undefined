/**
 * Landing · "It says no when it can't do it reliably." + "Your data stays in your browser." (V3-Door-Landing,
 * SAYS NO + DATA STAYS). The example-rows switch is the real setting (state.ts sendRows / setSendRows →
 * Engine.setSendSamples); it is the page's only example-rows switch (the top bar's mode note just reports it).
 * Copy and rows: ./saysNoView.ts.
 */
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { Switch } from '../components/Switch';
import { ROUTE_PATHS } from '../router';
import { sendRows, setSendRows } from '../state';
import { DECLINES, DEFAULT_DECLINE, declineById, privacyCardView, type DeclineId } from './saysNoView';
import './SaysNoAndPrivacy.css';

export function SaysNoAndPrivacy({ engine }: { engine: Engine }) {
  const [sel, setSel] = useState<DeclineId>(DEFAULT_DECLINE);
  const d = declineById(sel);
  const mode = engine.state.value.mode;
  const v = privacyCardView(sendRows.value, mode);

  return (
    <section aria-label="Limits and privacy" class="fd-sn">
      <div class="fd-wrap fd-sn__grid">
        <div class="fd-card fd-sn__card">
          <h2 class="fd-sn__h">It says no when it can't do it reliably.</h2>
          <p class="fd-sn__lead">
            Some asks have nothing a check could hold onto. Instead of a confident wrong number, you get the reason and what would help.
          </p>
          <div role="group" aria-label="Try a request" class="fd-sn__chips">
            {DECLINES.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === sel ? 'true' : 'false'}
                class={'fd-sn__chip' + (c.id === sel ? ' is-on' : '')}
                onClick={() => setSel(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div class="fd-sn__no">
            <div class="fd-sn__asked">YOU ASKED · {d.label}</div>
            <div class="fd-sn__no-h">I can't do that reliably.</div>
            <p class="fd-sn__no-p">
              <span class="fd-sn__b">Why: </span>
              {d.why}
            </p>
            <p class="fd-sn__no-p">
              <span class="fd-sn__b">What would help: </span>
              {d.help}
            </p>
            <p class="fd-mono fd-sn__saved">Nothing was saved.</p>
          </div>
        </div>

        <div class="fd-card fd-sn__card">
          <h2 class="fd-sn__h">Your data stays in your browser.</h2>
          <p class="fd-sn__lead">The checks run here, on your computer. When you ask a question, this is exactly what the AI sees:</p>
          <ol class="fd-sn__list">
            <li>
              <span class="fd-sn__num">1</span>
              <span>
                <span class="fd-sn__item">Your question</span>
                <span class="fd-sn__sub">"{v.question}"</span>
              </span>
            </li>
            <li>
              <span class="fd-sn__num">2</span>
              <span>
                <span class="fd-sn__item">Column names and types</span>
                <span class="fd-sn__cols">{v.columnsLine}</span>
              </span>
            </li>
            <li>
              <span class="fd-sn__num">3</span>
              <span class="fd-sn__grow">
                <span class="fd-sn__rowhead">
                  <span class={'fd-sn__item' + (v.rowsOn ? '' : ' is-off')}>{v.rowsTitle}</span>
                  <span class="fd-sn__toggle">
                    <Switch checked={v.rowsOn} onChange={setSendRows} label={v.switchLabel} />
                    {v.rowsWord}
                  </span>
                </span>
                {v.rowsOn ? (
                  // scrolls sideways when a row is long: focusable and named so it can be scrolled from the keyboard
                  <span class="fd-mono fd-sn__rows" role="group" aria-label={v.rowsTitle} tabIndex={0}>
                    {v.exampleRows.map((r, i) => (
                      <Fragment key={i}>
                        {i > 0 && <br />}
                        {r}
                      </Fragment>
                    ))}
                  </span>
                ) : (
                  <span class="fd-sn__off">{v.offText}</span>
                )}
              </span>
            </li>
          </ol>
          <p class="fd-sn__fine">
            {v.finePrint}
            {v.replayNote && ' ' + v.replayNote}
          </p>
          <a href={ROUTE_PATHS.start} class="fd-sn__link">
            See exactly what the AI was sent
          </a>
        </div>
      </div>
    </section>
  );
}
