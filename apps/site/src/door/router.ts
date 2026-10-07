/**
 * A tiny hash router on a signal. Only `#/…` hashes are routes ('#/' or '' → landing, '#/start' or '#/start?…' →
 * start, '#/zen' → the "Step by step" walk-through, which is where first-time visitors are sent; '#/start' stays
 * reachable as the full view). Any other hash ('#own-file', '#asks', the skip link's '#main') is an IN-PAGE link: it scrolls to that id
 * (smooth unless reduced motion), moves focus to the target's heading and never changes the route or the URL.
 *
 * One page owns its own sub-path: Step by step keeps its pane in the address ('#/zen/3'). A hash change from one of its
 * panes to another ('#/zen/3' to '#/zen/4', with the browser's Back and Forward) is the page's own business: the router
 * updates the route and the title but does not scroll or move focus (pageKeepsFocus). Everything else behaves as it always
 * did: a change of route, an in-page anchor, navigate() to the hash the page is already on, and a same-route hash on the
 * landing or the Full view (the logo's '#/' from '#/#asks' scrolls to the top again).
 *
 * An anchor after a Step by step pane ('#/zen/3#x') is NOT scrolled to when the address is changed to it on a hash change, and
 * nothing links to one. The rule here alone would say yes (pageKeepsFocus is false for it), but the browser fires popstate
 * before hashchange and the page's own popstate handler (zen/Zen.tsx) reads the pane before the '#' and rewrites the address to
 * the plain pane ('#/zen/3', replaceState) first; this handler then reads the rewritten address, a pane with no anchor, and
 * leaves scroll and focus alone. The address is how the router sees the page, so the page's rewrite is what decides. A cold
 * LOAD of such an address is the exception (installRouter reads its anchor before the page has mounted): '#/zen/1#main' still
 * focuses #main, and the page then rewrites the address to '#/zen/1'; an id the page does not have does nothing.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { h, type AnchorHTMLAttributes, type ComponentChildren } from 'preact';

export type Route = 'landing' | 'start' | 'zen';

export const ROUTE_PATHS: Record<Route, string> = { landing: '#/', start: '#/start', zen: '#/zen' };

export const ROUTE_TITLES: Record<Route, string> = {
  landing: 'Undefined — answers from your spreadsheet, checked before you see them',
  start: 'Get started · Undefined',
  zen: 'Step by step · Undefined',
};

/**
 * Pure: is this hash Step by step's own ('#/zen', '#/zen/', '#/zen/3', '#/zen?x=1', '#/zen/3#x')? THE definition: parseHash
 * names the route by it, and the walk-through itself (zen/flow.ts re-exports this one) asks the same question of the address
 * before it rewrites it, so the two can never disagree about what a Step by step hash is.
 */
export const isZenHash = (hash: string): boolean => /^#\/zen(?:[?/].*)?$/.test(hash);

