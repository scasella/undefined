/**
 * TypeScript lib .d.ts texts embedded in the bundle. In source form this is null and the engine reads the libs from
 * the installed `typescript` package; scripts/build.mjs replaces this module with the texts (an Action runs from its
 * checked-out `dist/` with no node_modules).
 */
export const EMBEDDED_LIBS: Readonly<Record<string, string>> | null = null;
