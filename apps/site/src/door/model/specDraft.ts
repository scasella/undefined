/**
 * The AI's draft of a stricter contract for a question (Step by step, pane 3; docs/FRONT-DOOR.md "Draft the contract").
 *
 * A question the viewer typed (or a suggestion with no seeded agreement) goes to the model as one sentence, so only the two
 * checks that always run apply. Here the model is asked, in a SEPARATE call from the one that writes the answer, to draft
 * what the answer will be held to: the precise contract in words, the return type, examples (unit tests on made-up rows)
 * and house rules (fast-check properties). Where the question leaves something open that changes the answer (which rows
 * count, ties, rounding, order, the shape of the result) it must ASK instead of drafting, and it always says in plain words
 * what passing the checks would show and what it would not. Nothing it drafts is a check until the viewer approves it.
 *
 * Load-bearing (docs/DESIGN.md "What the model sees"): the model that writes the answer sees the contract (`doc`), the
 * signature and the NAMES of the checks, never their bodies. So everything the checks rely on (the shape, the order, each
 * thing the viewer settled) must be written into `doc` (`draftToSpec`), or the answer cannot pass them.
 *
 * Pure: no engine, no DOM. The wire format is the service's `{ body, notes }` (server/codexService.ts OUTPUT_SCHEMA): the
 * draft is a JSON document inside `body`.
 */
import type { FunctionSpec } from '@scasella/undefined-engine/types';
import { listTestNames } from '@scasella/undefined-engine/shared/specInfo';

/** Something the model will not guess: asked before anything is drafted. */
export interface DraftQuestion {
  id: string;
  /** The question, in the viewer's terms ("Should a partly refunded order count as refunded?"). */
  ask: string;
  /** Why it matters to the answer, one sentence. */
  why: string;
  /** Two to four plain choices; the viewer may also write their own. */
  options: string[];
}

/** One drafted check: an example (a unit test) or a house rule (a property). */
export interface DraftItem {
  id: string;
  kind: 'example' | 'rule';
  /** The check's name (the test or property name in `source`, which the answering model sees). */
  name: string;
  /** What it checks, in plain words, for the viewer. */
  plain: string;
  /** Where the model made a call the question did not settle and did not ask about ('' when none). */
  assumption: string;
  /** Test API source (docs/DESIGN.md "Test API"): exactly one `test(…)` (example) or `property(…)` / `matchesReference(…)` (rule). */
  source: string;
}

export interface SpecDraft {
  /** The contract in words, for the answering model and the viewer: what is returned, its shape, order, ties, rounding, rows counted. */
  contract: string;
  /** TypeScript return type text, e.g. `number` or `Array<{ customer: string; revenue: number }>`. */
  returns: string;
  /** Questions to settle first. When there are any, nothing else is drafted. */
  questions: DraftQuestion[];
  examples: DraftItem[];
  rules: DraftItem[];
  /** What passing every drafted check would show, in plain words. */
  shows: string;
  /** What it would not show (made-up tables, a limited number of runs, what the checks do not look at). */
  limits: string;
}

/** A question the viewer settled, as it is written into the contract and the next prompt. */
export interface SettledPoint {
  ask: string;
  answer: string;
}

/** Everything the draft prompt is built from. */
export interface DraftInput {
  /** The question in the viewer's words. */
  question: string;
  /** The function's name: the checks call it by this name. */
  fn: string;
  /** The parameter: the bound table (`rows`) and its row type. */
  param: string;
  typeName: string;
  /** `type Row = { … }` */
  typeDecl: string;
  rowCount: number;
  /** A few rows, only when the viewer shares sample rows (the same rows the answer's prompt would carry). */
  sampleText?: string;
  /** What the viewer settled in earlier rounds. */
  settled: SettledPoint[];
  /** The draft the viewer asked to have changed, and what they asked for. */
  revise?: { draft: SpecDraft; request: string };
  /** The last draft could not be used (a check did not parse): the reason, so it is fixed. */
  fix?: string;
  /** No more questions: settle anything left with a marked assumption (after the second round of questions). */
  noMoreQuestions?: boolean;
}

