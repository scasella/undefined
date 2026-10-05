/** The first run's hero line (V3-Door-FirstRun 65-79): the claim, what it means, and "How it works" in three steps. */
import { INTRO_EYEBROW, introSteps } from './startView';
import './Intro.css';

const steps = introSteps();

export function Intro() {
  return (
    <section aria-labelledby="fr-h" class="fd-intro">
      <div class="fd-wrap fd-intro__row">
        <div class="fd-intro__copy">
          <div class="fd-eyebrow">{INTRO_EYEBROW}</div>
          <h1 id="fr-h" class="fd-intro__h">
            The AI writes it. <span class="fd-intro__accent">Your rules check it.</span> You see it only if it passes.
          </h1>
          <p class="fd-intro__p">
            Your examples, your locked answers and your house rules form one agreement. A calculation reaches you only when it passes all of them. If two rules
            can't both be true, or your rules don't cover a case, it stops and asks you. It never guesses.
          </p>
        </div>
        <ol aria-label="How it works" class="fd-intro__steps">
          {steps.map((s) => (
            <li key={s.n} class={'fd-intro__step' + (s.lit ? ' is-lit' : '')}>
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
