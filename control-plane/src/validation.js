import { invalid } from './errors.js';
import { assertNoWeaponisedText, parseSignals } from './security/evidence.js';
import { assertBoundedStructure, assertNoPollutedKeys, safeText } from './security/text.js';
import { CAPABILITY_MATURITY_SET } from './governance/maturity.js';
import { SIGNATURE } from './security/attestation.js';
import { INFORMATION_CLASSES, nodeUri, parseUri, tryUri } from './identity/uri.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,179}$/;
const HASH = /^[a-f0-9]{64}$/;
const METADATA_KEY = /^[a-z][a-z0-9_.-]{0,80}$/;
const SENSITIVE_METADATA_KEY = /(token|secret|password|credential|authorization|cookie|email|phone|contact)/i;

/**
 * ISO-8601 with an explicit offset. `Date.parse` accepts far more than this —
 * RFC 2822, bare years, implementation-defined shapes — and two callers disagreeing
 * about what "2026-09-03" means is a correctness defect in a ledger whose ordering
 * and freshness checks depend on time.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const NODE_KINDS = new Set(['api', 'world_model', 'information_library', 'reasoning_engine', 'visual_dock', 'operator_surface']);
const CAPABILITY_MODES = new Set(['observe', 'propose', 'execute']);
const APPROVALS = new Set(['automatic', 'operator']);
const RELATIONS = new Set(['supplies_context_to', 'coordinates', 'visualizes', 'governs', 'depends_on']);
// `critical` sits between degraded and offline: the node answers, and what it answers
// says it must not be relied on. The plane this one was merged with recorded it, and a
// probe that can only say "degraded" for a service reporting a failed dependency is
// rounding a verdict down.
const HEALTH = new Set(['unknown', 'healthy', 'degraded', 'critical', 'offline']);
const OBSERVATION_SOURCES = new Set(['operator', 'health_check', 'webhook']);
const ATTESTATION_METHODS = new Set(['automated_scan', 'operator_review', 'external_audit', 'self_declared']);

const MAX_METADATA_KEYS = 40;

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${path} must be an object.`);
  return value;
}

function exactKeys(value, path, required, optional = []) {
  const object = record(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw invalid(`${path}.${key} is not part of the control-plane contract.`);
  }
  for (const key of required) {
    if (!(key in object)) throw invalid(`${path}.${key} is required.`);
  }
  return object;
}

/**
 * Every string that reaches the journal passes through `safeText` first: no control
 * characters, no bidirectional overrides, no invisible formatting, no credential
 * shapes. A ledger read by humans in terminals and by agents in prompts must not
 * carry text that renders as something other than what was stored.
 */
function string(value, path, maximum = 1_200) {
  if (typeof value !== 'string') throw invalid(`${path} must be a non-empty string no longer than ${maximum} characters.`);
  const safe = safeText(value, path);
  const trimmed = safe.trim();
  if (!trimmed || trimmed.length > maximum) throw invalid(`${path} must be a non-empty string no longer than ${maximum} characters.`);
  assertNoWeaponisedText(trimmed, path);
  return trimmed;
}

function identifier(value, path) {
  const parsed = string(value, path, 180);
  if (!IDENTIFIER.test(parsed)) throw invalid(`${path} must use letters, numbers, colon, underscore, period, slash, or hyphen.`);
  return parsed;
}

function instant(value, path) {
  const parsed = string(value, path, 80);
  if (!ISO_INSTANT.test(parsed) || !Number.isFinite(Date.parse(parsed))) {
    throw invalid(`${path} must be an ISO date-time.`, 'Use an ISO-8601 instant with an explicit offset, for example 2026-09-03T12:00:00.000Z.');
  }
  return parsed;
}

function member(value, path, allowed) {
  const parsed = string(value, path, 80);
  if (!allowed.has(parsed)) throw invalid(`${path} is not an allowed value.`);
  return parsed;
}

function nullableRevision(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !HASH.test(value)) throw invalid('expectedRevision must be null or a 64-character SHA-256 revision.');
  return value;
}

