/** Landing · order of work (V3-Door-Landing 455-483): the usual order vs. checking first. Static copy. */
import './OrderOfWork.css';

const Arrow = () => (
  <span aria-hidden="true" class="fd-ow-arrow">
    →
  </span>
);

export function OrderOfWork() {
  return (
    <section aria-labelledby="order-h" class="fd-ow">
      <div class="fd-wrap">
        <h2 id="order-h" class="fd-ow-h">
          Most AI assistants hand you a formula. The checking is up to you. <span class="fd-ow-h__accent">This checks first.</span>
        </h2>
        <div class="fd-ow-rows">
          <div class="fd-ow-row">
            <span class="fd-eyebrow fd-ow-label">THE USUAL ORDER</span>
            <span class="fd-ow-step">You ask</span>
            <Arrow />
            <span class="fd-ow-step">The AI writes a formula</span>
            <Arrow />
            <span class="fd-ow-step">You see a number</span>
            <Arrow />
            <span class="fd-ow-step fd-ow-step--dashed">You do the checking</span>
          </div>
          <div class="fd-ow-row">
            <span class="fd-eyebrow fd-ow-label fd-ow-label--here">HERE</span>
            <span class="fd-ow-step fd-ow-step--ask">You ask</span>
            <Arrow />
            <span class="fd-ow-step fd-ow-step--agree">The AI drafts the checks · you agree</span>
            <Arrow />
            <span class="fd-ow-step fd-ow-step--ink">The AI drafts a calculation</span>
            <Arrow />
            <span class="fd-ow-step fd-ow-step--trace">
              <span aria-hidden="true" class="fd-ow-pulse" />
              Your rules check it · drafts that fail are thrown out
            </span>
            <Arrow />
            <span class="fd-ow-step fd-ow-step--done">You see the number, with what was checked</span>
          </div>
        </div>
        <p class="fd-ow-note">Plenty of AI assistants write good formulas. The difference is the order of work.</p>
      </div>
    </section>
  );
}
