import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ControlPlane } from '../src/control-plane.js';
import { buildOperationalIndex } from '../src/indexing/operational-index.js';

const journalPath = resolve(process.cwd(), process.env.CONTROL_PLANE_JOURNAL_PATH || 'data/control-plane.jsonl');
const indexPath = resolve(process.cwd(), process.env.CONTROL_PLANE_INDEX_PATH || 'data/control-plane-index.json');
const plane = ControlPlane.fromPath(journalPath);
const index = buildOperationalIndex(await plane.snapshot());
const temporaryPath = `${indexPath}.${process.pid}.tmp`;
await mkdir(dirname(indexPath), { recursive: true });
await writeFile(temporaryPath, `${JSON.stringify(index)}\n`, 'utf8');
await rename(temporaryPath, indexPath);
console.log(JSON.stringify({ indexPath, sourceRevision: index.sourceRevision, nodeCount: index.nodes.length, capabilityCount: index.capabilities.length }, null, 2));
