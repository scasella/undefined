/**
 * Landing · "Hand your data team a file they can rerun." + HONEST LIMITS + the closing call to action
 * (V3-Door-Landing, DATA TEAM FILE + LIMITS). The zip card lists what Eject really writes and the limits are the real
 * ones (./teamFileView.ts). The limits' middle line follows the engine's mode. `#own-file` (where the first run's
 * "How to run it on your computer" links land) is the limits card, which links to the README's setup steps: the
 * zip card above it is about handing a result to a team, not about running the app.
 * The closing card's "Try the demo" starts the step-by-step walk-through; its second button is about your own file and,
 * on the public demo, goes straight to the README's setup steps (ownFileCta).
 */
import { FileGlyph } from '../icons';
import { LinkButton } from '../components/LinkButton';
import { RUN_LOCALLY_URL } from '../components/DemoNote';
import { ROUTE_PATHS } from '../router';
import { engineRef } from '../state';
import { honestLimits, ownFileCta, TEAM_FILE_LEAD, teamFileView } from './teamFileView';
import './TeamFile.css';

export function TeamFile() {
  const mode = engineRef.value?.state.value.mode ?? 'replay';
  const zip = teamFileView();
  const limits = honestLimits(mode);
  const own = ownFileCta(mode, 'closing');

  return (
    <section aria-labelledby="file-h" class="fd-tf">
      <div class="fd-wrap fd-tf__grid">
        <div class="fd-card fd-tf__card">
          <h2 id="file-h" class="fd-tf__h">Hand your data team a file they can rerun.</h2>
          <p class="fd-tf__lead">{TEAM_FILE_LEAD}</p>
          <div class="fd-tf__zip">
            <div class="fd-tf__zip-head">
              <FileGlyph class="fd-tf__glyph" />
              <span class="fd-tf__zip-name">{zip.zipLine}</span>
            </div>
            <ul class="fd-tf__files">
              {zip.items.map((it) => (
                <li key={it.file}>
                  <span class="fd-tf__title">{it.title}</span>
                  <span class="fd-tf__file"> · {it.file}</span> · {it.desc}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div class="fd-tf__side">
          <div id="own-file" class="fd-tf__limits">
            <div class="fd-eyebrow">HONEST LIMITS</div>
            <ul class="fd-tf__limit-list">
              {limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <a class="fd-tf__run" href={RUN_LOCALLY_URL} target="_blank" rel="noopener">
              Setup steps for running it on your computer
              <span class="fd-sr"> (the README on GitHub, opens in a new tab)</span>
            </a>
          </div>
          <div class="fd-card fd-tf__card">
            <div class="fd-tf__claim">Every calculation is checked before you see it.</div>
            <div class="fd-tf__ctas">
              <LinkButton href={ROUTE_PATHS.zen} icon="arrow">
                Try the demo
              </LinkButton>
              {own.target === 'readme' ? (
                <LinkButton href={RUN_LOCALLY_URL} variant="secondary" class="fd-btn--wrap" target="_blank" rel="noopener">
                  {own.label}
                  <span class="fd-sr"> (the README on GitHub, opens in a new tab)</span>
                </LinkButton>
              ) : (
                <LinkButton href={ROUTE_PATHS.zen} variant="secondary" class="fd-btn--wrap">
                  {own.label}
                </LinkButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
