import { describe, expect, it } from 'vitest';
import { anchorId, parseHash, ROUTE_PATHS, ROUTE_TITLES } from './router';

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
  it('maps the step-by-step walk-through (the route stays #/zen)', () => {
    expect(parseHash('#/zen')).toBe('zen');
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
