/**
 * A fake Engine over hand-written states (DEV ONLY). It mutates its signal minimally so the UI can be
 * exercised: setInput works, and submitting the opener plays the scripted sequence
 * opening → generating → rejected by properties → second candidate → committed.
 */
import { signal } from '@preact/signals';
import type { AttemptView, DatasetRef, Diagnostic, Engine, EngineState, ExpectationPreview, FunctionSpec, GapRef, GateResult, RestartId, SpecPatch } from '../../types';
import { gapQuestion as buildGapQuestion } from '../../decide/gaps';
import { buildDecision, decisionsOf, decisionSummary, upsertDecision, type RulingSpec } from '../../decide/decisions';
import { decidedReason, removedDecisionReason } from '../../shared/evidence';
import { specWithDecisions } from '../../core/program';
import { encodeValue } from '../../shared/serialize';
import { buildData, datasetPreview, PINNED_INFO } from '../../core/engine';
import { addedChecks, dataDrawerOpen, decideOpen, decidePrefill, lowerTab, pendingRecording, selection, sessionLogOpen, shareOpen } from '../uiState';
import { parseRecordingText } from '../../share/source';
import { suggestProperties } from '../../suggest/suggest';
import { appendProperty } from '../../suggest/apply';
import { addedCheckReason } from '../../shared/evidence';
import {
  EXAMPLES,
  FIXTURE_PREVIEW,
  MEDIAN_BAD,
  MEDIAN_GOOD,
  SCENARIOS,
  SCENARIO_UI,
  TAKEAWAY,
  medianPinnable,
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
  const ui = SCENARIO_UI[scenario];
  if (ui?.drawer) dataDrawerOpen.value = true;
  if (ui?.tab) lowerTab.value = ui.tab;
  if (ui?.added) addedChecks.value = ui.added();
  if (ui?.share) shareOpen.value = true;
  if (ui?.sessionLog) sessionLogOpen.value = true;
  if (ui?.pending) pendingRecording.value = ui.pending();
  if (ui?.decide && state.value.generation) {
    const { attempt, ...prefill } = ui.decide;
    selection.value = { genId: state.value.generation.id, attempt };
    decidePrefill.value = prefill;
    decideOpen.value = `${state.value.generation.id}:${attempt}`;
  }
  let logEntries = state.value.sessionLog?.count ?? 0;

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
      s.repl.push({ kind: 'output', id: eid('out'), value: '2.5', ms: 0.4, label: 'generated', detail: `revision ${s.headRevision}`, pinnable: medianPinnable(call.slice('median('.length, -1), 2.5) });
      s.busy = false;
    });
  }

  /** The diagnostic a GapRef points at in the fixture state (the fixture keeps no history: the head artifact). */
  const diagnosticAt = (ref: GapRef): Diagnostic | null => {
    if ('diagnostic' in ref) return ref.diagnostic;
    const a = state.value.program.functions[ref.fn]?.artifact;
    return a?.candidates[ref.candidate]?.gates.find((g) => g.gate === ref.gate)?.diagnostics[ref.index] ?? null;
  };
  const questionOf = (ref: GapRef) => {
    const rec = state.value.program.functions[ref.fn];
    const d = diagnosticAt(ref);
    return rec && d ? buildGapQuestion({ spec: rec.spec, diagnostic: d, ...(rec.artifact ? { returnType: rec.artifact.returnType } : {}) }) : null;
  };
  /** Literals only (no evaluation in the fixture): NaN, ±Infinity, -0, undefined, null, numbers, JSON. */
  const fixtureLiteral = (expr: string): ExpectationPreview => {
    const t = expr.trim();
    const named: Record<string, unknown> = { NaN, Infinity, '-Infinity': -Infinity, '-0': -0, undefined, null: null, true: true, false: false };
    let v: unknown;
    if (t in named) v = named[t];
    else {
      try {
        v = JSON.parse(t);
      } catch {
        return { ok: false, error: 'fixture engine: only literals are evaluated here (NaN, -1, "dont-stop", [1, 2])' };
      }
    }
    return { ok: true, shown: t, outcome: { returns: encodeValue(v) }, mentionsFn: false };
  };

  const engine: Engine = {
    state,
    // fixture: the real question builder over the fixture state
    gapQuestion: (ref) => questionOf(ref),
    async previewExpectation(_fn, expr) {
      return fixtureLiteral(expr);
    },
    // fixture: re-certifies when the ruling agrees with the tests; otherwise the artifact goes stale and the re-grow
    // reports that it needs live mode (the replay rule), as the engine does in replay mode
    async decide(ref, choice, opts = {}) {
      const q = questionOf(ref);
      const d = diagnosticAt(ref);
      if (!q || !d || (d.kind !== 'test' && d.kind !== 'property')) return notice('error', 'This check result cannot be decided.');
      let ruling: RulingSpec;
      if ('alternative' in choice) {
        const alt = q.alternatives.find((a) => a.id === choice.alternative);
        if (!alt || alt.disabled) return notice('error', alt?.disabled ?? 'Unknown choice.');
        ruling = alt.relational ? { kind: 'relational', args: alt.relational.args } : { kind: 'outcome', outcome: alt.outcome! };
      } else if ('throws' in choice) {
        ruling = { kind: 'outcome', outcome: { throws: true } };
      } else {
        const p = fixtureLiteral(choice.expr);
        if (!p.ok) return notice('error', p.error);
        ruling = { kind: 'outcome', outcome: p.outcome! };
      }
      const dec = buildDecision({
        fn: ref.fn,
        kind: q.kind,
        args: q.args,
        ruling,
        answers: { check: q.check.name, checkKind: q.check.kind, silentOn: q.silentOn, gate: q.check.gate },
        ...(d.expectedOutcome ? { expected: d.expectedOutcome } : {}),
        decidedAt: Date.now(),
        ...(opts.reason ? { reason: opts.reason } : {}),
      });
      const reason = decidedReason(decisionSummary(dec));
      update((s) => {
        const rec = s.program.functions[ref.fn]!;
        rec.spec = specWithDecisions(rec.spec, upsertDecision(decisionsOf(rec.spec), dec));
        rec.testsHash = bump(rec.testsHash);
        if (rec.artifact && !dec.waives) {
          pushRevision(s, 'decision', `${reason} — re-certified (r${rec.artifact.revision}'s artifact passes)`, { fn: ref.fn });
          rec.artifact.testsHash = rec.testsHash;
          rec.artifact.recertified = [...(rec.artifact.recertified ?? []), { at: Date.now(), revision: s.headRevision, reason }];
          if (rec.artifact.evidence) rec.artifact.evidence = { ...rec.artifact.evidence, decisions: (rec.artifact.evidence.decisions ?? 0) + 1 };
          s.repl.push({ kind: 'info', id: eid('if'), text: `${ref.fn}: ${reason}. The committed function already satisfies it: re-certified at r${s.headRevision}, nothing regenerated.`, tone: 'accent' });
        } else {
          pushRevision(s, 'decision', `${reason} — the committed function fails it; re-growing`, { fn: ref.fn });
          const message = `Your decision (${decisionSummary(dec)}) differs from what the recorded session was checked against, so there is no recorded answer to replay. Run live to grow ${ref.fn} against it.`;
          s.generation = s.generation
            ? { ...s.generation, phase: 'failed', call: `${dec.call} (your decision)`, attempts: [], error: { code: 'no_recording', message }, decision: { id: dec.id, call: dec.call } }
            : s.generation;
          s.repl.push({ kind: 'error', id: eid('er'), name: 'GenerationFailed', message });
        }
      });
    },
    async removeDecision(fn, decisionId) {
      update((s) => {
        const rec = s.program.functions[fn];
        const d = rec ? decisionsOf(rec.spec).find((x) => x.id === decisionId) : undefined;
        if (!rec || !d) return;
        rec.spec = specWithDecisions(rec.spec, decisionsOf(rec.spec).filter((x) => x.id !== decisionId));
        rec.testsHash = bump(rec.testsHash);
        if (rec.artifact) rec.artifact.testsHash = rec.testsHash;
        pushRevision(s, 'decision', removedDecisionReason(decisionSummary(d)), { fn });
      });
    },
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
          s.repl.push({
            kind: 'output',
            id: eid('out'),
            value,
            ms: 0.1,
            label: 'cached artifact',
            detail: `certified r${median.artifact.revision}`,
            ...(value !== 'NaN' ? { pinnable: medianPinnable(m[1], Number(value)) } : {}),
          });
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
    async previewImage(json: string) {
      try {
        JSON.parse(json);
      } catch (e) {
        return { ok: false as const, error: `the file is not JSON (${(e as Error).message})` };
      }
      const st = state.value;
      return { ok: true as const, revisions: 3, functions: 1, datasets: 0, exportedAt: '2026-10-04T09:00:00.000Z', current: { revisions: st.revisions.length, functions: Object.keys(st.program.functions).length } };
    },
    async importImage(json: string) {
      try {
        JSON.parse(json);
        update((s) => pushRevision(s, 'import', 'imported image (fixture: contents ignored)'));
      } catch (e) {
        notice('error', `Import failed: ${(e as Error).message}`);
      }
    },
    // fixture: a small recording once median is committed (so the Share dialog can be exercised)
    exportRecording() {
      const median = state.value.program.functions.median;
      if (!median?.artifact) return null;
      return {
        format: 'undefined-recording',
        version: 2,
        id: 'median-fixture',
        title: 'Live session: median',
        recordedAt: new Date().toISOString(),
        model: 'gpt-6-luna',
        codexVersion: '0.157.2',
        effort: 'medium',
        sessions: [
          {
            fn: 'median',
            specHash: median.specHash,
            testsHash: median.testsHash,
            label: 'median',
            spec: median.spec,
            calls: ['median([3, 1, 4, 2])'],
            attempts: median.artifact.candidates.map((c) => ({ prompt: c.prompt ?? '', body: c.body, notes: c.notes, durationMs: c.generationMs, progress: [] })),
          },
        ],
      };
    },
    // fixture: real parsing/validation; the preview is the scripted one for anything valid
    async previewRecording(input) {
      if (input.text === undefined) return { ok: false, error: `fixture: links are not fetched (${input.url ?? 'no url'})`, hint: 'Drop the file instead.' };
      const p = parseRecordingText(input.text);
      if (!p.ok && input.text !== '{}') return { ok: false, error: p.error };
      return { ...FIXTURE_PREVIEW, source: input.source ?? 'a file' };
    },
    async loadRecording(input) {
      update((s) => {
        delete s.recordingOffer;
        s.loadedRecording = { title: FIXTURE_PREVIEW.title, source: input.source ?? 'a file', calls: FIXTURE_PREVIEW.calls, dismissed: false };
        s.replInput = FIXTURE_PREVIEW.calls[0]!;
        s.hints.opener = false;
        pushRevision(s, 'import', `Loaded recording: ${FIXTURE_PREVIEW.title}`);
      });
    },
    dismissRecordingBanner() {
      update((s) => void (s.loadedRecording && (s.loadedRecording.dismissed = true)));
    },
    dismissRecordingOffer() {
      update((s) => void delete s.recordingOffer);
    },
    dismissOtherTabBanner() {
      update((s) => void (s.otherTab &&= { dismissed: true }));
    },
    async setSessionLogEnabled(on) {
      update((s) => void (s.sessionLog = { enabled: on, count: logEntries, status: 'indexeddb' }));
    },
    async exportSessionLog() {
      return JSON.stringify({ format: 'undefined-session-log', version: 1, exportedAt: new Date().toISOString(), entries: [] }, null, 2);
    },
    async clearSessionLog() {
      logEntries = 0;
      update((s) => void (s.sessionLog = { enabled: s.sessionLog?.enabled ?? false, count: 0, status: 'indexeddb' }));
    },
    async resetImage() {
      epoch++;
      state.value = SCENARIOS.opening();
    },
    // data: the real parsing/typing/preview (pure engine functions); binding is simulated on the fixture state
    previewDataset(input) {
      return datasetPreview(input, state.value.send);
    },
    async loadDataset(input) {
      const b = await buildData(input);
      if (!b.ok) return notice('error', `Could not load the data: ${b.error}`);
      const ref: DatasetRef = b.ref;
      update((s) => {
        s.program.datasets = { ...(s.program.datasets ?? {}), [ref.name]: ref };
        s.datasets = Object.values(s.program.datasets);
        s.env[ref.name] = `[… ${ref.rowCount} rows]`;
        pushRevision(s, 'dataset', `Loaded dataset ${ref.name}: ${ref.rowCount} rows × ${ref.columns.length} columns`);
        s.repl.push({ kind: 'info', id: eid('if'), text: `\`${ref.name}\` is bound: \`${ref.typeDecl}\` (${ref.rowCount} rows)`, tone: 'muted' });
      });
    },
    async removeDataset(name) {
      update((s) => {
        if (!s.program.datasets?.[name]) return;
        const { [name]: _gone, ...rest } = s.program.datasets;
        s.program.datasets = rest;
        s.datasets = Object.values(rest);
        delete s.env[name];
        pushRevision(s, 'dataset', `Removed dataset ${name}`);
      });
    },
    setSendSamples(on) {
      update((s) => void (s.send = { ...s.send, samples: on }));
    },
    async pinResult(entryId) {
      update((s) => {
        const e = s.repl.find((x) => x.id === entryId);
        if (e?.kind !== 'output' || !e.pinnable || e.pinned) return;
        const rec = s.program.functions[e.pinnable.fn];
        if (!rec) return;
        const pins = rec.spec.pins ?? [];
        rec.spec = { ...rec.spec, pins: [...pins, { id: `pin${pins.length + 1}`, label: e.pinnable.call, args: e.pinnable.args, expected: e.pinnable.expected, pinnedAt: Date.now() }] };
        e.pinned = true;
        pushRevision(s, 'pin', `Pinned: ${e.pinnable.call}`, { fn: e.pinnable.fn });
        s.repl.push({ kind: 'info', id: eid('if'), text: PINNED_INFO, tone: 'accent' });
      });
    },
    async runMutation(fn) {
      update((s) => void s.repl.push({ kind: 'info', id: eid('if'), text: `fixture: mutation check of ${fn} re-run (scripted report unchanged)`, tone: 'muted' }));
    },
    // fixture: a passing re-check (re-certified in place); the recheck-failed scenario shows the failing one
    async addSuggestedProperty(fn, suggestionId) {
      update((s) => {
        const rec = s.program.functions[fn];
        const sug = rec ? suggestProperties(rec.spec, s.program).find((x) => x.id === suggestionId) : undefined;
        if (!rec || !sug) return;
        rec.spec = appendProperty(rec.spec, sug);
        rec.testsHash = bump(rec.testsHash);
        pushRevision(s, 'recertify', `${addedCheckReason(sug.title)}: committed function re-certified`, { fn });
        if (rec.artifact) {
          rec.artifact.testsHash = rec.testsHash;
          rec.artifact.recertified = [...(rec.artifact.recertified ?? []), { at: Date.now(), revision: s.headRevision, reason: addedCheckReason(sug.title) }];
          if (rec.artifact.evidence) {
            const { mutation: _old, ...ev } = rec.artifact.evidence;
            rec.artifact.evidence = { ...ev, properties: [...ev.properties, { name: sug.title, runs: 100 }] };
          }
        }
        s.mutation = { fn, phase: 'waiting', done: 0, total: 0 };
      });
    },
    async removePin(fn, pinId) {
      update((s) => {
        const rec = s.program.functions[fn];
        const pin = rec?.spec.pins?.find((p) => p.id === pinId);
        if (!rec || !pin) return;
        const left = rec.spec.pins!.filter((p) => p.id !== pinId);
        rec.spec = { ...rec.spec, pins: left };
        if (left.length === 0) delete rec.spec.pins;
        for (const e of s.repl) if (e.kind === 'output' && e.pinnable?.fn === fn && e.pinnable.call === pin.label) delete e.pinned;
        pushRevision(s, 'pin', `Unpinned: ${pin.label}`, { fn });
      });
    },
  };
  return engine;
}
