/**
 * The engine's Node entry: the gate host (a worker_thread with a watchdog — NOT a secure sandbox, see host.ts),
 * TypeScript libs from disk, and certifyFile(). Never imported by the site.
 */
export { createNodeGateHost, nodeGateWorker, spawnRealmWorker, DEFAULT_HEAP_MB, DEFAULT_STACK_MB, DEFAULT_YOUNG_MB } from './host';
export type { NodeGateHost, NodeHostOptions } from './host';
export { useNodeLibs, typescriptLibDir } from './libs';
export { harnessSource, bundleHarness } from './harnessSource';
export { certifyFile, certifiedBy, discoverSpec, refersTo, specCandidates } from './certifyFile';
export type { CertifyFileOptions, CertifyFileResult } from './certifyFile';
