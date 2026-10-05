import { describe, expect, it } from 'vitest';
import { anchorId, parseHash } from './router';

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
