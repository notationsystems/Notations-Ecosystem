import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { coverage, digestIsComplete, unanswered } from '../src/product/slice';
import { PRODUCTS } from '../src/product/ProductSurface';
import { LANDSHARK, TRADEWIND } from '../src/product/Mapping';
import type { CaravanSlice } from '../src/product/types';

const slice = JSON.parse(readFileSync(path.join(__dirname, '../../ecosystem/caravan/fixtures.json'), 'utf8')) as CaravanSlice;

describe('the Caravan shell reads a slice for what it could not answer', () => {
  it('finds every typed non-success, wherever it sits', () => {
    const un = unanswered(slice);
    const classes = new Set(un.map((u) => u.truthClass));
    expect(classes).toEqual(new Set(['UNOBSERVED', 'UNRESOLVED', 'CONFLICTING', 'NOT_EVIDENCED']));
    for (const u of un) expect(u.whyUnknown, u.path).toBeTruthy();
  });

  it('finds them by path, including one nested inside a voyage milestone', () => {
    const paths = unanswered(slice).map((u) => u.path);
    expect(paths).toContain('frame.release');
    expect(paths.some((p) => /voyages\[\d+\]\.milestones\[\d+\]\.at/.test(p))).toBe(true);
  });

  it('does not descend into a truth and count its own fields as subjects', () => {
    // A CONFLICTING truth carries a `detail` array; those are positions, not further unknowns.
    const conflicting = unanswered(slice).filter((u) => u.truthClass === 'CONFLICTING');
    expect(conflicting).toHaveLength(1);
    expect(conflicting[0]?.detail?.length).toBeGreaterThan(1);
  });

  it('reports coverage as a count of subjects, never as a score', () => {
    const c = coverage(slice);
    expect(c.answered + c.unanswered).toBe(c.total);
    expect(c.total).toBeGreaterThan(15);
    // Every non-success is attributed to a class, so no unknown is folded into a single number.
    expect(Object.values(c.byClass).reduce((a, b) => a + b, 0)).toBe(c.unanswered);
  });

  it('surfaces an unknown the response forgot to put in its own digest', () => {
    const thinned: CaravanSlice = { ...slice, exceptions: [] };
    expect(digestIsComplete(thinned)).toBe(false);
    // The shell renders from `unanswered`, so the thinned digest changes nothing it shows.
    expect(unanswered(thinned)).toEqual(unanswered(slice));
  });
});

describe('the product surfaces state what they are', () => {
  it('marks Caravan a reference implementation and the other two not built', () => {
    expect(PRODUCTS.find((p) => p.id === 'caravan')?.standing).toBe('reference_implementation');
    expect(PRODUCTS.find((p) => p.id === 'tradewind')?.standing).toBe('not_built');
    expect(PRODUCTS.find((p) => p.id === 'landshark')?.standing).toBe('not_built');
    expect(PRODUCTS.some((p) => p.standing === 'deployed_service')).toBe(false);
  });

  it('says why each unbuilt line has no data, rather than showing an empty surface', () => {
    for (const line of [TRADEWIND, LANDSHARK]) {
      expect(line.whyNotLive).toMatch(/defined, not built/);
      expect(line.notTheJob.length).toBeGreaterThan(1);
    }
  });

  it('keeps each line off the others’ objects', () => {
    expect(TRADEWIND.notTheJob.join(' ')).toMatch(/Caravan’s object/);
    expect(LANDSHARK.notTheJob.join(' ')).toMatch(/not the BIM customer/);
    expect(TRADEWIND.owns).toContain('commodity');
    expect(LANDSHARK.owns).toContain('site');
    expect(TRADEWIND.owns).not.toContain('site');
  });

  it('offers no product surface named Payload', () => {
    expect(PRODUCTS.map((p) => p.name)).toEqual(['Caravan', 'Tradewind', 'Landshark']);
  });
});

describe('the fixture the shell is built against', () => {
  it('is labelled a fixture and names no corridor', () => {
    expect(slice.status).toBe('fixture');
    expect(slice.why_no_corridor).toMatch(/undecided/i);
    expect(JSON.stringify(slice)).not.toMatch(/"id": "(?!FIXTURE-)/);
  });

  it('carries no release, because release identity is not built', () => {
    expect(slice.frame.release.class).toBe('NOT_EVIDENCED');
  });
});
