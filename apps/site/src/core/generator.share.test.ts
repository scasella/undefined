/** Sharing replayed sessions: RecordingSink provenance, ReplayGenerator.has, recordedAttempt, per-session model fields. */
import { describe, expect, it } from 'vitest';
import type { GenerateRequest, GenerateResult, Recording } from '@scasella/undefined-engine/types';
import { recordedAttempt, RecordingSink, ReplayGenerator, validateRecording } from './generator';

const H = (c: string) => c.repeat(64);
const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({ fn: 'median', specHash: H('a'), testsHash: H('b'), attempt: 0, prompt: 'built today', ...over });

const RECORDED: Recording = {
  format: 'undefined-recording',
  version: 1,
  id: 'r',
  title: 'r',
  recordedAt: '2026-10-01T00:00:00.000Z',
  model: 'gpt-6-luna',
  codexVersion: '0.159.2',
  effort: 'low',
  sessions: [
    {
      fn: 'median',
      specHash: H('a'),
      testsHash: H('b'),
      label: 'median — recorded',
      attempts: [
        { prompt: 'THE RECORDED PROMPT', body: 'return 1;', notes: 'n0', durationMs: 9000, progress: [{ t: 8000, text: 'thinking', channel: 'stderr' }] },
        { prompt: 'P1', body: 'return 2;', notes: 'n1', durationMs: 7000, progress: [] },
      ],
    },
  ],
};

const replayed = (body: string): GenerateResult => ({ body, notes: '', model: 'gpt-6-luna', codexVersion: '0.159.2', durationMs: 0, source: 'replay', progress: [] });
const live = (body: string): GenerateResult => ({ body, notes: 'live', model: 'gpt-x', codexVersion: '1.0.0', durationMs: 5, source: 'live', progress: [] });

describe('sharing replayed sessions', () => {
  it('ReplayGenerator.has answers by fn + hashes', () => {
    const g = new ReplayGenerator([RECORDED], { maxMs: 0 });
    expect(g.has('median', H('a'), H('b'))).toBe(true);
    expect(g.has('median', H('a'), H('c'))).toBe(false);
    expect(g.has('mode', H('a'), H('b'))).toBe(false);
  });

  it('recordedAttempt returns the attempt verbatim with provenance and label (session fields win)', () => {
    const found = recordedAttempt([RECORDED], req({ attempt: 1 }))!;
    expect(found.attempt).toBe(RECORDED.sessions[0]!.attempts[1]);
    expect(found).toMatchObject({ label: 'median — recorded', provenance: { model: 'gpt-6-luna', codexVersion: '0.159.2', effort: 'low' } });
    expect(recordedAttempt([RECORDED], req({ attempt: 2 }))).toBeUndefined();
    const own: Recording = { ...RECORDED, version: 2, sessions: [{ ...RECORDED.sessions[0]!, model: 'other', codexVersion: '9', effort: 'high' }] };
    expect(recordedAttempt([own], req())!.provenance).toEqual({ model: 'other', codexVersion: '9', effort: 'high' });
  });

  it('a replayed result is recorded only with its recorded attempt: verbatim (real timings and prompt) and credited to that model', () => {
    const sink = new RecordingSink({ now: () => new Date('2026-10-04T10:00:00Z') });
    sink.add(req(), replayed('return 1;'), 'x'); // no provenance: ignored, as before
    expect(sink.toRecording({ id: 'i', title: 't' })).toBeNull();
    for (const attempt of [0, 1]) {
      const from = recordedAttempt([RECORDED], req({ attempt }))!;
      sink.add(req({ attempt }), replayed(from.attempt.body), from.label, { replayed: from, call: 'median([1, 2])' });
    }
    expect(sink.sources).toBe('replay');
    const rec = sink.toRecording({ id: 'i', title: 't' })!;
    expect(rec).toMatchObject({ model: 'gpt-6-luna', codexVersion: '0.159.2', effort: 'low' });
    expect(rec.sessions[0]!.attempts).toEqual(RECORDED.sessions[0]!.attempts);
    expect(rec.sessions[0]!.label).toBe('median — recorded');
    expect(rec.sessions[0]!.model).toBeUndefined();
  });

  it('a mixed export puts the other model on its own sessions, and that survives validation and replay', async () => {
    const sink = new RecordingSink({ effort: 'low' });
    const from = recordedAttempt([RECORDED], req())!;
    sink.add(req(), replayed('return 1;'), from.label, { replayed: from });
    sink.add(req({ fn: 'mode', attempt: 0, prompt: 'pm' }), live('return 3;'), 'mode', { effort: 'medium' });
    expect(sink.sources).toBe('mixed');
    const rec = sink.toRecording({ id: 'i', title: 't' })!;
    expect(rec.version).toBe(2);
    expect(rec.model).toBe('gpt-6-luna');
    expect(rec.sessions[1]).toMatchObject({ fn: 'mode', model: 'gpt-x', codexVersion: '1.0.0', effort: 'medium' });
    const v = validateRecording(JSON.parse(JSON.stringify(rec)));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const out = await new ReplayGenerator([v.recording], { maxMs: 0 }).generate(req({ fn: 'mode', prompt: '' }), () => {});
    expect(out).toMatchObject({ body: 'return 3;', model: 'gpt-x', codexVersion: '1.0.0', source: 'replay' });
  });

  it('per-session provenance is a version 2 field (a v1 file carrying it is rejected)', () => {
    const bad = { ...RECORDED, sessions: [{ ...RECORDED.sessions[0]!, model: 'x' }] };
    const v = validateRecording(JSON.parse(JSON.stringify(bad)));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/version 2 field/);
    const wrong = { ...RECORDED, version: 2, sessions: [{ ...RECORDED.sessions[0]!, effort: 3 }] };
    expect(validateRecording(JSON.parse(JSON.stringify(wrong))).ok).toBe(false);
  });
});
