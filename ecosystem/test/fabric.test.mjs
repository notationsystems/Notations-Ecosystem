import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ControlPlane } from '../../control-plane/src/control-plane.js';
import { parseCommand } from '../../control-plane/src/validation.js';
import { loadCatalog } from '../validate.mjs';
import { seed } from '../seed.mjs';
import { loadManifests, registerFabricSyncs } from '../fabric.mjs';
import { buildSampleSnapshot } from '../sample-snapshot.mjs';

const NOW = '2026-09-03T00:00:00.000Z';

test('every fabric manifest is a valid register_fabric_sync command naming a catalog node', async () => {
  const manifests = await loadManifests();
  assert.ok(manifests.length >= 9);
  const known = new Set((await loadCatalog()).map((e) => e.entry.nodeId));
  for (const { file, manifest } of manifests) {
    assert.doesNotThrow(() => parseCommand({ requestId: 'x', actorId: 'operator:host', submittedAt: NOW, expectedRevision: null, action: 'register_fabric_sync', manifest }), path.basename(file));
    assert.ok(known.has(manifest.systemNodeId), `${path.basename(file)}: ${manifest.systemNodeId} is not a catalog node`);
    assert.equal(manifest.fabricNodeId, 'notations-platform');
    assert.equal(manifest.provenanceRequired, true);
    assert.equal(manifest.knownAtRequired, true);
  }
});

test('the declared bindings follow the corpus roles the catalog declares, and re-registering is quiet', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notations-fabric-test-'));
  try {
    const plane = ControlPlane.fromPath(path.join(dir, 'journal.jsonl'), () => NOW);
    const entries = await loadCatalog();
    await seed(plane, entries, { now: () => NOW });
    const manifests = await loadManifests();
    // Every manifest is accepted: the plane checks each authority against the system's corpus
    // role, so an accepted set is a set the doctrine agrees with. A rejected one would fail here.
    const first = await registerFabricSyncs(plane, manifests, { now: () => NOW });
    assert.equal(first.appended, manifests.length);
    assert.equal(first.skipped, 0);
    const snapshot = await plane.snapshot();
    assert.equal(snapshot.fabric.syncs.length, manifests.length);
    // Every canonical_state binding is a domain owner or the coordination journal; every
    // projection binding is a project node.
    const role = (id) => entries.find((e) => e.entry.nodeId === id).entry.reference.corpus.role;
    const owns = (id) => (entries.find((e) => e.entry.nodeId === id).entry.reference.corpus.owner_of ?? []).length > 0;
    for (const sync of snapshot.fabric.syncs) {
      if (sync.authority === 'canonical_state') assert.ok(owns(sync.systemNodeId) || role(sync.systemNodeId) === 'coordinate', sync.syncId);
      if (sync.authority === 'projection') assert.equal(role(sync.systemNodeId), 'project', sync.syncId);
      if (sync.authority === 'derived_compute') assert.equal(role(sync.systemNodeId), 'transform', sync.syncId);
      if (sync.authority === 'evidence_source') assert.ok(['hold', 'feed'].includes(role(sync.systemNodeId)), sync.syncId);
      assert.equal(sync.registeredBy, 'operator:host');
    }
    const second = await registerFabricSyncs(plane, manifests, { now: () => NOW });
    assert.equal(second.appended, 0);
    assert.equal(second.unchanged, manifests.length);
    // A projection that claimed canonical state would be refused by the plane, not by this tool.
    const globe = manifests.find((m) => m.manifest.authority === 'projection').manifest;
    await assert.rejects(
      registerFabricSyncs(plane, [{ file: 'x', manifest: { ...globe, syncId: 'globe-as-owner', authority: 'canonical_state' } }], { now: () => NOW }),
      (error) => error.code === 'FABRIC_AUTHORITY_MISMATCH',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the sample snapshot carries the declared fabric, so the twin can draw it offline', async () => {
  const snapshot = await buildSampleSnapshot(await loadCatalog());
  const manifests = await loadManifests();
  assert.equal(snapshot.fabric.syncs.length, manifests.length);
  assert.ok(snapshot.fabric.syncs.every((s) => s.fabricNodeId === 'notations-platform'));
  assert.ok(snapshot.nodes.some((n) => n.nodeId === 'notations-platform' && n.metadata.fabric_layers));
});
