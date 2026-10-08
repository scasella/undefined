/**
 * The footer of the landing and of the Full view (the one `contentinfo` landmark each page has; Step by step has its own bare one).
 * Landing: the privacy line, a way to the full first-run page (#/start), and a link to the source and README. Full view: the same
 * line about where the file is that Step by step's footer says (state.ts privacyLine: the page itself is the full view, so no link
 * to it, and the claim is the honesty bar's, so none here), and the link to the source and README.
 */
import './SiteFooter.css';

export interface SiteFooterProps {
  /** 'landing' (the default) or 'start' (the Full view). */
  page?: 'landing' | 'start';
  /** The Full view's line about where the file is (state.ts privacyLine for the mode); the landing's is its own words. */
  privacy?: string;
}

export const LANDING_PRIVACY = 'No account · no tracking · nothing leaves this browser except what the AI sees';

export function SiteFooter({ page = 'landing', privacy = '' }: SiteFooterProps) {
  const landing = page === 'landing';
  return (
    <footer class="fd-footer">
      <div class="fd-footer__in">
        <span>Undefined · sample files are fictional</span>
        <span>{landing ? LANDING_PRIVACY : privacy}</span>
        <span class="fd-footer__links">
          {landing && <a href="#/start">Full view of the demo</a>}
          <a href="https://github.com/scasella/undefined#readme" rel="noopener">
            Source &amp; README
          </a>
        </span>
      </div>
    </footer>
  );
}
