import { resolve } from 'node:path';
import { ControlPlane } from '../src/control-plane.js';
import { payloadTerminalProfile } from '../src/profiles/payload-terminal.js';
import { securityConstellationProfile } from '../src/profiles/security-constellation.js';

const profiles = {
  'payload-terminal': payloadTerminalProfile,
  'security-constellation': securityConstellationProfile,
};
const profileId = process.argv[2];
const makeProfile = profiles[profileId];
if (!makeProfile) {
  console.error('Usage: node scripts/apply-internal-profile.js <payload-terminal|security-constellation>');
  process.exit(64);
}
const actorId = process.env.NOTATIONS_INTERNAL_ACTOR?.trim();
if (!actorId) {
  console.error('NOTATIONS_INTERNAL_ACTOR is required for internal control-plane operations.');
  process.exit(64);
}
const journalPath = resolve(process.cwd(), process.env.CONTROL_PLANE_JOURNAL_PATH || 'data/control-plane.jsonl');
const plane = ControlPlane.fromPath(journalPath);
const snapshot = await plane.snapshot();
const result = await plane.applyProfile({
  requestId: `internal-profile:${profileId}:${new Date().toISOString()}`,
  actorId,
  submittedAt: new Date().toISOString(),
  expectedRevision: snapshot.revision,
}, makeProfile());
console.log(JSON.stringify(result, null, 2));
