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

/** The dimensions of the constellation. Unknown dimensions are refused. */
export const POSTURE_DIMENSIONS = Object.freeze({
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
      { id: 'key-file-path', pattern: /\b\S*(?:id_rsa|id_ed25519|\.pem|\.pfx|\.p12|\.jks|\.kdbx|\.env)\b/i },
    ],
  },
];

/**
 * Inspect one text field for refused material.
 * @returns {{class: string, id: string, why: string} | null}
 */
export function detectRefusedMaterial(text) {
  if (typeof text !== 'string' || !text) return null;
  const secret = detectSecretShape(text);
  if (secret) {
    return { class: 'credential-material', id: secret.id, why: 'The control plane never holds credentials or key material, in any field.' };
  }
  for (const group of REFUSED_CLASSES) {
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

  const dimension = String(parsed.dimension);
  if (!(dimension in POSTURE_DIMENSIONS)) {
    throw invalid(`${path}.dimension ${dimension} is not a constellation dimension.`, `Use one of: ${Object.keys(POSTURE_DIMENSIONS).join(', ')}.`);
  }
  const state = String(parsed.state);
  if (!POSTURE_STATES.includes(state)) throw invalid(`${path}.state must be one of ${POSTURE_STATES.join(', ')}.`);

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
    if (!EVIDENCE_REF.test(reference)) {
      throw invalid(
        `${path}.evidenceRef must be an opaque identifier such as sha256:<hex>.`,
        'A reference identifies the attestation in the system that produced it. It is deliberately not a link: the control plane must not carry a pointer to raw findings.',
      );
    }
    signal.evidenceRef = reference;
  }

  if (parsed.expiresAt !== undefined) {
    const expiresAt = String(parsed.expiresAt);
    if (!Number.isFinite(Date.parse(expiresAt))) throw invalid(`${path}.expiresAt must be an ISO date-time.`);
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
const STATE_RANK = Object.freeze({ failing: 4, weak: 3, unknown: 2, adequate: 1, strong: 0 });

export function worstState(states) {
  let worst = 'strong';
  for (const state of states) {
    if ((STATE_RANK[state] ?? 2) > (STATE_RANK[worst] ?? 0)) worst = state;
  }
  return states.length ? worst : 'unknown';
}

/**
 * Fold every node's latest attestation into the ecosystem constellation.
 *
 * Staleness is first-class: an attestation that has expired, or that predates
 * `staleAfterMs`, is reported as stale rather than quietly counted as current. An
 * out-of-date assurance is the failure mode this view exists to make visible.
 */
export function buildConstellation(postureByNode, { now = Date.now(), staleAfterMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
  const dimensions = Object.fromEntries(Object.keys(POSTURE_DIMENSIONS).map(dimension => [dimension, { dimension, description: POSTURE_DIMENSIONS[dimension], states: {}, nodes: 0, stale: 0, coverage: null, findings: { critical: 0, high: 0, medium: 0, low: 0 }, worst: 'unknown' }]));
  let attested = 0;
  let staleNodes = 0;
  const coverageAccumulator = Object.fromEntries(Object.keys(POSTURE_DIMENSIONS).map(dimension => [dimension, []]));

  for (const posture of Object.values(postureByNode)) {
    if (!posture) continue;
    attested += 1;
    const attestedAtMs = Date.parse(posture.attestedAt);
    const nodeStale = Number.isFinite(attestedAtMs) ? now - attestedAtMs > staleAfterMs : true;
    if (nodeStale) staleNodes += 1;
    for (const signal of posture.signals) {
      const bucket = dimensions[signal.dimension];
      if (!bucket) continue;
      const expired = signal.expiresAt ? Date.parse(signal.expiresAt) <= now : false;
      const stale = nodeStale || expired;
      const state = stale ? 'unknown' : signal.state;
      bucket.states[state] = (bucket.states[state] ?? 0) + 1;
      bucket.nodes += 1;
      if (stale) bucket.stale += 1;
      if (typeof signal.coverage === 'number' && !stale) coverageAccumulator[signal.dimension].push(signal.coverage);
      for (const severity of FINDING_SEVERITIES) bucket.findings[severity] += signal.findings?.[severity] ?? 0;
    }
  }

  for (const [dimension, bucket] of Object.entries(dimensions)) {
    const samples = coverageAccumulator[dimension];
    bucket.coverage = samples.length ? Math.round((samples.reduce((sum, value) => sum + value, 0) / samples.length) * 100) / 100 : null;
    bucket.worst = worstState(Object.entries(bucket.states).flatMap(([state, count]) => Array.from({ length: count }, () => state)));
  }

  return {
    schema: 'notations.control-plane.constellation.v1',
    generatedAt: new Date(now).toISOString(),
    attestedNodes: attested,
    staleNodes,
    dimensions: Object.values(dimensions),
    boundary: 'Posture is evidence only: states, coverage and counts. Credentials, key material, vulnerability detail, network topology, offensive capability and pointers to raw findings are refused at the command boundary.',
  };
}
