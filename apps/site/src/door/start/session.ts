/**
 * The first-run SESSION CONTROLLER: the engine glue `#/start` stands on. No components here; the page sections read
 * these signals and call these functions. Everything shown comes from the real engine (docs/FRONT-DOOR.md honesty
 * rule 1); the pure parts are start/derive.ts, start/intake.ts and start/recorded.ts (unit-tested).
 *
 * ── Getting it ──────────────────────────────────────────────────────────────────────────────────────────────────
 *   const s = sessionFor(engine);       // one shared session per engine (every section gets the same one)
 *   s.dispose();                        // stops its effects; clears the shell chip / running pulse (page unmount)
 *   createSession(engine, config?)      // a private one (tests, scratch harnesses)
 *   s.config.seed = false               // never install the seeded agreement (default true); read at the next ask
 *   s.config.sampleNames.orders = 'x'   // bind a sample under another variable (default: samples.ts datasetName)
 *   createSession(engine, { recordings: async () => [...] })   // the replay recordings (default: the bundled ones)
 *
 * ── Signals (read `.value` in a component to subscribe) ─────────────────────────────────────────────────────────
 *   source         'sample' | 'own' | 'none'            what the page has bound
 *   sampleId       'orders' | 'sales' | null
 *   dataset        DatasetRef | null                    the bound ref, looked up live in state.datasets (a Reset clears it)
 *   rows           DataRow[] | null                     the bound rows, exactly as the engine holds them
 *   fileName       'orders.csv' | 'pasted data' | ''    for captions
 *   fileChip       'orders.csv · 332 rows · 10 columns' | null   (also pushed to state.ts shellFileChip)
 *   intake         { busy, problem, warnings }          problem: the engine's own words (spreadsheet, delimiter, too big…)
 *   questions      SuggestedQuestion[]                  model/questions.ts suggestedQuestions for the bound file, each
 *                                                       `level` ('full' | 'basic') set to what will REALLY run (levelFor)
 *   questionId     string | null                        defaults per DEFAULT_QUESTION_ID (own file: the first)
 *   question       SuggestedQuestion | null
 *   seed           SeededAgreement | null               the demo's agreement for this question, only when it will be
 *                                                       installed: live mode, or replay with a recording made against
 *                                                       it (null: none, seed off, not recorded, or still being checked)
 *   seedState      'none' | 'installing' | 'installed' | 'failed'
 *   availability   Record<questionId, 'certified' | 'recorded' | 'none' | 'live'>   can it be answered here, and how
 *   recordedOther  SuggestedQuestion | null             another question that CAN be answered here (for the no-recording copy)
 *   run            RunRef | null                        the run the page started (derive.ts)
 *   outcome        RunOutcome                           idle · running · committed · cached · thrown-out · stopped ·
 *                                                       declined · no-recording · service · error (derive.ts)
 *   trace          TraceView                            CheckTrace props: lanes, ghost, header, footer, liveText (+ cached)
 *   answer         AnswerProps                          AnswerCard props: view, held, heldCaption, level, locked, canLock,
 *                                                       assumptions, checked, notChecked
 *   lock           LockInfo                             locked + how to undo it
 *   agreement      AgreementView                        Your agreement (seeded shows at once)
 *   privacy        PrivacyView | null                   What the AI will see (model/privacy.ts)
 *   lastPrompt     string | null                        the real prompt of the last draft (after a run)
 *   gap            GapQuestion | null                   the question only you can answer (outcome 'stopped')
 *   noRecording    string                               the honest sentence for outcome 'no-recording' ('' otherwise)
 *   version        'Version 4 · 5 Oct 2026'
 *   busy           boolean                              the engine or this session is working: disable inputs
 *   canAsk / canChange  boolean
 *   askLabel       'Ask · checks run first' | 'Ask again'
 *
 * ── Actions (all return false / do nothing when not allowed: engine not ready, busy, nothing bound) ──────────────
 *   useSample(id)              bind the bundled sample (skipped when the same sample is already bound), default question
 *   intakeText({text, filename?})   preview with the engine first (refusals become intake.problem), then bind; name
 *                              derived from the file name (ui/data.ts datasetNameFromFile), `data` for pasted text
 *   intakeFile(file)           File → refusals (spreadsheet, size, binary) → intakeText
 *   selectQuestion(id)         select; installs the seeded agreement now when there is one (idempotent)
 *   ask()                      install the seed if needed, setInput(call), submit(); returns when the run settled
 *   toggleLock()               engine.pinResult(entryId) / engine.removePin(fn, pinId)
 *   decide(choice, {reason?, scope?})   rule on the stop-and-ask (engine.decide); then asks again for the answer
 *   reset()                    engine.resetImage() and back to nothing bound
 *
 * Telemetry: when a run settles, recordChecks(lanes that ran, real gate ms) once per run; +1 when its stress test
 * (mutation check) finishes. shellRunning pulses while a run is in progress.
 *
 * The seeded agreement is ADAPTIVE (recorded.ts seedUsable): installed in live mode, and in replay mode only when a
 * bundled recording was made against exactly its spec (public/recordings/orders-agreement.json, written by
 * `npm run record:door`), or a function already certified for it answers. Otherwise the question goes out spec-less.
 *
 * What the replay site can answer today (session.test.ts proves it against public/recordings/orders.json): the only
 * recorded session for the samples is the spec-less `topCustomersByRevenue(rows)` on orders.csv bound as `rows`
 * (type `Row`; the row type's name is inside the hashed spec, so orders.csv is bound as `rows`, see samples.ts). So
 * "Top 5 customers by revenue" replays with basic checks (committed, Puddlesworth Inc $2,599.13 first, every row
 * counted), and "Count orders by status" / "Revenue by country" end in 'no-recording', pointing at it. Once
 * orders-agreement.json is bundled, the same question installs the agreement and runs with full checks, unchanged code.
 */
