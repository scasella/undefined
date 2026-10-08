/**
 * Landing · "It asks before it writes the checks" (#agree-first): the headline feature, shown as the recorded run it is (agreeFirstView:
 * every word is the recording's). Three panels in the order they happen: it asked, it drafted, you agreed, joined by the order rule
 * that runs under them. "Try this question" binds orders.csv, selects the same question and opens Step by step's agreement pane.
 */
import type { Engine } from '@scasella/undefined-engine/types';
import { CheckDisc } from '../icons';
import { BeatMark } from '../components/AgreementDraft';
import { Button, LinkButton } from '../components/LinkButton';
import { ROUTE_PATHS } from '../router';
import { RECORDED_DRAFT } from '../model/recordedDraft';
import { AGREE_FIRST_CURATION, agreeFirstView } from './agreeFirstView';
import './AgreeFirst.css';

const view = agreeFirstView();

/** Bind the recorded sample, select the recorded question and open the agreement pane (Step by step, pane 3). */
async function tryIt(engine: Engine): Promise<void> {
  const d = RECORDED_DRAFT;
  if (!d || !engine.state.peek().ready) {
    location.hash = ROUTE_PATHS.zen;
    return;
  }
  const { sessionFor } = await import('../start/session');
  const s = sessionFor(engine);
  if ((s.source.peek() !== 'sample' || s.sampleId.peek() !== d.sampleId) && !(await s.useSample(d.sampleId))) {
    location.hash = ROUTE_PATHS.zen;
    return;
  }
  await s.selectQuestion(d.questionId);
  location.hash = '#/zen/3';
}

export function AgreeFirst({ engine }: { engine: Engine }) {
  if (!view) return null;
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
  return (
    <section id="agree-first" class="fd-af" aria-labelledby="af-h">
      <div class="fd-wrap">
        <div class="fd-af__intro">
          <h2 id="af-h" class="fd-af__h">
            Before it writes the checks, it asks what you meant. <span class="fd-af__accent">Nothing counts until you agree.</span>
          </h2>
          <p class="fd-af__lede">
            Ask in your own words. The AI drafts the examples and house rules your answer has to pass, asks you about anything your question leaves
            open, and says plainly what passing them would and would not show. You approve the checks; then it writes the calculation.
          </p>
        </div>

        <figure class="fd-af__board">
          <figcaption class="fd-label-line fd-af__asked">You asked · {view.question}</figcaption>
          <ol class="fd-af__panels">
            <li class="fd-af__panel fd-af__panel--ask">
              <h3 class="fd-af__ph">
                <BeatMark id="ask" />
                It asked {n(view.asked.length, 'question')}
                <span class="fd-af__pn">{view.rounds > 1 ? `in ${view.rounds} rounds` : 'first'}</span>
              </h3>
              <ul class="fd-af__qs">
                {view.asked.map((a) => (
                  <li key={a.ask} class="fd-af__q">
                    <span class="fd-af__qa">{a.ask}</span>
                    <span class="fd-af__qr">
                      <span class="fd-af__dot" aria-hidden="true" />
                      <span class="fd-sr">Answer: </span>
                      {a.answer}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
            <li class="fd-af__panel fd-af__panel--draft">
              <h3 class="fd-af__ph">
                <BeatMark id="draft" />
                It drafted the agreement
              </h3>
              <ol class="fd-af__terms">
                {view.terms.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
              {view.moreTerms > 0 && <p class="fd-af__more">and {n(view.moreTerms, 'more term')}</p>}
              <p class="fd-af__count">
                {n(view.examples.length, 'example')} · {n(view.rules.length, 'house rule')}
              </p>
              <ul class="fd-af__checks">
                {[...view.examples, ...view.rules].slice(0, 4).map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </li>
            <li class="fd-af__panel fd-af__panel--agreed">
              <h3 class="fd-af__ph fd-af__ph--agreed">
                <CheckDisc size={18} />
                You agreed to them
              </h3>
              <p class="fd-af__agreed">
                Approved: {n(view.examples.length, 'example')} and {n(view.rules.length, 'house rule')}. Every version of the answer now has to pass them.
              </p>
              <div class="fd-af__limits">
                <span class="fd-af__lh">What they would not show</span>
                <p>{view.limits}</p>
              </div>
            </li>
          </ol>
          <div class="fd-af__foot">
            <p class="fd-af__prov">
              <strong>{view.provenance}.</strong> {AGREE_FIRST_CURATION}
            </p>
            <Button variant="secondary" icon="arrow" onClick={() => void tryIt(engine)}>
              Try this question on {RECORDED_DRAFT?.sampleId === 'orders' ? 'orders.csv' : 'the sample'}
            </Button>
          </div>
        </figure>
        {engine.state.value.mode === 'replay' && (
          <p class="fd-af__note">
            This demo plays the recorded run back. On the version on your computer the AI drafts for any question you type.{' '}
            <LinkButton href="#own-file" variant="ghost-link" class="fd-af__link">
              How to run it
            </LinkButton>
          </p>
        )}
      </div>
    </section>
  );
}
