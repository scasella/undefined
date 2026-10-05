import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { recordingParamFromLocation } from '../share/source';
import { openerFromSearch } from './opener';

const IDS = EXAMPLES.map((e) => e.id);

describe('openerFromSearch', () => {
  it('names every shipped example', () => {
    for (const id of ['median', 'fibonacci', 'slugify', 'orders']) expect(openerFromSearch(`?opener=${id}`, IDS)).toBe(id);
  });

  it('tolerates case, whitespace, a missing "?" and other params', () => {
    expect(openerFromSearch('?opener=Fibonacci', IDS)).toBe('fibonacci');
    expect(openerFromSearch('?opener=%20orders%20', IDS)).toBe('orders');
    expect(openerFromSearch('opener=slugify', IDS)).toBe('slugify');
    expect(openerFromSearch('?fixture=x&opener=orders&recording=https%3A%2F%2Fe.com%2Fr.json', IDS)).toBe('orders');
  });

  it('is null when absent, empty or unknown (the caller keeps median)', () => {
    for (const s of ['', '?', '?opener=', '?opener=nope', '?opener=__proto__', '?opener=median()', '?other=orders', '?opener'])
      expect(openerFromSearch(s, IDS)).toBeNull();
    expect(openerFromSearch(undefined as unknown as string, IDS)).toBeNull();
  });

  it('does not disturb ?recording= or #recording=', () => {
    expect(recordingParamFromLocation('?opener=orders&recording=https%3A%2F%2Fe.com%2Fr.json', '')).toBe('https://e.com/r.json');
    expect(recordingParamFromLocation('?opener=orders', '#recording=https://e.com/x.json')).toBe('https://e.com/x.json');
    expect(recordingParamFromLocation('?opener=orders', '')).toBeNull();
  });
});
