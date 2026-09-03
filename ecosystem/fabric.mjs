#!/usr/bin/env node
// Register the estate's fabric syncs (ecosystem/fabric/*.json) with the control plane.
//
//   node ecosystem/fabric.mjs --journal control-plane/data/control-plane.jsonl [--actor operator:host]
//
// Operator-local by design: register_fabric_sync is refused over every plane (SEC-045), so
// this tool opens the journal in-process, the way the server does, and there is no --url.
// Idempotent the way the seed is: a manifest already in the snapshot with the same content
// is not resubmitted, and a changed one is submitted under a request id that carries a
// digest of its content.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../control-plane/src/journal.js';
import { contentDigest } from './seed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FABRIC_DIR = path.join(here, 'fabric');

export async function loadManifests(dir = FABRIC_DIR) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const manifests = [];
  for (const f of files) {
    const file = path.join(dir, f);
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    if (manifest.syncId !== path.basename(f, '.json')) throw new Error(`${f}: syncId "${manifest.syncId}" must match the file name`);
    manifests.push({ file, manifest });
  }
  return manifests;
}

/** The manifest fields of a recorded sync, for change detection; registration stamps are not the contract. */
export function syncShape(sync) {
  const { registeredBy, registeredAt, ...manifest } = sync;
  return canonicalize(manifest);
}

/** Drive any object with `snapshot()` and `command(cmd)`; the plane refuses this action over HTTP, so in practice the ControlPlane class. */
export async function registerFabricSyncs(plane, manifests, { actorId = 'operator:host', now = () => new Date().toISOString(), log = () => {} } = {}) {
  let snapshot = await plane.snapshot();
  const outcomes = { appended: 0, duplicate: 0, unchanged: 0, skipped: 0 };
  const registered = new Set(snapshot.nodes.map((n) => n.nodeId));
  for (const { manifest } of manifests) {
    if (!registered.has(manifest.systemNodeId) || !registered.has(manifest.fabricNodeId)) {
      outcomes.skipped += 1;
      log(`skipped   register_fabric_sync ${manifest.syncId} (${!registered.has(manifest.systemNodeId) ? manifest.systemNodeId : manifest.fabricNodeId} is not registered)`);
      continue;
    }
    const current = (snapshot.fabric?.syncs ?? []).find((s) => s.syncId === manifest.syncId);
    if (current && JSON.stringify(syncShape(current)) === JSON.stringify(canonicalize(manifest))) {
      outcomes.unchanged += 1;
      log(`unchanged register_fabric_sync ${manifest.syncId}`);
      continue;
    }
    const result = await plane.command({
      requestId: `fabric:${manifest.syncId}:${contentDigest(manifest)}`,
      actorId,
      submittedAt: now(),
      expectedRevision: snapshot.revision,
      action: 'register_fabric_sync',
      manifest,
    });
    snapshot = result.snapshot;
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    log(`${result.outcome.padEnd(9)} register_fabric_sync ${manifest.syncId} as ${manifest.authority}`);
  }
  return { ...outcomes, revision: snapshot.revision, syncs: snapshot.fabric?.syncs?.length ?? 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const journal = opt('--journal');
  if (!journal || opt('--url')) {
    console.error('usage: node ecosystem/fabric.mjs --journal <path> [--actor <actorId>]');
    console.error('Binding a system to the fabric is operator-local: there is no --url, and the plane refuses register_fabric_sync over every plane.');
    process.exit(2);
  }
  const { ControlPlane } = await import('../control-plane/src/control-plane.js');
  const plane = await ControlPlane.fromEnvironment(path.resolve(journal));
  const result = await registerFabricSyncs(plane, await loadManifests(), { actorId: opt('--actor') ?? 'operator:host', log: (line) => console.log(line) });
  console.log(`fabric: ${result.syncs} syncs registered: appended=${result.appended} unchanged=${result.unchanged} duplicate=${result.duplicate} skipped=${result.skipped}; revision=${result.revision}`);
}
