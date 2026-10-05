/**
 * Links made before the front door existed point at the site root and carry the workbench's own parameters:
 * `?opener=<example>` (README, docs, launch posts) and `?recording=<url>` share links (also `#recording=`). The front
 * door does not show either, so a visit with one of them goes on to the workbench, query and hash intact.
 * Pure (no DOM): main.tsx passes `location.search` and `location.hash`.
 */
export function legacyWorkbenchHref(search: string, hash: string): string | null {
  const has = (part: string, name: string): boolean => {
    try {
      return new URLSearchParams(part.replace(/^[?#]/, '')).has(name);
    } catch {
      return false;
    }
  };
  const wanted = has(search, 'opener') || has(search, 'recording') || has(hash, 'recording');
  return wanted ? `workbench.html${search}${hash}` : null;
}
