#!/usr/bin/env node
// Build a sample control-plane snapshot from the catalog by seeding a throwaway journal
// with the real ControlPlane class, then write it for the dock's offline mode.
//   node ecosystem/sample-snapshot.mjs [out=dock/public/sample-snapshot.json]
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlPlane } from '../control-plane/src/control-plane.js';
import { loadCatalog } from './validate.mjs';
import { seed } from './seed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_NOW = '2026-09-03T00:00:00.000Z';

export async function buildSampleSnapshot(entries, clock = () => SAMPLE_NOW) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notations-sample-'));
  try {
    const plane = ControlPlane.fromPath(path.join(dir, 'journal.jsonl'), clock);
    await seed(plane, entries, { now: clock });
    // A few health observations so the sample shows every health colour honestly labelled as sample data.
    const snapshot = await plane.snapshot();
    const sampleHealth = [['control-plane', 'healthy', 'health_check', 'Sample: the control plane answered /health.'], ['notations-dock', 'healthy', 'operator', 'Sample: dock rendered the snapshot.']];
    let revision = snapshot.revision;
    for (const [nodeId, health, source, detail] of sampleHealth) {
      if (!snapshot.nodes.some((n) => n.nodeId === nodeId)) continue;
      const r = await plane.command({ requestId: `sample:observe:${nodeId}`, actorId: 'sample:generator', submittedAt: clock(), expectedRevision: revision, action: 'record_observation', nodeId, health, observedAt: clock(), source, detail });
      revision = r.snapshot.revision;
    }
    const finalSnapshot = await plane.snapshot();
    return { ...finalSnapshot, sample: true, sampleNote: 'Generated from ecosystem/catalog by ecosystem/sample-snapshot.mjs. Not live control-plane state.' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? path.join(here, '../dock/public/sample-snapshot.json'));
  const entries = await loadCatalog(path.join(here, 'catalog'));
  const snapshot = await buildSampleSnapshot(entries);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`wrote ${out}: ${snapshot.nodes.length} nodes, ${snapshot.relations.length} relations, revision ${snapshot.revision}`);
}
