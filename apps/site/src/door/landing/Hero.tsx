/**
 * The landing hero (V3-Door-Landing 81-95): the claim, what it means, and the two ways in. "Try the demo" starts the
 * step-by-step walk-through. The second button is about your own file, and the public demo cannot answer questions about
 * one (recorded answers only), so there it says that and leads to how to run it on your computer (`#own-file`, the
 * limits card, which links to the README's setup steps); on a copy that already runs live it starts the walk-through.
 */
import { LinkButton } from '../components/LinkButton';
import { ROUTE_PATHS } from '../router';
import { engineRef } from '../state';
import { ownFileCta } from './teamFileView';
import './Hero.css';

export function Hero() {
  const own = ownFileCta(engineRef.value?.state.value.mode ?? 'replay', 'hero');
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
            <LinkButton href={ROUTE_PATHS.zen} variant="primary" icon="arrow">
              Try the demo
            </LinkButton>
            <LinkButton href={own.target === 'zen' ? ROUTE_PATHS.zen : '#own-file'} variant="secondary" class="fd-btn--wrap">
              {own.label}
            </LinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}