/** At most this many rounds of questions before the model must draft (the viewer is not interrogated). */
export const MAX_QUESTION_ROUNDS = 2;
/** fast-check runs per drafted house rule (the seeded demo agreement uses the same order of magnitude). */
export const RULE_RUNS = 200;

const MAX_QUESTIONS = 3;
const MAX_EXAMPLES = 6;
const MAX_RULES = 4;

const TEST_API = String.raw`Checks are TypeScript in this Test API (NOT vitest or jest; there are no imports, describe or expect):
  test(name: string, body: () => void): void
  eq(actual: unknown, expected: unknown): void   // deep equality, Object.is for numbers
  throws(fn: () => unknown, match?: RegExp | string): void
  property(name: string, arbs: Arbitrary[], predicate: (...args) => boolean | void, opts?: { numRuns?: number; silentOn?: string; reasonable?: string; when?: (...args) => boolean }): void
  matchesReference(name: string, arbs: Arbitrary[], reference: (...args) => unknown, opts?: same as property): void
  fc: fast-check (fc.record, fc.array, fc.constantFrom, fc.integer, fc.string, …)
The function under test is in scope by its own name. A test may also take a third argument { silentOn, reasonable }.
silentOn completes "The question didn't say ___" and reasonable says in one sentence why another choice is defensible:
put both on any check that encodes a choice the question and the settled points do not make.`;

/** The prompt for one round. */
export function buildDraftPrompt(i: DraftInput): string {
  const lines: string[] = [];
  lines.push(
    'You are drafting the CONTRACT a function will be held to, not the function. Another model will write the function later from',
    'your contract text, its signature and the NAMES of your checks only (it never sees the check bodies), and every check you write',
    'must pass on a correct answer. Do NOT run commands, do NOT read or inspect files. Answer with the JSON object only.',
    '',
    `The user's question about their table: ${JSON.stringify(i.question)}`,
    `The function: ${i.fn}(${i.param}: ${i.typeName}[]) answers it for the whole table (${i.rowCount} rows; other tables will have other rows).`,
    'The row type:',
    i.typeDecl.trim(),
  );
  if (i.sampleText !== undefined) lines.push('A few rows, spread across the data (nothing else is shared):', i.sampleText);
  else lines.push('(The user chose not to share sample rows; only the type is shared.)');
  if (i.settled.length > 0) {
    lines.push('', 'The user has settled these. Follow them exactly and write each one into the contract as a stated rule:');
    for (const s of i.settled) lines.push(`- ${s.ask} → ${s.answer}`);
  }
  if (i.revise) {
    lines.push('', 'Your previous draft is below. The user asked for this change:', JSON.stringify(i.revise.request), 'Previous draft:', JSON.stringify(i.revise.draft));
  }
  if (i.fix) lines.push('', `Your previous draft could not be used: ${i.fix}. Fix that and draft again.`);
  lines.push(
    '',
    'First decide whether the question leaves anything open that would change the answer: which rows count (status, blanks,',
    'duplicates), how ties are broken, rounding, sort order, how many items, the exact shape of the result, what an empty table gives.',
  );
  if (i.noMoreQuestions) {
    lines.push('Do NOT ask anything more. Make the most reasonable choice for anything still open and mark each such check with silentOn and reasonable.');
  } else {
    lines.push(
      `If something open matters and you are not sure what the user means, ASK: return up to ${MAX_QUESTIONS} questions with 2 to 4 short options each,`,
      'and leave contract, returns, examples and rules empty. Ask only what changes the answer; do not ask about things the columns settle.',
      'If nothing important is open, ask nothing and draft.',
    );
  }
  lines.push(
    '',
    'A draft has:',
    '- contract: the precise contract in plain words: what is returned, its exact shape and field names, order, ties, rounding, which rows count,',
    '  what an empty table returns, and every point the user settled. The function will be written from this text alone.',
    '- returns: the TypeScript return type.',
    `- examples: 2 to ${MAX_EXAMPLES} unit tests, each ONE test(...) call on a small made-up table written out in full (every field of the row type),`,
    '  with the expected value worked out by hand. Cover the ordinary case and the edges the contract names.',
    `- rules: 1 to ${MAX_RULES} house rules, each ONE property(...) or matchesReference(...) call over made-up tables built with fc, numRuns ${RULE_RUNS},`,
    '  stating something that must hold for every table (e.g. rows that must not count do not change the answer). Define any helper',
    '  inside the call (an IIFE or the predicate) so checks never share top-level names.',
    '- for each check: a name (the test/property name, unique), plain (what it checks, one sentence a non-programmer reads), assumption',
    '  (the choice it encodes that nobody settled, or empty), source (the code).',
    '- shows: in plain words, what passing every check would show about an answer.',
    '- limits: in plain words, what it would NOT show (the checks use made-up tables and a limited number of random tables, and what they do not look at).',
    '',
    TEST_API,
    '',
    'Put this JSON document in "body" (as a string) and one sentence about it in "notes":',
    '{"questions":[{"ask":"","why":"","options":[""]}],"contract":"","returns":"","examples":[{"name":"","plain":"","assumption":"","source":""}],',
    '"rules":[{"name":"","plain":"","assumption":"","source":""}],"shows":"","limits":""}',
  );
  return lines.join('\n');
}

