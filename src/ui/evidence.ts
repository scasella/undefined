/** Pure view selectors for evidence, the mutation check and added checks (no business logic). */
import type { Artifact, EngineState, FunctionRecord, GenerationView } from '../types';
import { addedCheckReason } from '../shared/evidence';
import { hasMarker } from '../suggest/suggest';

/**
 * The committed artifact a generation view is about: the function's artifact when it is the one committed in that
 * generation (same revision) and still live. undefined otherwise (regrown, edited, rolled away).
 */
export function committedArtifact(gen: GenerationView | null, program: EngineState['program']): Artifact | undefined {
  if (!gen || gen.phase !== 'committed' || gen.kind === 'recheck' || gen.revision === undefined) return undefined;
  const rec = program.functions[gen.fn];
  const a = rec?.artifact;
  if (!rec || !a || a.revision !== gen.revision) return undefined;
  if (a.specHash !== rec.specHash || a.testsHash !== rec.testsHash) return undefined;
  return a;
}

export type AddedOutcome = 'pending' | 'recertified' | 'fails' | 'added';

/**
 * How an added suggestion went: re-certified (the committed function passed it), fails (the re-check rejected the
 * committed function), added (in the spec, nothing committed to re-check), or pending (the engine is on it).
 */
export function addedOutcome(rec: FunctionRecord | undefined, gen: GenerationView | null, check: { id: string; title: string }): AddedOutcome {
  if (!rec) return 'pending';
  const reason = addedCheckReason(check.title);
  if (rec.artifact?.recertified?.some((r) => r.reason === reason)) return 'recertified';
  if (gen?.kind === 'recheck' && gen.fn === rec.spec.name && gen.recheck?.reason === reason) return 'fails';
  return hasMarker(rec.spec.properties, check.id) ? 'added' : 'pending';
}
