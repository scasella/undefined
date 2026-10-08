/**
 * Which suggested questions this page can actually answer right now, and why (pure, plus one fetch helper).
 *
 * In replay mode (the public site) a function is only written when a recorded session exists for the EXACT spec the
 * engine would grow: the recording is keyed by specHash + testsHash (core/generator.ts ReplayGenerator). So for each
 * question we build that spec the way the engine does (the program's spec for the function when it has one; else the
 * seeded agreement the session would install; else core/engine.ts callSpec → specFromCall(fn, ['<Type>[]'],
 * {typeDecls})) and look its hashes up in the bundled recordings. A function already certified for its current spec
 * needs nothing: the call is answered from the cached artifact. In live mode every question can be asked.
 *
 * The seeded agreement is ADAPTIVE (seedUsable): live mode always installs it; the replay demo installs it only when a
 * bundled recording matches its exact hashes (or the function is already certified for it). Otherwise the question
 * runs as a spec-less call (basic checks), which replays when recorded and says so honestly when not. levelFor says
 * which of the two will really run, for the 'Full checks' / 'Basic checks' chip.
 *
 * Several recordings for one function coexist: everything here, like core/generator.ts (ReplayGenerator,
 * findSession), keys a recorded session by function name + specHash + testsHash, never by the function name alone.
 */
import type { DatasetRef, FunctionSpec, Program, Recording } from '@scasella/undefined-engine/types';
import { specFromCall } from '@scasella/undefined-engine/gates/source';
import { hashesFor } from '@scasella/undefined-engine/shared/hash';
import { seedAgreement } from '../model/agreements';
import { checkFactsFrom, hasAgreement } from '../model/assumptions';
import type { DataRow } from '../model/figures';
import { suggestedQuestions, type CheckLevel, type SuggestedQuestion } from '../model/questions';
import type { SampleId } from '../model/samples';

/**
 * certified: answered from a function already certified (either mode: nothing is written or re-checked) · recorded: a
 * recorded draft exists · drafted: replay, no recorded answer for the spec as it is, but one for the checks the AI drafted
 * for it in the recorded draft (model/recordedDraft.ts): approving that draft makes it `recorded` · none: no recorded answer,
 * so it needs your computer (live mode) · live: live mode, and a new version would be written.
 */
export type Availability = 'certified' | 'recorded' | 'drafted' | 'none' | 'live';

/** The spec a spec-less call `fn(<dataset>)` grows from (core/engine.ts callSpec; exampleId is not hashed). */
export function callSpecFor(fn: string, dataset: Pick<DatasetRef, 'typeName' | 'typeDecl'>): FunctionSpec {
  return specFromCall(fn, [`${dataset.typeName}[]`], { typeDecls: dataset.typeDecl });
}

/** Whether `fn`'s artifact is live for its current spec (core: isLive): a call is answered without asking anyone. */
export function isCertified(program: Pick<Program, 'functions'>, fn: string): boolean {
  const rec = program.functions[fn];
  return !!rec?.artifact && rec.artifact.specHash === rec.specHash && rec.artifact.testsHash === rec.testsHash;
}

/**
 * The spec the engine will grow for `q`: the program's own (an installed agreement, an earlier call) else the seeded
 * one the session would install before the ask, else the spec-less call spec.
 */
export function expectedSpec(q: Pick<SuggestedQuestion, 'fn'>, program: Pick<Program, 'functions'>, dataset: Pick<DatasetRef, 'typeName' | 'typeDecl'>, seed: FunctionSpec | null): FunctionSpec {
  return program.functions[q.fn]?.spec ?? seed ?? callSpecFor(q.fn, dataset);
}

/** The key of a recorded session (and of the spec that would replay it): `fn specHash testsHash`. */
export async function specKey(spec: FunctionSpec): Promise<string> {
  const h = await hashesFor(spec);
  return `${spec.name} ${h.specHash} ${h.testsHash}`;
}

/**
 * Whether the session should install `seed` before asking: always in live mode (the model writes against it); in
 * replay mode only when a bundled recording was made against exactly this spec, or the program already holds a
 * function certified for it (the answer comes from that). Otherwise installing it could only end in "no recording".
 */
export async function seedUsable(input: {
  mode: 'live' | 'replay';
  seed: FunctionSpec | null;
  program: Pick<Program, 'functions'>;
  recordings: readonly Recording[];
}): Promise<boolean> {
  const { seed } = input;
  if (!seed) return false;
  if (input.mode === 'live') return true;
  const key = await specKey(seed);
  if (recordedKeys(input.recordings).has(key)) return true;
  const rec = input.program.functions[seed.name];
  return !!rec && isCertified(input.program, seed.name) && `${seed.name} ${rec.specHash} ${rec.testsHash}` === key;
}