import { batch, computed, effect, signal, type ReadonlySignal } from '@preact/signals';
import type { DatasetRef, DecideChoice, DecideOptions, Engine, EngineState, FunctionSpec, GapQuestion, GapRef, Program, Recording } from '@scasella/undefined-engine/types';
import { hashesFor } from '@scasella/undefined-engine/shared/hash';
import { seedAgreement, SEEDED_PIN_ID, type SeededAgreement } from '../model/agreements';
import type { AgreementView } from '../model/agreement';
import type { DataRow } from '../model/figures';
import { lastSentPrompt, privacyView, type PrivacyView } from '../model/privacy';
import { DEFAULT_QUESTION_ID, suggestedQuestions, type SuggestedQuestion } from '../model/questions';
import { sampleFile, sampleIdFor, type SampleId } from '../model/samples';
import { recordChecks, session as telemetry, shellFileChip, shellRunning } from '../state';
import {
  agreementFor,
  answerView,
  factsOfRows,
  lockInfo,
  matchRun,
  noRecordingText,
  outcomeOf,
  SETTLED_KINDS,
  telemetryOf,
  traceView,
  versionLine,
  type AnswerProps,
  type LockInfo,
  type RunOutcome,
  type RunRef,
  type TraceView,
} from './derive';
import { delimiterProblem, fileChipFor, fileProblem, ownDatasetName, parseRows, takenNames, textProblem } from './intake';
import { answerableOther, availabilityOf, fetchRecordings, levelFor, seedUsable, type Availability } from './recorded';

export type DataSource = 'sample' | 'own' | 'none';

export interface SessionConfig {
  /** Install the demo's seeded agreement before asking (orders.csv · top customers). Default true. */
  seed: boolean;
  /** Bind a sample under another variable name. Default: the sample's datasetName (`rows` for orders.csv, `sales`). */
  sampleNames: Partial<Record<SampleId, string>>;
  /** The recordings the replay engine plays (default: the bundled ones, recorded.ts fetchRecordings). */
  recordings?: () => Promise<Recording[]>;
}

export interface IntakeState {
  busy: boolean;
  /** Why the file or text was not bound (plain words, the engine's own where it has them). */
  problem: string | null;
  /** Parse warnings of the bound file. */
  warnings: string[];
}

interface Bound {
  source: 'sample' | 'own';
  sampleId: SampleId | null;
  name: string;
  hash: string;
  fileName: string;
  rows: DataRow[];
}

