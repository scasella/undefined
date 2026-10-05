/**
 * Plain-language text for the two honesty surfaces: who decided a rejection (the rejection card) and what the model
 * was sent (the "What the model saw" expander). Pure: built only from what the gates reported and from the prompt.
 */
import type { Declined, Diagnostic, FunctionSpec, GateResult } from '../types';
import { listTestNames } from '../shared/specInfo';
import { effectiveChecks } from '../decide/decisions';

/**
 * One or two short lines for under the rejection headline, from the failing gate's first diagnostic (the same one
 * the headline is built from, so the lines and the evidence agree). Fair to the model: when the check declared that
 * the spec was silent on the point, it says the candidate's choice was defensible.
 */
export function whoDecided(fail: GateResult, attempt: number): string[] {
  const d: Diagnostic | undefined = fail.diagnostics[0];
  if (fail.note === 'spec error') {
    return ["Your spec's checks did not load, so this is not a verdict on the candidate. Fix the spec and retry."];
  }
  if (d && (d.kind === 'test' || d.kind === 'property') && d.name === '(gate runner)') {
    return ['The gate runner failed before it could judge the candidate. This is not a verdict on the model.'];
  }
  if (fail.gate === 'compile' || d?.kind === 'compile') {
    return ["The model's code didn't compile. The compiler decided."];
  }
  if (d?.kind === 'invariant') {
    if (d.invariant === 'bounded') {
      const limit = d.budgetMs !== undefined ? `The spec set a limit: ${d.budgetMs} ms per call.` : 'The spec set a time limit per call.';
      const took = d.elapsedMs !== undefined ? `The candidate took longer (stopped at ${Math.round(d.elapsedMs)} ms).` : 'The candidate took longer.';
      return [`${limit} ${took}`];
    }
    return ['The model was told to be side-effect free. The candidate wasn\'t.'];
  }
  if (d && d.kind === 'test' && d.name.startsWith(PINNED_TEST_PREFIX)) {
    return [PINNED_WHO, PINNED_NEXT];
  }
  if (d && (d.kind === 'test' || d.kind === 'property') && d.silentOn) {
    return [
      `The spec didn't say ${d.silentOn}. Your tests did.`,
      d.reasonable?.trim() || `Candidate #${attempt} made a defensible choice the spec never ruled out.`,
    ];
  }
  if (fail.gate === 'invariants') return ['It broke the time-limit or no-side-effects rule. The evidence is below.'];
  return ['A check you wrote failed. The evidence is below.'];
}

