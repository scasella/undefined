/**
 * The first run's top (V3-Door-FirstRun 65-79), cut down to the task: an h1 in plain words and the three "How it works"
 * steps in one row. The landing's marketing claim and its paragraph are not repeated here: this page is for doing, and
 * "Ask a question" is meant to be on screen without scrolling.
 */
import { INTRO_EYEBROW, INTRO_TITLE, introSteps } from './startView';
import './Intro.css';

const steps = introSteps();

export function Intro() {
  return (
    <section aria-labelledby="fr-h" class="fd-intro">
      <div class="fd-wrap">
        <div class="fd-eyebrow">{INTRO_EYEBROW}</div>
        <h1 id="fr-h" class="fd-intro__h">
          {INTRO_TITLE}
        </h1>
        <ol aria-label="How it works" class="fd-intro__steps">
          {steps.map((s) => (
            <li key={s.n} class="fd-intro__step">
              <span class="fd-intro__num fd-mono" aria-hidden="true">
                {s.n}
              </span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
