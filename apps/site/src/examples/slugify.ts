import type { ExampleDef } from './index';

/*
 * slugify — Unicode is where first attempts go wrong.
 * The realistic trap: `normalize('NFD')` + stripping combining marks handles é/ü/å, but letters such as ß, æ, ø and Ł
 * have no decomposition, so they silently turn into separators ("Straße" → "stra-e"). The unit tests catch it with
 * a concrete case. `\w`-based cleaning keeps "_" and is caught by the output-shape property.
 * The doc says only "URL slug". How to spell letters outside a–z, what "&" becomes and whether an apostrophe splits a
 * word are conventions the tests choose, so those three tests carry a "spec was silent" marker; separators, trimming,
 * digits and the empty result follow from "URL slug" and are unmarked.
 */

const DOC = `Turns a title into a URL slug.`;

const TESTS = String.raw`test('lowercases words', () => {
  eq(slugify('Hello World'), 'hello-world');
});

test('accents', () => {
  eq(slugify('Crème Brûlée'), 'creme-brulee');
  eq(slugify('Ångström Über'), 'angstrom-uber');
});

test('special letters', () => {
  eq(slugify('Straße'), 'strasse');
  eq(slugify('Smørrebrød'), 'smorrebrod');
  eq(slugify('Łódź'), 'lodz');
  eq(slugify('Ærø'), 'aero');
}, {
  silentOn: 'how to spell letters outside a–z',
  reasonable: 'Dropping or spelling them out are both used in the wild; the doc only said URL slug.',
});

test('ampersands', () => {
  eq(slugify('Tom & Jerry'), 'tom-and-jerry');
}, {
  silentOn: 'what an ampersand should become',
  reasonable: 'Spelling it out as "and" and dropping it are both common slug conventions.',
});

test('apostrophes', () => {
  eq(slugify("Don't Stop"), 'dont-stop');
}, {
  silentOn: 'whether an apostrophe splits a word',
  reasonable: 'Both don-t-stop and dont-stop are common slug conventions.',
});

test('repeated separators', () => {
  eq(slugify('rock  --  roll... live'), 'rock-roll-live');
});

test('leading and trailing punctuation', () => {
  eq(slugify('  ...Hello, World!!  '), 'hello-world');
});

test('digits', () => {
  eq(slugify('Top 10 Tips for 2024'), 'top-10-tips-for-2024');
});

test('existing hyphens', () => {
  eq(slugify('well-known - fact'), 'well-known-fact');
});

test('nothing to keep', () => {
  eq(slugify(''), '');
  eq(slugify('!!! --- ???'), '');
});
`;

const PROPERTIES = String.raw`const titles = fc.oneof(
  fc.string({ unit: fc.constantFrom('a', 'Z', 'é', 'Ü', 'ß', 'ø', 'Ł', '7', ' ', '-', '_', '.', '!', '&') }),
  fc.string({ unit: 'grapheme' }),
);

property('output is lowercase letters and digits joined by single hyphens', [titles], (title: string) =>
  /^([a-z0-9]+(-[a-z0-9]+)*)?$/.test(slugify(title)),
);

property('slugifying a slug changes nothing', [titles], (title: string) => {
  const once = slugify(title);
  eq(slugify(once), once);
});
`;

const DOC_AFTER_BREAK = `Turns a title into a slug for file names: lowercase ASCII words (letters a–z and digits 0–9) joined by single underscores. Letters outside a–z are converted to their usual ASCII spelling rather than dropped: accents are removed (é → e, ü → u) and special letters are spelled out (ß → ss). Every run of other characters (spaces, punctuation, symbols, hyphens and existing underscores) becomes a single underscore, and the slug never starts or ends with an underscore. A title without any letters or digits gives the empty string.`;

const TESTS_AFTER_BREAK = String.raw`test('lowercases and joins words with underscores', () => {
  eq(slugify('Hello World'), 'hello_world');
});

test('removes accents', () => {
  eq(slugify('Crème Brûlée'), 'creme_brulee');
  eq(slugify('Ångström Über'), 'angstrom_uber');
});

test('spells out special letters in German, Nordic and Polish words', () => {
  eq(slugify('Straße'), 'strasse');
  eq(slugify('Smørrebrød'), 'smorrebrod');
  eq(slugify('Łódź'), 'lodz');
  eq(slugify('Ærø'), 'aero');
});

test('collapses runs of spaces and punctuation into one underscore', () => {
  eq(slugify('rock  &  roll... live'), 'rock_roll_live');
});

test('trims separators from both ends', () => {
  eq(slugify('__Hello, World!!  '), 'hello_world');
});

test('keeps digits', () => {
  eq(slugify('Top 10 Tips for 2024'), 'top_10_tips_for_2024');
});

test('turns hyphens into underscores without doubling them', () => {
  eq(slugify('well-known - fact'), 'well_known_fact');
});

test('gives an empty string when there is nothing to keep', () => {
  eq(slugify(''), '');
  eq(slugify('!!! ___ ???'), '');
});
`;

