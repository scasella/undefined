/** The landing footer: the privacy line, a way to the full first-run page (#/start), and a link to the source and README. */
import './SiteFooter.css';

export function SiteFooter() {
  return (
    <footer class="fd-footer">
      <div class="fd-footer__in">
        <span>Undefined · sample files are fictional</span>
        <span>No account · no tracking · nothing leaves this browser except what the AI sees</span>
        <span class="fd-footer__links">
          <a href="#/start">Full view of the demo</a>
          <a href="https://github.com/scasella/undefined#readme" rel="noopener">
            Source &amp; README
          </a>
        </span>
      </div>
    </footer>
  );
}