function metadata(value) {
  const parsed = value === undefined ? {} : record(value, 'node.metadata');
  const keys = Object.keys(parsed);
  if (keys.length > MAX_METADATA_KEYS) throw invalid(`node.metadata may not carry more than ${MAX_METADATA_KEYS} keys.`);
  const out = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (!METADATA_KEY.test(key)) throw invalid(`node.metadata.${key} is not a valid metadata key.`);
    if (SENSITIVE_METADATA_KEY.test(key)) throw invalid(`node.metadata.${key} is prohibited; credentials and contact data never enter the control plane.`);
    if (!['string', 'number', 'boolean'].includes(typeof entry) || (typeof entry === 'number' && !Number.isFinite(entry))) {
      throw invalid(`node.metadata.${key} must be a string, finite number, or boolean.`);
    }
    if (typeof entry === 'string' && entry.length > 500) throw invalid(`node.metadata.${key} exceeds 500 characters.`);
    // Key-name filtering alone does not stop a credential pasted into a value.
    out[key] = typeof entry === 'string' ? assertNoWeaponisedText(safeText(entry, `node.metadata.${key}`).trim(), `node.metadata.${key}`) : entry;
  }
  return out;
}

function location(value) {
  if (value === undefined || value === null) return null;
  const parsed = exactKeys(value, 'node.location', ['longitude', 'latitude']);
  if (typeof parsed.longitude !== 'number' || !Number.isFinite(parsed.longitude) || parsed.longitude < -180 || parsed.longitude > 180) throw invalid('node.location.longitude must be a longitude from -180 through 180.');
  if (typeof parsed.latitude !== 'number' || !Number.isFinite(parsed.latitude) || parsed.latitude < -90 || parsed.latitude > 90) throw invalid('node.location.latitude must be a latitude from -90 through 90.');
  return { longitude: parsed.longitude, latitude: parsed.latitude };
}

function capability(value, index) {
  const path = `node.capabilities[${index}]`;
  const parsed = exactKeys(value, path, ['capabilityId', 'label', 'description', 'mode', 'approval'], ['maturity', 'methodologyVersion']);
  const mode = member(parsed.mode, `${path}.mode`, CAPABILITY_MODES);
  const approval = member(parsed.approval, `${path}.approval`, APPROVALS);
  if (mode === 'execute' && approval !== 'operator') throw invalid(`${path}.approval must be "operator" for an execute capability.`);
  const out = {
    capabilityId: identifier(parsed.capabilityId, `${path}.capabilityId`),
    label: string(parsed.label, `${path}.label`, 120),
    description: string(parsed.description, `${path}.description`, 600),
    mode,
    approval,
  };
  // Maturity is declared, never defaulted. The plane this one was merged with normalised
  // an absent maturity to `research`; a plane that knows no estate cannot write a maturity
  // onto code it has never seen, so absent stays absent and the dock says "undeclared".
  if (parsed.maturity !== undefined) out.maturity = member(parsed.maturity, `${path}.maturity`, CAPABILITY_MATURITY_SET);
  if (parsed.methodologyVersion !== undefined) out.methodologyVersion = string(parsed.methodologyVersion, `${path}.methodologyVersion`, 80);
  return out;
}

function node(value) {
  const parsed = exactKeys(value, 'node', ['nodeId', 'name', 'kind', 'description', 'capabilities'], ['metadata', 'location']);
  if (!Array.isArray(parsed.capabilities) || parsed.capabilities.length < 1 || parsed.capabilities.length > 100) throw invalid('node.capabilities must contain between one and 100 capabilities.');
  const capabilities = parsed.capabilities.map(capability);
  const known = new Set();
  for (const entry of capabilities) {
    if (known.has(entry.capabilityId)) throw invalid(`node.capabilities contains duplicate capability id ${entry.capabilityId}.`);
    known.add(entry.capabilityId);
  }
  return {
    nodeId: identifier(parsed.nodeId, 'node.nodeId'),
    name: string(parsed.name, 'node.name', 160),
    kind: member(parsed.kind, 'node.kind', NODE_KINDS),
    description: string(parsed.description, 'node.description', 1_200),
    capabilities,
    metadata: metadata(parsed.metadata),
    location: location(parsed.location),
  };
}

/**
 * The fabric sync manifest: how one system's data participates in the canonical fabric
 * (docs/SUBSTRATE.md, docs/PLATFORM.md). It records which node, under which authority,
 * carrying which identity classes in which physical representations — never a provider
 * URL, a record, a document, a credential or an object byte. The plane this one was
 * merged with defined the shape; the identity grammar and the closed lists are this
 * plane's own.
 */
export const FABRIC_SYNC_SCHEMA = 'notations.fabric-sync-manifest.v1';
export const FABRIC_MODES = Object.freeze(['append_only', 'snapshot', 'event_stream']);
export const FABRIC_AUTHORITIES = Object.freeze(['evidence_source', 'canonical_state', 'projection', 'derived_compute']);
export const FABRIC_REPRESENTATIONS = Object.freeze(['object', 'graph', 'spatial', 'vector', 'sql', 'rdf', 'lakehouse', 'compute']);

