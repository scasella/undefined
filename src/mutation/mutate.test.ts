import { describe, expect, it } from 'vitest';
import { enumerateCandidates, generateMutants, loadTs, MUTATION_KINDS, parses, type Mutant } from './mutate';

// Hand-written fixtures in the style src/gates/compile.ts emits (MEDIAN is its verbatim output) (prologue, `{` on the signature line, 4-space
// indent, the emitter's reflow of `if (c) return x;`).
const ONE_LINER = `"use strict";
function add(a, b) {
    return a + b;
}
`;

const MEDIAN = `"use strict";
function median(numbers) {
    if (numbers.length === 0)
        return NaN;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
`;

const SLUGIFY = `"use strict";
function slugify(title) {
    const map = { 'ß': 'ss', 'æ': 'ae', 'ø': 'o', 'ł': 'l', 'œ': 'oe', 'þ': 'th', 'đ': 'd' };
    let out = '';
    for (const ch of title.toLowerCase().normalize('NFD')) {
        if (/[a-z0-9]/.test(ch))
            out += ch;
        else if (ch === '&')
            out += ' and ';
        else if (ch === "'" || ch === '’')
            continue;
        else if (map[ch] !== undefined)
            out += map[ch];
        else if (/\\p{M}/u.test(ch))
            continue;
        else
            out += ' ';
    }
    return out.trim().split(/ +/).filter((w) => w !== '').join('-');
}
`;

const FIB_BIGINT = `"use strict";
function fibonacci(n) {
    let a = 0n;
    let b = 1n;
    for (const bit of n.toString(2)) {
        const c = a * (2n * b - a);
        const d = a * a + b * b;
        if (bit === '1') {
            a = d;
            b = c + d;
        }
        else {
            a = c;
            b = d;
        }
    }
    return a;
}
`;

const NESTED = `"use strict";
function clampAll(xs, lo) {
    function clamp(x) {
        if (!(x >= lo))
            return lo;
        return x;
    }
    if (xs.length === 0)
        return [];
    return xs.map(clamp);
}
`;

const ALL = { ONE_LINER, MEDIAN, SLUGIFY, FIB_BIGINT, NESTED };

const brief = (m: Mutant) => ({ kind: m.kind, line: m.line, original: m.original, mutated: m.mutated });
const byId = (ms: Mutant[]) => [...ms].sort((a, b) => a.id.localeCompare(b.id));

