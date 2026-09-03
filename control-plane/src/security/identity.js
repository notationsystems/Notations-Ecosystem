/**
 * Identity: who is calling, and which actor may they claim?
 *
 * The control plane records an `actorId` on every event. Before this module that
 * field was self-asserted: any holder of the single deployment token could write
 * history as `operator:local`, `monitor:payload`, or any other identity, so the
 * journal's audit trail was unauthenticated. Here a bearer credential resolves to a
 * *principal*, and a principal may only claim the actor identities bound to it.
 *
 * Identity classes are kept distinct on purpose (SEC-010): the principal that
 * authenticates is not the actor recorded in history, is not the node being
 * described, and is not the key that signs the record.
 *
 * Credential format
 *   ncp.<keyId>.<secret>
 *
 * `secret` is a high-entropy machine credential (>= 192 bits), so verification is a
 * constant-time comparison of SHA-256 digests rather than a password KDF: a slow KDF
 * on an unauthenticated path is itself a denial-of-service surface, and buys nothing
 * against a credential that is not guessable.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ControlPlaneError } from '../errors.js';
import { isKnown } from './table.js';
import { ROLES, rolesOf } from './policy.js';

export const TOKEN_PREFIX = 'ncp';
export const MIN_SECRET_CHARACTERS = 32;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;
const SECRET = /^[A-Za-z0-9_-]{32,512}$/;
const ACTOR = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,179}$|^\*$/;
const NODE_PATTERN = /^(?:\*|[A-Za-z0-9][A-Za-z0-9:_./-]{0,179}\*?)$/;

/** A digest of the same length as a real one, for the unknown-key path. */
const DUMMY_DIGEST = createHash('sha256').update('notations.control-plane.absent-credential').digest();

export class Principal {
  constructor({ principalId, kind = 'service', roles = [], actors = [], nodes = null, legacy = false, expiresAt = null }) {
    this.principalId = principalId;
    this.kind = kind;
    this.roles = Object.freeze([...roles]);
    this.actors = Object.freeze([...actors]);
    this.nodes = nodes ? Object.freeze([...nodes]) : null;
    this.legacy = legacy;
    this.expiresAt = expiresAt;
    Object.freeze(this);
  }

  /** Every permission granted by this principal's roles. */
  get permissions() {
    return rolesOf(this.roles);
  }

  /**
   * May this principal write history as `actorId`?
   *
   * Exact match only, or the single `*` the legacy deployment token carries. The actor
   * is the audit trail, so a prefix pattern would let one credential write as a family
   * of identities — and `operator:alice*` also matches `operator:alice-evil`. Node
   * scoping below is where prefixes are useful and safe.
   */
  mayClaimActor(actorId) {
    return this.actors.some(pattern => pattern === '*' || pattern === actorId);
  }

  /**
   * May this principal submit a command naming this node? `null` means unrestricted.
   * A single trailing `*` is a prefix, so one monitor can cover `payload-*`.
   */
  mayActOnNode(nodeId) {
    if (this.nodes === null) return true;
    return this.nodes.some(pattern => (pattern === '*' ? true : pattern.endsWith('*') ? nodeId.startsWith(pattern.slice(0, -1)) : pattern === nodeId));
  }

  toJSON() {
    return { principalId: this.principalId, kind: this.kind, roles: this.roles, actors: this.actors, nodes: this.nodes, legacy: this.legacy };
  }
}

/**
 * The principal used when the ControlPlane class is driven in-process (seeding a
 * journal, tests, offline tooling). It is never reachable over HTTP: the server
 * always resolves a credential first.
 */
export const LOCAL_PRINCIPAL = new Principal({
  principalId: 'local:in-process',
  kind: 'service',
  roles: [...Object.keys(ROLES)],
  actors: ['*'],
  legacy: false,
});

function unauthorized(detail) {
  return new ControlPlaneError(401, 'CONTROL_PLANE_UNAUTHORIZED', detail, 'Authenticate with a control-plane credential issued to your principal.');
}

/** Parse `ncp.<keyId>.<secret>` without revealing which half was malformed. */
export function parseToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, keyId, secret] = parts;
  if (prefix !== TOKEN_PREFIX || !KEY_ID.test(keyId) || !SECRET.test(secret)) return null;
  return { keyId, secret };
}

