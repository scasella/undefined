/**
 * Main-thread side of gates 2–4: spawns a fresh gate worker per run, watches every candidate call with a
 * watchdog, and hard-terminates the worker when a call overruns its budget (the only thing that stops a
 * naive `fibonacci(90)`). The decision logic (Watchdog, timeoutResults, crashResults) is pure and unit-tested;
 * the Worker glue in runExecutionGates is deliberately thin.
 */
import type { Diagnostic, GateResult } from '../types';
import { applyAttribution, EXEC_PHASES, invariantFailure, notReached, type ExecPhase } from './attribution';
import type { ExecGateInput } from './gateExecutor';

export type { ExecGateInput, PinnedCase } from './gateExecutor';

// Declared here, not in gateWorker.ts: importing the worker module on the main thread would scrub its globals.
export type ToWorker = { type: 'run'; input: ExecGateInput };
export type FromWorker =
  | { type: 'phase'; phase: ExecPhase }
  | { type: 'enter'; label: string }
  | { type: 'leave' }
  | { type: 'gate'; result: GateResult }
  | { type: 'done'; results: GateResult[] }
  | { type: 'error'; message: string };

export const DEFAULT_OVERALL_CAP_MS = 15_000;
const WATCHDOG_INTERVAL_MS = 25;

export interface Overrun {
  reason: 'call' | 'overall';
  /** The in-flight call (or, for the overall cap, the last call made, if any). */
  label?: string;
  phase: ExecPhase;
  elapsedMs: number;
  /** Time spent in the interrupted phase. */
  phaseMs: number;
}

/** Tracks worker messages against main-thread timestamps and decides when to pull the plug. */
export class Watchdog {
  phase: ExecPhase = 'tests'; // the worker may still be loading when the overall cap hits
  private phaseStartedAt: number;
  private readonly stack: Array<{ label: string; startedAt: number }> = [];
  private lastLabel: string | undefined;

  constructor(
    private readonly budgetMs: number,
    private readonly overallCapMs: number,
    private readonly runStartedAt: number,
  ) {
    this.phaseStartedAt = runStartedAt;
  }

  onPhase(phase: ExecPhase, t: number): void {
    this.phase = phase;
    this.phaseStartedAt = t;
  }

  onEnter(label: string, t: number): void {
    this.stack.push({ label, startedAt: t });
    this.lastLabel = label;
  }

  onLeave(): void {
    this.stack.pop();
  }

  /** The outermost in-flight call: that is the one whose budget is running. */
  inFlight(): { label: string; startedAt: number } | undefined {
    return this.stack[0];
  }

  check(t: number): Overrun | null {
    const call = this.inFlight();
    const phaseMs = t - this.phaseStartedAt;
    if (call && t - call.startedAt > this.budgetMs) {
      return { reason: 'call', label: call.label, phase: this.phase, elapsedMs: t - call.startedAt, phaseMs };
    }
    if (t - this.runStartedAt > this.overallCapMs) {
      return { reason: 'overall', label: call?.label ?? this.lastLabel, phase: this.phase, elapsedMs: t - this.runStartedAt, phaseMs };
    }
    return null;
  }
}

/** Results after the watchdog terminated the worker (attribution rule: Invariants reports `bounded`). */
export function timeoutResults(reported: readonly GateResult[], o: Overrun, budgetMs: number, overallCapMs: number): GateResult[] {
  const elapsedMs = Math.round(o.elapsedMs);
  const diag: Extract<Diagnostic, { kind: 'invariant' }> =
    o.reason === 'call'
      ? {
          kind: 'invariant',
          invariant: 'bounded',
          message: `${o.label} did not return within ${budgetMs} ms`,
          call: o.label,
          phase: o.phase,
          budgetMs,
          elapsedMs,
          detail: 'worker terminated by the watchdog',
        }
      : {
          kind: 'invariant',
          invariant: 'bounded',
          message: `the gates did not finish within the ${overallCapMs} ms overall cap`,
          call: o.label,
          phase: o.phase,
          budgetMs: overallCapMs,
          elapsedMs,
          detail: `worker terminated by the watchdog (overall cap)${o.label ? `; last call ${o.label}` : ''}`,
        };
  return applyAttribution(reported, o.phase, invariantFailure(diag, Math.round(o.phaseMs)), Math.round(o.phaseMs));
}

/** Results when the worker itself failed (load error, crash). Never accepted: the current gate fails. */
export function crashResults(reported: readonly GateResult[], phase: ExecPhase, message: string, call?: string): GateResult[] {
  const at = EXEC_PHASES.indexOf(phase);
  return EXEC_PHASES.map((gate, i): GateResult => {
    const kept = reported.find((r) => r.gate === gate);
    if (i < at) return kept ?? notReached(gate);
    if (i > at) return notReached(gate);
    return {
      gate,
      status: 'fail',
      ms: 0,
      summary: 'gate worker error',
      headline: `Rejected: gate worker error: ${message}`,
      note: 'gate worker error',
      diagnostics: [{ kind: 'test', name: '(gate worker)', message, error: message, ...(call ? { call } : {}) }],
    };
  });
}

/**
 * Keep the results for the requested phases (all when `phases` is undefined), plus an Invariants failure even when
 * 'invariants' was not requested (attribution rule: a pure/bounded violation is always reported). Same rule as
 * gateExecutor.ts phaseWanted (duplicated so the main thread does not load the executor).
 */
export function selectPhases(results: readonly GateResult[], phases: readonly ExecPhase[] | undefined): GateResult[] {
  if (!phases) return [...results];
  return results.filter((r) => (phases as readonly string[]).includes(r.gate) || (r.gate === 'invariants' && r.status === 'fail'));
}

