/**
 * "Eject": download a committed function as a zip (<name>.ts, <name>.test.ts, provenance.json, README.md) that runs
 * on its own with vitest + fast-check. The files are built by src/eject; this is only the button and the download.
 */
import { useState } from 'preact/hooks';
import type { Engine, EngineState, Hash, Json } from '../../types';
import { ejectBlocker, ejectZip } from '../../eject/eject';
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
  const blocker = ejectBlocker(rec);
  if (blocker || !rec) {
    showNotice('error', `Cannot eject ${fn}: ${blocker}.`);
    return;
  }
  try {
    // Dataset rows live only in the image; fetch them only when a pin needs them.
    let datasets: Record<Hash, Json> | undefined;
    if ((rec.spec.pins ?? []).some((p) => p.args.some((a) => a.kind === 'dataset'))) {
      datasets = (JSON.parse(await engine.exportImage()) as { datasets?: Record<Hash, Json> }).datasets;
    }
    const { filename, bytes } = ejectZip({ functions: [rec], datasets, datasetRefs: state.datasets, revisions: state.revisions, now: Date.now() });
    downloadBytes(filename, bytes, 'application/zip');
    showNotice('info', `Downloaded ${filename}: ${fn}.ts, its tests for vitest + fast-check, provenance.json and a README.`);
  } catch (e) {
    showNotice('error', `Could not eject ${fn}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function EjectButton({ state, engine, fn }: { state: EngineState; engine: Engine; fn: string }) {
  const [busy, setBusy] = useState(false);
  const blocker = ejectBlocker(state.program.functions[fn]);
  return (
    <button
      type="button"
      class="btn btn-ghost btn-xs eject-btn"
      disabled={!!blocker || busy}
      title={
        blocker
          ? `Cannot eject: ${blocker}`
          : `Download ${fn} as a zip: ${fn}.ts, ${fn}.test.ts (its tests, pins and properties for vitest + fast-check), provenance.json and a README`
      }
      onClick={() => {
        setBusy(true);
        void ejectFunction(engine, state, fn).finally(() => setBusy(false));
      }}
    >
      Eject
    </button>
  );
}
