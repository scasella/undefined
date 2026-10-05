/**
 * URLs of the bundled worker scripts. `?worker&url` makes Vite bundle each worker as its own file (in dev it serves
 * the module directly) and gives back its URL, without starting it: spawn.ts starts it through a blob wrapper.
 * Kept in this one tiny module so tests running in Node can stub it.
 */
import gateWorkerUrl from './gateWorker.ts?worker&url';
import runtimeWorkerUrl from './runtimeWorker.ts?worker&url';

export { gateWorkerUrl, runtimeWorkerUrl };
