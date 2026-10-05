// Dev tool: calibrates the decline protocol. For ~47 spec-less calls it asks the real model (through the real prompt
// builder and the real codex invocation) and counts how often each is WRITTEN vs DECLINED, against what we expect.
// Usage: CAL_N=3 npx vitest run -c scripts/vitest.tune.config.ts scripts/calibrate.tune.ts   (writes .tmp/calibrate-out.json)
// Phase 3 (docs/COMPOSE-MEASUREMENTS.md): CAL_OTHERS=examples puts the three shipped spec'd examples (median, slugify,
// fibonacci) in the prompt's OTHER FUNCTIONS section, built exactly as the engine builds it for certified functions
// (compose/graph.ts othersFor: declarationLine + firstSentence of the doc; a case never lists itself).
// CAL_OTHERS=tempting runs the extra TEMPTING cases, each with its own hand-written OTHER FUNCTIONS list (prompt-only
// fixtures; nothing is certified). CAL_OUT overrides the output path. The output is {at, mode, N, results} (it was a bare
// array before Phase 3; nothing reads it but people).
import { it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createCodexService } from '../server/codexService';
import { buildPrompt, parseDecline } from '../src/shared/prompt';
import { specFromCall } from '../src/gates/source';
import { bundledOrders } from '../src/data/orders';
import { inferDataset } from '../src/data/infer';
import { sampleForModel } from '../src/data/sample';
import { declarationLine, type PromptInput } from '../src/shared/prompt';
import { firstSentence } from '../src/compose/graph';
import { median } from '../src/examples/median';
import { slugify } from '../src/examples/slugify';
import { fibonacci } from '../src/examples/fibonacci';

type Other = NonNullable<PromptInput['others']>[number];
const fromSpec = (ex: { spec?: import('../src/types').FunctionSpec }): Other & { name: string } => ({ name: ex.spec!.name, decl: declarationLine(ex.spec!), doc: firstSentence(ex.spec!.doc) });
const EXAMPLE_OTHERS = [fibonacci, median, slugify].map(fromSpec); // othersFor lists them sorted by name
const SLUGIFY = fromSpec(slugify);
const SEEDED = [
  { name: 'rngFromSeed', decl: 'function rngFromSeed(seed: number): number', doc: 'Returns a deterministic pseudo-random number in [0, 1) for a seed.' },
  { name: 'seededShuffle', decl: 'function seededShuffle(xs: number[], seed: number): number[]', doc: 'Returns a copy of xs shuffled deterministically by seed (Fisher-Yates with a seeded generator).' },
];
const FORMAT_DATE = { name: 'formatDate', decl: 'function formatDate(ms: number): string', doc: 'Formats a millisecond timestamp as an ISO date (YYYY-MM-DD) in UTC.' };

type Case = { name: string; types: string[]; expect: 'write' | 'decline'; group: string; data?: boolean; others?: Array<Other & { name: string }> };
const W = (name: string, types: string[], data = false): Case => ({ name, types, expect: 'write', group: data ? 'write-data' : 'write', data });
const D = (name: string, types: string[], group: string): Case => ({ name, types, expect: 'decline', group });
const CASES: Case[] = [
  W('topCustomersByRevenue', ['Row[]'], true), W('monthlyTotals', ['Row[]'], true), W('dedupeByEmail', ['Row[]'], true),
  W('countByCountry', ['Row[]'], true), W('averageOrderValue', ['Row[]'], true), W('ordersPerCustomer', ['Row[]'], true),
  W('truncate', ['string', 'number']), W('sortDescending', ['number[]']), W('isPalindrome', ['string']), W('titleCase', ['string']),
  W('capitalizeAll', ['string[]']), W('hello', []), W('add', ['number', 'number']), W('removeDuplicates', ['number[]']),
  W('median', ['number[]']), W('reverseString', ['string']), W('countWords', ['string']), W('sumBy', ['{ price: number; qty: number }[]', 'string']),
  W('transpose', ['number[][]']), W('isPrime', ['number']), W('gcd', ['number', 'number']), W('factorial', ['number']),
  W('clamp', ['number', 'number', 'number']), W('slugify', ['string']), W('formatCurrency', ['number']), W('parseCsvLine', ['string']),
  D('clean', ['string'], 'decline-generic'), D('process', ['number[]'], 'decline-generic'), D('handle', ['{ type: string; x: number }'], 'decline-generic'),
  D('transform', ['{ a: number; b: number }'], 'decline-generic'), D('data', ['number[]'], 'decline-generic'), D('run', ['string'], 'decline-generic'), D('doIt', ['number'], 'decline-generic'),
  D('counter', [], 'decline-impure'), D('nextId', [], 'decline-impure'), D('randomInt', ['number', 'number'], 'decline-impure'), D('shuffle', ['number[]'], 'decline-impure'),
  D('now', [], 'decline-impure'), D('uuid', [], 'decline-impure'), D('fetchUser', ['number'], 'decline-impure'), D('sleep', ['number'], 'decline-impure'),
  D('getWeather', ['string'], 'decline-impure'), D('loadConfig', ['string'], 'decline-impure'), D('readFile', ['string'], 'decline-impure'),
  D('httpGet', ['string'], 'decline-impure'), D('saveToDisk', ['{ a: number }'], 'decline-impure'), D('printReport', ['number[]'], 'decline-impure'), D('getCookie', ['string'], 'decline-impure'),
];

