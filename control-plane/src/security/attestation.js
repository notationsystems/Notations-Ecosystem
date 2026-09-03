import { createPublicKey, verify } from 'node:crypto';
import { ControlPlaneError } from '../errors.js';
import { canonicalize } from '../journal.js';

const BASE64URL = /^[A-Za-z0-9_-]{40,100}$/;

/** The exact, signature-covered data. Signature and transport fields never sign themselves. */
export function attestationPayload(attestation) {
  const { signature, ...payload } = attestation;
  return canonicalize(payload);
}

function trustedAttesters(environment) {
  const raw = environment.NOTATIONS_SECURITY_ATTESTERS;
  if (!raw?.trim()) {
    throw new ControlPlaneError(503, 'SECURITY_ATTESTERS_NOT_CONFIGURED', 'NOTATIONS_SECURITY_ATTESTERS is not configured.', 'Configure one or more trusted Ed25519 public keys before accepting security posture statements.');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ControlPlaneError(503, 'SECURITY_ATTESTERS_NOT_CONFIGURED', 'NOTATIONS_SECURITY_ATTESTERS is not valid JSON.', 'Configure a JSON object mapping signer ids to base64url Ed25519 public keys.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ControlPlaneError(503, 'SECURITY_ATTESTERS_NOT_CONFIGURED', 'NOTATIONS_SECURITY_ATTESTERS must be a JSON object.', 'Configure a JSON object mapping signer ids to base64url Ed25519 public keys.');
  return parsed;
}

/**
 * Verify an independently produced Ed25519 signature using only public key
 * material. The Control Plane never receives the collector's private key.
 */
export function verifySecurityAttestation(attestation, environment = process.env, clock = () => new Date().toISOString()) {
  const keyValue = trustedAttesters(environment)[attestation.signerId];
  if (typeof keyValue !== 'string' || !BASE64URL.test(keyValue)) {
    throw new ControlPlaneError(403, 'SECURITY_ATTESTER_UNTRUSTED', `Signer ${attestation.signerId} is not a configured trusted security attester.`, 'Register the attester’s Ed25519 public key in NOTATIONS_SECURITY_ATTESTERS.');
  }
  let publicKey;
  try {
    publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: keyValue }, format: 'jwk' });
  } catch {
    throw new ControlPlaneError(503, 'SECURITY_ATTESTERS_NOT_CONFIGURED', `Trusted key for ${attestation.signerId} is not a valid Ed25519 public key.`, 'Correct the attester public key configuration.');
  }
  const valid = verify(null, Buffer.from(JSON.stringify(attestationPayload(attestation))), publicKey, Buffer.from(attestation.signature, 'base64url'));
  if (!valid) throw new ControlPlaneError(422, 'SECURITY_ATTESTATION_INVALID', 'The security attestation signature does not verify.', 'Discard the statement and have a trusted collector sign a new bounded posture statement.');
  return Object.freeze({ signerId: attestation.signerId, verifiedAt: clock() });
}