/** Pure: the route a hash names, or null when the hash is not a route (an in-page anchor; keep the current route). */
export function parseHash(hash: string): Route | null {
  if (hash === '' || hash === '#' || hash === '#/') return 'landing';
  if (/^#\/start(?:[?/].*)?$/.test(hash)) return 'start';
  if (isZenHash(hash)) return 'zen';
  if (hash.startsWith('#/')) return 'landing'; // an unknown route: the front door
  return null;
}

/** Pure: the element id an in-page hash points at ('#own-file' → 'own-file'), or null for routes / empty. */
export function anchorId(hash: string): string | null {
  if (!hash.startsWith('#') || hash.startsWith('#/') || hash.length < 2) return null;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

const routeSig = signal<Route>('landing');
export const route: ReadonlySignal<Route> = routeSig;

/** Pure: the in-page id a route hash carries after the route ('#/#asks' → 'asks'), else null. */
export function routeAnchor(hash: string): string | null {
  if (!hash.startsWith('#/')) return null;
  const i = hash.indexOf('#', 1);
  return i < 0 ? null : anchorId(hash.slice(i));
}

/**
 * Pure: should a hash change be left to the page, with no scroll to the top and no focus move to #main? Only when the page
 * itself owns the sub-path: the viewer is on Step by step (`current`) and the new hash is another of its own, carrying no
 * in-page anchor ('#/zen/3' to '#/zen/4', '#/zen/3?x=1'). No for every other change: another route ('#/zen/3' to '#/start',
 * '#/' to '#/zen'), a hash that still carries an anchor ('#/zen/3#x': this rule alone would send the router to the anchor, but
 * on Step by step the page has already rewritten such an address to the plain pane by the time the router reads it, see the
 * top of this file), and any same-route hash on the landing or the Full view, which nothing there owns ('#/#asks' to '#/' is
 * the logo: back to the top). `current` is the route the viewer is ON, not the one the hash names.
 */
export function pageKeepsFocus(current: Route, hash: string): boolean {
  return current === 'zen' && parseHash(hash) === 'zen' && routeAnchor(hash) === null;
}

/**
 * Pure: the hash to put back when one that names no route was typed in by hand ('#own-file'). Step by step puts back the
 * route hash the page was on (`oldUrl`, the event's own record of it) so the pane survives ('#/zen/3'); every other route its
 * plain path, as before ('#/', '#/start').
 */
export function hashToKeep(oldUrl: string | undefined, current: Route): string {
  if (current !== 'zen') return ROUTE_PATHS[current];
  const i = oldUrl ? oldUrl.indexOf('#') : -1;
  const old = i < 0 ? '' : oldUrl!.slice(i);
  return parseHash(old) === 'zen' && routeAnchor(old) === null ? old : ROUTE_PATHS.zen;
}

/** What the router does about one hash change: the route to show (and whether the page keeps scroll and focus), or an in-page link. */
export type HashChange =
  | { kind: 'route'; route: Route; keep: boolean }
  | { kind: 'in-page'; id: string | null; putBack: string };

/**
 * Pure: the whole decision for a hashchange, from the route the viewer is on (`current`), the address it landed on (`hash`)
 * and the address it left (`oldUrl`, the event's own record of it). A hash that names a route is shown as that route, and
 * `keep` says whether the page it came from owns the change (pageKeepsFocus, asked of the CURRENT route: the page the viewer
 * is leaving, never the page the hash names). One that names no route ('#own-file', typed by hand) is an in-page link: its id
 * is scrolled to and `putBack` is the hash to restore (hashToKeep).
 */
export function planHashChange(current: Route, hash: string, oldUrl: string | undefined): HashChange {
  const next = parseHash(hash);
  if (next === null) return { kind: 'in-page', id: anchorId(hash), putBack: hashToKeep(oldUrl, current) };
  return { kind: 'route', route: next, keep: pageKeepsFocus(current, hash) };
}

/** The current route; reading it in a component subscribes that component. */
export function useRoute(): Route {
  return routeSig.value;
}

/** Go to a route path ('#/', '#/start', '#/start?x') or an in-page anchor ('#asks'). */
export function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  const r = parseHash(path);
  if (r === null) {
    scrollToAnchor(anchorId(path));
    return;
  }
  if (location.hash === path) applyRoute(r, true);
  else location.hash = path;
}

/** A link to a route ('#/…') or an in-page anchor ('#id'). Plain <a>, so it works without JS and opens in new tabs. */
export function Link({ to, children, ...rest }: { to: string; children?: ComponentChildren } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return h('a', { ...rest, href: to }, children);
}

const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const focusTarget = (el: HTMLElement): HTMLElement => {
  if (/^H[1-6]$/.test(el.tagName) || el.id === 'main') return el;
  return el.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? el;
};

function focusNoScroll(el: HTMLElement): void {
  if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

/** Scroll an id into view and move focus to its heading. Returns false when the id is not on the page. */
export function scrollToAnchor(id: string | null): boolean {
  if (!id || typeof document === 'undefined') return false;
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  focusNoScroll(focusTarget(el));
  return true;
}

/** `moved`: the hash changed (not the first render). `keep`: the page keeps its own scroll and focus (pageKeepsFocus). */
function applyRoute(r: Route, moved: boolean, keep = false): void {
  routeSig.value = r;
  document.title = ROUTE_TITLES[r];
  if (!moved || keep) return;
  // a cross-route anchor ('#/#asks'): once the new page has rendered, scroll to it instead of the top
  const anchor = routeAnchor(location.hash);
  if (anchor) {
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToAnchor(anchor)));
    return;
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  // after the new page has rendered
  requestAnimationFrame(() => {
    const main = document.getElementById('main');
    if (main) focusNoScroll(main);
  });
}

let installed = false;

/** Wire the router to the window (once). Call from the app root; module scope stays DOM-free for tests. */
export function installRouter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const initial = location.hash;
  const r = parseHash(initial);
  applyRoute(r ?? 'landing', false);
  const routed = routeAnchor(initial);
  if (routed) requestAnimationFrame(() => requestAnimationFrame(() => scrollToAnchor(routed)));
  if (r === null) {
    // a shared in-page link ('…/#asks'): land on the front door, then scroll once it has rendered
    const id = anchorId(initial);
    history.replaceState(null, '', location.pathname + location.search);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToAnchor(id)));
  }

  window.addEventListener('hashchange', (e) => {
    const plan = planHashChange(routeSig.value, location.hash, e.oldURL);
    if (plan.kind === 'in-page') {
      // typed by hand: treat as an in-page link and put the route hash back (with the pane Step by step was on)
      history.replaceState(null, '', location.pathname + location.search + plan.putBack);
      scrollToAnchor(plan.id);
      return;
    }
    applyRoute(plan.route, true, plan.keep);
  });

  // in-page anchors: scroll + focus without touching the URL, so Back never lands on a bare '#id'
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
    if (!(a instanceof HTMLAnchorElement)) return;
    const href = a.getAttribute('href') ?? '';
    if (parseHash(href) !== null) return; // a route: let the hash change
    const id = anchorId(href);
    if (id && document.getElementById(id)) {
      e.preventDefault();
      scrollToAnchor(id);
    }
  });
}
