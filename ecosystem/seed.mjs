#!/usr/bin/env node
// Seed the control plane with the ecosystem catalog.
//
//   node ecosystem/seed.mjs --journal control-plane/data/control-plane.jsonl   # in-process, no server needed
//   node ecosystem/seed.mjs --url http://127.0.0.1:8787 --token "$NOTATIONS_CONTROL_PLANE_TOKEN"
//
// Every node becomes one register_node command and every relation one declare_relation
// command, each submitted with the current revision. The journal identifies an event by
// digest(actorId, requestId) and refuses the same id with different content, so the seed
// compares each catalog entry with the snapshot first: unchanged entries are not submitted
// at all, and changed ones use a request id that carries a digest of their content
// (register:<nodeId>:<digest>). Re-running the seed is therefore safe and quiet.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../control-plane/src/journal.js';
import { checkEntry, loadCatalog, toNode, toRegisterCommand, toRelationCommands } from './validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Validate every entry with the control plane's parser. Returns { valid, invalid: [{ file, errors }] }. */
export function partitionValid(entries) {
  const known = new Set(entries.map((e) => e.entry.nodeId));
  const valid = [];
  const invalid = [];
  for (const e of entries) {
    const { errors } = checkEntry(e.entry, e.file, known);
    if (errors.length) invalid.push({ file: e.file, nodeId: e.entry.nodeId, errors }); else valid.push(e);
  }
  return { valid, invalid };
}

export function orderCatalog(entries) {
  // Nodes first (sorted by id), then relations, so every relation finds both ends registered.
  const nodes = [...entries].sort((a, b) => a.entry.nodeId.localeCompare(b.entry.nodeId));
  const known = new Set(nodes.map((e) => e.entry.nodeId));
  const relations = nodes.flatMap(({ entry }) => (entry.relations ?? []).filter((r) => known.has(r.targetNodeId)).map((r) => ({ entry, relation: r })));
  const skipped = nodes.flatMap(({ entry }) => (entry.relations ?? []).filter((r) => !known.has(r.targetNodeId)).map((r) => r.relationId));
  return { nodes, relations, skipped };
}

export function contentDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex').slice(0, 16);
}

/** The registered node as the control plane would store it, minus derived fields, for change detection. */
export function registeredShape(node) {
  const { registeredAt, updatedAt, health, lastObservedAt, lastObservation, ...rest } = node;
  return canonicalize(rest);
}

/** Drive any object with `snapshot()` and `command(cmd)` (the ControlPlane class or an HTTP client). */
export async function seed(plane, entries, { actorId = 'seed:ecosystem-catalog', now = () => new Date().toISOString(), log = () => {}, skipInvalid = false } = {}) {
  const { valid, invalid } = partitionValid(entries);
  if (invalid.length && !skipInvalid) {
    const detail = invalid.map((i) => `${i.nodeId}: ${i.errors[0]}`).join('; ');
    throw new Error(`refusing to seed: ${invalid.length} catalog entr${invalid.length === 1 ? 'y is' : 'ies are'} invalid (${detail}). Run node ecosystem/validate.mjs, or pass --skip-invalid.`);
  }
  for (const i of invalid) log(`invalid   ${i.nodeId} skipped: ${i.errors[0]}`);
  const { nodes, relations, skipped } = orderCatalog(valid);
  const outcomes = { appended: 0, duplicate: 0, unchanged: 0, skipped: skipped.length, invalid: invalid.length };
  let snapshot = await plane.snapshot();
  let revision = snapshot.revision;
  const submit = async (cmd) => {
    const result = await plane.command({ ...cmd, expectedRevision: revision });
    snapshot = result.snapshot;
    revision = snapshot.revision;
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    log(`${result.outcome.padEnd(9)} ${cmd.action} ${cmd.requestId}`);
    return result;
  };
  for (const { entry } of nodes) {
    const wanted = toNode(entry);
    const current = snapshot.nodes.find((n) => n.nodeId === entry.nodeId);
    if (current && JSON.stringify(registeredShape(current)) === JSON.stringify(canonicalize(wanted))) {
      outcomes.unchanged += 1;
      log(`unchanged register_node register:${entry.nodeId}`);
      continue;
    }
    const cmd = toRegisterCommand(entry, revision, actorId, now());
    await submit({ ...cmd, requestId: `register:${entry.nodeId}:${contentDigest(wanted)}` });
  }
  for (const { entry, relation } of relations) {
    const [cmd] = toRelationCommands({ ...entry, relations: [relation] }, revision, actorId, now());
    const current = snapshot.relations.find((r) => r.relationId === relation.relationId);
    if (current && current.sourceNodeId === cmd.sourceNodeId && current.targetNodeId === cmd.targetNodeId && current.kind === cmd.kind && current.description === cmd.description) {
      outcomes.unchanged += 1;
      log(`unchanged declare_relation relation:${relation.relationId}`);
      continue;
    }
    const shape = { relationId: cmd.relationId, sourceNodeId: cmd.sourceNodeId, targetNodeId: cmd.targetNodeId, kind: cmd.kind, description: cmd.description };
    await submit({ ...cmd, requestId: `relation:${relation.relationId}:${contentDigest(shape)}` });
  }
  for (const id of skipped) log(`skipped   declare_relation relation:${id} (target not in catalog)`);
  return { ...outcomes, revision, nodes: nodes.length, relations: relations.length };
}

class HttpPlane {
  constructor(base, token) { this.base = base.replace(/\/$/, ''); this.token = token; }
  headers(json = false) { return { authorization: `Bearer ${this.token}`, accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}) }; }
  async snapshot() { const r = await fetch(`${this.base}/v1/snapshot`, { headers: this.headers() }); if (!r.ok) throw new Error(`snapshot ${r.status}: ${await r.text()}`); return r.json(); }
  async command(cmd) { const r = await fetch(`${this.base}/v1/commands`, { method: 'POST', headers: this.headers(true), body: JSON.stringify(cmd) }); if (!r.ok) throw new Error(`command ${cmd.requestId} ${r.status}: ${await r.text()}`); return r.json(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const journal = opt('--journal');
  const url = opt('--url');
  const token = opt('--token') ?? process.env.NOTATIONS_CONTROL_PLANE_TOKEN;
  let plane;
  if (journal) {
    const { ControlPlane } = await import('../control-plane/src/control-plane.js');
    plane = ControlPlane.fromPath(path.resolve(journal));
  } else if (url) {
    if (!token) { console.error('--token or NOTATIONS_CONTROL_PLANE_TOKEN is required with --url'); process.exit(2); }
    plane = new HttpPlane(url, token);
  } else {
    console.error('usage: node ecosystem/seed.mjs --journal <path> | --url <base> [--token <token>] [--skip-invalid]');
    process.exit(2);
  }
  const entries = await loadCatalog(path.join(here, 'catalog'));
  const result = await seed(plane, entries, { log: (line) => console.log(line), skipInvalid: args.includes('--skip-invalid') });
  console.log(`seeded ${result.nodes} nodes and ${result.relations} relations: appended=${result.appended} unchanged=${result.unchanged} duplicate=${result.duplicate} skipped=${result.skipped} invalid=${result.invalid}; revision=${result.revision}`);
}
