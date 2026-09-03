/**
 * Security posture as evidence, not as material.
 *
 * The control plane visualises a security constellation: identity posture,
 * authorization coverage, encryption and key-lifecycle state, dependency risk,
 * service exposure, audit integrity, backups, incident state, and its own integrity.
 *
 * To do that it needs to know *how healthy* each control is. It must never hold the
 * things that would let an attacker act on that knowledge. Compromising a visualiser
 * should yield a dashboard, not a map of the estate and a key ring. So a posture
 * signal carries a state, a coverage fraction, finding counts, and a short summary —
 * and this module refuses, at the boundary, the five classes of material that would
 * turn the constellation into a weapon:
 *
 *   1. credentials and key material           (a key ring)
 *   2. network topology                       (addresses, ports, internal hostnames)
 *   3. raw vulnerability detail               (which version of what is exploitable)
 *   4. offensive capability                   (payloads, tooling invocations)
 *   5. pointers to any of the above           (URLs and filesystem paths to raw findings)
 *
 * Refusal is a successful, explanatory response: the attestor learns which class it
 * tripped and re-attests with counts instead of detail. The rule is enforced here
 * rather than documented elsewhere, so a well-meaning integration cannot quietly
 * widen it.
 */

import { invalid } from '../errors.js';
import { detectSecretShape, safeText } from './text.js';
import { isKnown, lookup, sealedKeys, sealedTable } from './table.js';
import { isUri } from '../identity/uri.js';

/** The dimensions of the constellation. Unknown dimensions are refused. */
export const POSTURE_DIMENSIONS = sealedTable({
  identity: 'Authentication strength and credential hygiene',
  authorization: 'Coverage of authorization checks over privileged surfaces',
  encryption_in_transit: 'Transport protection across trust boundaries',
  encryption_at_rest: 'Protection of stored data and secrets',
  key_lifecycle: 'Key generation, protection, rotation and retirement',
  dependency_risk: 'Software and dependency risk carried by the node',
  exposure: 'Service exposure and reachable surface',
  audit_integrity: 'Auditability and tamper evidence of the node history',
  backup: 'Recoverability of the node state',
  incident: 'Current incident state',
  control_plane_integrity: 'Integrity of the control plane itself',
});

export const POSTURE_STATES = Object.freeze(['strong', 'adequate', 'weak', 'failing', 'unknown']);
export const ATTESTATION_METHODS = Object.freeze(['automated_scan', 'operator_review', 'external_audit', 'self_declared']);
export const FINDING_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low']);

export const MAX_SIGNALS_PER_ATTESTATION = 12;
export const MAX_SUMMARY_CHARACTERS = 280;
export const MAX_FINDING_COUNT = 1_000_000;

const EVIDENCE_REF = /^(?:sha256:[a-f0-9]{64}|[A-Za-z0-9][A-Za-z0-9:_.-]{0,79})$/;

/**
 * A reference may also be a Notation identity — `notation://artifact/ns/id@v`.
 *
 * The published contract has always said so; the opaque form above could not express
 * it, because it admits no `/`. Accepting the identity grammar instead of widening the
 * character class is the safer of the two repairs: `parseUri` refuses percent-encoding,
 * queries, fragments, relative segments, empty segments and any class it does not know,
 * so what gets in is a name from a closed space rather than an arbitrary string with
 * slashes in it. It remains a name and not a link: `resolve()` throws by construction,
 * so the plane still cannot dereference what it records.
 *
 * The length bound is tighter than the identity space's own 512, because this field is
 * attestor-supplied and a long free-form tail is the one thing a name should not have.
 */
const MAX_EVIDENCE_URI_LENGTH = 200;

function isEvidenceReference(value) {
  if (EVIDENCE_REF.test(value)) return true;
  return value.length <= MAX_EVIDENCE_URI_LENGTH && isUri(value);
}
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Material the constellation must never hold. Each rule names the class it defends
 * so the refusal tells an attestor what to remove, not merely that it failed.
 */
