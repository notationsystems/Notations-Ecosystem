import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ControlPlane } from '../../control-plane/src/control-plane.js';
import { checkEntry, loadCatalog, toNode, toRegisterCommand } from '../validate.mjs';
import { orderCatalog, partitionValid, seed } from '../seed.mjs';
import { buildSampleSnapshot } from '../sample-snapshot.mjs';

const NOW = '2026-09-03T00:00:00.000Z';

test('every catalog entry passes the control-plane validator', async () => {
  const entries = await loadCatalog();
  assert.ok(entries.length >= 9);
  const known = new Set(entries.map((e) => e.entry.nodeId));
  for (const { file, entry } of entries) {
    const { errors } = checkEntry(entry, file, known);
    assert.deepEqual(errors, [], `${path.basename(file)}: ${errors.join('; ')}`);
  }
});

test('toNode strips catalog-only fields and keeps the contract fields', async () => {
  const [{ entry }] = (await loadCatalog()).filter((e) => e.entry.nodeId === 'control-plane');
  const node = toNode(entry);
  assert.deepEqual(Object.keys(node).sort(), ['capabilities', 'description', 'kind', 'location', 'metadata', 'name', 'nodeId']);
  assert.deepEqual(Object.keys(node.capabilities[0]).sort(), ['approval', 'capabilityId', 'description', 'label', 'mode']);
  assert.equal(toRegisterCommand(entry).requestId, 'register:control-plane');
});

test('seeding a fresh journal registers nodes before relations and is idempotent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notations-seed-test-'));
  try {
    const plane = ControlPlane.fromPath(path.join(dir, 'journal.jsonl'), () => NOW);
    const entries = await loadCatalog();
    const { nodes, relations } = orderCatalog(entries);
    const first = await seed(plane, entries, { now: () => NOW });
    assert.equal(first.appended, nodes.length + relations.length);
    assert.equal(first.duplicate, 0);
    const snapshot = await plane.snapshot();
    assert.equal(snapshot.nodes.length, nodes.length);
    assert.equal(snapshot.relations.length, relations.length);
    assert.ok(snapshot.relations.every((r) => snapshot.nodes.some((n) => n.nodeId === r.sourceNodeId) && snapshot.nodes.some((n) => n.nodeId === r.targetNodeId)));
    const second = await seed(plane, entries, { now: () => NOW });
    assert.equal(second.appended, 0);
    assert.equal(second.unchanged, nodes.length + relations.length);
    assert.equal(second.revision, first.revision);
    // A revised node is re-registered under a new request id and moves the revision.
    const revised = entries.map((e) => (e.entry.nodeId === 'control-plane' ? { ...e, entry: { ...e.entry, description: `${e.entry.description} (revised)` } } : e));
    const third = await seed(plane, revised, { now: () => NOW });
    assert.equal(third.appended, 1);
    assert.equal(third.unchanged, nodes.length + relations.length - 1);
    assert.notEqual(third.revision, first.revision);
    assert.match((await plane.snapshot()).nodes.find((n) => n.nodeId === 'control-plane').description, /\(revised\)$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sample snapshot carries the control-plane schema and a sample marker', async () => {
  const snapshot = await buildSampleSnapshot(await loadCatalog());
  assert.equal(snapshot.schema, 'notations.control-plane.snapshot.v1');
  assert.equal(snapshot.sample, true);
  assert.ok(snapshot.nodes.find((n) => n.nodeId === 'control-plane').health === 'healthy');
  assert.ok(snapshot.coordination.every((c) => c.dispatch === 'not_dispatched'));
});

test('seeding refuses an invalid catalog before touching the journal, unless told to skip', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notations-seed-invalid-'));
  try {
    const plane = ControlPlane.fromPath(path.join(dir, 'journal.jsonl'), () => NOW);
    const entries = (await loadCatalog()).filter((e) => ['control-plane', 'notations-dock'].includes(e.entry.nodeId));
    const broken = { file: '/tmp/broken.json', entry: { ...entries[0].entry, nodeId: 'broken', capabilities: [{ ...entries[0].entry.capabilities[0], description: 'x'.repeat(601) }] } };
    assert.equal(partitionValid([...entries, broken]).invalid.length, 1);
    await assert.rejects(seed(plane, [...entries, broken], { now: () => NOW }), /refusing to seed/);
    assert.equal((await plane.snapshot()).nodes.length, 0);
    const result = await seed(plane, [...entries, broken], { now: () => NOW, skipInvalid: true });
    assert.equal(result.invalid, 1);
    assert.equal((await plane.snapshot()).nodes.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
