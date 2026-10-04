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

  it('testNamesOf splits tests and properties', () => {
    expect(
      testNamesOf({ tests: 'test("a", () => {}); test("b", () => {});', properties: 'property("p", [], () => true);' }),
    ).toEqual({ tests: ['a', 'b'], properties: ['p'] });
  });
});
