import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { driftBetween, fidelityOf, timeAxis } from '../src/model/twin';
import type { Snapshot, SnapshotNode } from '../src/model/types';

const sample = JSON.parse(readFileSync(path.resolve(__dirname, '../public/sample-snapshot.json'), 'utf8')) as Snapshot;

describe('fidelity: what the twin knows and does not', () => {
  it('counts observed, attested and blind bodies from the snapshot alone', () => {
    const f = fidelityOf(sample, null);
    expect(f.total).toBe(sample.nodes.length);
    expect(f.observed + f.blind).toBeLessThanOrEqual(f.total);
    // Counted from the snapshot, never assumed about it: the sample carries whatever the
    // seed folded in, and the panel must report that rather than a belief about it.
    expect(f.observed).toBe(sample.nodes.filter((n) => n.lastObservedAt !== null).length);
    expect(f.attested).toBe(sample.nodes.filter((n) => n.security !== null).length);
    expect(f.blind).toBe(sample.nodes.filter((n) => n.lastObservedAt === null && n.security === null).length);
    // A blind body is one the twin knows exists and nothing else — most of a fresh estate.
    expect(f.blind).toBeGreaterThan(f.total / 2);
    expect(f.syncAgeSeconds).toBeNull();
    // Who vouched, and who is bound: counted, never assumed. The sample's attestations are
    // the generator's word alone, and its bindings are the declared manifests.
    expect(f.signed).toBe(sample.nodes.filter((n) => n.security?.signer).length);
    expect(f.signed).toBe(0);
    expect(f.bound).toBe(new Set(sample.fabric!.syncs.map((s) => s.systemNodeId)).size);
    expect(f.bound).toBeGreaterThan(0);
    const signed: Snapshot = { ...sample, nodes: sample.nodes.map((n, i) => (i === 0 && n.security ? { ...n, security: { ...n.security, signer: { signerId: 'collector:ci', verifiedAt: '2026-09-03T00:00:00Z' } } } : n)) };
    expect(fidelityOf(signed, null).signed).toBe(sample.nodes[0]!.security ? 1 : 0);
  });

  it('reports sync age in whole seconds and never negative', () => {
    const now = Date.parse('2026-09-03T12:00:10Z');
    expect(fidelityOf(sample, '2026-09-03T12:00:00Z', now).syncAgeSeconds).toBe(10);
    expect(fidelityOf(sample, '2026-09-03T12:00:30Z', now).syncAgeSeconds).toBe(0);
  });

  it('carries the proof root through when the plane supplied one', () => {
    const referenced: Snapshot = { ...sample, apiResponse: 'referenced', reference: 'notation://state/notationsystems/control-plane@abc', proofRoot: { revision: 'abc', chain: 'hash-linked', signing: 'active', rollbackAnchor: true } };
    expect(fidelityOf(referenced, null).proofRoot?.revision).toBe('abc');
    expect(fidelityOf(sample, null).proofRoot).toBeNull();
  });
});

describe('drift: the blueprint against the twin', () => {
  it('is clean when the twin is the blueprint', () => {
    const d = driftBetween(sample, sample);
    expect(d.clean).toBe(true);
    expect(d.missing).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('names what is missing, what is unplanned, and what changed', () => {
    const [first, second, ...rest] = sample.nodes;
    const extra: SnapshotNode = { ...first!, nodeId: 'field-registered', name: 'Registered in the field' };
    const revised: SnapshotNode = { ...second!, capabilities: [...second!.capabilities.slice(1), { ...second!.capabilities[0]!, capabilityId: 'new.capability' }] };
    const live: Snapshot = { ...sample, nodes: [extra, revised, ...rest], relations: sample.relations.slice(1) };

    const d = driftBetween(sample, live);
    expect(d.clean).toBe(false);
    expect(d.missing).toEqual([first!.nodeId]);
    expect(d.unplanned).toEqual(['field-registered']);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.nodeId).toBe(second!.nodeId);
    expect(d.changed[0]!.added).toEqual(['new.capability']);
    expect(d.changed[0]!.removed).toEqual([second!.capabilities[0]!.capabilityId]);
    expect(d.relationsMissing).toBe(1);
    expect(d.relationsUnplanned).toBe(0);
  });

  it('counts a binding as drift when it is declared and not registered, or registered under another authority', () => {
    const [first, ...rest] = sample.fabric!.syncs;
    const dropped: Snapshot = { ...sample, fabric: { ...sample.fabric!, syncs: rest } };
    const d = driftBetween(sample, dropped);
    expect(d.clean).toBe(false);
    expect(d.syncsMissing).toEqual([`${first!.systemNodeId}|${first!.authority}|${first!.fabricNodeId}`]);
    expect(d.syncsUnplanned).toEqual([]);
    // The same system bound as something else is a different contract, not the same one renamed.
    const rebound: Snapshot = { ...sample, fabric: { ...sample.fabric!, syncs: [{ ...first!, authority: first!.authority === 'projection' ? 'evidence_source' : 'projection' }, ...rest] } };
    const r = driftBetween(sample, rebound);
    expect(r.syncsMissing).toHaveLength(1);
    expect(r.syncsUnplanned).toHaveLength(1);
    // A live plane from before the registry drifts by every declared binding, and says which.
    const { fabric: _none, ...before } = sample;
    expect(driftBetween(sample, before as Snapshot).syncsMissing).toHaveLength(sample.fabric!.syncs.length);
  });

  it('treats a relation as the same only when source, kind and target all match', () => {
    const flipped: Snapshot = { ...sample, relations: sample.relations.map((r, i) => (i === 0 ? { ...r, kind: r.kind === 'depends_on' ? 'coordinates' : 'depends_on' } : r)) };
    const d = driftBetween(sample, flipped);
    expect(d.relationsMissing).toBe(1);
    expect(d.relationsUnplanned).toBe(1);
  });
});

describe('the time axis', () => {
  it('orders journal records oldest first and keeps their position', () => {
    const axis = timeAxis([
      { event: { eventId: 'e1', kind: 'node_registered', recordedAt: '2026-09-03T00:00:00Z' } },
      { event: { eventId: 'e2', kind: 'observation_recorded' } },
    ]);
    expect(axis.map((p) => p.index)).toEqual([0, 1]);
    expect(axis[1]!.recordedAt).toBe('');
  });
});
