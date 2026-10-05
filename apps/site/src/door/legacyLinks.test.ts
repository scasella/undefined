import { describe, expect, it } from 'vitest';
import { legacyWorkbenchHref } from './legacyLinks';

describe('legacyWorkbenchHref', () => {
  it('sends ?opener= links on to the workbench, query intact', () => {
    expect(legacyWorkbenchHref('?opener=fibonacci', '')).toBe('workbench.html?opener=fibonacci');
  });
  it('sends ?recording= and #recording= share links on, query and hash intact', () => {
    expect(legacyWorkbenchHref('?recording=https%3A%2F%2Fx.test%2Fr.json', '')).toBe('workbench.html?recording=https%3A%2F%2Fx.test%2Fr.json');
    expect(legacyWorkbenchHref('', '#recording=https://x.test/r.json')).toBe('workbench.html#recording=https://x.test/r.json');
  });
  it('leaves the front door alone otherwise (its own hash routes, unrelated queries)', () => {
    expect(legacyWorkbenchHref('', '')).toBeNull();
    expect(legacyWorkbenchHref('', '#/start')).toBeNull();
    expect(legacyWorkbenchHref('?utm_source=x', '#/')).toBeNull();
    expect(legacyWorkbenchHref('', '#own-file')).toBeNull();
  });
});
