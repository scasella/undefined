/**
 * certifyFile({ file, spec? }): certify() for files on disk, with spec discovery (docs/WORKSPACE-DESIGN.md §3.3) and the
 * Node gate host. NOT a secure sandbox: the certified code and its tests run in a worker_thread with a watchdog, see
 * host.ts.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { Json } from '../types';
import { certify, type CertifyInput, type CertifyResult, type SpecInput } from '../certifyModule';
import { loadTs } from '../gates/compile';
import { createNodeGateHost, type NodeGateHost, type NodeHostOptions } from './host';

export interface CertifyFileOptions extends Pick<CertifyInput, 'functions' | 'defaultBudgetMs' | 'mutation' | 'onGate' | 'onStart'> {
  file: string;
  /** An `undefined-spec` JSON file or a vitest test file; default: discovered next to `file`. */
  spec?: string;
  host?: NodeGateHost;
  hostOptions?: NodeHostOptions;
}

export interface CertifyFileResult extends CertifyResult {
  file: string;
  /** The spec or test file used, or null. */
  specFile: string | null;
  certifiedBy: Record<string, Json>;
}

/** Candidate spec files for `src/foo.ts`, first match wins (WORKSPACE-DESIGN.md §3.3). */
export function specCandidates(file: string): string[] {
  const dir = dirname(file);
  const stem = basename(file, extname(file));
  return [
    join(dir, `${stem}.undefined.json`),
    join(dir, `${stem}.test.ts`),
    join(dir, `${stem}.spec.ts`),
    join(dir, '__tests__', `${stem}.test.ts`),
    join(dir, '__tests__', `${stem}.spec.ts`),
  ];
}

export function discoverSpec(file: string, exists: (p: string) => boolean = existsSync): string | null {
  return specCandidates(file).find(exists) ?? null;
}

/** Whether an import specifier written in `testFile` refers to `sourceFile`. */
export function refersTo(testFile: string, specifier: string, sourceFile: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const strip = (p: string): string => p.replace(/\.(?:[cm]?[jt]s|tsx?)$/, '');
  return strip(resolve(dirname(testFile), specifier)) === strip(resolve(sourceFile));
}

const require = createRequire(import.meta.url);
function versionOf(pkg: string): string | null {
  try {
    return (require(`${pkg}/package.json`) as { version: string }).version;
  } catch {
    return null;
  }
}

/** What certified it: tool and runtime versions (a divergence from the site is traceable). Never sent anywhere. */
export async function certifiedBy(): Promise<Record<string, Json>> {
  const ts = await loadTs();
  const engine = (require('../../package.json') as { name: string; version: string });
  return {
    tool: engine.name,
    version: engine.version,
    node: process.versions.node,
    v8: process.versions.v8,
    icu: process.versions.icu ?? null,
    typescript: ts.version,
    fastCheck: versionOf('fast-check'),
    host: 'node worker_thread + node:vm realm with a watchdog (not a secure sandbox)',
  };
}

export async function certifyFile(o: CertifyFileOptions): Promise<CertifyFileResult> {
  const file = resolve(o.file);
  const source = await readFile(file, 'utf8');
  const specPath = o.spec ? resolve(o.spec) : discoverSpec(file);
  let spec: SpecInput | undefined;
  if (specPath) {
    const text = await readFile(specPath, 'utf8');
    const looksJson = specPath.endsWith('.json') || /^\s*\{/.test(text);
    spec = looksJson
      ? { kind: 'undefined-spec', text, file: specPath }
      : { kind: 'vitest', text, file: specPath, isSourceModule: (s) => refersTo(specPath, s, file) };
  }
  const host = o.host ?? (await createNodeGateHost(o.hostOptions));
  const by = await certifiedBy();
  const result = await certify({
    source,
    sourceFile: file,
    ...(spec ? { spec } : {}),
    host,
    certifiedBy: by,
    ...(o.functions ? { functions: o.functions } : {}),
    ...(o.defaultBudgetMs !== undefined ? { defaultBudgetMs: o.defaultBudgetMs } : {}),
    ...(o.mutation !== undefined ? { mutation: o.mutation } : {}),
    ...(o.onGate ? { onGate: o.onGate } : {}),
    ...(o.onStart ? { onStart: o.onStart } : {}),
  });
  return { ...result, file, specFile: specPath, certifiedBy: by };
}