describe('generateMutants: exact mutants on small inputs', () => {
  it('one-liner: an operator swap and a neutered return', async () => {
    const r = await generateMutants(ONE_LINER, { seed: 1, max: 50 });
    expect(r.sites).toBe(2);
    expect(r.stillborn).toBe(0);
    expect(byId(r.mutants).map((m) => ({ id: m.id, ...brief(m) }))).toEqual([
      { id: 'arithmetic@1:14', kind: 'arithmetic', line: 1, original: '+', mutated: '-' },
      { id: 'return-undefined@1:5', kind: 'return-undefined', line: 1, original: 'return a + b;', mutated: 'return undefined;' },
    ]);
    const arith = r.mutants.find((m) => m.kind === 'arithmetic')!;
    expect(arith.js).toBe(ONE_LINER.replace('a + b', 'a - b'));
  });

  it('median: every site, with lines relative to the compiled body', async () => {
    const r = await generateMutants(MEDIAN, { seed: 7, max: 1000 });
    expect(r.stillborn).toBe(0);
    expect(r.mutants).toHaveLength(r.sites);
    const got = r.mutants.map((m) => `${m.id} ${m.original} => ${m.mutated}`).sort();
    // line 1: if (numbers.length === 0)   line 2: return NaN;   line 3: const sorted = …(a, b) => a - b);
    // line 4: const mid = Math.floor(sorted.length / 2);
    // line 5: return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    // (1 → 0 as boundary -1 is the same text as the constant flip, so only the constant flip is kept.)
    expect(got).toEqual([
      'arithmetic@3:50 - => +',
      'arithmetic@4:42 / => *',
      'arithmetic@5:26 % => *',
      'arithmetic@5:64 - => +',
      'arithmetic@5:69 + => -',
      'arithmetic@5:84 / => *',
      'boundary@1:28-1 0 => -1',
      'boundary@4:44+1 2 => 3',
      'boundary@4:44-1 2 => 1',
      'boundary@5:28+1 2 => 3',
      'boundary@5:28-1 2 => 1',
      'boundary@5:34+1 1 => 2',
      'boundary@5:66+1 1 => 2',
      'boundary@5:86+1 2 => 3',
      'boundary@5:86-1 2 => 1',
      'constant@1:28 0 => 1',
      'constant@5:34 1 => 0',
      'constant@5:66 1 => 0',
      'equality@1:24 === => !==',
      'equality@5:30 === => !==',
      'negate-condition@1:9 numbers.length === 0 => !(numbers.length === 0)',
      'negate-condition@5:12 sorted.length % 2 === 1 => !(sorted.length % 2 === 1)',
      'return-undefined@2:9 return NaN; => return undefined;',
      'return-undefined@5:5 return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; => return undefined;',
    ].sort());
  });

  it('nested function and early return: sites inside the nested function are included', async () => {
    const r = await generateMutants(NESTED, { seed: 3, max: 1000 });
    expect(r.stillborn).toBe(0);
    const got = r.mutants.map((m) => `${m.line} ${m.kind} ${m.original} => ${m.mutated}`).sort();
    expect(got).toEqual([
      '2 comparison >= => >',
      '2 remove-not !(x >= lo) => (x >= lo)',
      '3 return-undefined return lo; => return undefined;',
      '4 return-undefined return x; => return undefined;',
      '6 boundary 0 => -1',
      '6 constant 0 => 1',
      '6 equality === => !==',
      '6 negate-condition xs.length === 0 => !(xs.length === 0)',
      '7 return-undefined return []; => return undefined;',
      '8 return-undefined return xs.map(clamp); => return undefined;',
    ]);
    // `if (!c)` is not also negated to `if (!(!c))`: remove-not already covers it.
    expect(r.mutants.some((m) => m.mutated.startsWith('!(!'))).toBe(false);
  });

  it('bigint literals get boundary and constant mutants with the n suffix', async () => {
    const r = await generateMutants(FIB_BIGINT, { seed: 1, max: 1000 });
    const lits = r.mutants.filter((m) => m.kind === 'boundary' || m.kind === 'constant').map((m) => `${m.line} ${m.original}=>${m.mutated}`);
    expect(lits).toEqual(expect.arrayContaining(['1 0n=>1n', '1 0n=>-1n', '2 1n=>0n', '2 1n=>2n', '4 2n=>3n', '4 2n=>1n', '3 2=>3']));
    // 2 → 1 in toString(2): same text as no other mutant, kept; 1n → 2n etc. all parse.
    expect(r.stillborn).toBe(0);
  });

  it('skips return mutations when the function already returns undefined', async () => {
    const js = `"use strict";\nfunction f(x) {\n    if (x)\n        return undefined;\n    return void 0;\n}\n`;
    const r = await generateMutants(js, { seed: 1, max: 100 });
    expect(r.mutants.map((m) => m.kind)).toEqual(['negate-condition']);
  });
});

