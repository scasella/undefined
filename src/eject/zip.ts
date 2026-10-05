/**
 * A tiny, dependency-free ZIP writer: STORE only (no compression), CRC-32, UTF-8 names, no ZIP64. Enough for a
 * handful of small text files. Pure: bytes in, bytes out.
 */

export interface ZipEntry {
  /** Path inside the archive, `/`-separated, no leading slash. */
  name: string;
  data: Uint8Array | string;
  /** Modification time (default: the archive's `date`). */
  date?: Date;
}

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (IEEE 802.3, the one ZIP uses). */
export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date fields (2-second resolution, years 1980–2107), in local time as unzip tools expect. */
export function dosDateTime(d: Date): { time: number; date: number } {
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 }; // 1980-01-01
  const year = Math.min(2107, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const UTF8_FLAG = 0x0800;
const VERSION_STORE = 10;
const MADE_BY_UNIX = (3 << 8) | 20;
const FILE_MODE = 0o100644;

/** Builds the archive. Throws on an empty, absolute or duplicate name, or when the archive would need ZIP64. */
export function zipStore(entries: readonly ZipEntry[], date: Date = new Date(0)): Uint8Array {
  const enc = new TextEncoder();
  const seen = new Set<string>();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    if (e.name === '' || e.name.startsWith('/') || e.name.includes('\\')) throw new Error(`zip: bad entry name ${JSON.stringify(e.name)}`);
    if (seen.has(e.name)) throw new Error(`zip: duplicate entry ${e.name}`);
    seen.add(e.name);
    const name = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const crc = crc32(data);
    const { time, date: day } = dosDateTime(e.date ?? date);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, VERSION_STORE, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, MADE_BY_UNIX, true);
    cv.setUint16(6, VERSION_STORE, true);
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    // extra, comment, disk start, internal attributes: 0
    cv.setUint32(38, (FILE_MODE << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);

    parts.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
    if (offset > 0xffffffff) throw new Error('zip: archive too large (ZIP64 is not supported)');
  }
  if (entries.length > 0xffff) throw new Error('zip: too many entries');

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + end.length);
  let at = 0;
  for (const p of [...parts, ...central, end]) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Reads back a STORE-only archive via its central directory (used by tests and the eject check, not by the app).
 * Verifies each entry's CRC. Throws on anything it does not understand.
 */
export function unzipStore(bytes: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  if (eocd < 0 || v.getUint32(eocd, true) !== 0x06054b50) throw new Error('unzip: no end of central directory record');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: Array<{ name: string; data: Uint8Array }> = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('unzip: bad central directory entry');
    if (v.getUint16(p + 10, true) !== 0) throw new Error('unzip: only stored entries are supported');
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error(`unzip: bad local header for ${name}`);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.slice(start, start + size);
    if (crc32(data) !== crc) throw new Error(`unzip: CRC mismatch for ${name}`);
    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
