/**
 * "Eject": download a committed function as a zip (<name>.ts, <name>.test.ts, provenance.json, README.md) that runs
 * on its own with vitest + fast-check. The files are built by src/eject; this is only the button and the download.
 */
import { useState } from 'preact/hooks';
import type { Engine, EngineState, Hash, Json } from '../../types';
import { ejectBlockerIn, ejectClosure, ejectZip } from '../../eject/eject';
import { decisionsOf } from '../../decide/decisions';

/** " (with 2 of your decisions)" when the spec holds decisions; empty otherwise. */
function withDecisions(n: number): string {
  return n === 0 ? '' : n === 1 ? ' (with your decision)' : ` (with ${n} of your decisions)`;
}
import { showNotice } from '../uiState';

function downloadBytes(filename: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function ejectFunction(engine: Engine, state: EngineState, fn: string): Promise<void> {
  const rec = state.program.functions[fn];
  const blocker = ejectBlockerIn(state.program, fn);
  if (blocker || !rec) {
    showNotice('error', `Cannot eject ${fn}: ${blocker}.`);
    return;
  }
  try {
    // Dataset rows live only in the image; fetch them only when a pin needs them.
    // a function that calls other generated functions is ejected with them (each with its own tests)
    const closure = ejectClosure(state.program, fn);
    let datasets: Record<Hash, Json> | undefined;
    if (closure.some((r) => (r.spec.pins ?? []).some((p) => p.args.some((a) => a.kind === 'dataset')))) {
      datasets = (JSON.parse(await engine.exportImage()) as { datasets?: Record<Hash, Json> }).datasets;
    }
    const { filename, bytes } = ejectZip({ functions: closure, datasets, datasetRefs: state.datasets, revisions: state.revisions, now: Date.now() });
    downloadBytes(filename, bytes, 'application/zip');
    const callees = closure.slice(1).map((r) => r.spec.name);
    showNotice(
      'info',
      `Downloaded ${filename}: ${fn}.ts, its tests${withDecisions(decisionsOf(rec.spec).length)} for vitest + fast-check${callees.length ? `, the functions it uses (${callees.join(', ')}) with their tests` : ''}, provenance.json and a README.`,
    );
  } catch (e) {
    showNotice('error', `Could not eject ${fn}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** "Eject" alone; "Eject median and 2 functions it uses" when the closure comes along. */
export function ejectLabel(fn: string, callees: number): string {
  if (callees === 0) return 'Eject';
  return `Eject ${fn} and ${callees === 1 ? '1 function' : `${callees} functions`} it uses`;
}

export function EjectButton({ state, engine, fn }: { state: EngineState; engine: Engine; fn: string }) {
  const [busy, setBusy] = useState(false);
  const rec = state.program.functions[fn];
  const blocker = ejectBlockerIn(state.program, fn);
  const decided = rec ? decisionsOf(rec.spec).length : 0;
  // a function that calls other generated functions is ejected with them: the label says so before the click
  const callees = ejectClosure(state.program, fn).slice(1).map((r) => r.spec.name);
  return (
    <button
      type="button"
      class="btn btn-ghost btn-xs eject-btn"
      disabled={!!blocker || busy}
      title={
        blocker
          ? `Cannot eject: ${blocker}`
          : `Download ${fn} as a zip: ${fn}.ts, ${fn}.test.ts (its tests, pins and properties${decided ? `, and ${decided === 1 ? 'your decision' : `your ${decided} decisions`}` : ''} for vitest + fast-check)${callees.length ? `, the same two files for each function it uses (${callees.join(', ')})` : ''}, provenance.json${decided ? ' (which lists each decision)' : ''} and a README`
      }
      onClick={() => {
        setBusy(true);
        void ejectFunction(engine, state, fn).finally(() => setBusy(false));
      }}
    >
      {ejectLabel(fn, callees.length)}
    </button>
  );
}
