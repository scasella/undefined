/**
 * Proves every suggestion kind is syntactically and semantically right, with the REAL compile gate and the REAL gate
 * executor (same harness as src/examples/examples.test.ts): for each kind, the generated snippet (appended through
 * appendProperty) ACCEPTS a known-good candidate and REJECTS a known-bad one at the Properties gate with a shrunk
 * counterexample. Assertions are structural (gate, property name, counterexample present), not seed-dependent strings.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Diagnostic, FunctionSpec, GateId, GateResult, Program } from '../types';
import { compileCandidate, transpileUserCode, warmUp } from '../gates/compile';
import { executeGates, type ExecGateInput } from '../sandbox/gateExecutor';
import { gateSeed, hashesFor } from '../shared/hash';
import { exampleById } from '../examples/index';
import { appendProperty } from './apply';
import { makeRecord, makeSpec, programOf } from './fixtures';
import { suggestProperties, type Suggestion, type SuggestionKind } from './suggest';

interface Verdict {
  gates: GateResult[];
  rejectedBy?: GateId;
  headline?: string;
}

async function runGates(spec: FunctionSpec, body: string): Promise<Verdict> {
  const compiled = await compileCandidate(spec, body);
  expect(compiled.gate.status, `body does not compile: ${compiled.gate.headline}`).not.toBe('fail');
  const props = transpileUserCode(spec.properties);
  expect(props.error, `properties do not transpile: ${props.error}`).toBeUndefined();
  const { specHash, testsHash } = await hashesFor(spec);
  const input: ExecGateInput = {
    name: spec.name,
    js: compiled.js!,
    testsJs: '',
    propertiesJs: props.js,
    budgetMs: spec.budgetMs,
    seed: gateSeed(specHash, testsHash),
  };
  const gates = [compiled.gate, ...executeGates(input, { phase: () => {}, enter: () => {}, leave: () => {} })];
  const failed = gates.find((g) => g.status === 'fail');
  return { gates, rejectedBy: failed?.gate, headline: failed?.headline };
}

async function committed(spec: FunctionSpec, body: string): Promise<{ js: string; returnType: string }> {
  const c = await compileCandidate(spec, body);
  expect(c.gate.status).not.toBe('fail');
  return { js: c.js!, returnType: c.returnType };
}

function pick(spec: FunctionSpec, program: Program, kind: SuggestionKind): Suggestion {
  const s = suggestProperties(spec, program).find((x) => x.kind === kind);
  expect(s, `no ${kind} suggestion for ${spec.name}`).toBeDefined();
  return s!;
}

/** Spec with ONLY the suggestion's snippet as properties (and no unit tests), so the Properties gate decides. */
function withOnly(spec: FunctionSpec, s: Suggestion): FunctionSpec {
  return appendProperty({ ...spec, tests: '', properties: '' }, s);
}

async function expectAccepts(spec: FunctionSpec, body: string): Promise<void> {
  const v = await runGates(spec, body);
  expect(v.rejectedBy, v.headline).toBeUndefined();
  const props = v.gates.find((g) => g.gate === 'properties')!;
  expect(props.status).toBe('pass');
}

async function expectRejects(spec: FunctionSpec, body: string, s: Suggestion): Promise<Extract<Diagnostic, { kind: 'property' }>> {
  const v = await runGates(spec, body);
  expect(v.rejectedBy, `expected the properties gate to reject; gates: ${v.gates.map((g) => `${g.gate}:${g.status}`).join(' ')}`).toBe('properties');
  const props = v.gates.find((g) => g.gate === 'properties')!;
  const d = props.diagnostics[0] as Extract<Diagnostic, { kind: 'property' }>;
  expect(d.kind).toBe('property');
  expect(d.name).toBe(s.title);
  expect(d.counterexample).not.toBe('(none)');
  expect(d.counterexample.length).toBeGreaterThan(0);
  expect(v.headline).toMatch(/^Rejected: /);
  printed.push(`${s.kind.padEnd(12)} ${v.headline}`);
  return d;
}

const printed: string[] = [];

beforeAll(async () => {
  await warmUp();
}, 60_000);