const REFUSED_CLASSES = [
  {
    class: 'network-topology',
    why: 'Addresses, ports and internal hostnames describe where to attack. The constellation reports whether exposure is controlled, never what is reachable.',
    patterns: [
      // IPv4 literals, excluding the loopback and version-like triples handled below.
      { id: 'ipv4-address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/ },
      { id: 'ipv6-address', pattern: /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i },
      { id: 'host-port', pattern: /\b(?:[a-z0-9-]+\.)+[a-z]{2,}:\d{2,5}\b/i },
      { id: 'port-claim', pattern: /\b(?:listens?|listening|bound|exposed|open)\s+on\s+(?:port\s+)?\d{1,5}\b|\bports?\s+\d{2,5}\b/i },
      { id: 'internal-hostname', pattern: /\b[a-z0-9-]+\.(?:internal|intranet|local|lan|corp|svc|cluster\.local)\b/i },
      { id: 'port-listing', pattern: /\bports?\s*[:=]?\s*\d{1,5}\s*(?:,\s*\d{1,5}\s*){1,}/i },
      { id: 'open-port-claim', pattern: /\b(?:open|listening|exposed)\s+ports?\b/i },
    ],
  },
  {
    class: 'vulnerability-detail',
    why: 'A specific exploitable version is a targeting instruction. Report counts by severity and let the remediation system hold the detail.',
    patterns: [
      // Separators vary between tools and prose; the identifier is the same instruction.
      { id: 'cve-with-status', pattern: /\bCVE[\s._-]?\d{4}[\s._-]\d{4,7}\b/i },
      { id: 'ghsa-id', pattern: /\bGHSA[\s._-]?[a-z0-9]{4}[\s._-][a-z0-9]{4}[\s._-][a-z0-9]{4}\b/i },
      { id: 'vulnerable-package-version', pattern: /\b[@a-z0-9][a-z0-9/._-]*@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?\b/ },
      { id: 'exploitability-claim', pattern: /\b(?:exploitable|remote code execution|rce|proof[- ]of[- ]concept|poc|0-?day|zero-?day)\b/i },
      { id: 'stack-trace', pattern: /\bat\s+[\w$.]+\s*\([^)]*:\d+:\d+\)/ },
    ],
  },
  {
    class: 'offensive-capability',
    why: 'The control plane records posture; it never carries the means to act on a weakness.',
    // Universal: unlike an address or a package version, none of these has a reading
    // in which it belongs in a coordination ledger, so they are refused in every
    // free-text field rather than only in a posture summary.
    universal: true,
    patterns: [
      { id: 'offensive-tooling', pattern: /\b(?:metasploit|msfvenom|sqlmap|mimikatz|cobalt\s*strike|beef|hashcat|responder\.py|impacket)\b/i },
      { id: 'scanner-invocation', pattern: /\bnmap\s+-|\bnikto\s+-|\bhydra\s+-/i },
      { id: 'reverse-shell', pattern: /\b(?:reverse|bind)\s+shell\b|\bnc\s+-[a-z]*[el][a-z]*\s/i },
      { id: 'pipe-to-shell', pattern: /\bcurl\b[^|]{0,120}\|\s*(?:ba)?sh\b/i },
      { id: 'injection-payload', pattern: /(?:'\s*or\s*'?1'?\s*=\s*'?1|<script\b|\bunion\s+select\b|\bdrop\s+table\b|\$\{jndi:)/i },
    ],
  },
  {
    class: 'pointer-to-raw-material',
    why: 'A link or path to the raw finding moves the exposure rather than removing it, and invites whatever follows the pointer to fetch it.',
    patterns: [
      { id: 'url', pattern: /\b[a-z][a-z0-9+.-]*:\/\/\S+/i },
      // A link is still a link without its scheme.
      { id: 'scheme-less-url', pattern: /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S+/i },
      // A report artifact is a pointer to findings. Source and documentation paths are
      // not: an attestor may reasonably say which module implements a control.
      { id: 'report-artifact-path', pattern: /\b[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)+\.(?:json|csv|sarif|xml|txt|log|html|htm|zip)\b/i },
      { id: 'absolute-path', pattern: /(?:^|\s)(?:\/(?:etc|root|home|var|srv|opt|proc|Users)\/|[A-Za-z]:\\)\S*/ },
    ],
  },
  {
    class: 'key-material-location',
    why: 'A path to key material is the first half of stealing it, and the ledger is read by agents and rendered in a browser. Name the control, not the file that holds the key.',
    universal: true,
    patterns: [
      { id: 'key-file-path', pattern: /\b\S*(?:id_rsa|id_ed25519|\.pem|\.pfx|\.p12|\.jks|\.kdbx|\.env)\b/i },
    ],
  },
];

/** The classes that are refused everywhere, not only inside a posture attestation. */
const UNIVERSAL_CLASSES = REFUSED_CLASSES.filter(group => group.universal);

/**
 * Inspect one text field for refused material.
 * @returns {{class: string, id: string, why: string} | null}
 */
export function detectRefusedMaterial(text, groups = REFUSED_CLASSES) {
  if (typeof text !== 'string' || !text) return null;
  if (groups === REFUSED_CLASSES) {
    const secret = detectSecretShape(text);
    if (secret) {
      return { class: 'credential-material', id: secret.id, why: 'The control plane never holds credentials or key material, in any field.' };
    }
  }
  for (const group of groups) {
    for (const rule of group.patterns) {
      if (rule.pattern.test(text)) return { class: group.class, id: rule.id, why: group.why };
    }
  }
  return null;
}

/**
 * Enforce the evidence boundary on a free-text field.
 * @param {string} value
 * @param {string} path for the refusal message
 */
export function assertEvidenceOnly(value, path) {
  const found = detectRefusedMaterial(value);
  if (!found) return value;
  throw invalid(
    `${path} contains ${found.class} (${found.id}) and is refused.`,
    `${found.why} Re-attest with a state, a coverage fraction, and counts by severity, and keep the detail in the system that produced it.`,
  );
}

/**
 * The part of the evidence boundary that is not about evidence.
 *
 * Most of what a posture summary may not carry has a legitimate reading somewhere
 * else in the ledger: a node's metadata names a repository, a capability description
 * mentions a version. Two classes have no such reading anywhere — the means to attack
 * a system, and the location of the key material that protects one — so they are
 * refused in every free-text field the plane records, not only inside an attestation.
 * Without this the boundary would be a property of one command rather than of the
 * ledger, and a node description would be the way around it.
 */
export function assertNoWeaponisedText(value, path) {
  const found = detectRefusedMaterial(value, UNIVERSAL_CLASSES);
  if (!found) return value;
  throw invalid(`${path} contains ${found.class} (${found.id}) and is refused.`, found.why);
}

function number(value, path, { min, max, integer = false }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(`${path} must be a finite number.`);
  if (integer && !Number.isInteger(value)) throw invalid(`${path} must be an integer.`);
  if (value < min || value > max) throw invalid(`${path} must be between ${min} and ${max}.`);
  return value;
}

function exactKeys(value, path, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${path} must be an object.`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw invalid(`${path}.${key} is not part of the control-plane contract.`);
  for (const key of required) if (!(key in value)) throw invalid(`${path}.${key} is required.`);
  return value;
}

/** Validate one posture signal. */
export function parseSignal(value, index) {
  const path = `signals[${index}]`;
  const parsed = exactKeys(value, path, ['dimension', 'state'], ['coverage', 'findings', 'summary', 'evidenceRef', 'expiresAt']);

  const dimension = parsed.dimension;
  if (!isKnown(POSTURE_DIMENSIONS, dimension)) {
    throw invalid(`${path}.dimension is not a constellation dimension.`, `Use one of: ${Object.keys(POSTURE_DIMENSIONS).join(', ')}.`);
  }
  const state = parsed.state;
  if (typeof state !== 'string' || !POSTURE_STATES.includes(state)) throw invalid(`${path}.state must be one of ${POSTURE_STATES.join(', ')}.`);

  const signal = { dimension, state };

  if (parsed.coverage !== undefined) signal.coverage = number(parsed.coverage, `${path}.coverage`, { min: 0, max: 1 });

  if (parsed.findings !== undefined) {
    const findings = exactKeys(parsed.findings, `${path}.findings`, [], [...FINDING_SEVERITIES]);
    const counted = {};
    for (const severity of FINDING_SEVERITIES) {
      if (findings[severity] === undefined) continue;
      counted[severity] = number(findings[severity], `${path}.findings.${severity}`, { min: 0, max: MAX_FINDING_COUNT, integer: true });
    }
    signal.findings = counted;
  }

  if (parsed.summary !== undefined) {
    const summary = safeText(parsed.summary, `${path}.summary`).trim();
    if (!summary || summary.length > MAX_SUMMARY_CHARACTERS) throw invalid(`${path}.summary must be 1 to ${MAX_SUMMARY_CHARACTERS} characters.`);
    assertEvidenceOnly(summary, `${path}.summary`);
    signal.summary = summary;
  }

  if (parsed.evidenceRef !== undefined) {
    const reference = safeText(parsed.evidenceRef, `${path}.evidenceRef`).trim();
    if (!isEvidenceReference(reference)) {
      throw invalid(
        `${path}.evidenceRef must be an opaque identifier such as sha256:<hex>, or a notation:// identity.`,
        'A reference identifies the attestation in the system that produced it. It is deliberately not a link: the control plane must not carry a pointer to raw findings.',
      );
    }
    signal.evidenceRef = reference;
  }

  if (parsed.expiresAt !== undefined) {
    const expiresAt = safeText(parsed.expiresAt, `${path}.expiresAt`).trim();
    if (!ISO_INSTANT.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt))) {
      throw invalid(`${path}.expiresAt must be an ISO date-time.`, 'Use an ISO-8601 instant with an explicit offset, for example 2026-09-03T12:00:00.000Z.');
    }
    signal.expiresAt = expiresAt;
  }

  return signal;
}

