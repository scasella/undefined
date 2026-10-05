import { defineConfig, type Plugin } from 'vitest/config';
import preact from '@preact/preset-vite';
import { codexService } from './server/codexPlugin';
import { cspMetaHtml, DEV_CSP, PRODUCTION_CSP } from './server/csp';

/**
 * Content-Security-Policy (server/csp.ts). The production policy goes into the BUILT index.html as a <meta> (GitHub
 * Pages cannot send headers); the sandbox workers inherit it because they are started from blob: URLs
 * (src/sandbox/spawn.ts). Dev and preview servers also send a policy header.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'undefined-csp',
    apply: 'build',
    // Right after <meta charset>, i.e. before every script and stylesheet: a meta policy governs only what follows it.
    transformIndexHtml: {
      order: 'post',
      handler: (html) => cspMetaHtml(html, PRODUCTION_CSP),
    },
  };
}

// `UNDEFINED_PREVIEW_CSP_HEADER=0 vite preview` serves the build exactly as GitHub Pages does (meta policy only, no
// header); scripts/sandbox-check.mjs uses it to prove the meta alone protects the workers.
const previewHeader = process.env.UNDEFINED_PREVIEW_CSP_HEADER !== '0';

// base './' so `npm run build` output works from any path (GitHub Pages project sites).
// The Codex generation service is dev-server middleware only: it is absent from the
// static build, which therefore runs in replay mode.
export default defineConfig({
  base: './',
  plugins: [preact(), codexService(), contentSecurityPolicy()],
  server: { open: true, headers: { 'Content-Security-Policy': DEV_CSP } },
  preview: { headers: previewHeader ? { 'Content-Security-Policy': PRODUCTION_CSP } : {} },
  worker: { format: 'es' },
  optimizeDeps: { include: ['typescript', 'fast-check'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  // setupFiles: the compile gate's TypeScript lib source (src/gates/libs.ts), as core/engine.ts registers it in the app.
  test: { name: 'site', environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'], setupFiles: ['./src/gates/libs.ts'] },
});