export function hashSecret(secret) {
  return createHash('sha256').update(`notations.control-plane.credential.v1|${secret}`).digest();
}

/** Mint a credential. The secret is returned once and never stored in plaintext. */
export function issueCredential({ principalId, keyId = null, kind = 'service', roles = [], actors = null, nodes = null, expiresAt = null }) {
  const secret = randomBytes(32).toString('base64url');
  const resolvedKeyId = keyId ?? `k-${randomBytes(6).toString('hex')}`;
  if (!KEY_ID.test(resolvedKeyId)) throw new Error(`keyId ${resolvedKeyId} is not a valid key id.`);
  const record = {
    principalId,
    kind,
    roles: [...roles],
    actors: actors ?? [principalId],
    nodes,
    keyId: resolvedKeyId,
    secretHash: hashSecret(secret).toString('hex'),
    createdAt: new Date().toISOString(),
    expiresAt,
    disabled: false,
  };
  return { token: `${TOKEN_PREFIX}.${resolvedKeyId}.${secret}`, record };
}

/**
 * A registry of issued credentials. Holds only SHA-256 digests: a stolen registry
 * file does not yield a usable credential.
 */
export class PrincipalRegistry {
  constructor(records = [], { legacyToken = null } = {}) {
    this.byKeyId = new Map();
    this.warnings = [];
    for (const record of records) this.#add(record);
    this.legacy = null;
    if (legacyToken) this.#addLegacy(legacyToken);
  }

  #add(record) {
    const problems = validatePrincipalRecord(record);
    if (problems.length) {
      this.warnings.push(`principal ${record?.principalId ?? '<unnamed>'} ignored: ${problems.join('; ')}`);
      return;
    }
    if (this.byKeyId.has(record.keyId)) {
      this.warnings.push(`duplicate keyId ${record.keyId} ignored`);
      return;
    }
    this.byKeyId.set(record.keyId, {
      record,
      digest: Buffer.from(record.secretHash, 'hex'),
      principal: new Principal({ principalId: record.principalId, kind: record.kind, roles: record.roles, actors: record.actors, nodes: record.nodes ?? null, expiresAt: record.expiresAt ?? null }),
    });
  }

  /**
   * Backwards compatibility with a single deployment token. The resulting principal
   * holds every role and may claim any actor, so the audit trail it writes is not
   * identity-bound; the server warns once at boot and the security status route
   * reports the deployment as unbound.
   */
  #addLegacy(token) {
    this.legacy = {
      digest: hashSecret(token),
      principal: new Principal({ principalId: 'root:legacy-token', kind: 'service', roles: [...Object.keys(ROLES)], actors: ['*'], legacy: true }),
    };
  }

  get size() {
    return this.byKeyId.size + (this.legacy ? 1 : 0);
  }

  get configured() {
    return this.size > 0;
  }

  /** Every principal that could authenticate, without any secret material. */
  describe() {
    const entries = [...this.byKeyId.values()].map(({ record, principal }) => ({ ...principal.toJSON(), keyId: record.keyId, expiresAt: record.expiresAt ?? null, disabled: Boolean(record.disabled) }));
    if (this.legacy) entries.push({ ...this.legacy.principal.toJSON(), keyId: 'legacy', expiresAt: null, disabled: false });
    return entries;
  }

  /**
   * Resolve a bearer token to a principal in constant time with respect to which
   * credential was presented. Throws `CONTROL_PLANE_UNAUTHORIZED` on every failure
   * with one indistinguishable message (no enumeration oracle).
   */
  verify(token, now = new Date()) {
    if (!this.configured) {
      throw new ControlPlaneError(503, 'CONTROL_PLANE_NOT_CONFIGURED', 'The control plane is fail-closed until a credential registry or deployment token is configured.', 'Issue a credential with `npm run issue-credential`, or set NOTATIONS_CONTROL_PLANE_TOKEN for local development.');
    }
    const parsed = parseToken(token);
    if (!parsed) {
      // A non-registry token can still be the legacy deployment token.
      if (this.legacy && typeof token === 'string' && token.length > 0) {
        const supplied = hashSecret(token);
        if (timingSafeEqual(supplied, this.legacy.digest)) return this.legacy.principal;
      } else {
        timingSafeEqual(DUMMY_DIGEST, DUMMY_DIGEST);
      }
      throw unauthorized('The supplied authority is invalid.');
    }
    const entry = this.byKeyId.get(parsed.keyId);
    const supplied = hashSecret(parsed.secret);
    if (!entry) {
      timingSafeEqual(supplied, DUMMY_DIGEST);
      throw unauthorized('The supplied authority is invalid.');
    }
    const matches = timingSafeEqual(supplied, entry.digest);
    if (!matches) throw unauthorized('The supplied authority is invalid.');
    this.assertUsable(entry.record, now);
    return entry.principal;
  }
}

