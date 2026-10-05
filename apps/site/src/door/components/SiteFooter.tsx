/** The landing footer, plus a quiet link to the workbench (the original REPL UI). */
import './SiteFooter.css';

export function SiteFooter() {
  return (
    <footer class="fd-footer">
      <div class="fd-footer__in">
        <span>Undefined · sample files are fictional</span>
        <span>No account · no tracking · nothing leaves this browser except what the AI sees</span>
        <span class="fd-footer__links">
          <a href="workbench.html" rel="nofollow" title="The original REPL: every engine feature, no guided flow">
            Workbench
          </a>
          <a href="https://github.com/scasella/undefined#readme" rel="noopener">
            Source &amp; README
          </a>
        </span>
      </div>
    </footer>
  );
}