function closedList(value, path, allowed, noun) {
  if (!Array.isArray(value) || !value.length || value.length > allowed.length) throw invalid(`${path} must name between one and ${allowed.length} ${noun}s.`);
  const out = value.map((entry, index) => {
    if (typeof entry !== 'string' || !allowed.includes(entry)) throw invalid(`${path}[${index}] is not a ${noun}.`, `Use one of: ${allowed.join(', ')}.`);
    return entry;
  });
  if (new Set(out).size !== out.length) throw invalid(`${path} must not repeat a ${noun}.`);
  return out;
}

function fabricManifest(value) {
  const parsed = exactKeys(value, 'manifest', ['schema', 'syncId', 'systemNodeId', 'systemIdentity', 'fabricNodeId', 'mode', 'authority', 'identityKinds', 'representations', 'provenanceRequired', 'knownAtRequired']);
  if (parsed.schema !== FABRIC_SYNC_SCHEMA) throw invalid(`manifest.schema must be ${FABRIC_SYNC_SCHEMA}.`);
  const systemNodeId = identifier(parsed.systemNodeId, 'manifest.systemNodeId');
  let identity;
  try {
    identity = parseUri(string(parsed.systemIdentity, 'manifest.systemIdentity', 512));
  } catch (error) {
    throw invalid(`manifest.systemIdentity is not a notation:// identity: ${error.detail ?? error.message}`);
  }
  // One system, one spelling. The plane already names every node in the identity space;
  // a manifest that spelled the same node differently would give it a second identity,
  // which is the thing the typed space exists to prevent.
  if (identity.uri !== tryUri(nodeUri, systemNodeId)) {
    throw invalid(`manifest.systemIdentity must be the plane's own name for ${systemNodeId}: ${tryUri(nodeUri, systemNodeId) ?? 'an id this grammar cannot name'}.`);
  }
  if (parsed.provenanceRequired !== true || parsed.knownAtRequired !== true) {
    throw invalid(
      'Every fabric sync requires provenance and knownAt; a system manifest cannot relax either.',
      'Set provenanceRequired and knownAtRequired to true. A sync that carried values without their source or their knowledge time would be the fabric copying a corpus without its provenance (COR-003, COR-004).',
    );
  }
  return {
    schema: FABRIC_SYNC_SCHEMA,
    syncId: identifier(parsed.syncId, 'manifest.syncId'),
    systemNodeId,
    systemIdentity: identity.uri,
    fabricNodeId: identifier(parsed.fabricNodeId, 'manifest.fabricNodeId'),
    mode: member(parsed.mode, 'manifest.mode', new Set(FABRIC_MODES)),
    authority: member(parsed.authority, 'manifest.authority', new Set(FABRIC_AUTHORITIES)),
    identityKinds: closedList(parsed.identityKinds, 'manifest.identityKinds', INFORMATION_CLASSES, 'information identity class'),
    representations: closedList(parsed.representations, 'manifest.representations', FABRIC_REPRESENTATIONS, 'physical representation'),
    provenanceRequired: true,
    knownAtRequired: true,
  };
}

function base(input, action, fields, optional = []) {
  const parsed = exactKeys(input, 'command', ['requestId', 'actorId', 'submittedAt', 'expectedRevision', 'action', ...fields], optional);
  if (parsed.action !== action) throw invalid(`command.action must be ${action}.`);
  return {
    requestId: identifier(parsed.requestId, 'requestId'),
    actorId: identifier(parsed.actorId, 'actorId'),
    submittedAt: instant(parsed.submittedAt, 'submittedAt'),
    expectedRevision: nullableRevision(parsed.expectedRevision),
    action,
    raw: parsed,
  };
}

/**
 * Every action `parseCommand` will parse.
 *
 * Declared here rather than inferred from the switch, so a second list — the policy
 * table's `ACTION_PERMISSIONS` — can be compared against it. An action this parser
 * accepts and the permission table does not map is an action nobody has to hold anything
 * to invoke, and until something compared the two, nothing would have noticed.
 */
export const SUPPORTED_ACTIONS = Object.freeze([
  'register_node',
  'declare_relation',
  'record_observation',
  'record_security_posture',
  'request_capability',
  'resolve_coordination',
  'register_fabric_sync',
]);

