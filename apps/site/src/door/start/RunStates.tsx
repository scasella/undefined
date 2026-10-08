/**
 * First run · the outcomes that are not a plain answer, shown between the check trace and the (held) answer card:
 *   stopped      "A question only you can answer · Needs you" (LANDING 683-731's card, fed by the engine's GapQuestion)
 *                → session.decide → the green "Saved as a house rule." (kept while the decide's own run is shown)
 *   declined     the grey "I can't do that reliably." panel (LANDING 759-765), from GenerationView.declined
 *   no-recording the honest replay message (session.noRecording) with the way out in it as ONE real button (the question that
 *                has a recorded answer, or the sample file that has one), and the link to run it on your computer
 *   thrown-out   every draft was thrown out: the last reason and how many drafts were tried; when every draft failed the SAME check
 *                and the AI drafted it, "This check may be wrong" (model/suspectCheck.ts): the evidence, and the two ways forward
 *   service      the writing service failed: its message and the exact fix commands
 *   error        the calculation itself failed on the file
 *   cached       a normal answer, plus one quiet line saying nothing was re-checked
 * Nothing here is scripted: every sentence is the session's (or a fixed plain sentence about the engine's own code).
 * When one of these appears because of something the user just did, focus moves to its heading.
 */
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AttemptView, DecideOptions, Declined, Engine, GapAlternative, GapQuestion, GenerateError, GenerationView } from '@scasella/undefined-engine/types';
import { dayText } from '../model/agreement';
import { ghostFromAttempts, type LaneFacts } from '../model/lanes';
import { ASK_LABEL } from '../model/labels';
import { isTypedQuestion } from '../model/questions';
import { AskDiamond, CheckDisc, ThrownOut } from '../icons';
import { Button } from '../components/LinkButton';
import { headingTag, type HeadingLevel } from '../components/headings';
import { ASK_BUTTON_ID, NoRecordingSentence } from './AskCard';
import type { SampleId } from '../model/samples';
import { matchRun, noRecordingView, sampleOffer, type RunOutcome } from './derive';
import { suspectCheck, withoutCheck, withRequirement, type SuspectCheck } from '../model/suspectCheck';
import { sessionFor, type Session } from './session';
import './RunStates.css';

/** Where the "run it on your computer" explanation lives (the landing's team-file section). */
export const OWN_FILE_HREF = '#/#own-file';
export const CACHED_LINE = 'Already checked in this session. Change a rule or ask a different question to check again.';
export const NOTHING_SAVED = 'Nothing was saved.';
/**
 * What a card says is saved when the question was one the viewer typed. A typed question's own contract is saved as a step BEFORE it
 * is asked (session.ts ensureTyped -> the engine's upsertSpec: "Spec added: <name> — no artifact yet"), so a run that ends with no
 * answer still saved that one thing, and "Nothing was saved." would be false. What is never saved by a run that ended this way is
 * an answer (nothing was shown) or a calculation (no draft was kept).
 */
export const ONLY_QUESTION_SAVED = 'Only your question was saved: no answer and no calculation.';
/** The sentence that closes a card that ends with no answer: for a question the viewer typed, the one that says what really was saved. */
export const savedLine = (questionId: string | null | undefined): string => (questionId && isTypedQuestion(questionId) ? ONLY_QUESTION_SAVED : NOTHING_SAVED);

// ───────────────────────── the question only you can answer ─────────────────────────

export interface GapOption {
  id: string;
  /** `Give $0.00` / `Stop and show an error` / `Give the same as …` */
  label: string;
  /** lower-case for the preview: `gives $0.00` */
  verb: string;
  /** Where the choice comes from, in plain words. */
  tag: string;
  /** Shown but not selectable, with the reason. */
  disabled?: string;
}

export interface GapView {
  head: string;
  body: string;
  caseTag: string;
  call: string;
  caseLine: string;
  legend: string;
  options: GapOption[];
  /** `for every negative n` when a rule for the whole kind of case can be saved. */
  scope: string | null;
  existing: string | null;
  onlyAgreeing: string | null;
}

const PREFIX = 'This adds a house rule: ';

