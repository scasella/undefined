import type { ExampleDef } from './index';

/*
 * slugify — Unicode is where first attempts go wrong.
 * The realistic trap: `normalize('NFD')` + stripping combining marks handles é/ü/å, but letters such as ß, æ, ø and Ł
 * have no decomposition, so they silently turn into separators ("Straße" → "stra-e"). The unit tests catch it with
 * a concrete case. `\w`-based cleaning keeps "_" and is caught by the output-shape property.
 */

const DOC = `Turns a title into a URL slug: lowercase ASCII words (letters a–z and digits 0–9) joined by single hyphens. Letters outside a–z are converted to their usual ASCII spelling rather than dropped: accents are removed (é → e, ü → u) and special letters are spelled out (ß → ss). Every run of other characters (spaces, punctuation, symbols, existing hyphens) becomes a single hyphen, and the slug never starts or ends with a hyphen. A title without any letters or digits gives the empty string.`;

const TESTS = String.raw`test('lowercases and joins words with hyphens', () => {
  eq(slugify('Hello World'), 'hello-world');
});

test('removes accents', () => {
  eq(slugify('Crème Brûlée'), 'creme-brulee');
  eq(slugify('Ångström Über'), 'angstrom-uber');
});

test('spells out special letters in German, Nordic and Polish words', () => {
  eq(slugify('Straße'), 'strasse');
  eq(slugify('Smørrebrød'), 'smorrebrod');
  eq(slugify('Łódź'), 'lodz');
  eq(slugify('Ærø'), 'aero');
});

test('collapses runs of spaces and punctuation into one hyphen', () => {
  eq(slugify('rock  &  roll... live'), 'rock-roll-live');
});

test('trims separators from both ends', () => {
  eq(slugify('  ...Hello, World!!  '), 'hello-world');
});

test('keeps digits', () => {
  eq(slugify('Top 10 Tips for 2024'), 'top-10-tips-for-2024');
});

test('keeps existing hyphens without doubling them', () => {
  eq(slugify('well-known - fact'), 'well-known-fact');
});

test('gives an empty string when there is nothing to keep', () => {
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
  return String.raw`const special: Record<string, string> = {
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ŋ': 'ng',
};
const ascii = title
  .toLowerCase()
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .toLowerCase()
  .replace(/[ßæœøłđðþıŋ]/g, (ch) => special[ch] ?? ch);
return ascii.replace(/[^a-z0-9]+/g, '${sep}').replace(/^${sep}+|${sep}+$/g, '');`;
}

export const slugify: ExampleDef = {
  id: 'slugify',
  title: 'slugify',
  blurb: 'Unicode beyond accents: stripping marks handles é, but ß, ø and Ł need spelling out, and a unit test names the exact title that breaks.',
  call: 'slugify("Hello, World! Crème Brûlée")',
  fn: 'slugify',
  breakIt: {
    label: 'Break it: underscores',
    description: 'The doc and tests now ask for underscores as the separator (file-name slugs). The certified "hello-world-creme-brulee" becomes wrong, so the function must be regenerated.',
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
      why: 'NFD plus stripping combining marks handles é and ü, but ß has no decomposition, so it becomes a separator.',
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
      why: 'Special-cases only the example in the doc (ß); ø, Ł and æ still have no decomposition and turn into separators.',
    },
    {
      body: String.raw`const special: Record<string, string> = { 'ß': 'ss', 'æ': 'ae', 'ø': 'o', 'ł': 'l' };
return title
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[ßæøł]/g, (ch) => special[ch] ?? ch)
  .replace(/[^a-z0-9]+/g, '-');`,
      rejectedBy: 'tests',
      why: 'Never trims: leading and trailing punctuation leave hyphens at the ends of the slug.',
    },
    {
      body: String.raw`const special: Record<string, string> = { 'ß': 'ss', 'æ': 'ae', 'ø': 'o', 'ł': 'l' };
return title
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[ßæøł]/g, (ch) => special[ch] ?? ch)
  .replace(/[^\w]+/g, '-')
  .replace(/^-+|-+$/g, '');`,
      rejectedBy: 'properties',
      why: 'Cleans with \\w, which also matches "_": every unit test passes, but the output-shape property finds a title whose slug keeps an underscore.',
    },
  ],
  goodBodiesAfterBreak: [goodBody('_')],
};