export type ParsedDraft = { ok: true; draft: SpecDraft } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (o: Record<string, unknown>, k: string): string => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
const list = (o: Record<string, unknown>, k: string): unknown[] => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []);

/** The JSON inside a reply, tolerating a markdown fence or words around it. */
function jsonOf(body: string): unknown {
  const t = body.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('the draft is not JSON');
    return JSON.parse(t.slice(a, b + 1));
  }
}

/**
 * Read and check the model's reply. A draft is usable only when every check is exactly one named check calling the function,
 * the names are unique, and (no questions) there is a contract, a return type and at least one example. Syntax is checked
 * separately (`syntaxProblem`), where TypeScript is loaded.
 */
export function parseDraft(body: string, fn: string): ParsedDraft {
  let raw: unknown;
  try {
    raw = jsonOf(body);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'the draft is not JSON' };
  }
  if (!isObj(raw)) return { ok: false, error: 'the draft is not a JSON object' };

  const questions: DraftQuestion[] = [];
  for (const [n, q] of list(raw, 'questions').entries()) {
    if (!isObj(q) || text(q, 'ask') === '') continue;
    const options = list(q, 'options').filter((o): o is string => typeof o === 'string' && o.trim() !== '').map((o) => o.trim()).slice(0, 4);
    questions.push({ id: `q${n + 1}`, ask: text(q, 'ask'), why: text(q, 'why'), options });
  }
  const shows = text(raw, 'shows');
  const limits = text(raw, 'limits');
  if (questions.length > 0) {
    return { ok: true, draft: { contract: '', returns: '', questions: questions.slice(0, MAX_QUESTIONS), examples: [], rules: [], shows, limits } };
  }

  const items = (k: 'examples' | 'rules'): DraftItem[] | string => {
    const out: DraftItem[] = [];
    for (const [n, it] of list(raw, k).entries()) {
      if (!isObj(it)) return `${k}[${n}] is not an object`;
      const source = text(it, 'source');
      const names = listTestNames(source);
      if (names.length !== 1) return `${k}[${n}] must hold exactly one check, it holds ${names.length}`;
      const name = names[0]!;
      const isTest = /^\s*(?:\/\/[^\n]*\n\s*)*test\s*\(/.test(source);
      if (k === 'examples' && !isTest) return `example "${name}" must be a test(...) call`;
      if (k === 'rules' && isTest) return `house rule "${name}" must be a property(...) or matchesReference(...) call`;
      if (!new RegExp(`\\b${fn}\\s*\\(`).test(source) && !(k === 'rules' && /matchesReference\s*\(/.test(source))) {
        return `check "${name}" never calls ${fn}`;
      }
      out.push({ id: `${k === 'examples' ? 'e' : 'r'}${n + 1}`, kind: k === 'examples' ? 'example' : 'rule', name, plain: text(it, 'plain') || name, assumption: text(it, 'assumption'), source });
    }
    return out;
  };
  const examples = items('examples');
  if (typeof examples === 'string') return { ok: false, error: examples };
  const rules = items('rules');
  if (typeof rules === 'string') return { ok: false, error: rules };
  const names = [...examples, ...rules].map((i) => i.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) return { ok: false, error: `two checks are both called "${dup}"` };

  const contract = text(raw, 'contract');
  const returns = text(raw, 'returns');
  if (contract === '') return { ok: false, error: 'the draft has no contract' };
  if (returns === '') return { ok: false, error: 'the draft has no return type' };
  if (examples.length === 0) return { ok: false, error: 'the draft has no examples' };
  return {
    ok: true,
    draft: { contract, returns, questions: [], examples: examples.slice(0, MAX_EXAMPLES), rules: rules.slice(0, MAX_RULES), shows, limits },
  };
}

/** The smallest piece of TypeScript the syntax check needs (`transpileModule`), so tests can pass the real module or a stand-in. */
export interface Transpiler {
  transpileModule(input: string, opts: { reportDiagnostics: boolean; compilerOptions?: object }): {
    diagnostics?: ReadonlyArray<{ messageText: string | { messageText: string } }>;
  };
}

/** The first syntax error in any drafted check, said with the check's name, or null. A broken check would stop the run as a spec error. */
export function syntaxProblem(draft: SpecDraft, ts: Transpiler): string | null {
  for (const it of [...draft.examples, ...draft.rules]) {
    const d = ts.transpileModule(it.source, { reportDiagnostics: true }).diagnostics ?? [];
    if (d.length > 0) {
      const m = d[0]!.messageText;
      return `check "${it.name}" has a syntax error: ${typeof m === 'string' ? m : m.messageText}`;
    }
  }
  return null;
}

/**
 * The spec the viewer approved: the base spec (the question's own, `customSpec`) with the drafted contract, the return type and
 * only the checks they kept. The settled points are written into the contract again, word for word, because the model that
 * writes the answer reads the contract and the checks' names, never their bodies.
 */
export function draftToSpec(base: FunctionSpec, draft: SpecDraft, keep: ReadonlySet<string>, settled: readonly SettledPoint[], question: string): FunctionSpec {
  const kept = (xs: DraftItem[]) => xs.filter((x) => keep.has(x.id));
  const block = (xs: DraftItem[]) => xs.map((x) => `// ${x.plain.replace(/\n/g, ' ')}\n${x.source.trim()}\n`).join('\n');
  const doc = [
    `Answer this question about the table: ${question}`,
    '',
    draft.contract,
    ...(settled.length > 0 ? ['', 'The user settled:', ...settled.map((s) => `- ${s.ask} ${s.answer}`)] : []),
  ].join('\n');
  const examples = kept(draft.examples);
  const rules = kept(draft.rules);
  return {
    ...base,
    returns: draft.returns,
    doc,
    tests: examples.length > 0 ? `${DRAFTED_MARK}\n${block(examples)}` : '',
    properties: rules.length > 0 ? `${DRAFTED_MARK}\n${block(rules)}` : '',
  };
}

/** The first line of a tests or properties source the AI drafted and the viewer approved (draftToSpec): how a drafted check is told apart. */
export const DRAFTED_MARK = '// Drafted by the AI and approved by the user.';

/** `2 examples and 1 house rule` */
export function keptCount(draft: SpecDraft, keep: ReadonlySet<string>): string {
  const e = draft.examples.filter((x) => keep.has(x.id)).length;
  const r = draft.rules.filter((x) => keep.has(x.id)).length;
  const p = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return `${p(e, 'example')} and ${p(r, 'house rule')}`;
}
