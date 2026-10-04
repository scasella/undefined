/** Test fixtures for the suggestion engine (specs and program records). Used only by src/suggest/*.test.ts. */
import type { FunctionRecord, FunctionSpec, Program } from '../types';

export function makeSpec(name: string, params: Array<[string, string]>, returns: string | null, extra: Partial<FunctionSpec> = {}): FunctionSpec {
  return {
    name,
    params: params.map(([n, type]) => ({ name: n, type })),
    returns,
    doc: '',
    tests: '',
    properties: '',
    budgetMs: 1000,
    maxAttempts: 3,
    origin: 'user',
    ...extra,
  };
}

export function makeRecord(spec: FunctionSpec, artifact?: { js: string; returnType: string }): FunctionRecord {
  return {
    spec,
    specHash: 'spec',
    testsHash: 'tests',
    artifact: artifact
      ? {
          body: '',
          source: '',
          js: artifact.js,
          returnType: artifact.returnType,
          specHash: 'spec',
          testsHash: 'tests',
          model: 'test',
          codexVersion: 'test',
          committedAt: 0,
          candidates: [],
          revision: 1,
        }
      : null,
  };
}

export function programOf(...records: FunctionRecord[]): Program {
  return { functions: Object.fromEntries(records.map((r) => [r.spec.name, r])) };
}