export function sourceTag(alt: Pick<GapAlternative, 'source'>): string {
  switch (alt.source) {
    case 'tests':
      return 'what your check expects';
    case 'candidate':
      return 'what the draft did';
    case 'declared':
      return 'listed by your rule';
    case 'common':
      return 'a common choice';
  }
}

export function optionOf(alt: GapAlternative): GapOption {
  let verb: string;
  if (alt.relational) verb = `gives the same as ${alt.relational.label.replace(/^same as /, '')}`;
  else if (alt.outcome && 'throws' in alt.outcome) verb = 'stops and shows an error';
  else verb = `gives ${alt.label}`;
  return {
    id: alt.id,
    label: verb.charAt(0).toUpperCase() + verb.slice(1),
    verb,
    tag: sourceTag(alt),
    ...(alt.disabled ? { disabled: alt.disabled.replace(/`/g, '') } : {}),
  };
}

export function gapView(g: GapQuestion): GapView {
  const isRule = g.check.kind === 'property';
  const whose = isRule ? 'your house rule expects' : 'your example expects';
  return {
    head: 'What should happen in this case?',
    body: isRule
      ? `We tried a made-up table where this happens. Your rules are silent on “${g.silentOn}”. We won't guess.`
      : `One of your examples lands on this case, and your rules are silent on “${g.silentOn}”. We won't guess.`,
    caseTag: isRule ? 'Made-up table · the smallest one that shows it' : 'Your example',
    call: g.call,
    caseLine: `draft gave ${g.actualShown} · ${whose} ${g.expectedShown}`,
    legend: 'What should happen?',
    options: g.alternatives.map(optionOf),
    scope: g.ruleScope?.label ?? null,
    existing: g.existing ? 'You already decided this case. Saving again replaces that rule.' : null,
    onlyAgreeing: g.onlyAgreeing ? g.onlyAgreeing.replace(/`/g, '') : null,
  };
}

/** The live preview sentence under the options. */
export function gapPreview(v: Pick<GapView, 'call' | 'options'>, selected: string | null, scope: 'call' | 'rule', scopeLabel: string | null): string {
  const o = v.options.find((x) => x.id === selected && !x.disabled);
  if (!o) return 'Pick what should happen. Nothing is saved until you do.';
  if (scope === 'rule' && scopeLabel) return `${PREFIX}${scopeLabel}, it ${o.verb}.`;
  return `${PREFIX}${v.call} ${o.verb}.`;
}

/** The saved rule, as the green card shows it: the preview without its lead-in, capitalised. */
export function savedRuleText(preview: string): string {
  return preview.replace(PREFIX, '').replace(/^./, (m) => m.toUpperCase());
}

// ───────────────────────── it says no ─────────────────────────

export const DECLINE_WHY: Record<Declined['reason'], string> = {
  'cannot-be-pure': "The answer would depend on something outside your file, like today's date, chance or another file. No check could hold it steady.",
  'needs-spec': "Your question and your columns don't say enough to check a draft against, so any answer would be a guess.",
};
const DECLINE_HELP: Record<Declined['reason'], string> = {
  'cannot-be-pure': 'Ask about what is in the file itself, for example with the dates written out.',
  'needs-spec': 'Say exactly what counts, then it becomes a rule we can check.',
};

export function declinedView(reason: Declined['reason'], message: string, asked: string): { asked: string; why: string; help: string } {
  return { asked: `You asked · ${asked}`, why: DECLINE_WHY[reason], help: message.trim() || DECLINE_HELP[reason] };
}

// ───────────────────────── thrown out ─────────────────────────

export const THROWN_OUT_HEAD = 'Nothing is shown: every draft was thrown out.';

/** The last draft's rejection in the trace's own words, and how many drafts were tried. */
export function thrownOutView(gen: GenerationView | null, facts: LaneFacts, recordedOut: boolean): { last: string; tried: string; recorded: string | null } {
  const n = gen?.attempts.length ?? 0;
  let last = '';
  const lastA = gen?.attempts[n - 1];
  if (gen && lastA) {
    // ghostFromAttempts leaves out the attempt it is told is shown (by identity): pass a copy so every rejection counts
    const shown: AttemptView = { ...lastA };
    const ghosts = ghostFromAttempts(gen, facts, shown);
    const g = ghosts[ghosts.length - 1];
    if (g) last = g.note.map((s) => s.text).join('').trim();
  }
  return {
    last: last || 'No draft passed every check.',
    tried: n === 1 ? '1 draft tried' : `${n} drafts tried`,
    recorded: recordedOut ? 'In this demo, answers are recorded, and the recorded drafts ran out before one passed.' : null,
  };
}

// ───────────────────────── this check may be wrong ─────────────────────────

/** A shown value, kept to one readable line. */
const clip = (v: string, n = 140): string => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

export interface SuspectView {
  head: string;
  intro: string;
  /** The call, what the check expects and what the drafts gave (examples only). */
  evidence: string | null;
  why: string;
  /** The two ways forward, the one the evidence favours first. */
  actions: Array<{ id: 'drop' | 'keep'; label: string }>;
  /** The demo cannot change the checks (no recording would match): said instead of the buttons. */
  demo: string | null;
}

export const SUSPECT_DEMO = 'On your computer you could drop this check or write what it requires into the agreement, then try again. This demo can only replay its recording.';

export function suspectView(s: SuspectCheck, mode: 'live' | 'replay'): SuspectView {
  const n = s.drafts;
  const intro = `All ${n} drafts failed the same check, one the AI drafted for you: “${s.plain}”`;
  let evidence: string | null = null;
  if (s.kind === 'example' && s.expected !== null && s.gave.length > 0) {
    const at = s.call ? `${clip(s.call, 60)}: ` : '';
    const gave = s.reading === 'check' ? `every draft gave ${clip(s.gave[0]!)}` : `the drafts gave ${s.gave.map((g) => clip(g, 60)).join(' · ')}`;
    evidence = `${at}the check expects ${clip(s.expected)}; ${gave}.`;
  }
  const drop = { id: 'drop' as const, label: 'Drop this check and try again' };
  const keep = { id: 'keep' as const, label: 'Keep it: add it to the agreement and try again' };
  return s.reading === 'check'
    ? {
        head: 'This check may be wrong',
        intro,
        evidence,
        why: 'The drafts were written separately and agree with each other, not with the check. That usually means the answer the check expects is off. You decide which is right.',
        actions: [drop, keep],
        demo: mode === 'replay' ? SUSPECT_DEMO : null,
      }
    : {
        head: 'Your agreement may not say what this check requires',
        intro,
        evidence,
        why: 'The AI that writes the answer reads your agreement and the names of its checks, never what a check does. If the check is right, writing what it requires into the agreement gives the next drafts a fair chance; if it is wrong, drop it.',
        actions: [keep, drop],
        demo: mode === 'replay' ? SUSPECT_DEMO : null,
      };
}

// ───────────────────────── service / error ─────────────────────────

export function serviceView(o: Extract<RunOutcome, { kind: 'service' }> | Extract<RunOutcome, { kind: 'error' }>): { head: string; text: string; fix: string[] } {
  if (o.kind === 'service') {
    const e: GenerateError = o.error;
    return { head: "The AI couldn't write a draft.", text: e.message, fix: e.fix ?? [] };
  }
  return { head: 'The calculation failed when it ran on your file.', text: `${o.name}: ${o.message}`, fix: [] };
}

// ───────────────────────── component ─────────────────────────

const SHOWN = new Set<RunOutcome['kind']>(['stopped', 'declined', 'no-recording', 'thrown-out', 'service', 'error', 'cached']);

interface Saved {
  runId: number;
  rule: string;
  at: number;
}

/**
 * `headingLevel` is the level of the cards' headings (3 under the Full view's "Ask a question" h2, 2 on Step by step, where the card
 * follows the page's h1): the level that follows the page's own, so none is skipped.
 */
export function RunStates({ engine, session, headingLevel = 3 }: { engine: Engine; session?: Session; headingLevel?: HeadingLevel }) {
  const s = session ?? sessionFor(engine);
  const H = headingTag(headingLevel);
  const o = s.outcome.value;
  const run = s.run.value;
  const busy = s.busy.value;
  const [saved, setSaved] = useState<Saved | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);
  // runs started before this mounted never steal focus (e.g. coming back to the page)
  const firstRun = useRef(run?.id ?? 0);
  const focused = useRef('');

  const showSaved = !!saved && run?.id === saved.runId;
  useEffect(() => {
    if (saved && run && run.id !== saved.runId) setSaved(null);
  }, [run?.id]);

  useEffect(() => {
    if (!run || run.id <= firstRun.current || !SHOWN.has(o.kind) || o.kind === 'cached') return;
    const key = `${run.id}:${o.kind}`;
    if (focused.current === key) return;
    focused.current = key;
    headRef.current?.focus();
  }, [run?.id, o.kind]);

  const decide = (choice: string, opts: DecideOptions, rule: string) => {
    const before = s.run.peek()?.id;
    const p = s.decide({ alternative: choice }, opts);
    const r = s.run.peek();
    if (r && r.id !== before) {
      setSaved({ runId: r.id, rule, at: Date.now() });
      setTimeout(() => savedRef.current?.focus(), 0);
    }
    void p;
  };
  const retry = () => {
    if (s.canAsk.peek()) void s.ask();
  };
  const tryOther = (id: string) => {
    void s.selectQuestion(id).then(() => document.getElementById(ASK_BUTTON_ID)?.focus());
  };
  // `switch to orders.csv` (the recorded sample): the card it is in goes away, so focus goes to Ask
  const useSample = (id: SampleId) => {
    void s.useSample(id).then(() => document.getElementById(ASK_BUTTON_ID)?.focus());
  };

  const label = s.question.value?.label ?? '';
  // a question the viewer typed was saved before it was asked, so the cards that end with no answer say so (savedLine)
  const savedWords = savedLine(run?.questionId);
  let card = null;
  if (o.kind === 'stopped') {
    const g = s.gap.value;
    if (g) card = <GapCard key={`${run?.id}:${g.call}:${g.check.name}`} gap={g} busy={busy} headRef={headRef} onSave={decide} level={headingLevel} />;
  } else if (o.kind === 'declined') {
    const v = declinedView(o.reason, o.message, label);
    card = (
      <div class="fd-rs fd-rs--no" role="status">
        <div class="fd-label-line">{v.asked}</div>
        <H class="fd-rs__no-h" tabIndex={-1} ref={headRef}>
          I can't do that reliably.
        </H>
        <p class="fd-rs__p">
          <span class="fd-rs__b">Why: </span>
          {v.why}
        </p>
        <p class="fd-rs__p">
          <span class="fd-rs__b">What would help: </span>
          {v.help}
        </p>
        <p class="fd-rs__meta">{savedWords}</p>
      </div>
    );
  } else if (o.kind === 'no-recording') {
    const other = s.recordedOther.value;
    const offer = sampleOffer(s.sampleId.value);
    card = (
      <div class="fd-rs fd-rs--no" role="status">
        <div class="fd-label-line">You asked · {label}</div>
        <H class="fd-rs__no-h" tabIndex={-1} ref={headRef}>
          No recorded answer for this one.
        </H>
        <p class="fd-rs__p">
          {/* the way out is said once, in the sentence, as a real button (`try it` / `switch to orders.csv`): no second control for it below */}
          {s.noRecording.value ? <NoRecordingSentence view={noRecordingView(s.source.value === 'own', other, offer)} onTry={tryOther} onUse={useSample} busy={busy} /> : o.message}
        </p>
        <div class="fd-rs__actions">
          <a class="fd-rs__link" href={OWN_FILE_HREF}>
            How to run it on your computer
          </a>
        </div>
        <p class="fd-rs__meta">Nothing was checked. {savedWords}</p>
      </div>
    );
  } else if (o.kind === 'thrown-out') {
    const st = s.engine.state.value;
    const gen = matchRun(st, run).generation;
    const v = thrownOutView(gen, s.trace.value.facts, o.recordedOut);
    const spec = gen ? (st.program.functions[gen.fn]?.spec ?? null) : null;
    const sus = suspectCheck(gen, spec);
    const sv = sus ? suspectView(sus, st.mode) : null;
    // the viewer's ruling on the suspect: install the changed agreement (session.applySpec), then ask again
    const settle = (id: 'drop' | 'keep') => {
      if (!sus || !spec || !s.canChange.peek()) return;
      const next = id === 'drop' ? withoutCheck(spec, sus) : withRequirement(spec, sus);
      if (!next) return;
      void s.applySpec(next).then((ok) => ok && s.ask());
    };
    card = (
      <div class="fd-rs fd-rs--out" role="status">
        <H class="fd-rs__out-h" tabIndex={-1} ref={headRef}>
          <ThrownOut size={20} tone="light" />
          {THROWN_OUT_HEAD}
        </H>
        <p class="fd-rs__p">{v.last}</p>
        {v.recorded && <p class="fd-rs__p">{v.recorded}</p>}
        {sus && sv && (
          <div class="fd-rs__suspect">
            <p class="fd-rs__suspect-h">
              <AskDiamond size={18} solid />
              {sv.head}
            </p>
            <p class="fd-rs__suspect-p">{sv.intro}</p>
            {sv.evidence && <p class="fd-rs__suspect-ev">{sv.evidence}</p>}
            <p class="fd-rs__suspect-p">{sv.why}</p>
            <details class="fd-rs__suspect-code">
              <summary>Show the check</summary>
              <pre>{sus.source}</pre>
            </details>
            {sv.demo ? (
              <p class="fd-rs__suspect-demo">{sv.demo}</p>
            ) : (
              <div class="fd-rs__actions fd-rs__actions--suspect">
                {sv.actions.map((a) => (
                  <Button key={a.id} variant="secondary" aria-disabled={!s.canChange.value || undefined} onClick={() => settle(a.id)}>
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        <div class="fd-rs__actions">
          <Button variant="secondary" aria-disabled={!s.canAsk.value || undefined} onClick={retry}>
            {sus ? 'Try again as it is' : 'Try again'}
          </Button>
          <span class="fd-rs__meta fd-rs__meta--inline">{v.tried} · {savedWords}</span>
        </div>
      </div>
    );
  } else if (o.kind === 'service' || o.kind === 'error') {
    const v = serviceView(o);
    card = (
      <div class="fd-rs fd-rs--plain" role="alert">
        <H class="fd-rs__plain-h" tabIndex={-1} ref={headRef}>
          {v.head}
        </H>
        <p class="fd-rs__p">{v.text}</p>
        {v.fix.length > 0 && (
          <>
            <p class="fd-rs__p">To fix it, run:</p>
            <pre class="fd-rs__fix">{v.fix.join('\n')}</pre>
          </>
        )}
        <div class="fd-rs__actions">
          <Button variant="secondary" aria-disabled={!s.canAsk.value || undefined} onClick={retry}>
            Try again
          </Button>
          <span class="fd-rs__meta fd-rs__meta--inline">Nothing was checked. {savedWords}</span>
        </div>
      </div>
    );
  } else if (o.kind === 'cached') {
    card = (
      <p class="fd-rs__cached" role="status">
        {CACHED_LINE}
      </p>
    );
  }

  if (!showSaved && !card) return null;
  return (
    <div class="fd-rs-wrap">
      {showSaved && saved && (
        <div class="fd-rs fd-rs--saved" role="status">
          <div class="fd-rs__saved-h" tabIndex={-1} ref={savedRef}>
            <CheckDisc size={20} />
            Saved as a house rule.
          </div>
          <p class="fd-rs__saved-rule">{saved.rule}</p>
          <p class="fd-rs__saved-meta">
            Decided by you on {dayText(saved.at)}
            {o.kind === 'running' ? ' · Checking again with your rule…' : o.kind === 'committed' || o.kind === 'cached' ? ' · Checked again with your rule.' : ''}
          </p>
        </div>
      )}
      {card}
    </div>
  );
}

function GapCard({
  gap,
  busy,
  headRef,
  onSave,
  level,
}: {
  gap: GapQuestion;
  busy: boolean;
  headRef: RefObject<HTMLHeadingElement | null>;
  onSave: (choice: string, opts: DecideOptions, rule: string) => void;
  level: HeadingLevel;
}) {
  const H = headingTag(level);
  const v = gapView(gap);
  const [sel, setSel] = useState<string | null>(null);
  const [scope, setScope] = useState<'call' | 'rule'>('call');
  const [why, setWhy] = useState('');
  const preview = gapPreview(v, sel, scope, v.scope);
  const ready = !!sel && !busy;
  const save = () => {
    if (!ready || !sel) return;
    const opts: DecideOptions = { ...(v.scope ? { scope } : {}), ...(why.trim() ? { reason: why.trim() } : {}) };
    onSave(sel, opts, savedRuleText(preview));
  };

  return (
    <div role="group" aria-labelledby="fd-gap-h" class="fd-rs fd-rs--ask">
      <div class="fd-label-line fd-label--ask">
        <AskDiamond solid size={16} />
        {ASK_LABEL}
      </div>
      <H id="fd-gap-h" tabIndex={-1} ref={headRef} class="fd-rs__ask-h">
        {v.head}
      </H>
      <p class="fd-rs__ask-body">{v.body}</p>
      <div class="fd-rs__case">
        <div class="fd-label-line fd-rs__case-tag">{v.caseTag}</div>
        <div class="fd-rs__case-row">
          <span class="fd-rs__case-call">{v.call}</span>
          <span>{v.caseLine}</span>
        </div>
      </div>
      {v.existing && <p class="fd-rs__ask-note">{v.existing}</p>}
      {v.onlyAgreeing && <p class="fd-rs__ask-note">{v.onlyAgreeing}</p>}

      <fieldset class="fd-rs__fs">
        <legend class="fd-rs__legend">{v.legend}</legend>
        <div class="fd-rs__opts">
          {v.options.map((opt) => {
            const on = opt.id === sel;
            const whyId = `fd-gap-${opt.id}-why`;
            return (
              <label key={opt.id} class={`fd-rs__opt${on ? ' is-on' : ''}${opt.disabled ? ' is-disabled' : ''}`}>
                <input
                  type="radio"
                  name="fd-gap-choice"
                  value={opt.id}
                  checked={on}
                  disabled={!!opt.disabled}
                  aria-describedby={opt.disabled ? whyId : undefined}
                  onChange={() => setSel(opt.id)}
                  class="fd-rs__radio"
                />
                <span class="fd-rs__opt-text">
                  <span>{opt.label}</span>
                  <span class="fd-rs__opt-tag">{opt.tag}</span>
                  {opt.disabled && (
                    <span class="fd-rs__opt-why" id={whyId}>
                      {opt.disabled}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {v.scope && (
        <fieldset class="fd-rs__fs fd-rs__fs--scope">
          <legend class="fd-rs__legend">Save it for</legend>
          <div class="fd-rs__scope">
            {(['call', 'rule'] as const).map((k) => (
              <label key={k} class={`fd-rs__opt fd-rs__opt--small${scope === k ? ' is-on' : ''}`}>
                <input type="radio" name="fd-gap-scope" value={k} checked={scope === k} onChange={() => setScope(k)} class="fd-rs__radio" />
                <span>{k === 'call' ? 'Just this case' : v.scope!.charAt(0).toUpperCase() + v.scope!.slice(1)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <p class="fd-rs__preview" aria-live="polite">
        {preview}
      </p>
      <div class="fd-rs__why">
        <label for="fd-gap-why" class="fd-rs__why-label">
          Why <span class="fd-rs__why-opt">(optional, saved with the rule)</span>
        </label>
        <input id="fd-gap-why" type="text" class="fd-rs__why-box" value={why} onInput={(e) => setWhy((e.target as HTMLInputElement).value)} />
      </div>
      <div class="fd-rs__actions">
        <Button variant="primary" aria-disabled={!ready || undefined} onClick={save}>
          Save as a house rule
        </Button>
        <span class="fd-rs__waiting">Waiting on you. No new answer is shown until you decide.</span>
      </div>
    </div>
  );
}
