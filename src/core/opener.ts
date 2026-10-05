/**
 * `?opener=<example id>`: which example is pre-typed in the console on a first visit (an experiment on the first
 * screen). Returns the id when it names one of `ids`; null when absent, empty or unknown (the caller keeps its default).
 */
export function openerFromSearch(search: string, ids: readonly string[]): string | null {
  try {
    if (typeof search !== 'string' || search === '') return null;
    const value = new URLSearchParams(search.replace(/^\?/, '')).get('opener')?.trim().toLowerCase();
    return value && ids.includes(value) ? value : null;
  } catch {
    return null;
  }
}
