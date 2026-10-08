import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Recording } from '@scasella/undefined-engine/types';
import { buildDataset } from '../../data/dataset';
import { bundledOrders } from '../../data/orders';
import { customSpec, suggestedQuestions } from './questions';
import { RECORDED_DRAFT, recordedDraftFor, recordedDraftReplays, recordedStory } from './recordedDraft';

const recording = (): Recording =>
  JSON.parse(readFileSync(new URL('../../../public/recordings/orders-draft.json', import.meta.url), 'utf8')) as Recording;

describe('the demo’s recorded draft (npm run record:draft)', () => {
  it('is bundled, for orders.csv · "What is our revenue by country?", and says how it was obtained', () => {
    const d = RECORDED_DRAFT;
    expect(d).not.toBeNull();
    expect(d && [d.sampleId, d.questionId, d.fn]).toEqual(['orders', 'country', 'revenueByCountry']);
    expect(recordedDraftFor('orders', 'country')).toBe(d);
    expect(recordedDraftFor('orders', 'top')).toBeNull();
    expect(recordedDraftFor('sales', 'country')).toBeNull();
    // the curation is in the title, as every recording's is
    expect(d!.title).toMatch(/recorded live \(\d+ tr(y|ies)/);
    expect(d!.title).toMatch(/answered the way the site’s agreed definition reads/);
  });

  it('reads back through the live parser: the AI asked first, then drafted', () => {
    const s = recordedStory(RECORDED_DRAFT!)!;
    expect(s).not.toBeNull();
    expect(s.asked.length).toBeGreaterThan(0);
    expect(s.asked.every((a) => a.questions.length === a.answers.length)).toBe(true);
    expect(s.final.examples.length).toBeGreaterThan(0);
    expect(s.final.shows).not.toBe('');
    expect(s.final.limits).not.toBe('');
  });

  it('approving it installs exactly the spec its bundled answer was recorded for', async () => {
    const built = await buildDataset('rows', bundledOrders(), { source: 'bundled', filename: 'orders.csv', typeName: 'Row' });
    if ('error' in built) throw new Error(built.message);
    const q = suggestedQuestions(built.ref, bundledOrders(), 'orders').find((x) => x.id === 'country')!;
    expect(await recordedDraftReplays(RECORDED_DRAFT!, customSpec(q, built.ref))).toBe(true);
    const k = RECORDED_DRAFT!.key;
    expect(recording().sessions.some((x) => x.fn === 'revenueByCountry' && x.specHash === k.specHash && x.testsHash === k.testsHash && x.attempts.length > 0)).toBe(true);
  });
});
