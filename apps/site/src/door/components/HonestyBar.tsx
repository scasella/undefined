/** The sticky bottom bar: "Checked, not proven." and the version line, with a link to the receipt on the landing. */
import { useRoute, type Route } from '../router';
import './HonestyBar.css';

export interface HonestyBarProps {
  /** "Version N": the engine's head revision (the landing passes the example's 3). */
  version: number;
  /** "5 Oct 2026" (state.formatDay). */
  date: string;
}

/**
 * Where "See the receipt" goes from each page. The landing goes to the first run, as the design does. The first run has
 * no receipt view of its own, so it shows no link there (it never links to itself); its receipt is the download under
 * a committed answer (provenance.json in the zip).
 */
export function receiptLink(route: Route): { href: string } | null {
  return route === 'landing' ? { href: '#/start' } : null;
}

export function HonestyBar({ version, date }: HonestyBarProps) {
  const route = useRoute();
  const link = receiptLink(route);
  return (
    <div class="fd-honesty">
      <div class="fd-honesty__in fd-mono">
        <span>Checked, not proven. We show you exactly what was checked.</span>
        <span>
          Version {version} · {date}
          {link && (
            <>
              {' '}·{' '}
              <a href={link.href}>See the receipt</a>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
