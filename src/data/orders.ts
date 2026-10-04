/**
 * A bundled, fully fictional e-commerce dataset for the data scratchpad. Deterministic: a seeded mulberry32 PRNG,
 * no Math.random, no clock.
 *
 * 320 orders (ids 1001–1320, dates over 2024 in ascending order) plus 12 deliberate duplicate rows: each is an exact
 * copy of an earlier order except that its email differs only in case/surrounding whitespace, inserted somewhere
 * after the original. Independently of the duplicates, a customer's email is sometimes written with different
 * casing or stray spaces, so "dedupe by normalized email" is a meaningful exercise.
 */

export interface Order {
  id: number;
  orderDate: string;
  customer: string;
  email: string;
  country: string;
  product: string;
  quantity: number;
  unitPrice: number;
  discount: number | null;
  status: 'paid' | 'refunded' | 'pending';
}

export const ORDER_COUNT = 320;
export const DUPLICATE_COUNT = 12;

const CUSTOMERS: readonly string[] = [
  'Zorblat Industries', 'Mx. Pemberwick', 'Quillfeather & Sons', 'Captain Wobblesworth', 'Glimmerbank Co-op',
  'Professor Snodgrass-Vee', 'Thistlewhump Bakery', 'Dr. Ooblek Fenn', 'Brambleskate Ltd', 'Madame Fizzlecrumb',
  'Nimbus Pickle Works', 'Sir Reginald Plonk', 'Wibbleton Hardware', 'Ms. Tumblequartz', 'Grommet & Gasket LLC',
  'Baron von Spudwick', 'Crumplehorn Tea Room', 'Lady Hootenmarsh', 'Flumpington Labs', 'Mr. Bartleby Snoot',
  'Kettlewhistle Farms', 'Agent Pumpernickel', 'Snorkelbury Supplies', 'Auntie Grizzlewort', 'Quasar Noodle Bar',
  'Dame Pottersnuff', 'Fizzwhack Robotics', 'Uncle Mungo Bramble', 'Puddlesworth Inc', 'Chef Ravioli Starbright',
  'Gobbledy Gear', 'Ms. Hobblewick Twirl', 'Velvetbog Imports', 'Count Wafflebottom', 'Tinkerspoon Studio',
  'Mx. Quibble Ashgrove', 'Bumbleforth & Kin', 'Jibberjab Media', 'Sergeant Fluffernut', 'Moonwhistle Gardens',
];

const COUNTRIES: readonly string[] = [
  'United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Netherlands', 'Australia', 'Japan', 'Brazil', 'India',
];

/** [product, base unit price] — invented products. */
const PRODUCTS: ReadonlyArray<readonly [string, number]> = [
  ['Quantum Spatula', 24.99],
  ['Self-Folding Napkin', 3.5],
  ['Left-Handed Teapot', 39],
  ['Anti-Gravity Sock (pair)', 12.75],
  ['Pocket Thundercloud', 89.9],
  ['Whispering Kettle', 54.25],
  ['Glow-in-the-Dark Cheese Grater', 18.4],
  ['Telescoping Fork', 7.99],
  ['Mood-Ring Mug', 15],
  ['Inflatable Bookshelf', 129.5],
  ['Solar-Powered Flashlight', 22.1],
  ['Echo Notebook', 9.95],
  ['Weatherproof Paper Umbrella', 31.6],
  ['Bottomless Sugar Bowl', 44.45],
  ['Silent Alarm Clock', 27.3],
];

const DISCOUNTS: readonly number[] = [0.05, 0.1, 0.15, 0.2, 0.25];

/** mulberry32: small, fast, good-enough deterministic PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20240101;
const DAY_MS = 86_400_000;
const JAN_1_2024 = Date.UTC(2024, 0, 1);

/** The canonical email for a customer: `zorblat.industries@example.com`. */
export function canonicalEmail(customer: string): string {
  const local = customer
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `${local}@example.com`;
}

/** Same address, written differently: casing and/or surrounding whitespace. `variant` ≥ 1. */
function emailVariant(email: string, variant: number): string {
  const [local, domain] = email.split('@') as [string, string];
  const capitalized = local.replace(/(^|\.)([a-z])/g, (_, dot: string, c: string) => dot + c.toUpperCase());
  switch (variant % 4) {
    case 1:
      return `${capitalized}@${domain}`;
    case 2:
      return ` ${email} `;
    case 3:
      return email.toUpperCase();
    default:
      return `${capitalized}@Example.com `;
  }
}

/** Normalized email for dedupe: trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

let cache: Order[] | null = null;

function generate(): Order[] {
  const rnd = mulberry32(SEED);
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

  // Each customer has a home country.
  const home = new Map(CUSTOMERS.map((c) => [c, pick(COUNTRIES)] as const));
  const days = Array.from({ length: ORDER_COUNT }, () => int(0, 365)).sort((a, b) => a - b); // 2024 has 366 days

  const orders: Order[] = days.map((d, i) => {
    const customer = pick(CUSTOMERS);
    const [product, base] = pick(PRODUCTS);
    const r = rnd();
    const status: Order['status'] = r < 0.8 ? 'paid' : r < 0.88 ? 'refunded' : 'pending';
    const email = canonicalEmail(customer);
    return {
      id: 1001 + i,
      orderDate: new Date(JAN_1_2024 + d * DAY_MS).toISOString().slice(0, 10),
      customer,
      email: rnd() < 0.15 ? emailVariant(email, int(1, 4)) : email,
      country: rnd() < 0.9 ? home.get(customer)! : pick(COUNTRIES),
      product,
      quantity: int(1, 9),
      // occasional price drift of up to ±10%, rounded to cents
      unitPrice: rnd() < 0.2 ? Math.round(base * (0.9 + rnd() * 0.2) * 100) / 100 : base,
      discount: rnd() < 0.3 ? pick(DISCOUNTS) : null,
      status,
    };
  });

  // 12 duplicates of distinct earlier orders, each with an email differing only in case/whitespace.
  const out: Order[] = [...orders];
  const used = new Set<number>();
  for (let k = 0; k < DUPLICATE_COUNT; k++) {
    let src: number;
    do src = int(0, ORDER_COUNT - 1);
    while (used.has(src));
    used.add(src);
    const original = orders[src]!;
    // At most one of the four variants equals the original's email (which is canonical or one variant).
    const v = int(1, 4);
    let email = emailVariant(canonicalEmail(original.customer), v);
    if (email === original.email) email = emailVariant(canonicalEmail(original.customer), (v % 4) + 1);
    const dup: Order = { ...original, email };
    // insert somewhere after the original (positions shift as we insert; find it by identity)
    const at = out.indexOf(original);
    const pos = int(at + 1, out.length);
    out.splice(pos, 0, dup);
  }
  return out;
}

/** 332 rows: 320 orders + 12 duplicates. A fresh deep copy on every call. */
export function bundledOrders(): Array<Record<string, unknown>> {
  cache ??= generate();
  return cache.map((o) => ({ ...o }));
}

export const ORDER_COLUMNS: ReadonlyArray<keyof Order> = [
  'id', 'orderDate', 'customer', 'email', 'country', 'product', 'quantity', 'unitPrice', 'discount', 'status',
];

/** The same rows as CSV (header + one line per row, LF). null → empty cell; quoted only when needed. */
export function BUNDLED_ORDERS_CSV(): string {
  const lines = [ORDER_COLUMNS.join(',')];
  for (const row of bundledOrders()) {
    lines.push(ORDER_COLUMNS.map((c) => csvCell(row[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
