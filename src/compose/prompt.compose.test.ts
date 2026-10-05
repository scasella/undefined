import { describe, expect, it } from 'vitest';
import type { FunctionSpec } from '../types';
import { buildPrompt, honestySection, othersSection } from '../shared/prompt';

const SPEC: FunctionSpec = {
  name: 'slugifyAll',
  params: [{ name: 'titles', type: 'string[]' }],
  returns: 'string[]',
  doc: 'Slugs for a list of titles.',
  tests: '',
  properties: '',
  budgetMs: 1000,
  maxAttempts: 3,
  origin: 'user',
};
const OTHERS = [
  { decl: 'function slugify(title: string): string', doc: 'Turns a title into a URL slug.' },
  { decl: 'function totalOf(rows: Row[]): number', doc: '(no doc)', types: ['type Row = { total: number }'] },
];

describe('the OTHER FUNCTIONS section', () => {
  it('appears only with others, right after FUNCTION, before REQUIREMENTS; HONESTY is byte-identical', () => {
    const without = buildPrompt({ spec: SPEC, history: [] });
    const withOthers = buildPrompt({ spec: SPEC, history: [], others: OTHERS });
    expect(without).not.toContain('OTHER FUNCTIONS');
    const at = withOthers.indexOf('OTHER FUNCTIONS');
    expect(at).toBeGreaterThan(withOthers.indexOf('Your body is compiled exactly as:'));
    expect(at).toBeLessThan(withOthers.indexOf('REQUIREMENTS FOR THE BODY'));
    expect(withOthers).toContain(honestySection(SPEC));
    // removing the section gives back the composition-free prompt exactly
    expect(withOthers.replace(`${othersSection(OTHERS)}\n\n`, '')).toBe(without);
  });

  it('lists each declaration with its doc, the types once, and the two calibration guards', () => {
    expect(othersSection(OTHERS)).toBe(
      [
        'OTHER FUNCTIONS (already certified in this program; you may call them by name; do not redeclare them)',
        'Their types (declared for you):',
        'type Row = { total: number }',
        '- function slugify(title: string): string',
        '  Turns a title into a URL slug.',
        '- function totalOf(rows: Row[]): number',
        '  (no doc)',
        'Calling one is optional. It runs under the same purity and time limits, and its time counts toward yours.',
        'A listed function does not give a meaningless name a meaning: the NEEDS_SPEC rule still applies. A seed you pick yourself is not fresh randomness: a task that needs randomness is still declined as HONESTY says, even if a listed function takes a seed.',
      ].join('\n'),
    );
  });
});
