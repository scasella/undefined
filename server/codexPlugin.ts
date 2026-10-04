import type { Plugin } from 'vite';
import { createCodexService, handleRequest } from './codexService';

/** Maps a request path to a service route, accepting both `/generate…` and `<base>generate…`. */
export function routeFor(url: string | undefined, base: string): 'generate' | 'health' | null {
  if (!url) return null;
  const path = url.split('?')[0]!.replace(/\/+$/, '');
  const prefixes = new Set(['/', base.startsWith('/') ? (base.endsWith('/') ? base : `${base}/`) : '/']);
  for (const prefix of prefixes) {
    if (path === `${prefix}generate`) return 'generate';
    if (path === `${prefix}generate/health`) return 'health';
  }
  return null;
}

/**
 * The live generation service, dev server only (`apply: 'serve'`): `vite build` output and `vite preview`
 * have no service, so the static site runs in replay mode. It listens wherever Vite listens.
 */
export function codexService(): Plugin {
  return {
    name: 'undefined-codex-service',
    apply: 'serve',
    configureServer(server) {
      const service = createCodexService();
      const base = server.config.base;
      // codex runs detached (own process group), so Ctrl-C on vite would not reach it. Vite closes the server on
      // SIGTERM but not on SIGINT/SIGHUP, so for those we kill codex, remove ourselves and re-raise the signal.
      // Re-raising (rather than exiting) keeps whatever behaviour the other listeners had; e.g. the signal-exit
      // handler already installed in the vite process only re-raises to the default (exit) once it is alone.
      const dispose = () => service.dispose();
      const onSignal = (sig: NodeJS.Signals) => {
        dispose();
        process.removeListener(sig, onSignal);
        process.kill(process.pid, sig);
      };
      process.once('exit', dispose);
      process.on('SIGINT', onSignal);
      process.on('SIGHUP', onSignal);
      server.httpServer?.once('close', () => {
        dispose();
        process.removeListener('exit', dispose);
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGHUP', onSignal);
      });
      server.middlewares.use((req, res, next) => {
        const route = routeFor(req.url, base);
        if (!route) return next();
        handleRequest(service, route, req, res).catch((err: unknown) => {
          server.config.logger.error(`[undefined-codex-service] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ code: 'codex_failed', message: 'internal service error' }));
          } else {
            res.end();
          }
        });
      });
    },
  };
}