/**
 * Validate the signal array of a `record_security_posture` command.
 * @returns {Array} normalized signals, one per dimension
 */
export function parseSignals(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SIGNALS_PER_ATTESTATION) {
    throw invalid(`signals must contain between 1 and ${MAX_SIGNALS_PER_ATTESTATION} posture signals.`);
  }
  const signals = value.map(parseSignal);
  const seen = new Set();
  for (const signal of signals) {
    if (seen.has(signal.dimension)) throw invalid(`signals contains ${signal.dimension} more than once.`);
    seen.add(signal.dimension);
  }
  return signals;
}

/** A weakest-link rollup: the constellation reports the worst state, not the average. */
const STATE_RANK = sealedTable({ failing: 4, weak: 3, unknown: 2, adequate: 1, strong: 0 });

export function worstState(states) {
  let worst = 'strong';
  for (const state of states) {
    if ((lookup(STATE_RANK, state) ?? 2) > (lookup(STATE_RANK, worst) ?? 0)) worst = state;
  }
  return states.length ? worst : 'unknown';
}

/**
 * Fold every node's latest attestation into the ecosystem constellation.
 *
 * Staleness is first-class: an attestation that has expired, or that predates
 * `staleAfterMs`, is reported as stale rather than quietly counted as current. An
 * out-of-date assurance is the failure mode this view exists to make visible.
 *
 * This function reads an append-only history, so it is written to be total over
 * anything that history can contain. A projection that throws on one stored record is
 * not a bug that returns an error — the record cannot be withdrawn, so every later
 * read of the whole snapshot fails for as long as the journal exists. A signal whose
 * dimension is not one of ours is therefore counted as unrecognised and skipped,
 * rather than trusted to index a table.
 */
