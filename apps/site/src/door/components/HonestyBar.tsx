/** The sticky bottom bar: "Checked, not proven." and the version line, with a link to the receipt on the landing. */
import type { EngineState } from '@scasella/undefined-engine/types';
import { useRoute, type Route } from '../router';
import { formatDay } from '../state';
import './HonestyBar.css';

export interface HonestyBarProps {
  /** "Version N": a committed version the user can point at; null shows no version at all. */
  version: number | null;
  /** "5 Oct 2026" (state.formatDay); null leaves the date out. */
  date: string | null;
  /** The landing's number belongs to its illustrated example answer, not to anything the visitor did: say so. */
  example?: boolean;
}

/**
 * Where "See the receipt" goes from each page. The landing goes to the first run, as the design does. The first run has
 * no receipt view of its own, so it shows no link there (it never links to itself); its receipt is the download under
 * a committed answer (provenance.json in the zip).
 */
export function receiptLink(route: Route): { href: string } | null {
  return route === 'landing' ? { href: '#/start' } : null;
}

export interface CommittedVersion {
  version: number;
  /** The day that version was made (null when its snapshot is not in the history). */
  date: string | null;
}

/**
 * Pure: the newest committed version, or null before the AI's work has passed its checks and been committed.
 *
 * `state.headRevision` is NOT that. It is the id of the newest snapshot of the whole program, and a snapshot is made for
 * every change (binding a file, installing the demo's agreement, locking an answer, a ruling), so it reads "Version 2"
 * before anything was asked and keeps climbing for an identical answer. A function's version is the revision its
 * accepted draft was committed at (`Artifact.revision`), the same number the answer card's caption shows.
 */
export function latestVersion(state: Pick<EngineState, 'program' | 'revisions'>): CommittedVersion | null {
  let version = 0;
  for (const rec of Object.values(state.program.functions)) {
    const r = rec.artifact?.revision;
    if (typeof r === 'number' && Number.isFinite(r) && r > version) version = r;
  }
  if (version <= 0) return null;
  const row = state.revisions.find((r) => r.id === version);
  return { version, date: row ? formatDay(row.at) : null };
}

/** Pure: the version part of the bar ('Version 3 · 5 Oct 2026', 'Example answer: Version 3 · 5 Oct 2026'), or null. */
export function versionText({ version, date, example = false }: HonestyBarProps): string | null {
  if (version === null) return null;
  const v = `Version ${version}${date ? ` · ${date}` : ''}`;
  return example ? `Example answer: ${v}` : v;
}

export function HonestyBar({ version, date, example }: HonestyBarProps) {
  const route = useRoute();
  const link = receiptLink(route);
  const text = versionText({ version, date, ...(example !== undefined ? { example } : {}) });
  return (
    <div class="fd-honesty">
      <div class="fd-honesty__in fd-mono">
        <span>Checked, not proven. We show you exactly what was checked.</span>
        {(text || link) && (
          <span>
            {text}
            {text && link && ' · '}
            {link && <a href={link.href}>See the receipt</a>}
          </span>
        )}
      </div>
    </div>
  );
}
