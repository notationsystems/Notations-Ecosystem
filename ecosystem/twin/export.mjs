// Seed a throwaway plane exactly as the sample snapshot is built, then export both the fold
// and the journal it was folded from, so an offline twin can scrub the time axis.
//
// The data this writes is a sample fold. It carries no credential, no host, no topology and no
// vulnerability detail: only what the catalog already declares in public, plus observations and
// posture summaries invented for the sample and labelled as such.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ControlPlane } from '../../control-plane/src/control-plane.js';
import { loadCatalog } from '../validate.mjs';
import { seed } from '../seed.mjs';
import { loadManifests, registerFabricSyncs } from '../fabric.mjs';

export async function exportTwinData() {
let t = Date.parse('2026-09-03T00:00:00.000Z');
const clock = () => { t += 37_000; return new Date(t).toISOString(); }; // distinct recordedAt per record, 37 s apart
const dir = await mkdtemp(path.join(os.tmpdir(), 'notations-twin-'));
const plane = ControlPlane.fromPath(path.join(dir, 'journal.jsonl'), clock);
const entries = await loadCatalog();
await seed(plane, entries, { now: clock });
await registerFabricSyncs(plane, await loadManifests(), { now: clock });
let snapshot = await plane.snapshot();
const cmd = async (c) => { const r = await plane.command({ ...c, expectedRevision: snapshot.revision }); snapshot = r.snapshot; return r; };
await cmd({ requestId: 'sample:observe:control-plane', actorId: 'sample:generator', submittedAt: clock(), action: 'record_observation', nodeId: 'control-plane', health: 'healthy', observedAt: clock(), source: 'health_check', detail: 'Sample: the control plane answered /health.' });
await cmd({ requestId: 'sample:observe:notations-dock', actorId: 'sample:generator', submittedAt: clock(), action: 'record_observation', nodeId: 'notations-dock', health: 'healthy', observedAt: clock(), source: 'operator', detail: 'Sample: dock rendered the snapshot.' });
await cmd({ requestId: 'sample:observe:payload-terminal', actorId: 'sample:generator', submittedAt: clock(), action: 'record_observation', nodeId: 'payload-terminal', health: 'degraded', observedAt: clock(), source: 'health_check', detail: 'Sample: /api/health answered operational with state warming.' });
await cmd({ requestId: 'sample:observe:osiris-intel', actorId: 'sample:generator', submittedAt: clock(), action: 'record_observation', nodeId: 'osiris-intel', health: 'offline', observedAt: clock(), source: 'health_check', detail: 'Sample: /health unreachable.' });
const signals = [
  { dimension: 'identity', state: 'adequate', coverage: 0.75, findings: { critical: 0, high: 1, medium: 2, low: 0 }, summary: 'Sample: most credentials are bound to a single actor; one shared credential remains.' },
  { dimension: 'authorization', state: 'strong', coverage: 1, summary: 'Sample: every state-changing action requires a named permission.' },
  { dimension: 'encryption_in_transit', state: 'adequate', coverage: 1, summary: 'Sample: TLS terminates at a trusted proxy.' },
  { dimension: 'encryption_at_rest', state: 'strong', coverage: 1, summary: 'Sample: signing key material is wrapped by a key encryption key.' },
  { dimension: 'key_lifecycle', state: 'strong', coverage: 1, summary: 'Sample: one active signing key, rotated within the last 180 days.' },
  { dimension: 'dependency_risk', state: 'weak', coverage: 1, findings: { critical: 0, high: 2, medium: 9, low: 31 }, summary: 'Sample: dependency audit reports two high findings awaiting remediation.' },
  { dimension: 'exposure', state: 'adequate', coverage: 0.8, findings: { critical: 0, high: 0, medium: 6, low: 0 }, summary: 'Sample: six catalogued systems have undeclared exposure.' },
  { dimension: 'audit_integrity', state: 'strong', coverage: 1, summary: 'Sample: the journal verifies as a signed, anchored hash chain.' },
  { dimension: 'backup', state: 'unknown', coverage: 0, summary: 'Sample: no off-host journal replica is configured, so recoverability is unverified.' },
  { dimension: 'incident', state: 'strong', coverage: 1, summary: 'Sample: no open security incident.' },
  { dimension: 'control_plane_integrity', state: 'strong', coverage: 1, summary: 'Sample: the control-plane invariant suite passes.' },
];
for (const nodeId of ['control-plane', 'payload-terminal']) await cmd({ requestId: `sample:posture:${nodeId}`, actorId: 'attestor:sample', submittedAt: clock(), action: 'record_security_posture', nodeId, attestedAt: clock(), method: 'automated_scan', signals });
await cmd({ requestId: 'sample:posture:ste', actorId: 'attestor:sample', submittedAt: clock(), action: 'record_security_posture', nodeId: 'scientific-transformer-engine', attestedAt: clock(), method: 'self_declared', signals: [{ dimension: 'audit_integrity', state: 'strong', coverage: 1, summary: 'Sample: hash-linked version store.' }, { dimension: 'backup', state: 'failing', coverage: 0, summary: 'Sample: in-memory only; nothing survives a restart.' }] });
// A coordination request an operator has to decide, and one already decided.
await cmd({ requestId: 'sample:coord:1', actorId: 'agent:planner', submittedAt: clock(), action: 'request_capability', coordinationId: 'coord-sample-1', requesterNodeId: 'payload-ocr-agent', targetNodeId: 'payload-terminal', capabilityId: snapshot.nodes.find(n => n.nodeId === 'payload-terminal').capabilities.find(c => c.mode === 'execute').capabilityId, requestedMode: 'execute', purpose: 'Sample: admit validated OCR observations into the physical-economy state.' });
await cmd({ requestId: 'sample:coord:2', actorId: 'agent:planner', submittedAt: clock(), action: 'request_capability', coordinationId: 'coord-sample-2', requesterNodeId: 'scientific-compute-layer', targetNodeId: 'scientific-transformer-engine', capabilityId: snapshot.nodes.find(n => n.nodeId === 'scientific-transformer-engine').capabilities.find(c => c.mode === 'execute').capabilityId, requestedMode: 'execute', purpose: 'Sample: propose a derived state for admission.' });
await cmd({ requestId: 'sample:coord:2:resolve', actorId: 'operator:sample', submittedAt: clock(), action: 'resolve_coordination', coordinationId: 'coord-sample-2', decision: 'approved', note: 'Sample: approved for a separately configured adapter. Not dispatched.' });
const final = await plane.snapshot();
const events = await plane.events();
const out = { snapshot: { ...final, sample: true }, events: events.events.map(r => ({ eventId: r.event.eventId, kind: r.event.kind, recordedAt: r.event.recordedAt, recordHash: r.recordHash, previousHash: r.previousHash, event: r.event })) };
await rm(dir, { recursive: true, force: true });
return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await exportTwinData();
  const target = process.argv[2] ?? 'twin-data.json';
  await writeFile(target, JSON.stringify(out));
  console.log('nodes', out.snapshot.nodes.length, 'relations', out.snapshot.relations.length, 'syncs', out.snapshot.fabric.syncs.length, 'coordination', out.snapshot.coordination.length, 'events', out.events.length, 'revision', out.snapshot.revision.slice(0, 12));
}
