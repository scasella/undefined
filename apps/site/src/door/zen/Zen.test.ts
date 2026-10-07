import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { zenPrivacyLine } from './Zen';

describe('zenPrivacyLine', () => {
  it('says the demo sends nothing', () => {
    expect(zenPrivacyLine('replay', true)).toMatch(/sends nothing/);
  });
  it('says exactly what the AI sees in live mode', () => {
    expect(zenPrivacyLine('live', false)).toMatch(/column names \+ types only/);
    expect(zenPrivacyLine('live', true)).toMatch(/3 example rows/);
  });
});

describe('Zen.tsx: nothing moves by itself (C1)', () => {
  const src = readFileSync(new URL('./Zen.tsx', import.meta.url), 'utf8');
  it('has no hand-over timer and never switches to the answer pane except from the viewer\'s own button', () => {
    expect(src).not.toMatch(/HAND_OVER/);
    expect(src).not.toMatch(/setTimeout|setInterval/);
    // go(5) is only ever called from the "See the answer" button's onClick
    const calls = [...src.matchAll(/\bgo\(5\)/g)];
    expect(calls).toHaveLength(1);
    expect(src).toMatch(/<Button id=\{ZEN_SEE_ANSWER_ID\}[^>]*onClick=\{\(\) => go\(5\)\}/);
    expect(src).not.toMatch(/setStep\(5\)/);
  });
  it('moves with pushState (no hashchange, so the router leaves focus alone) and rewrites a clamped URL with replaceState', () => {
    expect(src).toMatch(/history\.pushState\(/);
    expect(src).toMatch(/history\.replaceState\(/);
    expect(src).not.toMatch(/location\.hash\s*=[^=]/);
    expect(src).not.toMatch(/navigate\(/);
  });
  it('listens to hashchange and popstate, and removes both', () => {
    for (const ev of ['hashchange', 'popstate']) {
      expect(src).toContain(`window.addEventListener('${ev}'`);
      expect(src).toContain(`window.removeEventListener('${ev}'`);
    }
  });
});

describe('Zen.tsx: focus goes to "See the answer" when the run settles, wherever it was (C1)', () => {
  const src = readFileSync(new URL('./Zen.tsx', import.meta.url), 'utf8');
  const body = /function focusSeeAnswer\(\): void \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
  it('takes the button\'s own id and does not look at where focus is (no exception for a stray Tab to the skip link or a top-bar link)', () => {
    expect(body).toContain('ZEN_SEE_ANSWER_ID');
    expect(body).toContain('.focus()');
    expect(body).not.toMatch(/activeElement|contains\(|#main|getElementById\('main'\)/);
  });
  it('only a visit that watched the run moves focus (Back or Forward onto a finished trace says nothing)', () => {
    expect(src).toMatch(/if \(stepRef\.current !== 4 \|\| !watching\.current\) return;/);
  });
});

describe('Zen.tsx: the in-app Back checks where the browser landed (C5)', () => {
  const src = readFileSync(new URL('./Zen.tsx', import.meta.url), 'utf8');
  it('remembers the pane it was pressed on only when it asks the browser, and asks flow.ts what to do once the browser has landed', () => {
    expect(src).toMatch(/backFrom\.current = step;\s*history\.back\(\);/);
    expect(src).toContain('afterHistoryBack(askedFrom, want)');
  });
  it('listens for the browser moving with the "browser" flag (popstate and hashchange), not for the page\'s own direct calls', () => {
    expect(src).toMatch(/const onBrowser = \(\): void => sync\(true\);/);
    expect(src).toContain("window.addEventListener('popstate', onBrowser)");
    expect(src).toContain("window.addEventListener('hashchange', onBrowser)");
  });
  it('the viewer\'s own moves drop it (go clears it, so a stale ask cannot push a pane later)', () => {
    expect(/const go = useCallback\(\(n: ZenStep\): void => \{\s*backFrom\.current = null;/.test(src)).toBe(true);
  });
});

describe('Zen.tsx: owns the scroll while it is mounted (Back and Forward must not leave a residual offset)', () => {
  const src = readFileSync(new URL('./Zen.tsx', import.meta.url), 'utf8');
  it('holds history.scrollRestoration manual from mount and gives the browser\'s default ("auto") back on unmount (the effect returns the undo)', () => {
    expect(src).toMatch(/useEffect\(\(\) => holdManualScroll\(typeof history === 'undefined' \? null : history\), \[\]\);/);
  });
  it('never reads or stores the value itself: "put back what I found" is the leak (entries pushed from a pane are born manual), the default is flow.ts\'s to give', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/scrollRestoration/);
  });
});
