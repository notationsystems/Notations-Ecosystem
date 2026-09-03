import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ControlPlane } from '../src/control-plane.js';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: node scripts/register-fabric-sync.js <fabric-sync-manifest.json>');
  process.exit(64);
}
const actorId = process.env.NOTATIONS_INTERNAL_ACTOR?.trim();
if (!actorId) {
  console.error('NOTATIONS_INTERNAL_ACTOR is required for internal control-plane operations.');
  process.exit(64);
}
let manifest;
try {
  manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
} catch (error) {
  console.error(`Could not read a Fabric sync manifest: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(65);
}
const journalPath = resolve(process.cwd(), process.env.CONTROL_PLANE_JOURNAL_PATH || 'data/control-plane.jsonl');
const plane = ControlPlane.fromPath(journalPath);
const snapshot = await plane.snapshot();
const result = await plane.registerFabricSync({
  requestId: `internal-fabric-sync:${manifest.syncId}:${new Date().toISOString()}`,
  actorId,
  submittedAt: new Date().toISOString(),
  expectedRevision: snapshot.revision,
  manifest,
});
console.log(JSON.stringify(result, null, 2));
