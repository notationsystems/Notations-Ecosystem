import { describe, expect, it } from 'vitest';
import { TRUTH } from '../src/model/truth';
import { coverage, unanswered } from '../src/product/slice';
import type { CaravanSlice } from '../src/product/types';

const base = (over: Partial<CaravanSlice> = {}): CaravanSlice => ({
  schema: 'x', status: 'fixture',
  frame: { release: { class: 'NOT_EVIDENCED', whyUnknown: 'x' }, valid_time: { class: 'NOT_EVIDENCED', whyUnknown: 'x' }, knowledge_time: { class: 'NOT_EVIDENCED', whyUnknown: 'x' }, coverage: { class: 'NOT_EVIDENCED', whyUnknown: 'x' } },
  parties: [], shipments: [], voyages: [], exceptions: [], ...over,
});

describe('a hostile slice cannot take the surface down', () => {
  it('survives a deeply nested response without exhausting the stack', () => {
    // A response is attacker-influenced the moment it crosses a boundary. A walker with no depth
    // bound turns a nested document into a denial of the whole surface.
    let deep: unknown = { class: 'UNOBSERVED', whyUnknown: 'leaf' };
    for (let i = 0; i < 60_000; i += 1) deep = { nested: deep };
    const slice = base({ voyages: deep as never });
    expect(() => unanswered(slice)).not.toThrow();
  });

  it('does not treat an unknown truth class as a known one', () => {
    const slice = base({ parties: [{ id: 'p', role: 'r', resolution: { class: 'TOTALLY_FINE' as never, whyUnknown: 'x' } }] });
    // SEC-016: an unrecognised class acquires no semantics — it is neither a success nor an unknown.
    expect(TRUTH['TOTALLY_FINE' as never]).toBeUndefined();
    expect(() => unanswered(slice)).not.toThrow();
    expect(unanswered(slice).map((u) => u.truthClass)).not.toContain('TOTALLY_FINE');
  });

  it('counts only real truths, so a decoy object cannot inflate coverage', () => {
    const slice = base({ shipments: [{ id: 's', lot: { class: 'not-a-class' } as never, commodity_reference: { class: 'UNOBSERVED', whyUnknown: 'x' }, destination_site: { class: 'UNOBSERVED', whyUnknown: 'x' }, status: { class: 'UNOBSERVED', whyUnknown: 'x' } }] });
    const c = coverage(slice);
    expect(c.answered + c.unanswered).toBe(c.total);
    expect(c.answered).toBe(0);
  });
});

describe('the depth bound is stated, not silent', () => {
  it('reports the limit as a typed non-success rather than truncating quietly', () => {
    let deep: unknown = { class: 'UNOBSERVED', whyUnknown: 'leaf' };
    for (let i = 0; i < 500; i += 1) deep = { nested: deep };
    const found = unanswered(base({ voyages: deep as never }));
    const marker = found.find((u) => /nests deeper/.test(u.whyUnknown));
    expect(marker, 'a surface that quietly stopped looking would be claiming it had looked').toBeDefined();
    expect(marker?.truthClass).toBe('NOT_EVIDENCED');
  });

  it('counts the unread region as unanswered, never as answered', () => {
    let deep: unknown = { class: 'CANONICAL_PROOF', value: 1, reference: 'r', proofRoot: 'p' };
    for (let i = 0; i < 500; i += 1) deep = { nested: deep };
    const c = coverage(base({ voyages: deep as never }));
    expect(c.answered).toBe(0);
    expect(c.unanswered).toBeGreaterThan(0);
  });
});