const T = (name: string, types: string[], others: Array<Other & { name: string }>): Case => ({ name, types, expect: 'decline', group: 'tempting', others });
const TEMPTING: Case[] = [
  T('shuffle', ['number[]'], SEEDED), T('randomInt', ['number', 'number'], SEEDED), T('randomSample', ['number[]', 'number'], SEEDED),
  T('process', ['string[]'], [SLUGIFY]), T('clean', ['string[]'], [SLUGIFY]), T('handle', ['string'], [SLUGIFY]),
  T('now', [], [FORMAT_DATE]), T('today', [], [FORMAT_DATE]),
];

/** The body calls (or passes) `name` and does not declare its own `name` (a local variable named median is not a call). */
const callsName = (body: string, name: string): boolean =>
  new RegExp(`\\b${name}\\s*\\(|[(,]\\s*${name}\\s*[),]`).test(body) && !new RegExp(`(function|const|let|var)\\s+${name}\\b`).test(body);

it('calibrate', async () => {
  const N = Number(process.env.CAL_N ?? 3);
  const only = process.env.CAL_ONLY?.split(',');
  const rows = bundledOrders();
  const inf = inferDataset(rows, { typeName: 'Row' });
  const sample = sampleForModel(rows, { count: 3 });
  const mode = process.env.CAL_OTHERS ?? '';
  const base = mode === 'tempting' ? TEMPTING : CASES.map((c) => (mode === 'examples' ? { ...c, others: EXAMPLE_OTHERS.filter((o) => o.name !== c.name) } : c));
  const cases = base.filter((c) => !only || only.includes(c.name));
  const results: Array<Case & { wrote: number; declined: number; reasons: string[] }> = [];
  const queue = cases.flatMap((c) => Array.from({ length: N }, () => c));
  const tally = new Map<Case, { wrote: number; declined: number; reasons: string[] }>();
  cases.forEach((c) => tally.set(c, { wrote: 0, declined: 0, reasons: [] }));
  let next = 0;
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      while (next < queue.length) {
        const c = queue[next++]!;
        const spec = specFromCall(c.name, c.types, c.data ? { typeDecls: inf.typeDecl } : {});
        let prompt = buildPrompt({
          spec,
          callArgTypes: c.types,
          history: [],
          ...(c.data ? { dataSamples: [{ name: 'rows', typeName: 'Row', rowCount: rows.length, sampleText: sample.text }] } : {}),
          ...(c.others && c.others.length > 0 ? { others: c.others.map(({ decl, doc }) => ({ decl, doc })) } : {}),
        });
        // CAL_PATCH: a JSON file of [from, to] string replacements applied to the built prompt, to try a rewording of
        // the OTHER FUNCTIONS guard before it is put in src/shared/prompt.ts (only used while choosing it).
        if (process.env.CAL_PATCH) for (const [a, b] of JSON.parse(readFileSync(process.env.CAL_PATCH, 'utf8')) as [string, string][]) prompt = prompt.split(a).join(b);
        if (process.env.CAL_DUMP) writeFileSync(process.env.CAL_DUMP, prompt);
        const svc = createCodexService();
        const r = await svc.generate(prompt, () => {});
        const t = tally.get(c)!;
        if (!r.ok) { t.reasons.push('ERR ' + r.error.message.slice(0, 60)); continue; }
        const d = parseDecline(r.result.body);
        if (d) { t.declined++; t.reasons.push(d.reason + ': ' + d.message.slice(0, 90)); } else { t.wrote++; t.reasons.push('WROTE ' + (c.others ?? []).filter((o) => callsName(r.result.body, o.name)).map((o) => 'calls ' + o.name).join(' ') + ' | ' + r.result.body.replace(/\s+/g, ' ').slice(0, 140)); }
      }
    }),
  );
  for (const c of cases) results.push({ ...c, others: undefined, othersListed: (c.others ?? []).map((o) => o.name), ...tally.get(c)! } as never);
  mkdirSync('.tmp', { recursive: true });
  writeFileSync(process.env.CAL_OUT ?? '.tmp/calibrate-out.json', JSON.stringify({ at: new Date().toISOString(), mode, N, results }, null, 1));
}, 1_800_000);
