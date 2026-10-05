import { describe, expect, it } from 'vitest';
import { ejectLabel } from './Eject';
import { ejectClosure } from '@scasella/undefined-engine/eject/eject';
import { SCENARIOS } from '../dev/fixtures';

describe('Eject label', () => {
  it('is "Eject" alone for a function that calls nothing, and names the closure otherwise', () => {
    expect(ejectLabel('median', 0)).toBe('Eject');
    expect(ejectLabel('slugifyAll', 1)).toBe('Eject slugifyAll and 1 function it uses');
    expect(ejectLabel('median', 2)).toBe('Eject median and 2 functions it uses');
  });

  it('counts the closure the eject will write (composed fixture)', () => {
    const s = SCENARIOS['composed-committed']();
    expect(ejectClosure(s.program, 'slugifyAll').map((r) => r.spec.name)).toEqual(['slugifyAll', 'slugify']);
  });
});
