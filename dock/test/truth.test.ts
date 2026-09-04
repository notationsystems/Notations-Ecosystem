import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TRUTH, TRUTH_CLASSES, healthTruth, isNonSuccess, isObserved, isRenderable, isSuccess, postureTruth, valueOf, type Truth } from '../src/model/truth';

const declared = JSON.parse(readFileSync(path.join(__dirname, '../../ecosystem/truth-classes.json'), 'utf8'));

describe('the truth vocabulary this frontend renders', () => {
  it('is the vocabulary the estate declared, exactly', () => {
    expect([...TRUTH_CLASSES].sort()).toEqual(Object.keys(declared.classes).sort());
  });

  it('agrees with the declaration on which classes are successes', () => {
    for (const c of TRUTH_CLASSES) {
      expect(TRUTH[c].outcome, c).toBe(declared.classes[c].outcome);
    }
  });

  it('carries every field the declaration says a view must show', () => {
    for (const c of TRUTH_CLASSES) {
      for (const field of declared.classes[c].must_render) {
        expect(TRUTH[c].mustRender, `${c} must render ${field}`).toContain(field);
      }
    }
  });

  it('counts four typed non-successes, because they are the ones that get lost', () => {
    expect(TRUTH_CLASSES.filter(isNonSuccess)).toEqual(['UNOBSERVED', 'UNRESOLVED', 'CONFLICTING', 'NOT_EVIDENCED']);
    expect(TRUTH_CLASSES.filter(isSuccess)).toHaveLength(3);
  });
});

describe('API-001: an unknown cannot be rendered as a value', () => {
  it('gives a non-success no value to read', () => {
    const t: Truth<number> = { class: 'UNOBSERVED', whyUnknown: 'no observation is recorded for this node' };
    expect(valueOf(t)).toBeUndefined();
  });

  it('returns the value of a success', () => {
    const t: Truth<number> = { class: 'CANONICAL_PROOF', value: 31, reference: 'notation://nodes', proofRoot: 'abc123' };
    expect(valueOf(t)).toBe(31);
  });

  it('refuses an observation with no stated limits', () => {
    const bare: Truth<string> = { class: 'OPERATIONAL_OBSERVATION', value: 'healthy', observedAt: '2026-09-03T00:00:00Z', limitations: [] };
    const stated: Truth<string> = { ...bare, limitations: ['One probe, from one place, at one moment.'] };
    expect(isRenderable(bare)).toBe(false);
    expect(isRenderable(stated)).toBe(true);
  });

  it('refuses a canonical answer with no reference or no proof root', () => {
    expect(isRenderable({ class: 'CANONICAL_PROOF', value: 1, reference: '', proofRoot: 'abc' })).toBe(false);
    expect(isRenderable({ class: 'CANONICAL_PROOF', value: 1, reference: 'notation://x', proofRoot: '' })).toBe(false);
  });

  it('refuses a non-success that does not say why it is unknown', () => {
    expect(isRenderable({ class: 'CONFLICTING', whyUnknown: '' })).toBe(false);
  });
});

describe('the frontend boundary this dock is held to', () => {
  it('calls only tenant-read, verification and governance planes', () => {
    expect(declared.frontend_boundary.may_call).toEqual(['tenant_read', 'verification', 'governance']);
    expect(declared.frontend_boundary.may_never_call).toContain('internal_operator');
  });

  it('names the things a browser must never be handed', () => {
    for (const forbidden of ['private keys', 'credentials', 'raw evidence', 'host or network topology']) {
      expect(declared.frontend_boundary.may_never_receive).toContain(forbidden);
    }
  });

  it('holds the control-plane view to logical topology unless WGS84 is supplied', () => {
    expect(declared.frontend_boundary.control_plane_visual.geographic_requires).toMatch(/WGS84/);
  });
});

describe('a node health that nothing has looked at', () => {
  it('is UNOBSERVED, not healthy and not a dash', () => {
    const t = healthTruth({ health: 'unknown', lastObservedAt: null });
    expect(t.class).toBe('UNOBSERVED');
    expect(valueOf(t)).toBeUndefined();
    // The registry default is shown as a default, never as a finding.
    expect((t as { detail?: readonly string[] }).detail?.[0]).toMatch(/default and not a finding/);
  });

  it('is an observation once something has, and states its limits', () => {
    const t = healthTruth({ health: 'healthy', lastObservedAt: '2026-09-03T00:00:00Z', lastObservation: { source: 'health_check', detail: 'answered /health' } });
    expect(t.class).toBe('OPERATIONAL_OBSERVATION');
    expect(isRenderable(t)).toBe(true);
    expect((t as { limitations: readonly string[] }).limitations.length).toBeGreaterThan(1);
  });
});

describe('an attested posture', () => {
  it('with no signer is the principal’s own word, not a verified fact', () => {
    const t = postureTruth({ security: { attestedAt: '2026-09-03T00:00:00Z', method: 'self_declared' } });
    expect(t.class).toBe('OPERATIONAL_OBSERVATION');
    expect((t as { limitations: readonly string[] }).limitations.join(' ')).toMatch(/own word/);
  });

  it('with an independent signer is a verified derivation', () => {
    const t = postureTruth({ security: { attestedAt: '2026-09-03T00:00:00Z', method: 'automated_scan', signer: { signerId: 'collector-1' } } });
    expect(t.class).toBe('VERIFIED_DERIVATION');
    expect(isRenderable(t)).toBe(true);
  });

  it('with nothing attested is NOT_EVIDENCED, not a zero', () => {
    const t = postureTruth({});
    expect(t.class).toBe('NOT_EVIDENCED');
    expect(valueOf(t)).toBeUndefined();
  });
});

describe('an observation of "unknown" is still an observation', () => {
  // The snapshot's health is derived from the last observation, so an absent observation shows as
  // `unknown` — but `unknown` is also a health an operator can record. Any code that tests the enum
  // instead of `lastObservedAt` erases that operator's finding into an absence.
  const lookedAndFoundNothing = { health: 'unknown', lastObservedAt: '2026-09-03T00:00:00Z', lastObservation: { source: 'health_check', detail: 'reachable, state not determinable' } };
  const neverLooked = { health: 'unknown', lastObservedAt: null };

  it('counts as observed', () => {
    expect(isObserved(lookedAndFoundNothing)).toBe(true);
    expect(isObserved(neverLooked)).toBe(false);
  });

  it('renders as an observation, not as an unknown', () => {
    expect(healthTruth(lookedAndFoundNothing).class).toBe('OPERATIONAL_OBSERVATION');
    expect(healthTruth(neverLooked).class).toBe('UNOBSERVED');
  });

  it('would have been erased by testing the enum, which is why nothing does', () => {
    // The defect this guards: `health !== 'unknown'` says false for a node that was observed.
    expect(lookedAndFoundNothing.health !== 'unknown').toBe(false);
    expect(isObserved(lookedAndFoundNothing)).toBe(true);
  });
});