const PROPERTIES_AFTER_BREAK = String.raw`const titles = fc.oneof(
  fc.string({ unit: fc.constantFrom('a', 'Z', 'é', 'Ü', 'ß', 'ø', 'Ł', '7', ' ', '-', '_', '.', '!', '&') }),
  fc.string({ unit: 'grapheme' }),
);

property('output is lowercase letters and digits joined by single underscores', [titles], (title: string) =>
  /^([a-z0-9]+(_[a-z0-9]+)*)?$/.test(slugify(title)),
);

property('slugifying a slug changes nothing', [titles], (title: string) => {
  const once = slugify(title);
  eq(slugify(once), once);
});
`;

/** Shared transliteration step of the good bodies, parameterised by separator. */
function goodBody(sep: '-' | '_'): string {
  const amp = sep === '-' ? "\n  .replace(/&/g, ' and ')\n  .replace(/['’]/g, '')" : '';
  return String.raw`const special: Record<string, string> = {
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ŋ': 'ng',
};
const ascii = title
  .toLowerCase()
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .toLowerCase()
  .replace(/[ßæœøłđðþıŋ]/g, (ch) => special[ch] ?? ch)${amp};
return ascii.replace(/[^a-z0-9]+/g, '${sep}').replace(/^${sep}+|${sep}+$/g, '');`;
}

export const slugify: ExampleDef = {
  id: 'slugify',
  title: 'slugify',
  blurb: 'The doc says only "URL slug". Separators and trimming follow from that; spelling ß as ss, & as and, and dropping apostrophes do not, so when one of those tests rejects, the verdict says the spec was silent and the tests chose.',
  call: 'slugify("Hello, World! Crème Brûlée")',
  fn: 'slugify',
  breakIt: {
    label: 'Break it: underscores',
    description: 'The doc now states the whole file-name convention (underscores, letters spelled out as ASCII, every other run of characters one underscore) and the tests check what it states. The certified "hello-world-creme-brulee" becomes wrong, so the function must be regenerated.',
  },
  spec: {
    name: 'slugify',
    params: [{ name: 'title', type: 'string' }],
    returns: 'string',
    doc: DOC,
    tests: TESTS,
    properties: PROPERTIES,
    budgetMs: 1000,
    maxAttempts: 3,
    origin: 'example',
    exampleId: 'slugify',
  },
  breakPatch: { doc: DOC_AFTER_BREAK, tests: TESTS_AFTER_BREAK, properties: PROPERTIES_AFTER_BREAK },
  goodBodies: [
    goodBody('-'),
    String.raw`const map: { [ch: string]: string } = { 'ß': 'ss', 'æ': 'ae', 'ø': 'o', 'ł': 'l', 'œ': 'oe', 'þ': 'th', 'đ': 'd' };
let out = '';
for (const ch of title.toLowerCase().normalize('NFD')) {
  if (/[a-z0-9]/.test(ch)) out += ch;
  else if (ch === '&') out += ' and ';
  else if (ch === "'" || ch === '’') continue;
  else if (map[ch] !== undefined) out += map[ch];
  else if (/\p{M}/u.test(ch)) continue;
  else out += ' ';
}
return out.trim().split(/ +/).filter((w) => w !== '').join('-');`,
  ],
  badBodies: [
    {
      body: String.raw`return title
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');`,
      rejectedBy: 'tests',
      why: 'NFD plus stripping combining marks handles é and ü, but ß has no decomposition, so it becomes a separator. The doc never said how to spell ß: the special-letters test holds that convention, and the diagnostic says so.',
      silentOn: 'how to spell letters outside a–z',
    },
    {
      body: String.raw`return title
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/ß/g, 'ss')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');`,
      rejectedBy: 'tests',
      why: 'Special-cases only ß; ø, Ł and æ still have no decomposition and turn into separators. Again a convention the tests hold, not the doc.',
      silentOn: 'how to spell letters outside a–z',
    },
    {
      body: String.raw`const special: Record<string, string> = {
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ŋ': 'ng',
};
const ascii = title
  .toLowerCase()
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .replace(/[ßæœøłđðþıŋ]/g, (ch) => special[ch] ?? ch)
  .replace(/&/g, ' and ');
return ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');`,
      rejectedBy: 'tests',
      why: 'Treats an apostrophe like any other punctuation, so "Don\'t Stop" becomes "don-t-stop". A defensible slug; the doc never said, and the apostrophes test (not the spec) asks for "dont-stop".',
      silentOn: 'whether an apostrophe splits a word',
    },
    {
      body: String.raw`const special: Record<string, string> = { 'ß': 'ss', 'æ': 'ae', 'ø': 'o', 'ł': 'l' };
return title
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[ßæøł]/g, (ch) => special[ch] ?? ch)
  .replace(/&/g, ' and ')
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-');`,
      rejectedBy: 'tests',
      why: 'Never trims: leading and trailing punctuation leave hyphens at the ends of the slug. A real mistake for a URL slug, so no "spec was silent" marker.',
    },
    {
      body: String.raw`const special: Record<string, string> = { 'ß': 'ss', 'æ': 'ae', 'ø': 'o', 'ł': 'l' };
return title
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[ßæøł]/g, (ch) => special[ch] ?? ch)
  .replace(/&/g, ' and ')
  .replace(/['’]/g, '')
  .replace(/[^\w]+/g, '-')
  .replace(/^-+|-+$/g, '');`,
      rejectedBy: 'properties',
      why: 'Cleans with \\w, which also matches "_": every unit test passes, but the output-shape property finds a title whose slug keeps an underscore.',
    },
  ],
  goodBodiesAfterBreak: [goodBody('_')],
};