/**
 * Liveness of a credential, checked on every request including cache hits.
 *
 * The verification cache exists to avoid repeating a digest comparison, not to pin an
 * authorization decision. Caching "this credential is usable" would mean a disabled or
 * expired credential kept working for the cache lifetime — revocation that does not
 * revoke.
 */
PrincipalRegistry.prototype.assertUsable = function assertUsable(record, now = new Date()) {
  if (record.disabled) throw unauthorized('This credential has been disabled.');
  if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) throw unauthorized('This credential has expired.');
};

/** Re-check a cached principal against the current registry. */
PrincipalRegistry.prototype.revalidate = function revalidate(principalId, now = new Date()) {
  for (const { record, principal } of this.byKeyId.values()) {
    if (principal.principalId !== principalId) continue;
    this.assertUsable(record, now);
    return principal;
  }
  if (this.legacy && this.legacy.principal.principalId === principalId) return this.legacy.principal;
  throw unauthorized('The supplied authority is invalid.');
};

export function validatePrincipalRecord(record) {
  const problems = [];
  if (!record || typeof record !== 'object') return ['not an object'];
  if (typeof record.principalId !== 'string' || !record.principalId.trim()) problems.push('principalId is required');
  if (typeof record.keyId !== 'string' || !KEY_ID.test(record.keyId)) problems.push('keyId is invalid');
  if (typeof record.secretHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.secretHash)) problems.push('secretHash must be a sha-256 hex digest');
  if (!Array.isArray(record.roles) || !record.roles.length) problems.push('roles must be a non-empty array');
  else for (const role of record.roles) if (!isKnown(ROLES, role)) problems.push(`unknown role ${role}`);
  const actors = record.actors ?? [];
  if (!Array.isArray(actors) || !actors.length) problems.push('actors must be a non-empty array');
  else for (const actor of actors) if (typeof actor !== 'string' || !ACTOR.test(actor)) problems.push(`invalid actor pattern ${actor}`);
  if (record.nodes != null) {
    if (!Array.isArray(record.nodes)) problems.push('nodes must be an array or null');
    else for (const pattern of record.nodes) if (typeof pattern !== 'string' || !NODE_PATTERN.test(pattern)) problems.push(`invalid node pattern ${pattern}`);
  }
  if (record.expiresAt != null && !Number.isFinite(Date.parse(record.expiresAt))) problems.push('expiresAt must be an ISO date-time');
  return problems;
}

/** Load a registry file. A missing file is not an error; a malformed one is. */
export async function loadPrincipalsFile(filePath) {
  let body;
  try {
    body = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { principals: [], missing: true };
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`${filePath} is not valid JSON.`);
  }
  if (!parsed || !Array.isArray(parsed.principals)) throw new Error(`${filePath} must contain a "principals" array.`);
  return { principals: parsed.principals, missing: false };
}

/**
 * A short-lived cache of verified credentials, keyed by the digest of the presented
 * token. Bounds repeated verification work without holding the token itself.
 */
export class VerificationCache {
  constructor({ ttlMs = 30_000, max = 512 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.entries = new Map();
  }

  #key(token) {
    return createHash('sha256').update(token).digest('base64');
  }

  get(token, now = Date.now()) {
    const key = this.#key(token);
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    return hit.principal;
  }

  set(token, principal, now = Date.now()) {
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(this.#key(token), { principal, expiresAt: now + this.ttlMs });
  }

  clear() {
    this.entries.clear();
  }
}
