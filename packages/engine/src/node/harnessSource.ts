/**
 * The Node host's in-realm harness as one IIFE string (sandbox/vmHarness.ts and everything it imports, fast-check
 * included). It is evaluated inside a `node:vm` realm that cannot `import`, so it must be a single self-contained
 * script.
 *
 * Source of the string, in order: an explicit prebuilt file (`harnessPath`, what a packaged CLI or Action ships), else
 * a bundle made on first use with rolldown (the bundler Vite 8 runs on, already installed in this workspace) from the
 * engine's TypeScript source. The bundle is made once per process. TypeScript is NOT in it: compiling stays on the
 * main thread; the realm only runs the emitted JavaScript.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const HARNESS_GLOBAL = '__undefinedHarness';
const ENTRY = fileURLToPath(new URL('../sandbox/vmHarness.ts', import.meta.url));

let bundled: Promise<string> | null = null;

/** Bundle sandbox/vmHarness.ts to an IIFE that defines `var __undefinedHarness = { deliver }`. */
export async function bundleHarness(): Promise<string> {
  let rolldown: typeof import('rolldown').rolldown;
  try {
    ({ rolldown } = await import('rolldown'));
  } catch (e) {
    throw new Error(
      `the gate harness is not prebuilt and rolldown is not installed to build it (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const bundle = await rolldown({ input: ENTRY, platform: 'neutral', logLevel: 'silent', resolve: { mainFields: ['module', 'main'] } });
  try {
    const { output } = await bundle.generate({ format: 'iife', name: HARNESS_GLOBAL, minify: false });
    const chunk = output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('rolldown produced no chunk for the gate harness');
    return chunk.code;
  } finally {
    await bundle.close();
  }
}

/** The harness source: the prebuilt file when given, else the (memoised) on-demand bundle. */
export function harnessSource(harnessPath?: string): Promise<string> {
  if (harnessPath) return readFile(harnessPath, 'utf8');
  bundled ??= bundleHarness().catch((e: unknown) => {
    bundled = null;
    throw e;
  });
  return bundled;
}
