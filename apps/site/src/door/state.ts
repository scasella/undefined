/**
 * Shared UI state for the front door: the engine handle, the session telemetry counter, the example-rows preference
 * and what the shell's top bar shows (file chip, "running" pulse). Pure formatters are exported for tests.
 */
import { computed, signal, type ReadonlySignal } from '@preact/signals';
import type { Engine, EngineState } from '@scasella/undefined-engine/types';

/** The engine, set once by <App/>. */
export const engineRef = signal<Engine | null>(null);

/** The engine state; reading it in a component subscribes that component (as src/ui/App.tsx does). */
export function useEngineState(engine: Engine): EngineState {
  return engine.state.value;
}

// ───────────── session telemetry ("checks this session N · last 0.41 s") ─────────────

export interface SessionTelemetry {
  checks: number;
  lastMs: number | null;
}

export const session = signal<SessionTelemetry>({ checks: 0, lastMs: null });

/** Add `n` checks that just ran (taking `ms` in total for the run) to the session counter. */
export function recordChecks(n: number, ms: number): void {
  const s = session.value;
  session.value = { checks: s.checks + Math.max(0, Math.round(n)), lastMs: Math.max(0, ms) };
}

/** Pure: the telemetry counter text. Before any run: "checks this session 0". */
export function formatSession(s: SessionTelemetry): string {
  const head = 'checks this session ' + s.checks.toLocaleString('en-US');
  return s.lastMs === null ? head : head + ' · last ' + (s.lastMs / 1000).toFixed(2) + ' s';
}

// ───────────── what the AI sees: column names + 3 example rows, or types only ─────────────

/** Whether example rows go with the column names (engine `send.samples`). False until the engine exists. */
export const sendRows: ReadonlySignal<boolean> = computed(() => engineRef.value?.state.value.send.samples ?? false);

/** Set the example-rows preference (Engine.setSendSamples; in replay mode it is only remembered, nothing is sent). */
export function setSendRows(on: boolean): void {
  engineRef.value?.setSendSamples(on);
}

/** Pure: the short form in the privacy strip. */
export const rowsShort = (on: boolean): string => (on ? '3 example rows' : 'types only');

// ───────────── what the shell's top bar shows, set by the page ─────────────

/** The file chip in the top bar ("orders.csv · 332 rows · 10 columns"); null hides it. Pages set it. */
export const shellFileChip = signal<string | null>(null);
/** True while a run (or the landing's playback) is in progress: the demo pill's dot pulses. Pages set it. */
export const shellRunning = signal(false);

// ───────────── version line for the honesty bar ─────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Pure: "5 Oct 2026" (local time). */
export function formatDay(at: number): string {
  const d = new Date(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Pure: the head version and the day it was made, from real engine state. */
export function headVersion(state: Pick<EngineState, 'headRevision' | 'revisions'>, now: number = Date.now()): { version: number; date: string } {
  const head = state.revisions.find((r) => r.id === state.headRevision);
  return { version: state.headRevision, date: formatDay(head?.at ?? now) };
}
