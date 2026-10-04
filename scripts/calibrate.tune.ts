// Dev tool: calibrates the decline protocol. For ~47 spec-less calls it asks the real model (through the real prompt
// builder and the real codex invocation) and counts how often each is WRITTEN vs DECLINED, against what we expect.
// Usage: CAL_N=3 npx vitest run -c scripts/vitest.tune.config.ts scripts/calibrate.tune.ts   (writes .tmp/calibrate-out.json)
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createCodexService } from '../server/codexService';
import { buildPrompt, parseDecline } from '../src/shared/prompt';
import { specFromCall } from '../src/gates/source';
import { bundledOrders } from '../src/data/orders';
import { inferDataset } from '../src/data/infer';
import { sampleForModel } from '../src/data/sample';

type Case = { name: string; types: string[]; expect: 'write' | 'decline'; group: string; data?: boolean };
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

it('calibrate', async () => {
  const N = Number(process.env.CAL_N ?? 3);
  const only = process.env.CAL_ONLY?.split(',');
  const rows = bundledOrders();
  const inf = inferDataset(rows, { typeName: 'Row' });
  const sample = sampleForModel(rows, { count: 3 });
  const cases = CASES.filter((c) => !only || only.includes(c.name));
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
        const prompt = buildPrompt({
          spec,
          callArgTypes: c.types,
          history: [],
          ...(c.data ? { dataSamples: [{ name: 'rows', typeName: 'Row', rowCount: rows.length, sampleText: sample.text }] } : {}),
        });
        const svc = createCodexService();
        const r = await svc.generate(prompt, () => {});
        const t = tally.get(c)!;
        if (!r.ok) { t.reasons.push('ERR ' + r.error.message.slice(0, 60)); continue; }
        const d = parseDecline(r.result.body);
        if (d) { t.declined++; t.reasons.push(d.reason + ': ' + d.message.slice(0, 90)); } else t.wrote++;
      }
    }),
  );
  for (const c of cases) results.push({ ...c, ...tally.get(c)! });
  writeFileSync('.tmp/calibrate-out.json', JSON.stringify(results, null, 1));
}, 1_800_000);
