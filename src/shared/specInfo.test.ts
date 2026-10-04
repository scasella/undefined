import { describe, expect, it } from 'vitest';
import { listTestNames, testNamesOf } from './specInfo';

describe('listTestNames', () => {
  it('finds test/property/matchesReference names in source order', () => {
    const src = `
      test("odd length", () => eq(median([3, 1, 2]), 2));
      property('within bounds', [fc.array(fc.integer())], (xs) => true);
      matchesReference(\`same as sort\`, [fc.array(fc.integer())], (xs) => xs[0]);
      test( 'even length' , () => {});
    `;
    expect(listTestNames(src)).toEqual(['odd length', 'within bounds', 'same as sort', 'even length']);
  });

  it('ignores calls inside line and block comments', () => {
    const src = `
      // test("commented out", () => {});
      /* property("also commented", [], () => true);
         test("still comment", () => {}); */
      test("real", () => {}); // test("trailing comment")
    `;
    expect(listTestNames(src)).toEqual(['real']);
  });

  it('ignores calls that only appear inside string or template literals', () => {
    const src = `
      const s = "test('in a string', () => {})";
      const t = \`property("in a template", \${ test("nested in interpolation") })\`;
      test("real one", () => eq(s.length > 0, true));
    `;
    // templates are skipped whole; registering a test from inside an interpolation is not supported
    expect(listTestNames(src)).toEqual(['real one']);
  });

  it('decodes escapes in the name literal', () => {
    const src = String.raw`test("say \"hi\"\n\ttab", () => {}); test('it\'s é \x41 \u{1F600}', () => {});`;
    expect(listTestNames(src)).toEqual(['say "hi"\n\ttab', "it's é A 😀"]);
  });

  it('skips templates with interpolation, non-literal names and member calls', () => {
    const src = `
      test(\`case \${n}\`, () => {});
      test(name, () => {});
      fc.property(fc.integer(), (x) => true);
      obj.test("not a global test", () => {});
      mytest("prefix does not count", () => {});
      test /* odd spacing */ ( /* c */ "spaced", () => {});
    `;
    expect(listTestNames(src)).toEqual(['spaced']);
  });

  it('returns [] for empty source and survives unterminated input', () => {
    expect(listTestNames('')).toEqual([]);
    expect(listTestNames('test("never closed')).toEqual([]);
    expect(listTestNames('/* open comment test("x")')).toEqual([]);
  });

  it('regex literals with quotes, backticks and // do not hide later tests', () => {
    // shaped like the slugify example's tests and properties
    const src = String.raw`
test("strips quotes", () => eq(slugify("Rock 'n' Roll").replace(/['"]/g, ""), "rock-n-roll"));
test("no backticks", () => eq(/[\x60']/.test(slugify("a\x60b")), false));
test("url-ish", () => eq(slugify("http://x.y").split(/\/\//).length, 1));
property("only slug characters", [fc.string()], (title) =>
  /^([a-z0-9]+(-[a-z0-9]+)*)?$/.test(slugify(title)),
);
property("no double dashes", [fc.string()], (s) => !/--|"/.test(slugify(s)));
const quoteRe = /["'\`]+/g, sep = /[/]/;
test("class with slash", () => eq("a/b".split(sep).length, 2));
function clean(s: string) { return s.replace(/\p{M}+/gu, "").replace(/[ßæ"]/g, (ch) => ch); }
test("after a function with regexes", () => eq(clean("é"), "é"));
const ratio = 10 / 2 / 5; // division, not a regex: "test('x')"
test("after division", () => eq(ratio, 1));
const half = (xs: number[]) => xs.length / 2; test("division after a member", () => eq(half([1, 2]), 1));
if (true) { /'/.test("'"); } test("regex after a block", () => {});
`;
    expect(listTestNames(src)).toEqual([
      'strips quotes',
      'no backticks',
      'url-ish',
      'only slug characters',
      'no double dashes',
      'class with slash',
      'after a function with regexes',
      'after division',
      'division after a member',
      'regex after a block',
    ]);
  });

  it('regexes after return / typeof-like keywords and in nested calls', () => {
    const src = `
function isSlug(s) { return /^[a-z"]+$/.test(s); }
test("keyword context", () => eq(isSlug("ab"), true));
matchesReference("ref", [fc.string()], (s) => s.replace(/[\`'"]/g, ''));
test("after matchesReference", () => {});
`;
    expect(listTestNames(src)).toEqual(['keyword context', 'ref', 'after matchesReference']);
  });

  it('the real example specs list every test and property', async () => {
    const { EXAMPLES } = await import('../examples');
    for (const ex of EXAMPLES) {
      const { tests, properties } = testNamesOf(ex.spec);
      const count = (src: string) => (src.match(/^\s*(test|property|matchesReference)\(/gm) ?? []).length;
      expect(tests.length, `${ex.id} tests`).toBe(count(ex.spec.tests));
      expect(properties.length, `${ex.id} properties`).toBe(count(ex.spec.properties));
    }
  });

  it('testNamesOf splits tests and properties', () => {
    expect(
      testNamesOf({ tests: 'test("a", () => {}); test("b", () => {});', properties: 'property("p", [], () => true);' }),
    ).toEqual({ tests: ['a', 'b'], properties: ['p'] });
  });
});