export interface Session {
  readonly engine: Engine;
  readonly config: SessionConfig;
  readonly source: ReadonlySignal<DataSource>;
  readonly sampleId: ReadonlySignal<SampleId | null>;
  readonly dataset: ReadonlySignal<DatasetRef | null>;
  readonly rows: ReadonlySignal<DataRow[] | null>;
  readonly fileName: ReadonlySignal<string>;
  readonly fileChip: ReadonlySignal<string | null>;
  readonly intake: ReadonlySignal<IntakeState>;
  readonly questions: ReadonlySignal<SuggestedQuestion[]>;
  readonly questionId: ReadonlySignal<string | null>;
  readonly question: ReadonlySignal<SuggestedQuestion | null>;
  readonly seed: ReadonlySignal<SeededAgreement | null>;
  readonly seedState: ReadonlySignal<'none' | 'installing' | 'installed' | 'failed'>;
  readonly availability: ReadonlySignal<Record<string, Availability>>;
  readonly recordedOther: ReadonlySignal<SuggestedQuestion | null>;
  readonly run: ReadonlySignal<RunRef | null>;
  readonly outcome: ReadonlySignal<RunOutcome>;
  readonly trace: ReadonlySignal<TraceView>;
  readonly answer: ReadonlySignal<AnswerProps>;
  readonly lock: ReadonlySignal<LockInfo>;
  readonly agreement: ReadonlySignal<AgreementView>;
  readonly privacy: ReadonlySignal<PrivacyView | null>;
  readonly lastPrompt: ReadonlySignal<string | null>;
  readonly gap: ReadonlySignal<GapQuestion | null>;
  readonly noRecording: ReadonlySignal<string>;
  readonly version: ReadonlySignal<string>;
  readonly busy: ReadonlySignal<boolean>;
  readonly canAsk: ReadonlySignal<boolean>;
  readonly canChange: ReadonlySignal<boolean>;
  readonly askLabel: ReadonlySignal<string>;
  useSample(id: SampleId): Promise<boolean>;
  intakeText(input: { text: string; filename?: string }): Promise<boolean>;
  intakeFile(file: File): Promise<boolean>;
  selectQuestion(id: string): Promise<boolean>;
  ask(): Promise<boolean>;
  toggleLock(): Promise<boolean>;
  decide(choice: DecideChoice, opts?: DecideOptions): Promise<boolean>;
  reset(): Promise<void>;
  dispose(): void;
}

const EMPTY_INTAKE: IntakeState = { busy: false, problem: null, warnings: [] };
const PASTED = 'pasted data';

/** Whether `rec`'s spec text is the seed's (hashes; the stored spec may be normalised) and its locked answer is there. */
async function seedInstalled(state: EngineState, seed: SeededAgreement, installedOnce: boolean): Promise<boolean> {
  const rec = state.program.functions[seed.spec.name];
  if (!rec) return false;
  const h = await hashesFor(seed.spec);
  if (rec.specHash !== h.specHash || rec.testsHash !== h.testsHash) return false;
  // once this session installed it, an unlocked seeded pin stays unlocked (the user's choice)
  return installedOnce || (rec.spec.pins ?? []).some((p) => p.id === SEEDED_PIN_ID);
}

