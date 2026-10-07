/**
 * The mode note at the foot of the first-run rail (V3-Door-FirstRun 380-384).
 * Replay (`state.mode === 'replay'`): the design's "Demo · recorded answers, real checks" with a link to the landing's
 * "run it on your computer" spot (`#own-file`: the limits card, which lists the steps and links on to the README's).
 * Live: the honest live-mode equivalent. (The top bar's mode pill carries the same note, as a disclosure.)
 *
 * Also here: RunLocally, the steps themselves (model/runLocally.ts) as a plain list on the landing and as a disclosure on Step
 * by step's dead end.
 *
 * The router has no `#/?to=…` form, so the link's href is the landing ('#/', works without JS and in a new tab) and a
 * click goes there and then scrolls to the in-page anchor `#own-file` with the router's own scrollToAnchor.
 */
import { Fragment } from 'preact';
import { signal } from '@preact/signals';
import { softBreaks, type Part, type RunLocallyView } from '../model/runLocally';
import { navigate, parseHash, scrollToAnchor } from '../router';
import './DemoNote.css';

/** The README section that says how to run the app on your own computer (the landing's limits card links to it). */
export const RUN_LOCALLY_URL = 'https://github.com/scasella/undefined#run-it-on-your-computer';

export interface DemoNoteProps {
  mode: 'live' | 'replay';
  /** Landing section to land on (default 'own-file'). */
  anchor?: string;
}

function goToLandingSection(e: MouseEvent, anchor: string): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => scrollToAnchor(anchor)));
  if (parseHash(location.hash) === 'landing') {
    navigate('#/');
    settle();
    return;
  }
  window.addEventListener('hashchange', settle, { once: true });
  navigate('#/');
}

export function DemoNote({ mode, anchor = 'own-file' }: DemoNoteProps) {
  if (mode === 'live') {
    return (
      <div class="fd-demo">
        <div class="fd-demo__t">
          <span aria-hidden="true" class="fd-demo__dot fd-demo__dot--live" />
          Live · the AI runs on your computer
        </div>
        <p class="fd-demo__p">
          New questions go to the AI on this computer. The checks run in your browser, right now, before you see any answer. Only what's listed under What the AI will see is sent.
        </p>
      </div>
    );
  }
  return (
    <div class="fd-demo">
      <div class="fd-demo__t">
        <span aria-hidden="true" class="fd-demo__dot" />
        Demo · recorded answers, real checks
      </div>
      <p class="fd-demo__p">
        This page plays back answers the AI gave earlier. The checks run again in your browser, right now. To ask new questions about your own file, run it on your computer.
      </p>
      <a href="#/" class="fd-demo__a" onClick={(e) => goToLandingSection(e, anchor)}>
        How to run it on your computer
      </a>
    </div>
  );
}

/** A line of words with its commands set as code (model/runLocally.ts Part). */
function Words({ parts }: { parts: readonly Part[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <code key={i} class="fd-rl__code fd-mono">
            {p.code}
          </code>
        ),
      )}
    </>
  );
}

/** A command that may wrap at a URL's seams (a <wbr>, which copies as nothing) rather than in the middle of a word. */
function Command({ text }: { text: string }) {
  return (
    <>
      {softBreaks(text).map((piece, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {piece}
        </Fragment>
      ))}
    </>
  );
}

/** A drawn chevron (the shared icon set has none): points right while the disclosure is closed, down once it is open. */
function Chevron() {
  return (
    <svg aria-hidden="true" focusable="false" class="fd-rl__chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4.5 6.5 8 10l3.5-3.5" />
    </svg>
  );
}

/**
 * Whether Step by step's steps are open. They START open (the dead end is where a person who asked about their own file lands,
 * and the way forward is what they came for), and the viewer can fold them away. It is a signal, not state in the component:
 * the dead end's message is redrawn when the selected question changes (typing one and pressing Enter selects it, and the
 * steps are unmounted for a moment while the answer on file is looked up), and a fold or an unfold must survive that, and
 * moving between panes 2 and 3.
 */
export const runLocallyOpen = signal(true);

export interface RunLocallyProps {
  view: RunLocallyView;
  /**
   * `disclosure` (Step by step's dead end, where the question is the page's business): the one plain sentence for the person
   * who does not run commands, then the steps in a real <details> (open until the viewer folds it away: runLocallyOpen).
   * Otherwise (the landing's limits card) a heading and a plain list, all showing.
   */
  disclosure?: boolean;
  /** The README link, for the full steps, as the last line of the steps (the landing's card has its own link). */
  link?: boolean;
}

/**
 * "How to run it on your computer": what you need, the three commands, where it opens. Every word is the view's
 * (model/runLocally.ts); this lays them out. The commands wrap (pre-wrap, anywhere) rather than scroll, so nothing runs past
 * a phone's edge; no card inside a card.
 */
export function RunLocally({ view, disclosure = false, link = false }: RunLocallyProps) {
  const steps = (
    <>
      <p class="fd-rl__lead">{view.needsLead}</p>
      <ul class="fd-rl__list">
        {view.needs.map((n, i) => (
          <li key={i}>
            <Words parts={n} />
          </li>
        ))}
      </ul>
      <p class="fd-rl__lead">{view.commandsLead}</p>
      <pre class="fd-rl__cmds fd-mono">
        {view.commands.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && '\n'}
            <Command text={c} />
          </Fragment>
        ))}
      </pre>
      <p class="fd-rl__opens">
        {view.opensLead} <code class="fd-rl__code fd-mono">{view.opensAddress}</code>
      </p>
      {link && (
        <a class="fd-rl__readme" href={RUN_LOCALLY_URL} target="_blank" rel="noopener">
          {view.readmeLabel}
          <span class="fd-sr"> (the README on GitHub, opens in a new tab)</span>
        </a>
      )}
    </>
  );
  if (disclosure) {
    return (
      <div class="fd-rl">
        <p class="fd-rl__hand">{view.handOff}</p>
        {/* the fold is the signal's, flipped by the click itself (mouse, Enter and Space all click a <summary>) and not read back from the
              browser's own toggle, which reports a moment later: the message can be redrawn in that moment. The toggle still syncs
              the signal for a change the browser makes on its own (find in page opening it). */}
        <details class="fd-rl__d" open={runLocallyOpen.value} onToggle={(e) => (runLocallyOpen.value = e.currentTarget.open)}>
          <summary
            class="fd-rl__sum"
            onClick={(e) => {
              e.preventDefault();
              runLocallyOpen.value = !runLocallyOpen.value;
            }}
          >
            <Chevron />
            {view.heading}
          </summary>
          <div class="fd-rl__body">{steps}</div>
        </details>
      </div>
    );
  }
  return (
    <div class="fd-rl">
      <h3 class="fd-rl__h">{view.heading}</h3>
      <p class="fd-rl__hand">{view.handOff}</p>
      {steps}
    </div>
  );
}