/** A spec holds the user to something beyond "runs, never changes the data, finishes fast". */
export function specHasAgreement(spec: Pick<FunctionSpec, 'tests' | 'properties' | 'pins' | 'decisions'> | null | undefined): boolean {
  if (!spec) return false;
  return spec.tests.trim() !== '' || spec.properties.trim() !== '' || (spec.pins?.length ?? 0) > 0 || (spec.decisions?.length ?? 0) > 0;
}

/**
 * 'full' or 'basic': what will REALLY check the answer to `q`. A certified function answers from its artifact, so the
 * checks it was certified with count (as the answer card counts them); otherwise the spec the ask will run against
 * (the seed the session installs, else the program's, else the spec-less call spec) decides.
 */
export function levelFor(input: {
  question: Pick<SuggestedQuestion, 'fn' | 'text'>;
  availability: Availability | undefined;
  program: Pick<Program, 'functions'>;
  seed: FunctionSpec | null;
}): CheckLevel {
  const { question: q, program } = input;
  const rec = program.functions[q.fn];
  if (input.availability === 'certified' && rec) {
    return hasAgreement(checkFactsFrom({ artifact: rec.artifact, spec: rec.spec, question: q.text, mutationDone: true })) ? 'full' : 'basic';
  }
  return specHasAgreement(input.seed ?? rec?.spec) ? 'full' : 'basic';
}

/** Every recorded session key: `fn specHash testsHash`. */
export function recordedKeys(recordings: readonly Recording[]): Set<string> {
  const out = new Set<string>();
  for (const r of recordings) for (const s of r.sessions ?? []) if (s.attempts?.length) out.add(`${s.fn} ${s.specHash} ${s.testsHash}`);
  return out;
}

/** Per question id: can it be answered here, and how. `seedFor(q)` is the seeded spec the session would install (or null). */
export async function availabilityOf(input: {
  mode: 'live' | 'replay';
  questions: readonly SuggestedQuestion[];
  program: Pick<Program, 'functions'>;
  dataset: Pick<DatasetRef, 'typeName' | 'typeDecl'>;
  recordings: readonly Recording[];
  seedFor: (q: SuggestedQuestion) => FunctionSpec | null;
  /**
   * Replay: the key (`specHash`, `testsHash`) of the spec approving the recorded draft for `q` installs, when there is one and it reads
   * back to that spec (model/recordedDraft.ts recordedDraftReplays). 'drafted' also needs a bundled recording for that key.
   */
  drafted?: (q: SuggestedQuestion) => Promise<{ specHash: string; testsHash: string } | null>;
}): Promise<Record<string, Availability>> {
  const out: Record<string, Availability> = {};
  const keys = recordedKeys(input.recordings);
  for (const q of input.questions) {
    const seed = input.seedFor(q);
    // a certified function answers only while the spec the ask runs against is the one it was certified for. Live mode
    // too: asking again then shows the answer on file (a lock set since changes no hash), so what ran then is the level
    const installed = input.program.functions[q.fn];
    if (isCertified(input.program, q.fn) && (!seed || (await sameHashes(installed!.spec, seed)))) {
      out[q.id] = 'certified';
      continue;
    }
    if (input.mode === 'live') {
      out[q.id] = 'live';
      continue;
    }
    const spec = seed ?? expectedSpec(q, input.program, input.dataset, null);
    const h = await hashesFor(spec);
    if (keys.has(`${q.fn} ${h.specHash} ${h.testsHash}`)) out[q.id] = 'recorded';
    // only a question still at its spec-less start can take the recorded draft (one with checks of its own is not offered one)
    else {
      const k = !seed && !specHasAgreement(spec) && input.drafted ? await input.drafted(q) : null;
      out[q.id] = k && keys.has(`${q.fn} ${k.specHash} ${k.testsHash}`) ? 'drafted' : 'none';
    }
  }
  return out;
}

async function sameHashes(a: FunctionSpec, b: FunctionSpec): Promise<boolean> {
  const [x, y] = await Promise.all([hashesFor(a), hashesFor(b)]);
  return x.specHash === y.specHash && x.testsHash === y.testsHash;
}

/**
 * Whether a sample file has ANY question this page can answer (a recorded draft for the exact spec it would grow, or a function already
 * certified for it), worked out the way the bound file's own availability is (availabilityOf: the same hashes against the same recordings,
 * the seeded agreement installed only where seedUsable says so). In live mode every question can be asked, so it is always true there.
 * The sample's file name is not looked at: a sample with no recording behind any of its questions is the one this says false for.
 */
