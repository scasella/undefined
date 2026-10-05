/**
 * A tiny hash router on a signal. Only `#/…` hashes are routes ('#/' or '' → landing, '#/start' or '#/start?…' →
 * start). Any other hash ('#own-file', '#asks', the skip link's '#main') is an IN-PAGE link: it scrolls to that id
 * (smooth unless reduced motion), moves focus to the target's heading and never changes the route or the URL.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { h, type AnchorHTMLAttributes, type ComponentChildren } from 'preact';

export type Route = 'landing' | 'start';

export const ROUTE_PATHS: Record<Route, string> = { landing: '#/', start: '#/start' };

export const ROUTE_TITLES: Record<Route, string> = {
  landing: 'Undefined — answers from your spreadsheet, checked before you see them',
  start: 'Get started · Undefined',
};

/** Pure: the route a hash names, or null when the hash is not a route (an in-page anchor; keep the current route). */
export function parseHash(hash: string): Route | null {
  if (hash === '' || hash === '#' || hash === '#/') return 'landing';
  if (/^#\/start(?:[?/].*)?$/.test(hash)) return 'start';
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

function applyRoute(r: Route, moved: boolean): void {
  routeSig.value = r;
  document.title = ROUTE_TITLES[r];
  if (!moved) return;
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

  window.addEventListener('hashchange', () => {
    const next = parseHash(location.hash);
    if (next === null) {
      // typed by hand: treat as an in-page link and put the route hash back
      const id = anchorId(location.hash);
      history.replaceState(null, '', location.pathname + location.search + ROUTE_PATHS[routeSig.value]);
      scrollToAnchor(id);
      return;
    }
    applyRoute(next, true);
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
