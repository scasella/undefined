/**
 * Deterministic, JS-ish display of runtime values for the REPL, diagnostics and the model prompt.
 *
 * - Never throws (revoked proxies, throwing getters, hostile toString…): getters are never invoked
 *   (shown as `[Getter]`), and anything else that throws collapses to `[Unshowable]`.
 * - Bounded work: at most MAX_ENTRIES entries per container, nesting deeper than MAX_DEPTH is elided,
 *   and a container stops rendering children once its text is already over MAX_LEN.
 * - Built-ins are recognised by brand checks, not `instanceof`/constructor names, so values from another
 *   realm (worker, `new Function` scope) or the masked `Date` subclass still render as Date/Map/Set.
 */

const MAX_LEN = 200;
const MAX_ENTRIES = 20;
const MAX_DEPTH = 8;
const IDENT = /^[A-Za-z_$][\w$]*$/;

export function show(v: unknown): string {
  try {
    return cut(render(v, [], 0));
  } catch {
    return '[Unshowable]';
  }
}

/** `callString('median', [[1, 2]])` → `median([1, 2])`. */
export function callString(name: string, args: readonly unknown[]): string {
  return `${name}(${args.map(show).join(', ')})`;
}

/** Cut to MAX_LEN characters, the last one being `…`. Avoids splitting a surrogate pair. */
function cut(s: string): string {
  if (s.length <= MAX_LEN) return s;
  let end = MAX_LEN - 1;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return s.slice(0, end) + '…';
}

export function isDate(v: object): v is Date {
  try {
    Date.prototype.getTime.call(v);
    return true;
  } catch {
    return false;
  }
}

export function isMap(v: object): v is Map<unknown, unknown> {
  try {
    Map.prototype.has.call(v, undefined);
    return true;
  } catch {
    return false;
  }
}

export function isSet(v: object): v is Set<unknown> {
  try {
    Set.prototype.has.call(v, undefined);
    return true;
  } catch {
    return false;
  }
}

/** Prototype is null or some realm's Object.prototype. */
export function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === null || Object.getPrototypeOf(proto) === null;
}

function tagOf(v: unknown): string {
  return Object.prototype.toString.call(v).slice(8, -1);
}

function render(v: unknown, ancestors: object[], depth: number): string {
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v.length > MAX_LEN ? v.slice(0, MAX_LEN) : v);
    case 'number':
      return Object.is(v, -0) ? '-0' : String(v);
    case 'bigint':
      return `${v}n`;
    case 'boolean':
      return String(v);
    case 'undefined':
      return 'undefined';
    case 'symbol':
      return v.toString();
    case 'function':
      return `[Function ${typeof v.name === 'string' && v.name ? v.name : '(anonymous)'}]`;
  }
  if (v === null) return 'null';
  const obj = v as object;
  if (ancestors.includes(obj)) return '[Circular]';

  if (isDate(obj)) {
    const t = obj.getTime();
    return Number.isNaN(t) ? 'Invalid Date' : `Date(${new Date(t).toISOString()})`;
  }
  const tag = tagOf(obj);
  if (tag === 'Error') return showError(obj as Error);
  if (tag === 'RegExp') return String(obj);

  if (depth >= MAX_DEPTH) return `[${Array.isArray(obj) ? 'Array' : tag}]`;
  ancestors.push(obj);
  try {
    const child = (x: unknown): string => cut(render(x, ancestors, depth + 1));
    if (Array.isArray(obj)) {
      const arr = obj as unknown[];
      return `[${entries(arr.length, indices(arr.length), (i) => (i in arr ? child(arr[i]) : '<empty>')).join(', ')}]`;
    }
    if (isMap(obj)) {
      const body = entries(obj.size, obj.entries(), ([k, x]) => `${child(k)} => ${child(x)}`);
      return `Map(${obj.size}) ${braces(body)}`;
    }
    if (isSet(obj)) {
      return `Set(${obj.size}) ${braces(entries(obj.size, obj.values(), child))}`;
    }
    if (ArrayBuffer.isView(obj) && tag !== 'DataView') {
      const ta = obj as unknown as ArrayLike<unknown>;
      return `${tag}(${ta.length}) [${entries(ta.length, indices(ta.length), (i) => child(ta[i])).join(', ')}]`;
    }
    const body = props(obj, child);
    if (isPlainObject(obj)) return braces(body);
    return `${constructorName(obj)} ${braces(body)}`;
  } finally {
    ancestors.pop();
  }
}

function showError(e: Error): string {
  const name = typeof e.name === 'string' && e.name ? e.name : 'Error';
  const message = typeof e.message === 'string' ? e.message : '';
  return message ? `${name}: ${message}` : name;
}

function braces(items: string[]): string {
  return items.length === 0 ? '{}' : `{ ${items.join(', ')} }`;
}

function* indices(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
}

/**
 * Render up to MAX_ENTRIES items; stop early once the text is long enough to be cut anyway.
 * Adds `… N more` when entries were left out for count reasons.
 */
function entries<T>(count: number, items: Iterator<T>, fn: (item: T) => string): string[] {
  const out: string[] = [];
  let len = 0;
  for (let i = 0; i < Math.min(count, MAX_ENTRIES); i++) {
    const next = items.next();
    if (next.done) break;
    const s = fn(next.value);
    out.push(s);
    len += s.length + 2;
    if (len > MAX_LEN) return out;
  }
  if (count > MAX_ENTRIES) out.push(`… ${count - MAX_ENTRIES} more`);
  return out;
}

function props(obj: object, child: (x: unknown) => string): string[] {
  const keys = Object.keys(obj);
  return entries(keys.length, keys.values(), (k) => {
    const key = IDENT.test(k) ? k : JSON.stringify(k);
    const d = Object.getOwnPropertyDescriptor(obj, k);
    if (d && !('value' in d)) return `${key}: [${d.get && d.set ? 'Getter/Setter' : d.get ? 'Getter' : 'Setter'}]`;
    return `${key}: ${child(d?.value)}`;
  });
}

function constructorName(obj: object): string {
  const proto = Object.getPrototypeOf(obj) as object | null;
  const d = proto && Object.getOwnPropertyDescriptor(proto, 'constructor');
  const ctor = d && 'value' in d ? (d.value as unknown) : undefined;
  if (typeof ctor === 'function' && ctor.name) return ctor.name;
  return tagOf(obj) || 'Object';
}
