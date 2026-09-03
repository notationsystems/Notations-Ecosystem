import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ControlPlane } from '../src/control-plane.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/record-security-attestation.js <signed-attestation.json>');
  process.exit(64);
}
let supplied;
try {
  supplied = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
} catch (error) {
  console.error(`Could not read a signed attestation: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(65);
}
const journalPath = resolve(process.cwd(), process.env.CONTROL_PLANE_JOURNAL_PATH || 'data/control-plane.jsonl');
const plane = ControlPlane.fromPath(journalPath);
const snapshot = await plane.snapshot();
const result = await plane.recordSecurityAttestation({ ...supplied, expectedRevision: snapshot.revision });
console.log(JSON.stringify(result, null, 2));
