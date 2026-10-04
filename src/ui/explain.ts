/**
 * Plain-language text for the two honesty surfaces: who decided a rejection (the rejection card) and what the model
 * was sent (the "What the model saw" expander). Pure: built only from what the gates reported and from the prompt.
 */
import type { Declined, Diagnostic, FunctionSpec, GateResult } from '../types';
import { listTestNames } from '../shared/specInfo';

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
  if (fail.gate === 'invariants') return ['A purity or time-limit check failed, with the evidence above.'];
  return ['A check you wrote failed, with the evidence above.'];
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
export function modelSawSummary(spec: Pick<FunctionSpec, 'tests' | 'properties'> | undefined, prompt: string): { sent: string; notSent: string } {
  const tests = spec ? listTestNames(spec.tests).length : 0;
  const props = spec ? listTestNames(spec.properties).length : 0;
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
export const UNCHECKED_TEXT = 'Only compiled and checked for purity — nothing checked that this is what you meant.';

/** The decline card: a plain headline and the suggested next step. Not a rejection: no gate judged anything. */
export function declineCopy(d: Declined): { title: string; next: string } {
  return d.reason === 'cannot-be-pure'
    ? {
        title: 'The model declined to fake this.',
        next: 'Generated functions are pure: no clock, randomness, network, files or hidden state. Pass what it needs in as an argument (for example a seed or a timestamp) and call it again.',
      }
    : {
        title: 'The model needs a spec for this.',
        next: 'Write a one-line spec that answers the question (“Write a spec” in the REPL opens it with the parameters filled in), then call it again.',
      };
}