export async function sampleAnswerable(input: {
  mode: 'live' | 'replay';
  sampleId: SampleId;
  dataset: DatasetRef;
  rows: readonly DataRow[];
  program: Pick<Program, 'functions'>;
  recordings: readonly Recording[];
}): Promise<boolean> {
  if (input.mode === 'live') return true;
  const questions = suggestedQuestions(input.dataset, input.rows, input.sampleId);
  const seeds = new Map<string, FunctionSpec>();
  for (const q of questions) {
    const raw = seedAgreement(input.sampleId, q.id, input.dataset);
    if (raw && (await seedUsable({ mode: input.mode, seed: raw.spec, program: input.program, recordings: input.recordings }))) seeds.set(q.id, raw.spec);
  }
  const a = await availabilityOf({
    mode: input.mode,
    questions,
    program: input.program,
    dataset: input.dataset,
    recordings: input.recordings,
    seedFor: (q) => seeds.get(q.id) ?? null,
  });
  return Object.values(a).some((v) => v === 'recorded' || v === 'certified');
}

/** The first question (in list order) that can be answered here, other than `except`. */
export function answerableOther(questions: readonly SuggestedQuestion[], availability: Record<string, Availability>, except: string | null): SuggestedQuestion | null {
  return questions.find((q) => q.id !== except && (availability[q.id] === 'certified' || availability[q.id] === 'recorded')) ?? null;
}

/** How a recording of the seeded agreement was obtained (scripts/record-door.mjs prints it and keeps it in the title). */
export interface AgreementRecordingInfo {
  /** The recording's id and file name stem: `orders-agreement`. */
  id: string;
  /** Page runs it took to get a committed answer (1 = the first). */
  tries: number;
  /** Drafts written in the kept run. */
  drafts: number;
  /** The kept run's first draft was thrown out by a check. */
  firstThrownOut: boolean;
}

/**
 * The recording to ship for the seeded agreement: the session(s) of `exported` (Engine.exportRecording) for exactly
 * `key` (the installed spec's function + hashes) that hold drafts, with the curation stated in the title (the
 * honesty rule of scripts/record.mjs: how many tries, whether a first draft was thrown out). The recording format
 * keeps no free-form fields, so the title carries it. null when the export holds no such session.
 */
export function agreementRecording(exported: Recording, key: { fn: string; specHash: string; testsHash: string }, info: AgreementRecordingInfo): Recording | null {
  const sessions = exported.sessions.filter((x) => x.fn === key.fn && x.specHash === key.specHash && x.testsHash === key.testsHash && x.attempts.length > 0);
  if (sessions.length === 0) return null;
  const tries = `${info.tries} ${info.tries === 1 ? 'try' : 'tries'}`;
  const drafts = `${info.drafts} ${info.drafts === 1 ? 'draft' : 'drafts'}`;
  const first = info.firstThrownOut ? 'first draft thrown out' : 'first draft accepted';
  return {
    ...exported,
    id: info.id,
    title: `${info.id}: orders.csv, top 5 customers by revenue, with the seeded agreement; recorded live (${tries}; ${drafts}; ${first})`,
    sessions,
  };
}

type FetchFn = (url: string) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

/**
 * The bundled recordings (public/recordings, listed in index.json), loaded exactly as the engine's replay generator
 * loads them (core/generator.ts loadBundledRecordings: same index, same strict validation; that module is already in
 * the engine's chunk, so the dynamic import costs nothing). Failures are skipped: an empty list only means "nothing
 * known to be recorded". With `fetchImpl` (tests) the plain structural check below is used instead.
 */
export async function fetchRecordings(fetchImpl?: FetchFn): Promise<Recording[]> {
  if (!fetchImpl) {
    try {
      const { loadBundledRecordings } = await import('../../core/generator');
      return await loadBundledRecordings();
    } catch {
      return [];
    }
  }
  try {
    const res = await fetchImpl('./recordings/index.json');
    if (!res.ok) return [];
    const names = await res.json();
    if (!Array.isArray(names)) return [];
    const files = await Promise.all(
      names
        .filter((n): n is string => typeof n === 'string' && /^[\w.-]+\.json$/.test(n) && !n.includes('..'))
        .map(async (n) => {
          try {
            const r = await fetchImpl(`./recordings/${n}`);
            if (!r.ok) return null;
            const j = (await r.json()) as Partial<Recording>;
            return j && j.format === 'undefined-recording' && Array.isArray(j.sessions) ? (j as Recording) : null;
          } catch {
            return null;
          }
        }),
    );
    return files.filter((r): r is Recording => r !== null);
  } catch {
    return [];
  }
}