describe('generateMutants: selection', () => {
  it('is deterministic for the same (js, seed, max) and varies with the seed', async () => {
    const a = await generateMutants(MEDIAN, { seed: 42, max: 12 });
    const b = await generateMutants(MEDIAN, { seed: 42, max: 12 });
    expect(b).toEqual(a);
    const ids = new Set<string>();
    for (let seed = 0; seed < 8; seed++) {
      ids.add((await generateMutants(MEDIAN, { seed, max: 12 })).mutants.map((m) => m.id).join(','));
    }
    expect(ids.size).toBeGreaterThan(1);
  });

  it('respects max, including 0', async () => {
    for (const [name, js] of Object.entries(ALL)) {
      for (const max of [0, 1, 5, 12]) {
        const r = await generateMutants(js, { seed: 9, max });
        expect(r.mutants.length, `${name} max ${max}`).toBe(Math.min(max, r.sites - r.stillborn));
        expect(r.mutants.length).toBeLessThanOrEqual(max);
      }
    }
  });

  it('round-robins across kinds: the first k mutants are k different kinds when k kinds exist', async () => {
    for (const [name, js] of Object.entries(ALL)) {
      const all = await generateMutants(js, { seed: 5, max: 1000 });
      const kinds = new Set(all.mutants.map((m) => m.kind));
      for (const seed of [1, 2, 3]) {
        const r = await generateMutants(js, { seed, max: kinds.size });
        expect(new Set(r.mutants.map((m) => m.kind)).size, name).toBe(kinds.size);
      }
    }
    const twelve = await generateMutants(MEDIAN, { seed: 11, max: 12 });
    // median has 6 kinds; 12 mutants must cover all of them.
    expect(new Set(twelve.mutants.map((m) => m.kind)).size).toBe(6);
  });

  it('never returns duplicate-equivalent mutants (identical text) or a no-op', async () => {
    for (const js of Object.values(ALL)) {
      const r = await generateMutants(js, { seed: 1, max: 1000 });
      const texts = r.mutants.map((m) => m.js);
      expect(new Set(texts).size).toBe(texts.length);
      expect(texts).not.toContain(js);
    }
  });

  it('every returned mutant parses, and is the input with exactly one span replaced', async () => {
    const ts = await loadTs();
    for (const js of Object.values(ALL)) {
      const r = await generateMutants(js, { seed: 2, max: 1000 });
      for (const m of r.mutants) {
        expect(parses(ts, m.js)).toBe(true);
        let found = false;
        for (let i = js.indexOf(m.original); i !== -1 && !found; i = js.indexOf(m.original, i + 1)) {
          found = js.slice(0, i) + m.mutated + js.slice(i + m.original.length) === m.js;
        }
        expect(found, m.id).toBe(true);
      }
    }
  });

  it('does not mutate the "use strict" prologue or the signature', async () => {
    for (const js of Object.values(ALL)) {
      const head = js.slice(0, js.indexOf('{') + 1);
      for (const m of (await generateMutants(js, { seed: 4, max: 1000 })).mutants) expect(m.js.startsWith(head)).toBe(true);
    }
  });

  it('enumerates nothing for JS without a function declaration', async () => {
    const ts = await loadTs();
    expect(enumerateCandidates(ts, '"use strict";\nconst x = 1 + 2;\n')).toEqual([]);
    expect(await generateMutants('', { seed: 1, max: 12 })).toEqual({ mutants: [], stillborn: 0, sites: 0 });
  });

  it('exports every kind in a fixed order', () => {
    expect(MUTATION_KINDS).toHaveLength(10);
  });
});

describe('generateMutants: stillborn mutants', () => {
  it('a splice that forms `--` is counted stillborn and never returned', async () => {
    // a+-b: swapping + to - gives a--b, which is a postfix decrement followed by an identifier: a syntax error.
    const js = `"use strict";\nfunction f(a, b) {\n    return a+-b;\n}\n`;
    const r = await generateMutants(js, { seed: 1, max: 12 });
    expect(r.sites).toBe(2);
    expect(r.stillborn).toBe(1);
    expect(r.mutants.map(brief)).toEqual([
      { kind: 'return-undefined', line: 1, original: 'return a+-b;', mutated: 'return undefined;' },
    ]);
  });

  it('a boundary -1 on `a-0` is stillborn; the constant flip on the same literal is not', async () => {
    const js = `"use strict";\nfunction f(a) {\n    return a-0;\n}\n`;
    const r = await generateMutants(js, { seed: 1, max: 12 });
    expect(r.stillborn).toBe(1);
    expect(r.mutants.map((m) => `${m.kind} ${m.original}=>${m.mutated}`).sort()).toEqual([
      'arithmetic -=>+',
      'constant 0=>1',
      'return-undefined return a-0;=>return undefined;',
    ]);
  });

  it('a stillborn draw is replaced by the next candidate of the same kind', async () => {
    const js = `"use strict";\nfunction f(a, b) {\n    return a+-b + a * b;\n}\n`;
    const all = await generateMutants(js, { seed: 1, max: 12 });
    expect(all.stillborn).toBe(1);
    expect(all.mutants.filter((m) => m.kind === 'arithmetic').map((m) => m.js.split('\n')[2]!.trim()).sort()).toEqual([
      'return a+-b + a / b;',
      'return a+-b - a * b;',
    ]);
    // With room for one mutant per kind, every seed still yields one runnable arithmetic mutant, whether or not the
    // stillborn a--b was drawn first (then it is counted and the next arithmetic candidate is taken).
    const stillbornSeen = new Set<number>();
    for (let seed = 0; seed < 20; seed++) {
      const r = await generateMutants(js, { seed, max: 2 });
      expect(r.mutants.map((m) => m.kind).sort()).toEqual(['arithmetic', 'return-undefined']);
      stillbornSeen.add(r.stillborn);
    }
    expect([...stillbornSeen].sort()).toEqual([0, 1]);
  });
});