/** What actually ran against a candidate, derived from its gate results (Artifact.evidence without compile/mutation). */
export interface GateEvidence {
  unitTests: number;
  pinnedTests: number;
  properties: Array<{ name: string; runs: number }>;
  sampledCalls: number;
}

/**
 * Evidence counts from the results gateExecutor produces (their summary formats are documented there). Counts what
 * RAN: a skipped/interrupted/not-requested gate contributes nothing; a spec error or load failure counts 0 tests.
 * Summaries in an older format (no per-property breakdown) yield no property entries rather than guessed names.
 */
export function evidenceFrom(results: readonly GateResult[]): GateEvidence {
  const out: GateEvidence = { unitTests: 0, pinnedTests: 0, properties: [], sampledCalls: 0 };
  const ran = (r: GateResult): boolean => r.status === 'pass' || r.status === 'fail';
  const tests = results.find((r) => r.gate === 'tests');
  if (tests && ran(tests) && tests.counts) {
    const split = parseTestsSummary(tests.summary);
    if (split && split.unit + split.pinned === tests.counts.total) {
      out.unitTests = split.unit;
      out.pinnedTests = split.pinned;
    } else {
      out.unitTests = tests.counts.total;
    }
  }
  const props = results.find((r) => r.gate === 'properties');
  if (props && ran(props)) out.properties = parsePropertyRuns(props.summary);
  const inv = results.find((r) => r.gate === 'invariants');
  if (inv && inv.status === 'pass') {
    const m = /\((\d+) sampled calls? replayed on frozen arguments\)/.exec(inv.summary);
    out.sampledCalls = m ? Number(m[1]) : 0;
  }
  return out;
}

function parseTestsSummary(summary: string): { unit: number; pinned: number } | null {
  let m = /^(\d+) unit tests? \+ (\d+) pinned passed$/.exec(summary);
  if (m) return { unit: Number(m[1]), pinned: Number(m[2]) };
  m = /^(\d+) pinned passed$/.exec(summary);
  if (m) return { unit: 0, pinned: Number(m[1]) };
  m = /^\d+\/\d+ tests? passed \((\d+) unit \+ (\d+) pinned\)$/.exec(summary);
  if (m) return { unit: Number(m[1]), pinned: Number(m[2]) };
  m = /^\d+\/(\d+) tests? passed$/.exec(summary);
  if (m) return { unit: Number(m[1]), pinned: 0 };
  return null;
}

/** `… (150 runs: "a" 100, "b \"x\"" 50)` → [{a,100},{b "x",50}]. Names are JSON strings, so a scanner is exact. */
function parsePropertyRuns(summary: string): Array<{ name: string; runs: number }> {
  const at = summary.indexOf(' runs: ');
  if (at < 0 || !summary.endsWith(')')) return [];
  const list = summary.slice(at + ' runs: '.length, -1);
  const out: Array<{ name: string; runs: number }> = [];
  const item = /\s*("(?:[^"\\]|\\.)*") (\d+)\s*(?:,|$)/y;
  let m: RegExpExecArray | null;
  while (item.lastIndex < list.length && (m = item.exec(list)) !== null) {
    try {
      out.push({ name: JSON.parse(m[1]!) as string, runs: Number(m[2]) });
    } catch {
      return [];
    }
  }
  return item.lastIndex === list.length || list.length === 0 ? out : [];
}

/**
 * Run Tests, Properties and Invariants for one candidate in a fresh Worker with a hard per-call timeout.
 * Resolves with one result per requested phase (`input.phases`, default all three: tests, properties, invariants),
 * plus an Invariants failure whenever an invariant was violated; never rejects. `onGate` fires once per reported
 * gate as each one becomes final, so the UI can light them one at a time.
 */
export function runExecutionGates(input: ExecGateInput, onGate?: (r: GateResult) => void): Promise<GateResult[]> {
  return new Promise((resolve) => {
    const overallCapMs = input.overallCapMs ?? DEFAULT_OVERALL_CAP_MS;
    const dog = new Watchdog(input.budgetMs, overallCapMs, performance.now());
    const reported: GateResult[] = [];
    let settled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let worker: Worker | undefined;

    const report = (r: GateResult): void => {
      if (reported.some((x) => x.gate === r.gate)) return;
      reported.push(r);
      try {
        onGate?.(r);
      } catch (e) {
        console.error('onGate callback threw', e);
      }
    };
    const settle = (all: GateResult[]): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearInterval(timer);
      worker?.terminate();
      const results = selectPhases(all, input.phases);
      for (const r of results) report(r);
      resolve(results);
    };
    const crash = (message: string): void => settle(crashResults(reported, dog.phase, message, dog.inFlight()?.label));

    try {
      worker = new Worker(new URL('./gateWorker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      crash(e instanceof Error ? e.message : String(e));
      return;
    }

    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      if (settled) return;
      const m = ev.data;
      const t = performance.now();
      switch (m.type) {
        case 'phase':
          dog.onPhase(m.phase, t);
          break;
        case 'enter':
          dog.onEnter(m.label, t);
          break;
        case 'leave':
          dog.onLeave();
          break;
        case 'gate':
          report(m.result);
          break;
        case 'done':
          settle(m.results);
          break;
        case 'error':
          crash(m.message);
          break;
      }
    };
    worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      crash(ev.message || 'the gate worker failed to start');
    };
    worker.onmessageerror = () => crash('a gate worker message could not be decoded');

    timer = setInterval(() => {
      const o = dog.check(performance.now());
      if (o) settle(timeoutResults(reported, o, input.budgetMs, overallCapMs));
    }, WATCHDOG_INTERVAL_MS);

    try {
      worker.postMessage({ type: 'run', input } satisfies ToWorker);
    } catch (e) {
      crash(`could not send the run to the gate worker: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}
