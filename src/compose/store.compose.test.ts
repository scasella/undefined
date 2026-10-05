import { describe, expect, it } from 'vitest';
import type { Artifact, FunctionSpec, Image, Revision } from '../types';
import { imageHasDeps, toImage, validateImage } from '../core/store';

const spec = (name: string): FunctionSpec => ({ name, params: [], returns: 'number', doc: '', tests: '', properties: '', budgetMs: 1000, maxAttempts: 3, origin: 'user' });
const art = (deps?: Artifact['deps']): Artifact => ({
  body: 'return 1;',
  source: 's',
  js: 'j',
  returnType: 'number',
  specHash: 'x',
  testsHash: 'y',
  model: 'm',
  codexVersion: 'c',
  committedAt: 0,
  candidates: [],
  revision: 1,
  ...(deps ? { deps } : {}),
});
const H = 'a'.repeat(64);
const image = (deps?: Artifact['deps']): Image => {
  const rev: Revision = { id: 1, at: 0, kind: 'init', title: 't', env: {}, program: { functions: { f: { spec: spec('f'), specHash: 'x', testsHash: 'y', artifact: art(deps) } } } };
  return JSON.parse(JSON.stringify(toImage([rev], 1))) as Image;
};

describe('images with dependencies', () => {
  it('are written as version 3 and read back with their stamps', () => {
    const img = image({ g: { hash: H, revision: 2 } });
    expect(img.version).toBe(3);
    expect(imageHasDeps(img.revisions)).toBe(true);
    const v = validateImage(img);
    expect(v.ok && v.image.revisions[0]!.program.functions.f!.artifact!.deps).toEqual({ g: { hash: H, revision: 2 } });
  });

  it('refuse malformed stamps and a version that cannot hold them', () => {
    const bad = (deps: unknown) => {
      const img = image({ g: { hash: H, revision: 2 } });
      (img.revisions[0]!.program.functions.f!.artifact as unknown as { deps: unknown }).deps = deps;
      return validateImage(img);
    };
    expect(bad({})).toMatchObject({ ok: false, error: expect.stringContaining('must not be empty') });
    expect(bad({ g: { hash: 'nope', revision: 2 } })).toMatchObject({ ok: false, error: expect.stringContaining('must be a sha256 hash') });
    expect(bad({ g: { hash: H, revision: 0 } })).toMatchObject({ ok: false });
    expect(bad({ 'not a name': { hash: H, revision: 2 } })).toMatchObject({ ok: false, error: expect.stringContaining('must be a function name') });
    expect(validateImage({ ...image({ g: { hash: H, revision: 2 } }), version: 1 })).toEqual({ ok: false, error: 'version must be 3: a function in the image calls another (a version 3 field)' });
  });

  it('a program without dependencies is version 1 and its artifacts have no deps key', () => {
    const img = image();
    expect(img.version).toBe(1);
    expect('deps' in img.revisions[0]!.program.functions.f!.artifact!).toBe(false);
    const v = validateImage(img);
    expect(v.ok && 'deps' in v.image.revisions[0]!.program.functions.f!.artifact!).toBe(false);
  });
});
