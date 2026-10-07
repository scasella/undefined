import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anchorId, hashToKeep, isZenHash, pageKeepsFocus, parseHash, planHashChange, ROUTE_PATHS, ROUTE_TITLES, routeAnchor, type Route } from './router';

describe('parseHash', () => {
  it('maps the front door', () => {
    expect(parseHash('')).toBe('landing');
    expect(parseHash('#')).toBe('landing');
    expect(parseHash('#/')).toBe('landing');
  });
  it('maps the first run, ignoring a query', () => {
    expect(parseHash('#/start')).toBe('start');
    expect(parseHash('#/start?file=sales')).toBe('start');
  });
  it('maps the step-by-step walk-through (the route stays #/zen, with its pane after it)', () => {
    expect(parseHash('#/zen')).toBe('zen');
    for (const n of [1, 2, 3, 4, 5]) expect(parseHash(`#/zen/${n}`)).toBe('zen');
    expect(parseHash('#/zen/3?x=1')).toBe('zen');
    expect(parseHash('#/zen?x=1')).toBe('zen');
    expect(parseHash('#/zenith')).toBe('landing');
  });
  it('sends unknown routes to the front door', () => {
    expect(parseHash('#/nope')).toBe('landing');
    expect(parseHash('#/starter')).toBe('landing');
  });
  it('leaves in-page anchors alone (keep the current route)', () => {
    expect(parseHash('#own-file')).toBeNull();
    expect(parseHash('#asks')).toBeNull();
    expect(parseHash('#main')).toBeNull();
  });
});

describe('anchorId', () => {
  it('extracts in-page ids only', () => {
    expect(anchorId('#own-file')).toBe('own-file');
    expect(anchorId('#/start')).toBeNull();
    expect(anchorId('#')).toBeNull();
    expect(anchorId('')).toBeNull();
  });
});

describe('route titles', () => {
  it('names the zen route "Step by step", never "Zen"', () => {
    expect(ROUTE_TITLES.zen).toBe('Step by step · Undefined');
    expect(Object.values(ROUTE_TITLES).some((t) => /zen/i.test(t))).toBe(false);
  });
  it('keeps the first-run page reachable and un-redirected at #/start', () => {
    expect(ROUTE_PATHS.start).toBe('#/start');
    expect(parseHash(ROUTE_PATHS.start)).toBe('start');
    expect(ROUTE_PATHS.zen).toBe('#/zen');
    expect(parseHash(ROUTE_PATHS.zen)).toBe('zen');
  });
});

