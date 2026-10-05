/**
 * Landing · "Hand your data team a file they can rerun." + HONEST LIMITS + the closing call to action
 * (V3-Door-Landing, DATA TEAM FILE + LIMITS, id="own-file"). The zip card lists what Eject really writes and the
 * limits are the real ones (./teamFileView.ts). The limits' middle line follows the engine's mode.
 */
import { FileGlyph } from '../icons';
import { LinkButton } from '../components/LinkButton';
import { ROUTE_PATHS } from '../router';
import { engineRef } from '../state';
import { honestLimits, TEAM_FILE_LEAD, teamFileView } from './teamFileView';
import './TeamFile.css';

export function TeamFile() {
  const mode = engineRef.value?.state.value.mode ?? 'replay';
  const zip = teamFileView();
  const limits = honestLimits(mode);

  return (
    <section id="own-file" aria-labelledby="file-h" class="fd-tf">
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
          <div class="fd-tf__limits">
            <div class="fd-eyebrow">HONEST LIMITS</div>
            <ul class="fd-tf__limit-list">
              {limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
          <div class="fd-card fd-tf__card">
            <div class="fd-tf__claim">Every calculation is checked before you see it.</div>
            <div class="fd-tf__ctas">
              <LinkButton href={ROUTE_PATHS.start} icon="arrow">
                Try the demo
              </LinkButton>
              <LinkButton href={ROUTE_PATHS.start} variant="secondary">
                Run it on your own file
              </LinkButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