export function parseCommand(input) {
  const top = record(input, 'command');
  // Bound the shape before anything recurses over it. The command digest
  // canonicalizes the caller's own object, so an unbounded nesting depth here is a
  // stack-exhaustion vector reachable from any authenticated caller.
  assertBoundedStructure(top, { path: 'command' });
  assertNoPollutedKeys(top, 'command');
  const action = top.action;
  if (typeof action !== 'string') throw invalid('command.action is required.');

  switch (action) {
    case 'register_node': {
      const parsed = base(top, action, ['node']);
      return { ...parsed, node: node(parsed.raw.node) };
    }
    case 'declare_relation': {
      const parsed = base(top, action, ['relationId', 'sourceNodeId', 'targetNodeId', 'kind', 'description']);
      return { ...parsed, relationId: identifier(parsed.raw.relationId, 'relationId'), sourceNodeId: identifier(parsed.raw.sourceNodeId, 'sourceNodeId'), targetNodeId: identifier(parsed.raw.targetNodeId, 'targetNodeId'), kind: member(parsed.raw.kind, 'kind', RELATIONS), description: string(parsed.raw.description, 'description', 600) };
    }
    case 'record_observation': {
      const parsed = base(top, action, ['nodeId', 'health', 'observedAt', 'source', 'detail']);
      return { ...parsed, nodeId: identifier(parsed.raw.nodeId, 'nodeId'), health: member(parsed.raw.health, 'health', HEALTH), observedAt: instant(parsed.raw.observedAt, 'observedAt'), source: member(parsed.raw.source, 'source', OBSERVATION_SOURCES), detail: string(parsed.raw.detail, 'detail', 600) };
    }
    case 'record_security_posture': {
      const parsed = base(top, action, ['nodeId', 'attestedAt', 'method', 'signals'], ['signerId', 'signature']);
      const out = {
        ...parsed,
        nodeId: identifier(parsed.raw.nodeId, 'nodeId'),
        attestedAt: instant(parsed.raw.attestedAt, 'attestedAt'),
        method: member(parsed.raw.method, 'method', ATTESTATION_METHODS),
        signals: parseSignals(parsed.raw.signals),
      };
      // An independent signature names its signer, and a signer without a signature is a
      // claim — so the two are declared together or not at all. The signature itself is
      // checked by shape here and by the key in the plane; it does not pass through
      // `string()`, whose credential-shape heuristic cannot tell 86 characters of public
      // signature from 86 characters of secret, and a signature is not a secret.
      const signed = parsed.raw.signerId !== undefined || parsed.raw.signature !== undefined;
      if (signed) {
        if (parsed.raw.signerId === undefined || parsed.raw.signature === undefined) throw invalid('signerId and signature are declared together: a signature names its signer, and a signer without a signature is a claim.');
        out.signerId = identifier(parsed.raw.signerId, 'signerId');
        if (typeof parsed.raw.signature !== 'string' || !SIGNATURE.test(parsed.raw.signature)) throw invalid('signature must be a base64url Ed25519 signature: 86 characters, no padding.');
        out.signature = parsed.raw.signature;
      }
      return out;
    }
    case 'request_capability': {
      const parsed = base(top, action, ['coordinationId', 'requesterNodeId', 'targetNodeId', 'capabilityId', 'requestedMode', 'purpose']);
      return { ...parsed, coordinationId: identifier(parsed.raw.coordinationId, 'coordinationId'), requesterNodeId: identifier(parsed.raw.requesterNodeId, 'requesterNodeId'), targetNodeId: identifier(parsed.raw.targetNodeId, 'targetNodeId'), capabilityId: identifier(parsed.raw.capabilityId, 'capabilityId'), requestedMode: member(parsed.raw.requestedMode, 'requestedMode', CAPABILITY_MODES), purpose: string(parsed.raw.purpose, 'purpose', 1_200) };
    }
    case 'resolve_coordination': {
      const parsed = base(top, action, ['coordinationId', 'decision', 'note']);
      const decision = string(parsed.raw.decision, 'decision', 20);
      if (decision !== 'approved' && decision !== 'rejected') throw invalid('decision must be approved or rejected.');
      return { ...parsed, coordinationId: identifier(parsed.raw.coordinationId, 'coordinationId'), decision, note: string(parsed.raw.note, 'note', 1_200) };
    }
    case 'register_fabric_sync': {
      const parsed = base(top, action, ['manifest']);
      return { ...parsed, manifest: fabricManifest(parsed.raw.manifest) };
    }
    default:
      throw invalid(`command.action ${action} is not supported.`);
  }
}
