/**
 * A fake Engine over hand-written states (DEV ONLY). It mutates its signal minimally so the UI can be
 * exercised: setInput works, and submitting the opener plays the scripted sequence
 * opening → generating → rejected by properties → second candidate → committed.
 */
import { signal } from '@preact/signals';
import type { AttemptView, Engine, EngineState, FunctionSpec, GateResult, RestartId, SpecPatch } from '../../types';
import {
  EXAMPLES,
  MEDIAN_BAD,
  MEDIAN_GOOD,
  SCENARIOS,
  TAKEAWAY,
  candidate,
  eid,
  medianAcceptedGates,
  medianArtifact,
  medianGeneration,
  medianRejectedGates,
  openingTranscript,
  pendingGates,
  progressLines,
  revRow,
} from './fixtures';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Cheap stand-in for a hash change so specs visibly go stale. */
const bump = (hash: string): string => (hash[0] === 'f' ? '0' : 'f') + hash.slice(1);

export function createFixtureEngine(scenario: string): Engine {
  const make = SCENARIOS[scenario] ?? SCENARIOS.opening;
  const state = signal<EngineState>(make());
  let epoch = 0; // bumped by reset so a running script stops

  const update = (recipe: (s: EngineState) => void): void => {
    const next = structuredClone(state.value);
    recipe(next);
    state.value = next;
  };
  const notice = (tone: 'info' | 'error', text: string) => update((s) => void (s.notice = { tone, text }));
  const pushRevision = (s: EngineState, kind: EngineState['revisions'][number]['kind'], title: string, extra: { fn?: string; restoredFrom?: number } = {}) => {
    const id = (s.revisions[s.revisions.length - 1]?.id ?? 0) + 1;
    const fns = Object.keys(s.program.functions).length;
    const artifacts = Object.values(s.program.functions).filter((r) => r.artifact).length;
    s.revisions.push({ ...revRow({ id, kind, title, ...extra }, fns, artifacts), at: Date.now() });
    s.headRevision = id;
  };

  async function playAttempt(myEpoch: number, attempt: number, body: string, finalGates: GateResult[]): Promise<boolean> {
    const alive = () => epoch === myEpoch;
    const setAttempt = (patch: Partial<AttemptView>) =>
      update((s) => {
        const g = s.generation!;
        g.attempts[attempt - 1] = { ...g.attempts[attempt - 1], ...patch };
      });

    update((s) => {
      const g = s.generation!;
      g.attempt = attempt;
      g.phase = 'generating';
      g.progress = [];
      g.attempts.push({ attempt, status: 'generating', shown: '', gates: [] });
    });
    let prevT = 0;
    for (const line of progressLines()) {
      await sleep(Math.min(700, line.t - prevT));
      if (!alive()) return false;
      prevT = line.t;
      update((s) => void s.generation!.progress.push(line));
    }

    setAttempt({ status: 'typing' });
    const { typeCharMs, gateDwellMs } = state.value.pacing;
    for (let i = 3; i < body.length + 3; i += 3) {
      await sleep(typeCharMs * 3);
      if (!alive()) return false;
      setAttempt({ shown: body.slice(0, i) });
    }

    update((s) => void (s.generation!.phase = 'gating'));
    const gates = pendingGates();
    setAttempt({ status: 'gating', gates: [...gates] });
    for (let i = 0; i < gates.length; i++) {
      gates[i] = { ...gates[i], status: 'running' };
      setAttempt({ gates: [...gates] });
      await sleep(gateDwellMs);
      if (!alive()) return false;
      gates[i] = finalGates[i];
      if (finalGates[i].status === 'fail') {
        for (let j = i + 1; j < gates.length; j++) gates[j] = finalGates[j];
        setAttempt({ gates: [...gates] });
        break;
      }
      setAttempt({ gates: [...gates] });
    }
    // the prompt carries the rejected candidates before this one, as the engine's would
    const prior = state.value.generation!.attempts.slice(0, attempt - 1).flatMap((a) => (a.candidate ? [a.candidate] : []));
    const c = candidate(attempt, body, finalGates, '', { prior });
    setAttempt({ status: c.verdict === 'accepted' ? 'accepted' : 'rejected', candidate: c, shown: body });
    return c.verdict === 'accepted';
  }

  async function playOpening(call: string): Promise<void> {
    const myEpoch = ++epoch;
    update((s) => {
      s.busy = true;
      s.hints.opener = false;
      s.replInput = '';
      s.repl.push(...openingTranscript(call));
      s.generation = medianGeneration([], { call, progress: [] });
    });
    if (await playAttempt(myEpoch, 1, MEDIAN_BAD, medianRejectedGates())) return;
    await sleep(state.value.pacing.gateDwellMs * 2);
    if (epoch !== myEpoch) return;
    if (!(await playAttempt(myEpoch, 2, MEDIAN_GOOD, medianAcceptedGates()))) return;
    update((s) => {
      const g = s.generation!;
      s.program.functions.median.artifact = medianArtifact(2, g.attempts.map((a) => a.candidate!));
      pushRevision(s, 'commit', 'median certified (attempt 2 of 3, rejected by properties first)', { fn: 'median' });
      g.phase = 'committed';
      g.revision = s.headRevision;
      s.repl.push({ kind: 'output', id: eid('out'), value: '2.5', ms: 0.4, label: 'generated', detail: `revision ${s.headRevision}` });
      s.busy = false;
    });
  }

  const engine: Engine = {
    state,
    async init() {},
    setInput(text) {
      update((s) => void (s.replInput = text));
    },
    async submit() {
      const s0 = state.value;
      const text = s0.replInput.trim();
      if (!text || s0.busy) return;
      const median = s0.program.functions.median;
      const m = /^median\((\[[^\]]*\])\)$/.exec(text);
      if (m && median && !median.artifact) return playOpening(text);
      update((s) => {
        s.replInput = '';
        s.repl.push({ kind: 'input', id: eid('in'), text });
        if (m && median?.artifact) {
          let value = 'NaN';
          try {
            value = String(medianOf(JSON.parse(m[1]) as number[]));
          } catch {
            /* fixture: leave NaN */
          }
          s.repl.push({ kind: 'output', id: eid('out'), value, ms: 0.1, label: 'cached artifact', detail: `certified r${median.artifact.revision}` });
          if (!s.repl.some((e) => e.kind === 'takeaway')) s.repl.push({ kind: 'takeaway', id: eid('tk'), text: TAKEAWAY });
        } else {
          s.repl.push({ kind: 'info', id: eid('if'), text: `fixture engine: only median(...) is scripted (scenario "${scenario}")`, tone: 'muted' });
        }
      });
    },
    async upsertSpec(spec: FunctionSpec) {
      update((s) => {
        s.program.functions[spec.name] = { spec, specHash: 'e'.repeat(64), testsHash: 'e'.repeat(64), artifact: null };
        pushRevision(s, 'spec-edit', `${spec.name} spec created`, { fn: spec.name });
      });
    },
    async editSpec(fn: string, patch: SpecPatch) {
      update((s) => {
        const rec = s.program.functions[fn];
        if (!rec) return;
        rec.spec = { ...rec.spec, ...patch };
        if ('tests' in patch || 'properties' in patch) rec.testsHash = bump(rec.testsHash);
        if (Object.keys(patch).some((k) => k !== 'tests' && k !== 'properties' && k !== 'maxAttempts')) rec.specHash = bump(rec.specHash);
        pushRevision(s, 'spec-edit', `${fn} spec edited: ${Object.keys(patch).join(', ')}`, { fn });
      });
    },
    async breakIt(exampleId: string) {
      const ex = EXAMPLES.find((e) => e.id === exampleId);
      if (ex) await engine.editSpec(ex.fn, { doc: `${state.value.program.functions[ex.fn]?.spec.doc ?? ''} (${ex.breakIt.label})` });
    },
    async loadExample(exampleId: string) {
      const ex = state.value.examples.find((e) => e.id === exampleId);
      if (ex) engine.setInput(ex.call);
    },
    async rollback(id: number) {
      update((s) => pushRevision(s, 'rollback', `rolled back to r${id}`, { restoredFrom: id }));
    },
    async invokeRestart(entryId: string, restart: RestartId) {
      update((s) => {
        const e = s.repl.find((x) => x.id === entryId);
        if (e?.kind === 'error') e.resolved = true;
        if (restart === 'edit-spec') {
          // like the engine: point the UI at the function the error is about (fixture errors carry no fn)
          const fn = s.generation?.fn ?? Object.keys(s.program.functions)[0];
          if (fn) s.focusSpec = { fn, nonce: (s.focusSpec?.nonce ?? 0) + 1 };
          return;
        }
        s.repl.push({ kind: 'info', id: eid('if'), text: `fixture: restart "${restart}" chosen`, tone: 'muted' });
      });
    },
    async recheckService() {
      update((s) => void (s.service = { state: 'checking' }));
      await sleep(800);
      update((s) => {
        s.service = {
          state: 'degraded',
          problem: { code: 'not_logged_in', message: 'Codex CLI 0.157.2 is installed but not logged in.', fix: ['codex login'] },
          codexVersion: '0.157.2',
          model: 'gpt-6-luna',
        };
      });
    },
    async exportImage() {
      return JSON.stringify({ format: 'undefined-image', version: 1, exportedAt: new Date().toISOString(), head: state.value.headRevision, revisions: [] }, null, 2);
    },
    async importImage(json: string) {
      try {
        JSON.parse(json);
        update((s) => pushRevision(s, 'import', 'imported image (fixture: contents ignored)'));
      } catch (e) {
        notice('error', `Import failed: ${(e as Error).message}`);
      }
    },
    exportRecording() {
      return null;
    },
    async resetImage() {
      epoch++;
      state.value = SCENARIOS.opening();
    },
  };
  return engine;
}