/** Name prefix of a pinned result's test diagnostic (sandbox/gateExecutor.ts PINNED_PREFIX; not imported: fast-check). */
export const PINNED_TEST_PREFIX = 'pinned: ';
export const PINNED_WHO = 'You pinned this result from an earlier call. The candidate disagrees with it.';
export const PINNED_NEXT = 'Remove the pin in the Repo tab if that result was wrong.';

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The DATA blocks of a prompt (shared/prompt.ts dataSection): which datasets, and how many sample rows were shown. */
export function promptData(prompt: string): Array<{ name: string; samples: number | null }> {
  const out: Array<{ name: string; samples: number | null }> = [];
  const re = /^DATA\n`([^`]+)` is bound to [\d,]+ rows? of [^\n]*\n([^\n]*)(?:\n([^\n]*))?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    const name = m[1]!;
    if (/^A few rows, spread across the data|^First rows/.test(m[2]!)) {
      let n = 0;
      try {
        const rows: unknown = JSON.parse(m[3] ?? '');
        n = Array.isArray(rows) ? rows.length : 0;
      } catch {
        n = 0;
      }
      out.push({ name, samples: n });
    } else {
      out.push({ name, samples: null });
    }
  }
  return out;
}

/** What the prompt itself contains, detected from its section markers (shared/prompt.ts). */
export function promptFeatures(prompt: string): { budget: boolean; previous: boolean; runtimeFault: boolean; callTypes: boolean } {
  return {
    budget: /^- Each call must return within \d+ ms\.$/m.test(prompt),
    previous: /^PREVIOUS ATTEMPT\b/m.test(prompt),
    runtimeFault: /^RUNTIME FAULT$/m.test(prompt),
    callTypes: /^TRIGGERING CALL$/m.test(prompt),
  };
}

/**
 * The plain summary over the exact prompt. Test/property counts come from the function's CURRENT spec (names
 * found with listTestNames); every other clause is read off the prompt that was really sent, so the summary never
 * claims something the prompt below it does not contain (older recorded prompts have no time-budget line).
 */
export function modelSawSummary(spec: Pick<FunctionSpec, 'tests' | 'properties' | 'decisions'> | undefined, prompt: string): { sent: string; notSent: string } {
  // the effective checks: the decisions' generated tests are named in the prompt too
  const eff = spec ? effectiveChecks(spec) : undefined;
  const tests = eff ? listTestNames(eff.tests).length : 0;
  const props = eff ? listTestNames(eff.properties).length : 0;
  const f = promptFeatures(prompt);
  const parts = ['the signature', 'your doc'];
  parts.push(
    tests === 0 && props === 0
      ? 'the names of your tests and properties (there are none yet)'
      : `the names of ${count(tests, 'test', 'tests')} and ${count(props, 'property', 'properties')}`,
  );
  if (f.callTypes) parts.push("the types (not the values) of your call's arguments");
  const data = promptData(prompt);
  for (const d of data) {
    parts.push(
      d.samples === null
        ? `the type of ${d.name} only (you chose not to share sample rows)`
        : `the type of ${d.name} and ${count(d.samples, 'sample row', 'sample rows')}`,
    );
  }
  if (f.budget) parts.push('the time budget');
  if (f.runtimeFault) parts.push('the error a previous version hit at runtime');
  if (f.previous) parts.push('the previous attempt and its diagnostics');
  return {
    sent: `Sent: ${parts.join(', ')}.`,
    notSent:
      data.length > 0
        ? `Not sent: the bodies of the tests and properties, the reference implementation, or any other rows of ${data.map((d) => d.name).join(', ')}.`
        : 'Not sent: the bodies of the tests and properties, or the reference implementation.',
  };
}

/**
 * Under the result of a call that grew a function with no tests and no properties (the engine marks it by setting
 * the output's `note`): an accept there is not an endorsement, so the line says what was and was not checked.
 */
export const UNCHECKED_TEXT = 'It compiles and has no side effects, but nothing checked that it does what you meant.';

/** The decline card: a plain headline and the suggested next step. Not a rejection: no gate judged anything. */
export function declineCopy(d: Declined): { title: string; next: string } {
  return d.reason === 'cannot-be-pure'
    ? {
        title: 'The model declined to fake this.',
        next: 'Generated functions are pure: no clock, randomness, network, files or hidden state. Pass what it needs in as an argument (for example a seed or a timestamp) and call it again.',
      }
    : {
        title: 'The model needs a spec for this.',
        next: 'Write a one-line spec that answers the question (“Write a spec” in the console opens it with the parameters filled in), then call it again.',
      };
}

// ───────────── plain words for what the gates report (display only; the gates' own wording stays in title/details) ─────────────

/** One plain question per gate, shown under its name. */
export const GATE_QUESTION = {
  compile: 'Does it compile?',
  tests: 'Do your examples pass?',
  properties: 'Does it hold for lots of random inputs?',
  invariants: 'Is it pure and fast enough?',
} as const;

/** A two- or three-word caption under each gate's name while nothing has run yet. */
export const GATE_CAPTION = {
  compile: 'Type-checks',
  tests: 'Your examples',
  properties: '100 random inputs',
  invariants: 'Pure and fast',
} as const;

/** What each gate does, in plain words, for the row's disclosure (the precise terms stay in GATE_PRECISE). */
export const GATE_PLAIN = {
  compile: 'The strict TypeScript compiler, with the standard library only.',
  tests: 'Your unit tests, plus any results you pinned.',
  properties: 'Rules that must hold for any input, tried on generated inputs. The same spec always tries the same inputs.',
  invariants: 'No side effects (no globals, no changed arguments, the same answer every time) and within the time limit on every call.',
} as const;

export const NOT_REACHED_TEXT = 'Not run: an earlier check failed.';

/**
 * The short status cell of a gate row: "Passed", "3 of 3 held", "Pure · fast", "—". The full summary lives in the
 * row's disclosure, so this never needs truncating.
 */
export function shortGateStatus(g: Pick<GateResult, 'gate' | 'status' | 'summary' | 'note' | 'counts'>, notRun = false): string {
  if (notRun) return 'Not run';
  const c = g.counts;
  switch (g.status) {
    case 'pending':
      return 'Waiting';
    case 'running':
      return 'Running…';
    case 'skipped':
      if (!g.summary || g.summary === 'not reached' || g.note === 'not reached') return '—';
      return sentence(plainGateText(g.summary));
    case 'pass':
      if (g.gate === 'invariants') return 'Pure · fast';
      if (c && c.total === 0) return g.gate === 'tests' ? 'No tests yet' : 'Nothing to check';
      if (c && g.gate === 'tests') return `${c.passed} of ${c.total} passed`;
      if (c && g.gate === 'properties') return `${c.passed} of ${c.total} held`;
      return 'Passed';
    case 'fail':
      if (g.note === 'spec error') return 'Spec error';
      if (g.gate === 'invariants') {
        if (g.note === 'pure violated' || /pure violated/.test(g.summary)) return 'Side effect';
        if (g.note === 'bounded violated' || /bounded violated/.test(g.summary)) return 'Too slow';
        return 'Failed';
      }
      if (c && c.total > 0 && (g.gate === 'tests' || g.gate === 'properties')) return `${c.total - c.passed} of ${c.total} failed`;
      if (g.gate === 'compile' && /^\d+ errors?$/.test(g.summary)) return sentence(g.summary);
      return 'Failed';
  }
}

const sentence = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The second half of the rejection eyebrow: whose fault the verdict says it is, in two or three words. */
export function rejectionClass(fail: GateResult): string {
  const d: Diagnostic | undefined = fail.diagnostics[0];
  if (fail.note === 'spec error') return 'your spec did not load';
  if (d && (d.kind === 'test' || d.kind === 'property') && d.name === '(gate runner)') return 'gate runner fault';
  if (d && d.kind === 'test' && d.name.startsWith(PINNED_TEST_PREFIX)) return 'disagrees with your pin';
  if (d && (d.kind === 'test' || d.kind === 'property') && d.silentOn) return 'spec was silent';
  return 'model mistake';
}

/** The precise description of each gate, for its title attribute. */
export const GATE_PRECISE = {
  compile: 'strict TypeScript compiler, lib ES2022 only',
  tests: 'your unit tests (and pinned results)',
  properties: 'property-based tests (fast-check), fixed seed derived from the spec',
  invariants: 'invariants: pure (no globals, no argument mutation, deterministic) and bounded (per-call time limit)',
} as const;

/** A rejection headline without its "Rejected: " prefix (the card already says so) and without the rule tag. */
export function plainHeadline(headline: string): string {
  return headline
    .replace(/^Rejected:\s*/, '')
    .replace(/\s*\((bounded|pure)\)$/, '');
}

/**
 * Split a headline that starts with a call (`median([]) threw …`) into the call and the rest, so the call can be set
 * as code. null when it does not start with `name(` or the parentheses do not balance.
 */
export function splitCall(text: string): { call: string; rest: string } | null {
  const m = /^[A-Za-z_$][\w$]*\(/.exec(text);
  if (!m) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = m[0].length - 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return { call: text.slice(0, i + 1), rest: text.slice(i + 1) };
    }
  }
  return null;
}

/** Gate notes and summaries the gates word in their own terms, in plain words. Anything else is returned unchanged. */
export function plainGateText(text: string): string {
  if (text === 'interrupted: invariant violated') return 'stopped early: a time-limit or side-effect rule broke first';
  if (text === 'interrupted') return 'stopped early';
  if (text === 'bounded violated') return 'too slow: over the time limit';
  if (text === 'pure violated') return 'has a side effect';
  if (text === 'pure ✓ bounded ✓ (no sampled calls to replay)') return 'no side effects ✓ fast enough ✓ (no calls to re-run)';
  const m = /^pure ✓ bounded ✓ \((\d+) sampled calls? replayed on frozen arguments\)$/.exec(text);
  if (m) return `no side effects ✓ fast enough ✓ (${m[1]} call${m[1] === '1' ? '' : 's'} re-run on locked inputs)`;
  return text;
}

/** The rule an invariant diagnostic is about, in plain words. */
export function ruleName(invariant: 'pure' | 'bounded'): string {
  return invariant === 'bounded' ? 'return within the time limit' : 'no side effects';
}

/** A REPL error name, in plain words when it is the gates' own term. */
export function plainErrorName(name: string): string {
  return name === 'InvariantViolation' ? 'RuleBroken' : name;
}

/** How a failing check found its input, in one plain sentence (the precise terms live in the details line). */
export function howFound(d: Diagnostic): string | null {
  switch (d.kind) {
    case 'property': {
      const tries = `${d.runs} random input${d.runs === 1 ? '' : 's'}`;
      return d.shrinks > 0
        ? `Found by trying up to ${tries}, then cut down in ${d.shrinks} step${d.shrinks === 1 ? '' : 's'} to the smallest input that still fails. The same spec always tries the same inputs.`
        : `Found by trying up to ${tries}. The same spec always tries the same inputs.`;
    }
    case 'test':
      return d.name.startsWith(PINNED_TEST_PREFIX) ? 'A result you pinned from an earlier call.' : `Your test "${d.name}".`;
    case 'compile':
      return `TypeScript error TS${d.code}, line ${d.line} of the body.`;
    case 'invariant':
      if (!d.phase) return null;
      const phase: Record<string, string> = { tests: 'your tests', properties: 'the random-input checks', invariants: 'the final replay' };
      return `Caught while ${phase[d.phase] ?? d.phase} were running.`;
  }
}