export function buildConstellation(postureByNode, { now = Date.now(), staleAfterMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
  const names = Object.keys(POSTURE_DIMENSIONS);
  const dimensions = sealedKeys(names, dimension => ({
    dimension,
    description: POSTURE_DIMENSIONS[dimension],
    states: Object.create(null),
    nodes: 0,
    stale: 0,
    coverage: null,
    findings: { critical: 0, high: 0, medium: 0, low: 0 },
    worst: 'unknown',
  }));
  const coverageAccumulator = sealedKeys(names, () => []);
  let attested = 0;
  let staleNodes = 0;
  let unrecognisedSignals = 0;

  for (const posture of Object.values(postureByNode ?? {})) {
    if (!posture) continue;
    attested += 1;
    const attestedAtMs = Date.parse(posture.attestedAt);
    const nodeStale = Number.isFinite(attestedAtMs) ? now - attestedAtMs > staleAfterMs : true;
    if (nodeStale) staleNodes += 1;
    for (const signal of Array.isArray(posture.signals) ? posture.signals : []) {
      const bucket = signal ? lookup(dimensions, signal.dimension) : undefined;
      if (!bucket) {
        unrecognisedSignals += 1;
        continue;
      }
      const expired = signal.expiresAt ? Date.parse(signal.expiresAt) <= now : false;
      const stale = nodeStale || expired;
      const state = stale ? 'unknown' : signal.state;
      const key = isKnown(STATE_RANK, state) ? state : 'unknown';
      bucket.states[key] = (bucket.states[key] ?? 0) + 1;
      bucket.nodes += 1;
      if (stale) bucket.stale += 1;
      if (Number.isFinite(signal.coverage) && !stale) coverageAccumulator[signal.dimension].push(signal.coverage);
      for (const severity of FINDING_SEVERITIES) {
        const count = signal.findings?.[severity];
        if (Number.isFinite(count)) bucket.findings[severity] += count;
      }
    }
  }

  for (const dimension of names) {
    const bucket = dimensions[dimension];
    const samples = coverageAccumulator[dimension];
    bucket.coverage = samples.length ? Math.round((samples.reduce((sum, value) => sum + value, 0) / samples.length) * 100) / 100 : null;
    bucket.worst = worstState(Object.entries(bucket.states).flatMap(([state, count]) => Array.from({ length: count }, () => state)));
    bucket.states = { ...bucket.states };
  }

  return {
    schema: 'notations.control-plane.constellation.v1',
    generatedAt: new Date(now).toISOString(),
    attestedNodes: attested,
    staleNodes,
    unrecognisedSignals,
    dimensions: names.map(dimension => dimensions[dimension]),
    boundary: 'Posture is evidence only: states, coverage and counts. Credentials, key material, vulnerability detail, network topology, offensive capability and pointers to raw findings are refused at the command boundary.',
  };
}
