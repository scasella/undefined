/** The sticky bottom bar: "Checked, not proven." and the version line with a link to the receipt. */
import { useRoute, type Route } from '../router';
import './HonestyBar.css';

export interface HonestyBarProps {
  /** "Version N": the engine's head revision (the landing passes the example's 3). */
  version: number;
  /** "5 Oct 2026" (state.formatDay). */
  date: string;
  /** Where "See the receipt" goes; default receiptLink(route). */
  receiptHref?: string;
}

/** The workbench page (vite input `workbench`): its Repo tab lists each function's checks, history and Eject. */
export const WORKBENCH_HREF = 'workbench.html';

/**
 * Where "See the receipt" goes from each page. The landing goes to the first run, as the design does. The first run has
 * no receipt view of its own, so it does NOT link to itself: it opens the workbench, where the Repo tab shows each
 * function's checks and Eject downloads them with provenance.json (the receipt), and the title says so.
 */
export function receiptLink(route: Route): { href: string; title?: string } {
  if (route === 'landing') return { href: '#/start' };
  return {
    href: WORKBENCH_HREF,
    title: "Opens the workbench: its Repo tab shows each function's checks and history, and Eject downloads them with a provenance file",
  };
}

export function HonestyBar({ version, date, receiptHref }: HonestyBarProps) {
  const route = useRoute();
  const link = receiptHref !== undefined ? { href: receiptHref } : receiptLink(route);
  return (
    <div class="fd-honesty">
      <div class="fd-honesty__in fd-mono">
        <span>Checked, not proven. We show you exactly what was checked.</span>
        <span>
          Version {version} · {date} ·{' '}
          <a href={link.href} {...(link.title ? { title: link.title } : {})}>
            See the receipt
          </a>
        </span>
      </div>
    </div>
  );
}
