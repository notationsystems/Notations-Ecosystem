/**
 * Independent signatures over posture statements.
 *
 * A posture attestation submitted over the wire is already authenticated: the principal
 * held `security.attest`, and the actor it recorded is one bound to its credential. That
 * makes the statement the plane's to vouch for. An *independent* signature makes it the
 * collector's: the collector signs the statement with a key the plane never holds, the
 * plane verifies it against an allowlist of public keys, and a reader of the journal —
 * or of a replica, with no plane running — can check the signature without trusting the
 * plane at all. The constellation this plane was merged with was built on that property
 * ("never a self-authored green status"), and it is the one thing the evidence boundary
 * alone did not give.
 *
 * Public halves only. `NOTATIONS_SECURITY_ATTESTERS` maps a signer id to the base64url
 * `x` of an Ed25519 JWK. The private key stays with the collector; this module has no
 * code path that could accept one, and the plane's own signing key (which signs record
 * hashes, not statements) is a different key with a different purpose.
 */
import { createPublicKey, verify } from 'node:crypto';
import { ControlPlaneError } from '../errors.js';
import { canonicalize } from '../journal.js';
import { SIGNATURE } from '../validation.js';

/** 32 bytes of Ed25519 public key, base64url without padding. */
const PUBLIC_KEY_X = /^[A-Za-z0-9_-]{43}$/;
const SIGNER_ID = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,179}$/;

/**
 * Parse the allowlist. Null when unset — posture is then accepted on the principal's
 * authority alone, and the snapshot says so by carrying no signer. A malformed value is
 * refused at boot rather than ignored: a plane that silently dropped its attesters would
 * report every signed statement as untrusted and nothing would say why.
 *
 * @returns {Map<string, import('node:crypto').KeyObject> | null}
 */
export function parseAttesters(raw) {
  if (raw === undefined || raw === null || !String(raw).trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('NOTATIONS_SECURITY_ATTESTERS is not valid JSON; expected {"<signerId>":"<base64url Ed25519 public key x>"}.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('NOTATIONS_SECURITY_ATTESTERS must be a JSON object mapping signer ids to public keys.');
  const attesters = new Map();
  for (const [signerId, x] of Object.entries(parsed)) {
    if (!SIGNER_ID.test(signerId)) throw new Error(`NOTATIONS_SECURITY_ATTESTERS: "${signerId}" is not a valid signer id.`);
    if (typeof x !== 'string' || !PUBLIC_KEY_X.test(x)) throw new Error(`NOTATIONS_SECURITY_ATTESTERS: the key for ${signerId} is not a base64url Ed25519 public key.`);
    try {
      attesters.set(signerId, createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }));
    } catch {
      throw new Error(`NOTATIONS_SECURITY_ATTESTERS: the key for ${signerId} does not load as an Ed25519 public key.`);
    }
  }
  return attesters;
}

/**
 * The bytes a collector signs: the statement, canonicalized, with the signer named
 * inside it. The signature is not part of what it covers, and neither is anything the
 * plane adds — request id, actor, revision, receipt time — so the same statement
 * verifies wherever and whenever it is later read.
 */
export function postureStatement({ nodeId, attestedAt, method, signals, signerId }) {
  return Buffer.from(JSON.stringify(canonicalize({ nodeId, attestedAt, method, signals, signerId })));
}

/**
 * Verify one signature. Each refusal names its class, because the remedies differ: an
 * unconfigured plane needs a key, an untrusted signer needs registering, and an invalid
 * signature means the statement was altered or signed by a key other than the one it
 * names — and that one is never retried.
 */
export function verifyPostureSignature({ attesters, statement, signerId, signature, clock = () => new Date().toISOString() }) {
  if (!attesters || attesters.size === 0) {
    throw new ControlPlaneError(503, 'SECURITY_ATTESTERS_NOT_CONFIGURED', 'This plane holds no trusted attester keys, so a signed posture statement cannot be verified.', 'Configure NOTATIONS_SECURITY_ATTESTERS with the collector\'s Ed25519 public key, or submit the attestation unsigned on the principal\'s authority.');
  }
  const key = attesters.get(signerId);
  if (!key) {
    throw new ControlPlaneError(403, 'SECURITY_ATTESTER_UNTRUSTED', `Signer ${signerId} is not a configured trusted attester.`, 'Register the collector\'s Ed25519 public key in NOTATIONS_SECURITY_ATTESTERS.');
  }
  const valid = typeof signature === 'string' && SIGNATURE.test(signature) && verify(null, statement, key, Buffer.from(signature, 'base64url'));
  if (!valid) {
    throw new ControlPlaneError(422, 'SECURITY_ATTESTATION_INVALID', 'The posture statement\'s signature does not verify against the named signer\'s key.', 'Discard it. A statement that fails its own signature was altered in transit, or signed by a different key than the one it names.');
  }
  return Object.freeze({ signerId, verifiedAt: clock() });
}
