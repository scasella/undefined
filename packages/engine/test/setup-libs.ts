// vitest setup for the engine's own tests: the compile gate reads the TypeScript lib .d.ts files from the installed
// `typescript` package (the Node host, src/node/libs.ts; the site registers a Vite glob instead, apps/site/src/gates/libs.ts).
import { useNodeLibs } from '../src/node/libs';

useNodeLibs();
