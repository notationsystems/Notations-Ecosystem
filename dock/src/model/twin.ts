import type { Snapshot, SnapshotNode } from './types';

/**
 * What separates a twin from a picture: it says what it knows, what it does not, and how
 * far it has drifted from the blueprint it was seeded from.
 *
 * Every function here is pure and every figure it returns is countable from the snapshot
 * alone, so the fidelity panel never says more than the journal can back.
 */

export interface Fidelity {
  /** Bodies with at least one recorded health observation. The rest are drawn grey, not guessed. */
  observed: number;
  /** Bodies whose security posture has been attested. */
  attested: number;
  /** Bodies with neither — the twin knows they exist and nothing else. */
  blind: number;
  total: number;
  /** Seconds since the dock last synced, or null when it never has. */
  syncAgeSeconds: number | null;
  /** How the plane described its own answer, or null when the snapshot predates API-000. */
  proofRoot: Snapshot['proofRoot'] | null;
  reference: string | null;
}

export function fidelityOf(snapshot: Snapshot, lastSync: string | null, now = Date.now()): Fidelity {
  const observed = snapshot.nodes.filter((n) => n.lastObservedAt !== null).length;
  const attested = snapshot.nodes.filter((n) => n.security !== null).length;
  const blind = snapshot.nodes.filter((n) => n.lastObservedAt === null && n.security === null).length;
  const syncAgeSeconds = lastSync ? Math.max(0, Math.round((now - new Date(lastSync).getTime()) / 1000)) : null;
  return { observed, attested, blind, total: snapshot.nodes.length, syncAgeSeconds, proofRoot: snapshot.proofRoot ?? null, reference: snapshot.reference ?? null };
}

export interface Drift {
  /** In the blueprint, not in the twin: catalogued but never registered, or since retired. */
  missing: string[];
  /** In the twin, not in the blueprint: registered by hand or by another seed. */
  unplanned: string[];
  /** Registered with a different capability set than the blueprint declares. */
  changed: Array<{ nodeId: string; blueprint: number; live: number; added: string[]; removed: string[] }>;
  /** Relations in exactly one of the two. */
  relationsMissing: number;
  relationsUnplanned: number;
  /** True when nothing differs — the twin is the blueprint. */
  clean: boolean;
}

/**
 * How far the live twin has drifted from the catalog it was seeded from.
 *
 * The blueprint is the bundled sample snapshot: the catalog folded through the same seed
 * the plane was seeded with. Drift is not an error — a node revised in the field is the
 * system working — but drift nobody can see is how a catalog and a plane come to describe
 * two different estates while both claiming to describe one.
 */
export function driftBetween(blueprint: Snapshot, live: Snapshot): Drift {
  const planned = new Map(blueprint.nodes.map((n) => [n.nodeId, n]));
  const actual = new Map(live.nodes.map((n) => [n.nodeId, n]));

  const missing = [...planned.keys()].filter((id) => !actual.has(id)).sort();
  const unplanned = [...actual.keys()].filter((id) => !planned.has(id)).sort();

  const capabilityIds = (n: SnapshotNode) => new Set(n.capabilities.map((c) => c.capabilityId));
  const changed: Drift['changed'] = [];
  for (const [id, plan] of planned) {
    const now = actual.get(id);
    if (!now) continue;
    const before = capabilityIds(plan);
    const after = capabilityIds(now);
    const added = [...after].filter((c) => !before.has(c)).sort();
    const removed = [...before].filter((c) => !after.has(c)).sort();
    if (added.length || removed.length) changed.push({ nodeId: id, blueprint: before.size, live: after.size, added, removed });
  }
  changed.sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  const key = (r: { sourceNodeId: string; targetNodeId: string; kind: string }) => `${r.sourceNodeId}|${r.kind}|${r.targetNodeId}`;
  const plannedRelations = new Set(blueprint.relations.map(key));
  const actualRelations = new Set(live.relations.map(key));
  const relationsMissing = [...plannedRelations].filter((k) => !actualRelations.has(k)).length;
  const relationsUnplanned = [...actualRelations].filter((k) => !plannedRelations.has(k)).length;

  return {
    missing, unplanned, changed, relationsMissing, relationsUnplanned,
    clean: !missing.length && !unplanned.length && !changed.length && !relationsMissing && !relationsUnplanned,
  };
}

/** The journal records that fall on the twin's time axis, oldest first, with what each did. */
export interface TimePoint { eventId: string; recordedAt: string; kind: string; index: number }

export function timeAxis(events: Array<{ event: { eventId: string; kind: string; recordedAt?: string } }>): TimePoint[] {
  return events.map((r, index) => ({ eventId: r.event.eventId, kind: r.event.kind, recordedAt: r.event.recordedAt ?? '', index }));
}
