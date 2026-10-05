/**
 * The engine's host-neutral public surface (the CLI and the Action import this plus `./node`). The site imports
 * modules by subpath instead, so its code-split chunks stay as they were. Nothing here generates code.
 */
export { certify } from './certifyModule';
export type { CertifyInput, CertifyResult, FunctionResult, SpecInput } from './certifyModule';
export {
  certifyBody,
  certifiedProvenance,
  classifyMutant,
  evidenceOf,
  execGateInput,
  exitCodeFor,
  infraFailure,
  isUngated,
  mutationCheck,
  specChecks,
  specErrorGates,
  MUTANT_CALL_BUDGET_MS,
} from './certify';
export type { Certification, CertifyBodyInput, CertifyVerdict, GateHost, MutationCheckInput } from './certify';
export { extractFunctions } from './ingest/source';
export type { ExtractedFunction, IngestIssue } from './ingest/source';
export { parseSpecFile, specFor, validateSpecFile, SpecFileError, SPEC_FORMAT, SPEC_VERSION } from './ingest/specFile';
export type { SpecFile, SpecFileEntry } from './ingest/specFile';
export { ingestVitest } from './ingest/vitest';
export type { VitestIngest, VitestSpec } from './ingest/vitest';
export { SUPPORTED_MATCHERS } from './ingest/expectShim';
export { runExecutionGates, DEFAULT_OVERALL_CAP_MS } from './sandbox/gateRunner';
export type { ExecGateInput, GateWorkerPort, WorkerFailure } from './sandbox/gateRunner';
export { describeEvidence, survivorLine } from './shared/evidence';
export type * from './types';
