// The site's TypeScript lib source for the compile gate (packages/engine/src/gates/compile.ts setLibSource). Imported
// for its side effect by core/engine.ts and by the vitest setup of every config that compiles.
//
// Lazy loaders only; nothing is fetched until a loader is called. Narrowed to the es*/decorators family (the closure of
// lib.es2022.d.ts) so the build does not emit unused multi-MB chunks for lib.dom / lib.webworker. The pattern is
// relative because npm workspaces hoist `typescript` to the repository root's node_modules, outside the Vite root.
import { setLibSource } from '@scasella/undefined-engine/gates/compile';

const PREFIX = '../../../../node_modules/typescript/lib/';
const libLoaders = import.meta.glob<string>('../../../../node_modules/typescript/lib/lib.{es,decorators}*.d.ts', {
  query: '?raw',
  import: 'default',
});

setLibSource(async (file) => {
  const load = libLoaders[`${PREFIX}${file}`];
  if (!load) throw new Error(`TypeScript lib file not found: ${file}`);
  return load();
});
