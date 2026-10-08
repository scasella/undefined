import { describe, expect, it } from 'vitest';
import { RECORDED_DRAFT, recordedStory } from '../model/recordedDraft';
import { agreeFirstView, recordedDay, SHOWN_TERMS } from './agreeFirstView';

describe('landing · it asks before it writes the checks', () => {
  it('quotes the recorded draft and nothing else: every question, answer, term, check and limit is the recording’s', () => {
    const v = agreeFirstView()!;
    const s = recordedStory(RECORDED_DRAFT!)!;
    expect(v.question).toBe(RECORDED_DRAFT!.question);
    expect(v.asked.map((a) => a.ask)).toEqual(s.asked.flatMap((r) => r.questions.map((q) => q.ask)));
    expect(v.asked.map((a) => a.answer)).toEqual(s.settled.map((p) => p.answer));
    expect(v.rounds).toBe(s.asked.length);
    for (const t of v.terms) expect(s.final.contract).toContain(t);
    expect(v.terms.length).toBeLessThanOrEqual(SHOWN_TERMS);
    expect(v.examples).toEqual(s.final.examples.map((x) => x.plain));
    expect(v.rules).toEqual(s.final.rules.map((x) => x.plain));
    expect(v.limits).toBe(s.final.limits);
    expect(v.provenance).toBe(`Recorded run · ${RECORDED_DRAFT!.model} · ${recordedDay(RECORDED_DRAFT!.recordedOn)}`);
  });
  it('a recorded day is read from its date, never moved by a timezone', () => {
    expect(recordedDay('2026-10-08')).toBe('8 Oct 2026');
  });
  it('no recorded draft, no section', () => {
    expect(agreeFirstView(null)).toBeNull();
  });
});
