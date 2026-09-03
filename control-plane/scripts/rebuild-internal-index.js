#!/usr/bin/env node
/**
 * Rebuild the operational index from the journal and write it beside the journal.
 *
 *   node scripts/rebuild-internal-index.js [--journal data/control-plane.jsonl] [--out <path>]
 *
 * The index is a projection (docs/PLATFORM.md §5): discard it and rebuild it, never
 * reconcile it. The plane is opened the way the server opens it — signed reading, the
 * key store beside the journal — so an index built here is built over a verified history.
 * The journal is opened read-only; nothing here appends.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ControlPlane } from '../src/control-plane.js';
import { buildOperationalIndex } from '../src/indexing/operational-index.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const journalPath = resolve(option('journal', process.env.CONTROL_PLANE_JOURNAL_PATH || 'data/control-plane.jsonl'));
const indexPath = resolve(option('out', join(dirname(journalPath), 'control-plane-index.json')));

const plane = await ControlPlane.fromEnvironment(journalPath);
const index = buildOperationalIndex(await plane.snapshot());
await mkdir(dirname(indexPath), { recursive: true });
// Written whole or not at all: a reader never sees half an index.
const temporary = `${indexPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(index)}\n`, 'utf8');
await rename(temporary, indexPath);
console.log(JSON.stringify({
  indexPath,
  sourceRevision: index.sourceRevision,
  nodes: index.nodes.length,
  capabilities: index.capabilities.length,
  signals: Object.fromEntries(Object.entries(index.signals).map(([signal, ids]) => [signal, ids.length])),
}, null, 2));
