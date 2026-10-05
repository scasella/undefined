import { describe, expect, it } from 'vitest';
import { hashesFor } from '@scasella/undefined-engine/shared/hash';
import { ejectFiles } from '@scasella/undefined-engine/eject/eject';
import type { FunctionRecord, FunctionSpec } from '@scasella/undefined-engine/types';
import { DATASET_LIMITS } from '../../data/dataset';
import { AGREEMENT_FN } from '../model/agreements';
import { ejectFileNames, exampleCount, fmtMegabytes, honestLimits, teamFileView } from './teamFileView';

async function record(name: string): Promise<FunctionRecord> {
  const spec: FunctionSpec = {
    name, params: [{ name: 'rows', type: 'unknown[]' }], returns: 'number', doc: '', tests: '', properties: '',
    budgetMs: 100, maxAttempts: 3, origin: 'user',
  };
  const hashes = await hashesFor(spec);
  return {
    spec,
    ...hashes,
    artifact: {
      body: 'return 0;', source: '', js: '', returnType: 'number', ...hashes, model: 'm', codexVersion: '1', committedAt: 0,
      candidates: [], revision: 3,
    },
  } as FunctionRecord;
}

describe('teamFileView', () => {
  it('names exactly the files the real Eject writes', async () => {
    const real = ejectFiles({ functions: [await record(AGREEMENT_FN)], now: 0 });
    const ours = ejectFileNames(AGREEMENT_FN);
    expect(ours.folder).toBe(real.folder);
    expect(ours.files).toEqual(real.files.map((f) => f.path));
  });

  it('reads like the design, with the real names and counts', () => {
    const v = teamFileView();
    expect(v.zipLine).toBe('topCustomersByRevenue-eject.zip · 4 files');
    expect(v.items.map((i) => i.title)).toEqual(['The calculation', 'Its checks', 'The receipt', 'A read-me']);
    expect(v.items[1]!.desc).toBe(
      'your 6 examples, your locked answer, your 2 house rules, and the 100 made-up tables, made the same way every run',
    );
    expect(exampleCount()).toBe(6);
  });
});

describe('honestLimits', () => {
  it('states the real dataset limits', () => {
    expect(DATASET_LIMITS).toEqual({ maxRows: 20_000, maxBytes: 1_000_000 });
    expect(fmtMegabytes(1_000_000)).toBe('1 MB');
    expect(honestLimits('replay')[0]).toBe('CSV, TSV and JSON exports up to 20,000 rows and 1 MB of data. Not .xlsx yet: in Excel, use File › Save As › CSV.');
  });

  it('only calls the site a demo in replay mode', () => {
    expect(honestLimits('replay')[1]).toMatch(/^This public site is a demo/);
    expect(honestLimits('live')[1]).not.toMatch(/demo/);
  });
});