describe('pageKeepsFocus: only a page that owns its own sub-path keeps its scroll and focus (Step by step, its panes)', () => {
  it('Step by step moving between its panes does not scroll or move focus', () => {
    expect(pageKeepsFocus('zen', '#/zen/4')).toBe(true);
    expect(pageKeepsFocus('zen', '#/zen/1')).toBe(true);
    expect(pageKeepsFocus('zen', '#/zen')).toBe(true);
    expect(pageKeepsFocus('zen', '#/zen/3?x=1')).toBe(true);
  });
  it('the landing and the Full view behave exactly as before: a same-route hash change scrolls to the top and focuses #main', () => {
    // the logo (href="#/") pressed on the landing at an anchored address: back to the top, as it always was
    expect(pageKeepsFocus('landing', '#/')).toBe(false);
    expect(pageKeepsFocus('landing', '')).toBe(false);
    expect(pageKeepsFocus('landing', '#')).toBe(false);
    expect(pageKeepsFocus('landing', '#/?x=1')).toBe(false);
    expect(pageKeepsFocus('start', '#/start')).toBe(false);
    expect(pageKeepsFocus('start', '#/start?file=sales')).toBe(false);
    expect(pageKeepsFocus('start', '#/start/anything')).toBe(false);
  });
  it('a change of route behaves as before (scroll to the top, focus #main)', () => {
    expect(pageKeepsFocus('zen', '#/start')).toBe(false);
    expect(pageKeepsFocus('zen', '#/')).toBe(false);
    expect(pageKeepsFocus('landing', '#/zen')).toBe(false);
    expect(pageKeepsFocus('landing', '#/zen/2')).toBe(false);
    expect(pageKeepsFocus('start', '#/zen/1')).toBe(false);
    expect(pageKeepsFocus('start', '#/')).toBe(false);
    // an unknown route is the front door
    expect(pageKeepsFocus('zen', '#/nope')).toBe(false);
  });
  it('a hash that carries an anchor is not the page\'s to keep (the rule alone: on Step by step the page has rewritten it to the plain pane before the router reads it)', () => {
    expect(pageKeepsFocus('landing', '#/#asks')).toBe(false);
    expect(pageKeepsFocus('landing', '#/#own-file')).toBe(false);
    expect(pageKeepsFocus('zen', '#/zen/4#x')).toBe(false);
    expect(pageKeepsFocus('start', '#/#asks')).toBe(false);
    // a bare in-page hash is not a route at all
    expect(pageKeepsFocus('landing', '#own-file')).toBe(false);
    expect(pageKeepsFocus('zen', '#main')).toBe(false);
  });
  it('is decided by the route the viewer is on, not by the hash alone', () => {
    expect(routeAnchor('#/zen/4')).toBeNull();
    expect(pageKeepsFocus('zen', '#/zen/4')).toBe(true);
    expect(pageKeepsFocus('landing', '#/zen/4')).toBe(false);
    expect(pageKeepsFocus('start', '#/zen/4')).toBe(false);
  });
});

describe('hashToKeep: what to put back when a bare in-page hash was typed in by hand', () => {
  it('Step by step keeps the pane it was on', () => {
    expect(hashToKeep('http://x.test/app/#/zen/3', 'zen')).toBe('#/zen/3');
    expect(hashToKeep('http://x.test/#/zen/5?x=1', 'zen')).toBe('#/zen/5?x=1');
  });
  it('Step by step otherwise puts back its plain path (the old address was not its own, or carried an anchor)', () => {
    expect(hashToKeep(undefined, 'zen')).toBe('#/zen');
    expect(hashToKeep('http://x.test/#/start', 'zen')).toBe('#/zen');
    expect(hashToKeep('http://x.test/#/zen/3#asks', 'zen')).toBe('#/zen');
    expect(hashToKeep('http://x.test/', 'zen')).toBe('#/zen');
  });
  it('the landing and the Full view put back the route\'s plain path, exactly as before (no query, no old address)', () => {
    expect(hashToKeep(undefined, 'landing')).toBe('#/');
    expect(hashToKeep('http://x.test/', 'landing')).toBe('#/');
    expect(hashToKeep('', 'landing')).toBe('#/');
    expect(hashToKeep('http://x.test/#own-file', 'start')).toBe('#/start');
    expect(hashToKeep('http://x.test/#/start?file=sales', 'start')).toBe('#/start');
    expect(hashToKeep('http://x.test/#/start', 'start')).toBe('#/start');
    expect(hashToKeep('http://x.test/#/#asks', 'landing')).toBe('#/');
  });
});

describe('isZenHash: the one definition of a Step by step hash (parseHash names the route by it)', () => {
  it('is exactly the hashes parseHash calls "zen"', () => {
    for (const h of ['#/zen', '#/zen/', '#/zen/3', '#/zen/9', '#/zen?x=1', '#/zen/3#x', '#/zen/3?x=1#y']) {
      expect(isZenHash(h), h).toBe(true);
      expect(parseHash(h), h).toBe('zen');
    }
    for (const h of ['', '#', '#/', '#/start', '#/start/zen', '#/zenith', '#/zen2', '#/zen#x', '#/#asks', '#own-file', '#zen', '#/nope']) {
      expect(isZenHash(h), h).toBe(false);
      expect(parseHash(h), h).not.toBe('zen');
    }
  });
});

