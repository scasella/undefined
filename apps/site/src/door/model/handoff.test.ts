import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../ui/dev/fixtures';
import { HANDOFF_LABEL, handoffView, handoffZip } from './handoff';
import type { Engine } from '@scasella/undefined-engine/types';
import * as M from '@scasella/undefined-engine/eject/eject';

describe('handoff (the workbench Eject, from the front door)', () => {
  it('offers a committed, current function and says what the zip holds', () => {
    const s = SCENARIOS['share-dialog']();
    const fn = Object.keys(s.program.functions).find((n) => s.program.functions[n]!.artifact)!;
    const v = handoffView(M, s.program, fn);
    expect(v.ok).toBe(true);
    expect(v.title).toBe(`Downloads a zip: ${fn}.ts, ${fn}.test.ts (its checks, for vitest + fast-check), provenance.json and a README`);
    expect(HANDOFF_LABEL).toBe('Hand this to your data team (download)');
  });

  it('names the functions it uses when the closure comes along', () => {
    const s = SCENARIOS['composed-committed']();
    expect(handoffView(M, s.program, 'slugifyAll').title).toContain('the same two files for each function it uses (slugify)');
  });

  it('is not offered for a missing or stale function', () => {
    expect(handoffView(M, SCENARIOS['share-dialog']().program, 'nope')).toMatchObject({ ok: false, blocker: 'no such function' });
    const stale = SCENARIOS['repo-stale']();
    expect(handoffView(M, stale.program, 'median').ok).toBe(false);
  });

  it('builds the same zip as Eject', async () => {
    const s = SCENARIOS['share-dialog']();
    const fn = Object.keys(s.program.functions).find((n) => s.program.functions[n]!.artifact)!;
    const engine = { exportImage: async () => JSON.stringify({ datasets: {} }) } as unknown as Engine;
    const { filename, bytes } = await handoffZip(M, engine, s, fn, 0);
    expect(filename).toMatch(/\.zip$/);
    expect(bytes.length).toBeGreaterThan(100);
    await expect(handoffZip(M, engine, s, 'nope')).rejects.toThrow('no such function');
  });
});
