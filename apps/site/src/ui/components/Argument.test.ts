import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import { Argument, ARGUMENT, COPY } from './Argument';

// the same words scripts/shots.mjs flags when they are visible on the page
const BANNED = /property-based|\binvariant\b|\bmutants?\b|\bshrunk\b|fast-check|counterexample/i;

describe('the argument above the fold', () => {
  for (const [key, sentences] of Object.entries(COPY)) {
    it(`draft ${key} is two plain sentences`, () => {
      expect(sentences).toHaveLength(2);
      for (const s of sentences) {
        expect(s).toMatch(/^[A-Z][^.!?]*[.]$/);
        expect(s).not.toMatch(BANNED);
        expect(s).not.toMatch(/\b[A-Z]{2,}\b/);
        expect(s).not.toMatch(/!/);
      }
    });
  }

  it('renders the chosen draft', () => {
    const vnode = Argument() as VNode<{ class: string; children: (VNode<{ children: string }> | string)[] }>;
    expect(vnode.type).toBe('p');
    expect(vnode.props.class).toBe('argument');
    const text = vnode.props.children.map((c) => (typeof c === 'string' ? c : c.props.children)).join('');
    expect(text).toBe(`${ARGUMENT[0]} ${ARGUMENT[1]}`);
  });
});
