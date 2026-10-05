/**
 * "Hand this to your data team": the engine's ejection (eject/eject.ts): a zip with <fn>.ts, <fn>.test.ts (its
 * examples, locked answers and house rules for vitest + fast-check), provenance.json and a README, which runs on its own. Nothing here is illustrative: it is the real program.
 */
import type { Engine, EngineState, Hash, Json, Program } from '@scasella/undefined-engine/types';

/** The engine's eject module, loaded on demand (it is not needed on the landing; the engine chunk already uses it). */
export type EjectModule = typeof import('@scasella/undefined-engine/eject/eject');
export const loadEject = (): Promise<EjectModule> => import('@scasella/undefined-engine/eject/eject');

export const HANDOFF_LABEL = 'Hand this to your data team (download)';

export interface HandoffView {
  /** False when the function is missing or cannot be ejected (then the link is not offered). */
  ok: boolean;
  /** The engine's reason when it cannot be ejected. */
  blocker: string | null;
  /** The title on the link: what is in the zip. */
  title: string;
}

/** Pure: whether `fn` can be handed off now, and what the download holds. */
export function handoffView({ ejectBlockerIn, ejectClosure }: EjectModule, program: Program, fn: string): HandoffView {
  const rec = program.functions[fn];
  if (!rec) return { ok: false, blocker: 'no such function', title: '' };
  const blocker = ejectBlockerIn(program, fn);
  if (blocker) return { ok: false, blocker, title: '' };
  const callees = ejectClosure(program, fn).slice(1).map((r) => r.spec.name);
  const uses = callees.length ? `, the same two files for each function it uses (${callees.join(', ')})` : '';
  return {
    ok: true,
    blocker: null,
    title: `Downloads a zip: ${fn}.ts, ${fn}.test.ts (its checks, for vitest + fast-check)${uses}, provenance.json and a README`,
  };
}

/** Build the zip for `fn` with the engine's ejectZip. Throws the engine's reason when it cannot. */
export async function handoffZip(
  { ejectBlockerIn, ejectClosure, ejectZip }: EjectModule,
  engine: Engine,
  state: EngineState,
  fn: string,
  now = Date.now(),
): Promise<{ filename: string; bytes: Uint8Array }> {
  const blocker = ejectBlockerIn(state.program, fn);
  if (blocker || !state.program.functions[fn]) throw new Error(blocker ?? 'no such function');
  const closure = ejectClosure(state.program, fn);
  // dataset rows live only in the image: fetch them only when a locked answer needs them
  let datasets: Record<Hash, Json> | undefined;
  if (closure.some((r) => (r.spec.pins ?? []).some((p) => p.args.some((a) => a.kind === 'dataset')))) {
    datasets = (JSON.parse(await engine.exportImage()) as { datasets?: Record<Hash, Json> }).datasets;
  }
  return ejectZip({ functions: closure, datasets, datasetRefs: state.datasets, revisions: state.revisions, now });
}

/** Save bytes as a file in the browser. */
export function downloadBytes(filename: string, bytes: Uint8Array, type = 'application/zip'): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
