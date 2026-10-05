/**
 * The compile gate's TypeScript lib files, read from the installed `typescript` package (the same files the site
 * bundles through its Vite glob, apps/site/src/gates/libs.ts). The compiler sees the same virtual file system in both
 * hosts (`/node_modules/typescript/lib`, `/candidate.ts`), so diagnostics, line mapping and emitted JavaScript are the
 * same for the same TypeScript version.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { setLibSource } from '../gates/compile';

let installed = false;

/** The directory of the installed TypeScript's lib .d.ts files. */
export function typescriptLibDir(): string {
  return dirname(createRequire(import.meta.url).resolve('typescript/lib/lib.es2022.d.ts'));
}

/** Register the disk lib source once per process (idempotent). */
export function useNodeLibs(): void {
  if (installed) return;
  installed = true;
  const dir = typescriptLibDir();
  setLibSource(async (file) => {
    if (!/^lib\.[\w.]+\.d\.ts$/.test(file)) throw new Error(`TypeScript lib file not found: ${file}`);
    try {
      return await readFile(join(dir, file), 'utf8');
    } catch {
      throw new Error(`TypeScript lib file not found: ${file}`);
    }
  });
}
