/**
 * The mode note at the foot of the first-run rail (V3-Door-FirstRun 380-384).
 * Replay (`state.mode === 'replay'`): the design's "Demo · recorded answers, real checks" with a link to the landing's
 * "run it on your computer" spot (`#own-file`: the limits card, which links on to the README's setup steps).
 * Live: the honest live-mode equivalent. (The top bar's mode pill carries the same note, as a disclosure.)
 *
 * The router has no `#/?to=…` form, so the link's href is the landing ('#/', works without JS and in a new tab) and a
 * click goes there and then scrolls to the in-page anchor `#own-file` with the router's own scrollToAnchor.
 */
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
