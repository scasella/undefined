import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, dosDateTime, unzipStore, zipStore } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(enc.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('dosDateTime', () => {
  it('packs local time fields with 2-second resolution and clamps to 1980', () => {
    const { time, date } = dosDateTime(new Date(2026, 9, 4, 13, 45, 31));
    expect(time).toBe((13 << 11) | (45 << 5) | 15);
    expect(date).toBe(((2026 - 1980) << 9) | (10 << 5) | 4);
    expect(dosDateTime(new Date(1970, 5, 1)).date).toBe((0 << 9) | (1 << 5) | 1);
  });
});

describe('zipStore', () => {
  const files = [
    { name: 'pkg/a.ts', data: 'export const a = 1;\n' },
    { name: 'pkg/ünïcode.md', data: 'Crème brûlée ✓\n' },
    { name: 'pkg/empty.txt', data: '' },
    { name: 'pkg/bin', data: new Uint8Array([0, 255, 1, 254]) },
  ];

  it('round-trips names and bytes, with valid CRCs', () => {
    const zip = zipStore(files, new Date(Date.UTC(2026, 0, 2, 3, 4, 6)));
    const back = unzipStore(zip);
    expect(back.map((e) => e.name)).toEqual(files.map((f) => f.name));
    expect(dec.decode(back[1]!.data)).toBe('Crème brûlée ✓\n');
    expect([...back[3]!.data]).toEqual([0, 255, 1, 254]);
    expect(back[2]!.data.length).toBe(0);
  });

  it('is deterministic for the same input and date', () => {
    const d = new Date(Date.UTC(2026, 5, 1));
    expect(zipStore(files, d)).toEqual(zipStore(files, d));
  });

  it('writes an empty archive as a bare end record', () => {
    const zip = zipStore([]);
    expect(zip.length).toBe(22);
    expect(unzipStore(zip)).toEqual([]);
  });

  it('rejects duplicate, empty and absolute names', () => {
    expect(() => zipStore([{ name: 'a', data: '' }, { name: 'a', data: '' }])).toThrow(/duplicate/);
    expect(() => zipStore([{ name: '', data: '' }])).toThrow(/bad entry/);
    expect(() => zipStore([{ name: '/etc/x', data: '' }])).toThrow(/bad entry/);
  });

  it('detects a corrupted entry', () => {
    const zip = zipStore([{ name: 'a.txt', data: 'hello' }]);
    zip[30 + 'a.txt'.length] ^= 1; // first data byte
    expect(() => unzipStore(zip)).toThrow(/CRC mismatch/);
  });

  it.skipIf(!hasUnzip())('is accepted by the system unzip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    try {
      const path = join(dir, 'x.zip');
      writeFileSync(path, zipStore(files, new Date(Date.UTC(2026, 0, 2))));
      execFileSync('unzip', ['-tq', path], { stdio: 'pipe' });
      execFileSync('unzip', ['-q', path, '-d', join(dir, 'out')], { stdio: 'pipe' });
      expect(readFileSync(join(dir, 'out', 'pkg', 'ünïcode.md'), 'utf8')).toBe('Crème brûlée ✓\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