describe('every suggestion kind passes a good candidate and rejects a bad one through the real gates', () => {
  it('idempotence: normalizeEmail', async () => {
    const spec = makeSpec('normalizeEmail', [['email', 'string']], 'string', { doc: 'Trims and lowercases an email address.' });
    const s = pick(spec, programOf(makeRecord(spec)), 'idempotence');
    const full = withOnly(spec, s);
    await expectAccepts(full, 'return email.trim().toLowerCase();');
    // replace() without /g removes only the first space: "  " → " " → "".
    const d = await expectRejects(full, "return email.toLowerCase().replace(' ', '');", s);
    expect(d.call).toMatch(/^normalizeEmail\(/);
  });

  it('idempotence: abs on numbers', async () => {
    const spec = makeSpec('abs', [['x', 'number']], 'number');
    const s = pick(spec, programOf(makeRecord(spec)), 'idempotence');
    const full = withOnly(spec, s);
    await expectAccepts(full, 'return x < 0 ? -x : x;');
    await expectRejects(full, 'return x < 0 ? -x : x + 1;', s);
  });

  it('shape: slugify (shipped good body passes; the \\w-based body that keeps "_" is rejected)', async () => {
    const ex = exampleById('slugify')!;
    const spec = { ...ex.spec, properties: '' };
    const s = pick(spec, programOf(makeRecord(spec)), 'shape');
    const full = withOnly(spec, s);
    for (const good of ex.goodBodies) await expectAccepts(full, good);
    const keepsUnderscore = ex.badBodies.find((b) => b.rejectedBy === 'properties')!.body;
    await expectRejects(full, keepsUnderscore, s);
  });

  it('idempotence: slugify (good body passes; a slugify that re-hyphenates its own hyphens is rejected)', async () => {
    const ex = exampleById('slugify')!;
    const spec = { ...ex.spec, properties: '' };
    const s = pick(spec, programOf(makeRecord(spec)), 'idempotence');
    const full = withOnly(spec, s);
    await expectAccepts(full, ex.goodBodies[0]!);
    // turns every non-alphanumeric character (including an existing "-") into "--": not stable under re-application
    await expectRejects(full, "return title.toLowerCase().replace(/[^a-z0-9]/g, '--');", s);
  });

  it('roundTrip: decodeBase64 against the committed encodeBase64', async () => {
    const enc = makeSpec('encodeBase64', [['text', 'string']], 'string');
    const dec = makeSpec('decodeBase64', [['encoded', 'string']], 'string');
    // UTF-16 code units as big-endian byte pairs, base64-encoded by hand (no btoa/TextEncoder needed).
    const encBody = String.raw`const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const bytes: number[] = [];
for (let i = 0; i < text.length; i++) {
  const u = text.charCodeAt(i);
  bytes.push(u >> 8, u & 255);
}
let out = '';
for (let i = 0; i < bytes.length; i += 3) {
  const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
  out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]!;
  out += i + 1 < bytes.length ? abc[(n >> 6) & 63]! : '=';
  out += i + 2 < bytes.length ? abc[n & 63]! : '=';
}
return out;`;
    const decBody = (lowByteOnly: boolean): string => String.raw`const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const bytes: number[] = [];
for (let i = 0; i < encoded.length; i += 4) {
  const n = (abc.indexOf(encoded[i]!) << 18) | (abc.indexOf(encoded[i + 1]!) << 12) |
    (Math.max(0, abc.indexOf(encoded[i + 2]!)) << 6) | Math.max(0, abc.indexOf(encoded[i + 3]!));
  bytes.push((n >> 16) & 255);
  if (encoded[i + 2] !== '=') bytes.push((n >> 8) & 255);
  if (encoded[i + 3] !== '=') bytes.push(n & 255);
}
let out = '';
for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(${lowByteOnly ? 'bytes[i + 1]!' : '(bytes[i]! << 8) | bytes[i + 1]!'});
return out;`;
    const program = programOf(makeRecord(dec), makeRecord(enc, await committed(enc, encBody)));
    const s = pick(dec, program, 'roundTrip');
    const full = withOnly(dec, s);
    await expectAccepts(full, decBody(false));
    // drops the high byte of each UTF-16 unit: fine for ASCII, wrong for "é"-and-beyond only above U+00FF
    const d = await expectRejects(full, decBody(true), s);
    expect(d.call).toMatch(/^decodeBase64\(/);

    // and from the encoder's side, with the decoder embedded
    const program2 = programOf(makeRecord(enc), makeRecord(dec, await committed(dec, decBody(false))));
    const s2 = pick(enc, program2, 'roundTrip');
    const full2 = withOnly(enc, s2);
    await expectAccepts(full2, encBody);
    await expectRejects(full2, "return encodeURIComponent(text).replace(/%/g, '');", s2);
  });

  const sortSpec = makeSpec('sortDescending', [['xs', 'number[]']], 'number[]');
  const sortGood = 'return [...xs].sort((a, b) => b - a);';
  const sortDedupe = 'return [...new Set(xs)].sort((a, b) => b - a);';

  it('sorted: sortDescending (default string sort is caught)', async () => {
    const s = pick(sortSpec, programOf(makeRecord(sortSpec)), 'sorted');
    const full = withOnly(sortSpec, s);
    await expectAccepts(full, sortGood);
    await expectRejects(full, 'return [...xs].sort().reverse();', s);
  });

  it('sameElements: sortDescending (a sort that drops duplicates is caught)', async () => {
    const s = pick(sortSpec, programOf(makeRecord(sortSpec)), 'sameElements');
    const full = withOnly(sortSpec, s);
    await expectAccepts(full, sortGood);
    await expectRejects(full, sortDedupe, s);
    // an element swapped for another of the same length is caught too
    await expectRejects(full, 'return [...xs].sort((a, b) => b - a).map((x, i) => (i === 0 ? x + 1 : x));', s);
  });

  it('sameElements: sortWords on string[]', async () => {
    const spec = makeSpec('sortWords', [['words', 'string[]']], 'string[]');
    const s = pick(spec, programOf(makeRecord(spec)), 'sameElements');
    const full = withOnly(spec, s);
    await expectAccepts(full, 'return [...words].sort((a, b) => a.localeCompare(b));');
    await expectRejects(full, "return [...words].filter((w) => w !== '').sort();", s);
  });

  it('length: sortDescending and reverseList', async () => {
    const s = pick(sortSpec, programOf(makeRecord(sortSpec)), 'length');
    const full = withOnly(sortSpec, s);
    await expectAccepts(full, sortGood);
    await expectRejects(full, sortDedupe, s);
    const rev = makeSpec('reverseList', [['xs', 'number[]']], 'number[]');
    const s2 = pick(rev, programOf(makeRecord(rev)), 'length');
    const full2 = withOnly(rev, s2);
    await expectAccepts(full2, 'return [...xs].reverse();');
    await expectRejects(full2, 'return xs.slice(1).reverse();', s2);
  });

  it('bounds: median (good example body passes; summing the two middles instead of averaging is rejected)', async () => {
    const ex = exampleById('median')!;
    const spec = { ...ex.spec, properties: '' };
    const s = pick(spec, programOf(makeRecord(spec)), 'bounds');
    const full = withOnly(spec, s);
    for (const good of ex.goodBodies) await expectAccepts(full, good);
    await expectRejects(
      full,
      String.raw`const s = [...numbers].sort((a, b) => a - b);
const m = Math.floor(s.length / 2);
return s.length % 2 === 1 ? s[m] : s[m - 1] + s[m];`,
      s,
    );
  });

  it('bounds: clamp(value, min, max)', async () => {
    const spec = makeSpec('clamp', [['value', 'number'], ['min', 'number'], ['max', 'number']], 'number');
    const s = pick(spec, programOf(makeRecord(spec)), 'bounds');
    const full = withOnly(spec, s);
    await expectAccepts(full, 'return Math.min(Math.max(value, min), max);');
    await expectRejects(full, 'return value > max ? max : value;', s);
  });

  it('commutative: multiply (repeated addition that ignores a negative multiplier is rejected)', async () => {
    const spec = makeSpec('multiply', [['a', 'number'], ['b', 'number']], 'number');
    const s = pick(spec, programOf(makeRecord(spec)), 'commutative');
    const full = withOnly(spec, s);
    await expectAccepts(full, 'return a * b;');
    await expectRejects(full, 'let r = 0;\nfor (let i = 0; i < b; i++) r += a;\nreturn r;', s);
  });

  it('identity: add (joining digits instead of adding is rejected)', async () => {
    const spec = makeSpec('add', [['a', 'number'], ['b', 'number']], 'number');
    const s = pick(spec, programOf(makeRecord(spec)), 'identity');
    const full = withOnly(spec, s);
    await expectAccepts(full, 'return a + b;');
    await expectRejects(full, 'return Number(String(a) + String(b));', s);
  });

  it('nonNegative: distance', async () => {
    const spec = makeSpec('distance', [['a', 'number'], ['b', 'number']], 'number');
    const s = pick(spec, programOf(makeRecord(spec)), 'nonNegative');
    const full = withOnly(spec, s);
    await expectAccepts(full, 'return Math.abs(a - b);');
    await expectRejects(full, 'return a - b;', s);
  });

  it('nonNegative: magnitude of a { x, y } point', async () => {
    const spec = makeSpec('magnitude', [['p', '{ x: number; y: number }']], 'number');
    const s = pick(spec, programOf(makeRecord(spec)), 'nonNegative');
    const full = withOnly(spec, s);
    await expectAccepts(full, 'return Math.hypot(p.x, p.y);');
    await expectRejects(full, 'return p.x + p.y;', s);
  });
});

describe('snippets compose', () => {
  it('all suggestions for a spec appended together register without collisions and pass a good candidate', async () => {
    let spec: FunctionSpec = sortSpecWithUserProperty();
    for (const s of suggestProperties(spec, programOf(makeRecord(spec)))) spec = appendProperty(spec, s);
    expect(suggestProperties(spec, programOf(makeRecord(spec)))).toEqual([]);
    const v = await runGates(spec, 'return [...xs].sort((a, b) => b - a);');
    expect(v.rejectedBy, v.headline).toBeUndefined();
    const sum = { ...makeSpec('add', [['a', 'number'], ['b', 'number']], 'number') };
    let s2 = sum;
    for (const s of suggestProperties(sum, programOf(makeRecord(sum)))) s2 = appendProperty(s2, s);
    expect((await runGates(s2, 'return a + b;')).rejectedBy).toBeUndefined();
    console.log(`\nSuggestion rejection headlines:\n${printed.join('\n')}\n`);
  });
});

function sortSpecWithUserProperty(): FunctionSpec {
  // A user property that already declares consts named like the snippets' locals: the IIFEs keep them apart.
  return makeSpec('sortDescending', [['xs', 'number[]']], 'number[]', {
    properties: "const canonical = 1;\nconst once = 2;\nproperty('first is the largest', [fc.array(fc.integer(), { minLength: 1 })], (xs: number[]) => sortDescending(xs)[0] === Math.max(...xs));",
  });
}
