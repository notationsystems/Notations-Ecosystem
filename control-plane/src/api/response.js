/**
 * API-000, at the boundary that actually answers.
 *
 * > Every API response either carries a canonical reference and a proof root, or says
 * > explicitly that it is an operational observation and states its limitations.
 *
 * The invariant is stated in `docs/API_PLANES.md` and placed per capability by
 * `ecosystem/api.mjs`. This is where it is enforced on the wire, for this plane's own
 * responses, because a rule that only the catalog checks is a rule about a description
 * rather than about a system.
 *
 * A response with neither shape is the one worth refusing. It reads as authoritative, it
 * cannot be re-derived, and nothing in it says which of the two it is — so the reader has
 * to know the system in order to know how much to trust the answer. That is exactly the
 * knowledge a stranger does not have and a machine client never has.
 *
 * The two shapes are not a spectrum:
 *
 *  - `referenced` — a read of held material at a stated point in the history that holds
 *    it. Carries the `notation://` name of what was read and the proof root it was read
 *    at, so the claim can be checked against the chain rather than believed.
 *  - `operational_observation` — one running process's account of itself at a moment.
 *    Carries when it was observed and, more importantly, what it does *not* cover.
 *
 * The limitations are the load-bearing half of the second shape. `/health` is safe to
 * serve unauthenticated precisely because it says it describes this process and not the
 * estate; without that sentence the same bytes are an oracle.
 */
import { tryUri, uri } from '../identity/uri.js';

export const REFERENCED = 'referenced';
export const OPERATIONAL_OBSERVATION = 'operational_observation';

/** The plane's own canonical name, at the revision a read was taken. */
export function planeReference(revision) {
  // A version segment the grammar cannot carry would mangle the name, and a mangled name
  // is worse than an absent one: it would let two revisions spell the same identity.
  return tryUri(uri.state, 'notationsystems', 'control-plane', revision ?? null);
}

/**
 * A response that reads held material.
 *
 * `proofRoot` is not decoration. The revision is the head of the hash-linked, signed
 * chain the fold was taken from; a caller with a replica can re-derive the same body from
 * it, which is what makes this a claim rather than an assertion.
 */
export function referenced(body, { revision, integrity = null, records = null, cursor = null } = {}) {
  return {
    ...body,
    apiResponse: REFERENCED,
    reference: planeReference(revision),
    proofRoot: {
      revision: revision ?? null,
      ...(cursor === null ? {} : { eventCursor: cursor }),
      ...(records === null ? {} : { records }),
      // What kind of root this is. An unsigned chain is still hash-linked and still a
      // root; saying which keeps "verified" from covering both.
      chain: 'hash-linked',
      signing: integrity?.signing ?? 'unknown',
      rollbackAnchor: integrity?.rollbackAnchor ?? false,
    },
  };
}

/**
 * A response that observes a running process.
 *
 * `limitations` is required and may not be empty, because it is the whole point: an
 * observation without its limits is indistinguishable from a claim about the estate.
 */
export function observed(body, limitations, { observedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(limitations) || limitations.length === 0) {
    throw new TypeError('An operational observation must state at least one limitation.');
  }
  return {
    ...body,
    apiResponse: OPERATIONAL_OBSERVATION,
    observation: { observedAt, limitations: Object.freeze([...limitations]) },
  };
}

/**
 * Whether a body satisfies API-000, and why not when it does not.
 *
 * Exported so the server can assert it on the way out and a test can assert it over every
 * route: a check that lives only in the tests describes the tests.
 */
export function checkApiZero(body) {
  if (!body || typeof body !== 'object') return 'a response body must be an object';
  const kind = body.apiResponse;
  if (kind === REFERENCED) {
    if (!('reference' in body)) return 'a referenced response must carry a canonical reference';
    if (!body.proofRoot || typeof body.proofRoot !== 'object') return 'a referenced response must carry a proof root';
    if (!('revision' in body.proofRoot)) return 'a proof root must name the revision it was read at';
    return null;
  }
  if (kind === OPERATIONAL_OBSERVATION) {
    if (!body.observation || typeof body.observation !== 'object') return 'an operational observation must carry an observation block';
    if (!body.observation.observedAt) return 'an operational observation must say when it was observed';
    if (!Array.isArray(body.observation.limitations) || !body.observation.limitations.length) {
      return 'an operational observation must state what it does not cover';
    }
    return null;
  }
  return `a response must declare apiResponse as "${REFERENCED}" or "${OPERATIONAL_OBSERVATION}"; this one declares ${JSON.stringify(kind)}`;
}

/**
 * What the plane says about itself when it refuses.
 *
 * A refusal is already a typed answer — code, detail, remedy — and it makes no claim
 * about canonical state. Under API-000 that makes it an observation, and the limitation
 * worth stating is the one a caller most often gets wrong: a refusal describes what this
 * process did with this request, not what the estate holds.
 */
export const REFUSAL_LIMITATIONS = Object.freeze([
  'A refusal by this process at this moment; it makes no claim about canonical state.',
  'Nothing was written. A refused command leaves no record beyond the security log.',
]);

/** Liveness, and the two things an unauthenticated caller must not read into it. */
export const LIVENESS_LIMITATIONS = Object.freeze([
  'Reports this process only, not the estate: no node named in the catalog is contacted to answer.',
  'Says nothing about held state — not the revision, not the record count, not journal integrity. Both would be an oracle for an unauthenticated caller.',
]);

/** Security posture: this process's own configuration and counters, and their limits. */
export const SECURITY_STATUS_LIMITATIONS = Object.freeze([
  'Describes this process — its configuration, its journal handle and its counters — not the estate\'s security posture.',
  'Counters and the recent-event window are in memory and reset when the process restarts.',
  'Carries states, coverage and counts only. No advisory identifier, package version, address or evidence path crosses this boundary.',
]);