export function createSession(engine: Engine, config: Partial<SessionConfig> = {}): Session {
  const cfg: SessionConfig = {
    seed: config.seed ?? true,
    sampleNames: { ...(config.sampleNames ?? {}) },
    ...(config.recordings ? { recordings: config.recordings } : {}),
  };
  const st = engine.state;

  const bound = signal<Bound | null>(null);
  const intake = signal<IntakeState>(EMPTY_INTAKE);
  const questionId = signal<string | null>(null);
  const run = signal<RunRef | null>(null);
  const seedState = signal<'none' | 'installing' | 'installed' | 'failed'>('none');
  const working = signal(false);
  const recordings = signal<Recording[] | null>(null);
  const availability = signal<Record<string, Availability>>({});
  /** Seed verdicts (seedUsable) by seedKey: true = install it, false = ask spec-less. Missing = not decided yet. */
  const seedVerdicts = signal<ReadonlyMap<string, boolean>>(new Map());
  const seedChecks = new Map<string, Promise<boolean>>();
  let recordingsP: Promise<Recording[]> | null = null;
  const installedOnce = new Set<string>();
  let runSeq = 0;
  let intakeSeq = 0;
  let disposed = false;

  const dataset = computed<DatasetRef | null>(() => {
    const b = bound.value;
    if (!b) return null;
    return st.value.datasets.find((d) => d.name === b.name && d.hash === b.hash) ?? null;
  });
  const live = computed(() => (dataset.value ? bound.value : null));
  const source = computed<DataSource>(() => live.value?.source ?? 'none');
  const sampleId = computed(() => live.value?.sampleId ?? null);
  const rows = computed(() => live.value?.rows ?? null);
  const fileName = computed(() => live.value?.fileName ?? '');
  const fileChip = computed(() => (dataset.value ? fileChipFor(dataset.value) : null));
  const facts = computed(() => factsOfRows(rows.value));

  const program = computed(() => st.value.program);
  const mode = computed(() => st.value.mode);
  /** The questions as model/questions.ts suggests them (static level). */
  const baseQuestions = computed<SuggestedQuestion[]>(() => {
    const d = dataset.value;
    const r = rows.value;
    return d && r ? suggestedQuestions(d, r, sampleId.value) : [];
  });
  /** The demo's agreement for (sample, question), whether or not it will be installed. */
  const rawSeedFor = (q: Pick<SuggestedQuestion, 'id'> | null, d: DatasetRef | null, sid: SampleId | null): SeededAgreement | null =>
    cfg.seed && q && d ? seedAgreement(sid, q.id, d) : null;
  const seedKey = (q: Pick<SuggestedQuestion, 'id'>, d: DatasetRef, sid: SampleId | null, m: string): string => `${m} ${sid ?? ''} ${q.id} ${d.name} ${d.hash}`;
  /** The seed that WILL be installed for `q` (its verdict is in and says yes), else null. */
  const seedFor = (q: Pick<SuggestedQuestion, 'id'> | null, d: DatasetRef | null, sid: SampleId | null, verdicts: ReadonlyMap<string, boolean>, m: string): SeededAgreement | null => {
    const raw = rawSeedFor(q, d, sid);
    return raw && verdicts.get(seedKey(q!, d!, sid, m)) === true ? raw : null;
  };
  /** Verdicts for every question's seed are in (no seed counts as decided). */
  const seedsDecided = computed(() => {
    const d = dataset.value;
    const v = seedVerdicts.value;
    return baseQuestions.value.every((q) => !rawSeedFor(q, d, sampleId.value) || v.has(seedKey(q, d!, sampleId.value, mode.value)));
  });
  const questions = computed<SuggestedQuestion[]>(() => {
    const d = dataset.value;
    const p = program.value;
    const a = availability.value;
    const v = seedVerdicts.value;
    const m = mode.value;
    return baseQuestions.value.map((q) => {
      const level = levelFor({ question: q, availability: a[q.id], program: p, seed: seedFor(q, d, sampleId.value, v, m)?.spec ?? null });
      return level === q.level ? q : { ...q, level };
    });
  });
  const question = computed(() => questions.value.find((q) => q.id === questionId.value) ?? null);
  const seed = computed(() => seedFor(question.value, dataset.value, sampleId.value, seedVerdicts.value, mode.value));
  /** The seed's spec while it is not in the program yet (the rail shows it at once). */
  const pendingSeed = computed<FunctionSpec | null>(() => (seed.value && seedState.value !== 'installed' ? seed.value.spec : null));

  const match = computed(() => matchRun(st.value, run.value));
  const outcome = computed<RunOutcome>(() =>
    outcomeOf(st.value, run.value, match.value, (ref: GapRef) => {
      try {
        return engine.gapQuestion(ref) !== null;
      } catch {
        return false;
      }
    }),
  );
  const fn = computed(() => question.value?.fn ?? null);

  const trace = computed<TraceView>(() => {
    const q = question.value;
    const d = dataset.value;
    return traceView({
      state: st.value,
      run: run.value,
      match: match.value,
      outcome: outcome.value,
      label: q?.label ?? '',
      question: q?.text ?? '',
      file: d?.filename ?? fileName.value,
      rows: d?.rowCount ?? 0,
      fn: fn.value,
      pendingSeed: pendingSeed.value,
    });
  });

  const recordedOther = computed(() => answerableOther(baseQuestions.value, availability.value, questionId.value));
  const noRecording = computed(() => {
    const o = outcome.value;
    if (o.kind !== 'no-recording') return '';
    // the engine tags any call on bound data as needsLive 'data'; whether it is the user's own file is the page's to say
    return noRecordingText(source.value === 'own', recordedOther.value);
  });

  const answer = computed<AnswerProps>(() => {
    const d = dataset.value;
    return answerView({
      state: st.value,
      match: match.value,
      outcome: outcome.value,
      fn: fn.value,
      question: question.value?.text ?? '',
      fileName: d?.filename ?? fileName.value,
      rowCount: d?.rowCount ?? null,
      data: facts.value,
      noRecording: noRecording.value,
    });
  });
  const lock = computed(() => lockInfo(st.value.program, answer.value.view ? match.value.output : null));
  const agreement = computed(() => agreementFor(st.value.program, fn.value, pendingSeed.value, seed.value !== null));
  const privacy = computed<PrivacyView | null>(() => {
    const d = dataset.value;
    const q = question.value;
    if (!d) return null;
    return privacyView({
      question: q?.text ?? '',
      dataset: { ...d, ...(d.filename ? { filename: d.filename } : {}) },
      rows: rows.value,
      send: st.value.send,
      mode: st.value.mode,
    });
  });
  const lastPrompt = computed(() => {
    const f = fn.value;
    if (!f || !run.value) return null;
    return lastSentPrompt(match.value.generation, st.value.program.functions[f] ?? null);
  });
  const gap = computed<GapQuestion | null>(() => {
    const o = outcome.value;
    if (o.kind !== 'stopped') return null;
    try {
      return engine.gapQuestion(o.ref);
    } catch {
      return null;
    }
  });
  const version = computed(() => versionLine(st.value));
  const running = computed(() => outcome.value.kind === 'running' || !!run.value?.pending);
  const busy = computed(() => st.value.busy || working.value || running.value || intake.value.busy);
  const canChange = computed(() => st.value.ready && !busy.value);
  const canAsk = computed(() => canChange.value && !!question.value && !!dataset.value);
  const askLabel = computed(() => (run.value && SETTLED_KINDS.has(outcome.value.kind) && run.value.questionId === questionId.value ? 'Ask again' : 'Ask · checks run first'));

  // ───────────── effects: shell, telemetry, availability ─────────────

  const stops: Array<() => void> = [];
  stops.push(
    effect(() => {
      shellFileChip.value = fileChip.value;
    }),
  );
  stops.push(
    effect(() => {
      shellRunning.value = running.value;
    }),
  );
  // telemetry once per run (the checks that ran, real gate ms), then +1 when its stress test finishes
  const counted = new Set<number>();
  const stressCounted = new Set<number>();
  stops.push(
    effect(() => {
      const r = run.value;
      const o = outcome.value;
      if (!r || r.pending || !SETTLED_KINDS.has(o.kind)) return;
      const m = match.value;
      const t = trace.value;
      if (!counted.has(r.id)) {
        counted.add(r.id);
        // a cached answer ran nothing; a run that never drafted ran nothing
        if (o.kind !== 'cached' && m.generation) {
          const { checks, ms } = telemetryOf(m.generation, t.facts);
          if (checks > 0) recordChecks(checks, ms);
        }
      }
      const stress = t.lanes[5];
      const mut = st.value.mutation;
      if (o.kind === 'committed' && !stressCounted.has(r.id) && stress?.state === 'passed' && (!mut || mut.fn !== r.fn || mut.phase === 'done')) {
        stressCounted.add(r.id);
        recordChecks(1, telemetry.peek().lastMs ?? 0);
      }
    }),
  );
  // what can be answered here (replay: hash-matched against the bundled recordings), once every seed is decided
  let availSeq = 0;
  // (program and mode change rarely; reading them through computeds keeps this off the typewriter's updates)
  stops.push(
    effect(() => {
      const d = dataset.value;
      const qs = baseQuestions.value;
      const s = { program: program.value, mode: mode.value };
      const recs = recordings.value;
      const sid = sampleId.value;
      const v = seedVerdicts.value;
      const my = ++availSeq;
      if (!d || qs.length === 0) {
        availability.value = {};
        return;
      }
      // decide every question's seed first (the availability and the level depend on it)
      for (const q of qs) if (rawSeedFor(q, d, sid) && !v.has(seedKey(q, d, sid, s.mode))) void decideSeed(q, d, sid);
      if (s.mode === 'replay' && recs === null) {
        void loadRecordings();
        return;
      }
      if (!seedsDecided.value) return;
      void availabilityOf({
        mode: s.mode,
        questions: qs,
        program: s.program,
        dataset: d,
        recordings: recs ?? [],
        seedFor: (q) => seedFor(q, d, sid, v, s.mode)?.spec ?? null,
      }).then((a) => {
        if (!disposed && my === availSeq) availability.value = a;
      });
    }),
  );

  /** The replay recordings, loaded once (the engine's own loader, unless the config brings its own). */
  function loadRecordings(): Promise<Recording[]> {
    if (!recordingsP) {
      recordingsP = (cfg.recordings ?? (() => fetchRecordings()))()
        .catch((): Recording[] => [])
        .then((r) => {
          if (!disposed) recordings.value = r;
          return r;
        });
    }
    return recordingsP;
  }

  /**
   * Decide (once per mode, sample, question and dataset) whether `q`'s seed will be installed: recorded.ts seedUsable
   * against the program as it is now. Records the verdict in seedVerdicts; returns it.
   */
  function decideSeed(q: Pick<SuggestedQuestion, 'id'>, d: DatasetRef, sid: SampleId | null): Promise<boolean> {
    const m = st.peek().mode;
    const key = seedKey(q, d, sid, m);
    const known = seedVerdicts.peek().get(key);
    if (known !== undefined) return Promise.resolve(known);
    let p = seedChecks.get(key);
    if (!p) {
      const raw = rawSeedFor(q, d, sid);
      const prog: Pick<Program, 'functions'> = st.peek().program;
      p = (async () => {
        if (!raw) return false;
        const recs = m === 'replay' ? await loadRecordings() : [];
        return seedUsable({ mode: m, seed: raw.spec, program: prog, recordings: recs });
      })()
        .catch(() => false)
        .then((ok) => {
          if (!disposed) {
            const next = new Map(seedVerdicts.peek());
            next.set(key, ok);
            seedVerdicts.value = next;
          }
          return ok;
        });
      seedChecks.set(key, p);
    }
    return p;
  }

  // ───────────── actions ─────────────

  const ready = (): boolean => !disposed && st.peek().ready;
  const idle = (): boolean => ready() && !st.peek().busy && !working.peek() && !run.peek()?.pending;

  function adopt(b: Bound, defaultQ: string | null): void {
    batch(() => {
      bound.value = b;
      run.value = null;
      seedState.value = 'none';
      questionId.value = defaultQ;
      intake.value = { busy: false, problem: null, warnings: intake.peek().warnings };
    });
  }

  /** Did the engine bind `name` just now? The new head is a dataset revision holding it. */
  function boundRef(name: string, before: number): DatasetRef | null {
    const s = st.peek();
    const last = s.revisions[s.revisions.length - 1];
    if (s.headRevision <= before || last?.kind !== 'dataset') return null;
    return s.datasets.find((d) => d.name === name) ?? null;
  }

  async function ensureSeed(): Promise<boolean> {
    // the seed is installed only when it will really run (live, or replay with its recording): decide that first
    const q = question.peek();
    const d0 = dataset.peek();
    if (q && d0 && rawSeedFor(q, d0, sampleId.peek())) await decideSeed(q, d0, sampleId.peek());
    if (disposed) return false;
    const sd = seed.peek();
    if (!sd) {
      seedState.value = 'none';
      return true;
    }
    const d = dataset.peek();
    const key = `${sd.spec.name} ${d?.hash ?? ''}`;
    if (await seedInstalled(st.peek(), sd, installedOnce.has(key))) {
      seedState.value = 'installed';
      return true;
    }
    seedState.value = 'installing';
    const before = st.peek().headRevision;
    await engine.upsertSpec(sd.spec);
    if (disposed) return false;
    const ok = await seedInstalled(st.peek(), sd, false);
    if (ok) installedOnce.add(key);
    // the selection may have moved on while it installed
    if (seed.peek() === sd) seedState.value = ok ? 'installed' : 'failed';
    if (!ok && st.peek().headRevision === before && st.peek().notice?.tone === 'error') intake.value = { ...intake.peek(), problem: st.peek().notice!.text };
    return ok;
  }

  async function useSample(id: SampleId): Promise<boolean> {
    if (!idle()) return false;
    const f = sampleFile(id);
    const name = cfg.sampleNames[id] ?? f.datasetName;
    const my = ++intakeSeq;
    working.value = true;
    intake.value = { busy: true, problem: null, warnings: [] };
    try {
      let ref = st.peek().datasets.find((d) => d.name === name && sampleIdFor(d) === id) ?? null;
      if (!ref) {
        const before = st.peek().headRevision;
        await engine.loadDataset({ text: f.text(), filename: f.filename, name, source: 'bundled' });
        if (disposed || my !== intakeSeq) return false;
        ref = boundRef(name, before);
        if (!ref) {
          intake.value = { busy: false, problem: st.peek().notice?.text ?? `Could not load ${f.filename}.`, warnings: [] };
          return false;
        }
      }
      adopt({ source: 'sample', sampleId: id, name, hash: ref.hash, fileName: f.filename, rows: f.rows() }, DEFAULT_QUESTION_ID[id]);
      intake.value = EMPTY_INTAKE;
      await ensureSeed();
      return true;
    } finally {
      if (my === intakeSeq) {
        working.value = false;
        if (intake.peek().busy) intake.value = { ...intake.peek(), busy: false };
      }
    }
  }

  async function intakeText(input: { text: string; filename?: string }): Promise<boolean> {
    if (!idle()) return false;
    const my = ++intakeSeq;
    const fail = (problem: string): false => {
      if (my === intakeSeq) intake.value = { busy: false, problem, warnings: [] };
      return false;
    };
    const early = textProblem(input.text, input.filename);
    if (early) return fail(early);
    const s = st.peek();
    const replacing = bound.peek()?.source === 'own' ? bound.peek()!.name : null;
    const name = ownDatasetName(input.filename, takenNames(s), replacing);
    const fname = input.filename;
    working.value = true;
    intake.value = { busy: true, problem: null, warnings: [] };
    try {
      const preview = await engine.previewDataset({ text: input.text, name, ...(fname ? { filename: fname } : {}) });
      if (disposed || my !== intakeSeq) return false;
      if (!preview.ok) return fail(preview.error);
      const delim = delimiterProblem(input.text, preview.columns.length);
      if (delim) return fail(delim);
      const parsed = parseRows(input.text, fname);
      if (!parsed.ok) return fail(parsed.error);
      const before = st.peek().headRevision;
      await engine.loadDataset({ text: input.text, name, ...(fname ? { filename: fname, source: 'file' as const } : { source: 'paste' as const }) });
      if (disposed || my !== intakeSeq) return false;
      const ref = boundRef(name, before);
      if (!ref) return fail(st.peek().notice?.text ?? 'Could not load the data.');
      const b: Bound = { source: 'own', sampleId: null, name, hash: ref.hash, fileName: fname ?? PASTED, rows: parsed.rows };
      const qs = suggestedQuestions(ref, parsed.rows, null);
      adopt(b, qs[0]?.id ?? null);
      intake.value = { busy: false, problem: null, warnings: preview.warnings };
      return true;
    } finally {
      if (my === intakeSeq) {
        working.value = false;
        if (intake.peek().busy) intake.value = { ...intake.peek(), busy: false };
      }
    }
  }

  async function intakeFile(file: File): Promise<boolean> {
    if (!idle()) return false;
    const bad = fileProblem(file);
    if (bad) {
      intake.value = { busy: false, problem: bad, warnings: [] };
      return false;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (e) {
      intake.value = { busy: false, problem: `Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
      return false;
    }
    return intakeText({ text, filename: file.name });
  }

  async function selectQuestion(id: string): Promise<boolean> {
    if (!idle() || !questions.peek().some((q) => q.id === id)) return false;
    if (questionId.peek() !== id) {
      batch(() => {
        questionId.value = id;
        run.value = null;
        seedState.value = 'none';
      });
    }
    working.value = true;
    try {
      return await ensureSeed();
    } finally {
      working.value = false;
    }
  }

  /** setInput + submit for `q`, recorded as run `r` (pending until the engine resolves). */
  async function submitAs(r: RunRef): Promise<void> {
    run.value = r;
    engine.setInput(r.call);
    try {
      await engine.submit();
    } finally {
      if (run.peek()?.id === r.id) run.value = { ...run.peek()!, pending: false };
    }
  }

  async function ask(): Promise<boolean> {
    if (!idle()) return false;
    const q = question.peek();
    if (!q || !dataset.peek()) return false;
    working.value = true;
    try {
      if (!(await ensureSeed())) return false;
      if (disposed || st.peek().busy) return false;
      const s = st.peek();
      working.value = false;
      await submitAs({ id: ++runSeq, origin: 'ask', questionId: q.id, fn: q.fn, call: q.call, genBefore: s.generation?.id ?? null, replBefore: s.repl.length, pending: true });
      return true;
    } finally {
      working.value = false;
    }
  }

  async function toggleLock(): Promise<boolean> {
    if (!idle()) return false;
    const l = lock.peek();
    working.value = true;
    try {
      if (l.locked && l.pin) await engine.removePin(l.pin.fn, l.pin.id);
      else if (!l.locked && l.entryId) await engine.pinResult(l.entryId);
      else return false;
      return true;
    } finally {
      working.value = false;
    }
  }

  async function decide(choice: DecideChoice, opts?: DecideOptions): Promise<boolean> {
    const o = outcome.peek();
    const prev = run.peek();
    if (o.kind !== 'stopped' || !prev || !idle()) return false;
    const s = st.peek();
    const r: RunRef = { ...prev, id: ++runSeq, origin: 'decide', genBefore: s.generation?.id ?? null, replBefore: s.repl.length, pending: true };
    run.value = r;
    try {
      await engine.decide(o.ref, choice, opts ?? {});
      if (disposed || run.peek()?.id !== r.id) return true;
      // the ruling re-checked or re-grew the function; a REPL answer needs the call itself
      const rec = st.peek().program.functions[r.fn];
      const certified = !!rec?.artifact && rec.artifact.specHash === rec.specHash && rec.artifact.testsHash === rec.testsHash;
      if (certified && !st.peek().busy) {
        engine.setInput(r.call);
        await engine.submit();
      }
      return true;
    } finally {
      if (run.peek()?.id === r.id) run.value = { ...run.peek()!, pending: false };
    }
  }

  async function reset(): Promise<void> {
    if (disposed) return;
    intakeSeq++;
    batch(() => {
      bound.value = null;
      run.value = null;
      questionId.value = null;
      seedState.value = 'none';
      intake.value = EMPTY_INTAKE;
    });
    installedOnce.clear();
    // a fresh image: certified functions are gone, so seed verdicts that relied on one are decided again
    seedChecks.clear();
    seedVerdicts.value = new Map();
    working.value = true;
    try {
      await engine.resetImage();
    } finally {
      working.value = false;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const stop of stops) stop();
    stops.length = 0;
    shellFileChip.value = null;
    shellRunning.value = false;
    if (shared.get(engine) === api) shared.delete(engine);
  }

  const api: Session = {
    engine,
    config: cfg,
    source,
    sampleId,
    dataset,
    rows,
    fileName,
    fileChip,
    intake,
    questions,
    questionId,
    question,
    seed,
    seedState,
    availability,
    recordedOther,
    run,
    outcome,
    trace,
    answer,
    lock,
    agreement,
    privacy,
    lastPrompt,
    gap,
    noRecording,
    version,
    busy,
    canAsk,
    canChange,
    askLabel,
    useSample,
    intakeText,
    intakeFile,
    selectQuestion,
    ask,
    toggleLock,
    decide,
    reset,
    dispose,
  };
  return api;
}

const shared = new WeakMap<Engine, Session>();

/** The page's one session for `engine` (created on first use; a disposed one is replaced). */
export function sessionFor(engine: Engine): Session {
  let s = shared.get(engine);
  if (!s) {
    s = createSession(engine);
    shared.set(engine, s);
  }
  return s;
}
