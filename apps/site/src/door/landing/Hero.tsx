/** The landing hero (V3-Door-Landing 81-95): the claim, what it means, and the two ways in. */
import { LinkButton } from '../components/LinkButton';
import './Hero.css';

export function Hero() {
  return (
    <section aria-labelledby="hero-h" class="fd-hero">
      <div class="fd-wrap">
        <div class="fd-eyebrow">Answers from your spreadsheet exports · checked before you see them</div>
        <h1 id="hero-h" class="fd-hero__h">
          The AI writes it. <span class="fd-hero__accent">Your rules check it.</span> You see it only if it passes.
        </h1>
        <div class="fd-hero__row">
          <p class="fd-hero__p">
            Your examples, your locked answers and your house rules form one agreement. A calculation reaches you only when it passes all of them.
            If two rules can't both be true, or your rules don't cover a case, it stops and asks you. It never guesses.
          </p>
          <div class="fd-hero__ctas">
            <LinkButton href="#/start" variant="primary" icon="arrow">
              Try the demo
            </LinkButton>
            <LinkButton href="#own-file" variant="secondary">
              Run it on your own file
            </LinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}
