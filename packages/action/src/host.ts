/**
 * The Node gate host for the Action, and what certified the code.
 *
 * NOT A SECURE SANDBOX. The PR's functions and tests run in a Node `worker_thread` with a watchdog, inside a `node:vm`
 * realm with no Node APIs (packages/engine/src/node/host.ts). That catches accidental impurity, runaway loops and
 * runaway memory; it does not contain code written to escape. The isolation boundary is the GitHub runner.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { __version as fastCheckVersion } from 'fast-check';
import type { Json } from '@scasella/undefined-engine';
import { loadTs } from '@scasella/undefined-engine/gates/compile';
import { createNodeGateHost, type NodeGateHost } from '@scasella/undefined-engine/node';
import pkg from '../package.json' with { type: 'json' };
import { EMBEDDED_LIBS } from './embedded';

/** dist/harness.js next to the bundle when running from dist/; otherwise the engine bundles it from source. */
export function prebuiltHarness(): string | undefined {
  const p = join(dirname(fileURLToPath(import.meta.url)), 'harness.js');
  return existsSync(p) ? p : undefined;
}

export async function actionHost(): Promise<NodeGateHost> {
  const harnessPath = prebuiltHarness();
  const libs = EMBEDDED_LIBS;
  return createNodeGateHost({
    ...(harnessPath ? { harnessPath } : {}),
    ...(libs
      ? {
          libs: async (file: string) => {
            const t = Object.prototype.hasOwnProperty.call(libs, file) ? libs[file] : undefined;
            if (t === undefined) throw new Error(`TypeScript lib file not found: ${file}`);
            return t;
          },
        }
      : {}),
  });
}

/** Tool and runtime versions, merged into each accepted function's provenance. Never sent anywhere. */
export async function certifiedBy(): Promise<Record<string, Json>> {
  const ts = await loadTs();
  return {
    tool: pkg.name,
    version: pkg.version,
    node: process.versions.node,
    v8: process.versions.v8,
    icu: process.versions.icu ?? null,
    typescript: ts.version,
    fastCheck: fastCheckVersion,
    host: 'node worker_thread + node:vm realm with a watchdog (not a secure sandbox)',
  };
}