describe('planHashChange: the hashchange handler\'s whole decision, from the route the viewer is on', () => {
  const route = (r: Route, keep: boolean) => ({ kind: 'route', route: r, keep });
  const OLD = 'http://x.test/app/';
  it('from the landing to Step by step is a change of route: the router scrolls to the top and focuses #main (keep is false)', () => {
    // the wiring this pins: pageKeepsFocus is asked of the route the viewer is ON ('landing'), not of the one the hash names
    // ('zen', where it would say yes and leave the viewer scrolled down the landing with focus nowhere)
    expect(planHashChange('landing', '#/zen', OLD + '#/')).toEqual(route('zen', false));
    expect(planHashChange('landing', '#/zen/2', OLD + '#/')).toEqual(route('zen', false));
    expect(planHashChange('start', '#/zen/1', OLD + '#/start')).toEqual(route('zen', false));
  });
  it('from Step by step out to the other pages is a change of route too', () => {
    expect(planHashChange('zen', '#/start', OLD + '#/zen/3')).toEqual(route('start', false));
    expect(planHashChange('zen', '#/', OLD + '#/zen/3')).toEqual(route('landing', false));
    expect(planHashChange('zen', '#/nope', OLD + '#/zen/3')).toEqual(route('landing', false));
  });
  it('from one Step by step pane to another is the page\'s own business (keep is true)', () => {
    expect(planHashChange('zen', '#/zen/4', OLD + '#/zen/3')).toEqual(route('zen', true));
    expect(planHashChange('zen', '#/zen/3', OLD + '#/zen/4')).toEqual(route('zen', true));
    expect(planHashChange('zen', '#/zen/3?x=1', OLD + '#/zen/3')).toEqual(route('zen', true));
  });
  it('the landing and the Full view keep the router\'s old behaviour for a hash on their own route', () => {
    expect(planHashChange('landing', '#/', OLD + '#/#asks')).toEqual(route('landing', false));
    expect(planHashChange('landing', '#/#asks', OLD + '#/')).toEqual(route('landing', false));
    expect(planHashChange('start', '#/start?file=sales', OLD + '#/start')).toEqual(route('start', false));
  });
  it('a hash that names no route is an in-page link: its id, and the route hash to put back', () => {
    expect(planHashChange('landing', '#own-file', OLD + '#/')).toEqual({ kind: 'in-page', id: 'own-file', putBack: '#/' });
    expect(planHashChange('start', '#asks', OLD + '#/start')).toEqual({ kind: 'in-page', id: 'asks', putBack: '#/start' });
    // Step by step puts back the pane it was on
    expect(planHashChange('zen', '#main', OLD + '#/zen/3')).toEqual({ kind: 'in-page', id: 'main', putBack: '#/zen/3' });
    expect(planHashChange('zen', '#main', undefined)).toEqual({ kind: 'in-page', id: 'main', putBack: '#/zen' });
  });
  it('is decided by the route the viewer is on: the same hash, three viewers, three answers', () => {
    expect(planHashChange('zen', '#/zen/4', OLD)).toEqual(route('zen', true));
    expect(planHashChange('landing', '#/zen/4', OLD)).toEqual(route('zen', false));
    expect(planHashChange('start', '#/zen/4', OLD)).toEqual(route('zen', false));
  });
});

describe('router.ts: the hashchange handler hands planHashChange the route the viewer is ON and the address as it is now', () => {
  const src = readFileSync(new URL('./router.ts', import.meta.url), 'utf8');
  it('passes routeSig.value (the current route), location.hash and the event\'s old address, and nothing else decides', () => {
    expect(src).toContain('planHashChange(routeSig.value, location.hash, e.oldURL)');
    // the handler leaves the decision to it: no second parse of the hash, no second reading of the page's route
    const handler = /addEventListener\('hashchange', \(e\) => \{([\s\S]*?)\n  \}\);/.exec(src)?.[1] ?? '';
    expect(handler).not.toBe('');
    expect(handler).not.toMatch(/parseHash|pageKeepsFocus|hashToKeep|anchorId/);
    expect(handler).toContain('applyRoute(plan.route, true, plan.keep)');
  });
});
