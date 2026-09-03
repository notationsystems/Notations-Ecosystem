import { invalid } from './errors.js';
import { CANONICAL_KINDS, parseCanonicalURI } from './identity/canonical-uri.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,179}$/;
const HASH = /^[a-f0-9]{64}$/;
const METADATA_KEY = /^[a-z][a-z0-9_.-]{0,80}$/;
const SENSITIVE_METADATA_KEY = /(token|secret|password|credential|authorization|cookie|email|phone|contact)/i;

const NODE_KINDS = new Set(['api', 'world_model', 'information_library', 'reasoning_engine', 'visual_dock', 'operator_surface']);
const CAPABILITY_MODES = new Set(['observe', 'propose', 'execute']);
const APPROVALS = new Set(['automatic', 'operator']);
const RELATIONS = new Set(['supplies_context_to', 'coordinates', 'visualizes', 'governs', 'depends_on']);
const HEALTH = new Set(['unknown', 'healthy', 'degraded', 'critical', 'offline']);
const OBSERVATION_SOURCES = new Set(['operator', 'health_check', 'webhook']);
const SECURITY_CATEGORIES = new Set(['identity', 'cryptography', 'exposure', 'supply_chain', 'resilience', 'control_plane_integrity']);
const SECURITY_STATUSES = new Set(['healthy', 'degraded', 'critical', 'unknown']);
const BASE64URL = /^[A-Za-z0-9_-]+$/;

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

function string(value, path, maximum = 1_200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw invalid(`${path} must be a non-empty string no longer than ${maximum} characters.`);
  return value.trim();
}

function identifier(value, path) {
  const parsed = string(value, path, 180);
  if (!IDENTIFIER.test(parsed)) throw invalid(`${path} must use letters, numbers, colon, underscore, period, slash, or hyphen.`);
  return parsed;
}

function instant(value, path) {
  const parsed = string(value, path, 80);
  if (!Number.isFinite(Date.parse(parsed))) throw invalid(`${path} must be an ISO date-time.`);
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
  const out = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (!METADATA_KEY.test(key)) throw invalid(`node.metadata.${key} is not a valid metadata key.`);
    if (SENSITIVE_METADATA_KEY.test(key)) throw invalid(`node.metadata.${key} is prohibited; credentials and contact data never enter the control plane.`);
    if (!['string', 'number', 'boolean'].includes(typeof entry) || (typeof entry === 'number' && !Number.isFinite(entry))) {
      throw invalid(`node.metadata.${key} must be a string, finite number, or boolean.`);
    }
    if (typeof entry === 'string' && entry.length > 500) throw invalid(`node.metadata.${key} exceeds 500 characters.`);
    out[key] = typeof entry === 'string' ? entry.trim() : entry;
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
  const parsed = exactKeys(value, path, ['capabilityId', 'label', 'description', 'mode', 'approval']);
  const mode = member(parsed.mode, `${path}.mode`, CAPABILITY_MODES);
  const approval = member(parsed.approval, `${path}.approval`, APPROVALS);
  if (mode === 'execute' && approval !== 'operator') throw invalid(`${path}.approval must be "operator" for an execute capability.`);
  return {
    capabilityId: identifier(parsed.capabilityId, `${path}.capabilityId`),
    label: string(parsed.label, `${path}.label`, 120),
    description: string(parsed.description, `${path}.description`, 600),
    mode,
    approval,
  };
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

function base(input, action, fields) {
  const parsed = exactKeys(input, 'command', ['requestId', 'actorId', 'submittedAt', 'expectedRevision', 'action', ...fields]);
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

export function parseCommand(input) {
  const top = record(input, 'command');
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
    default:
      throw invalid(`command.action ${action} is not supported.`);
  }
}

/** The small, shared envelope used to apply a versioned built-in ecosystem profile. */
export function parseProfileApplication(input) {
  const parsed = exactKeys(input, 'profile application', ['requestId', 'actorId', 'submittedAt', 'expectedRevision']);
  return {
    requestId: identifier(parsed.requestId, 'requestId'),
    actorId: identifier(parsed.actorId, 'actorId'),
    submittedAt: instant(parsed.submittedAt, 'submittedAt'),
    expectedRevision: nullableRevision(parsed.expectedRevision),
    raw: parsed,
  };
}

/** A bounded, signed security posture statement—never a raw finding or secret. */
export function parseSecurityAttestation(input) {
  const parsed = exactKeys(input, 'security attestation', ['requestId', 'actorId', 'submittedAt', 'expectedRevision', 'attestation']);
  const attestation = exactKeys(parsed.attestation, 'attestation', ['attestationId', 'subjectNodeId', 'category', 'status', 'observedAt', 'expiresAt', 'summary', 'signerId', 'signature']);
  if (attestation.expiresAt !== null && attestation.expiresAt !== undefined) instant(attestation.expiresAt, 'attestation.expiresAt');
  const signature = string(attestation.signature, 'attestation.signature', 1_024);
  if (!BASE64URL.test(signature)) throw invalid('attestation.signature must be base64url-encoded Ed25519 signature data.');
  return {
    requestId: identifier(parsed.requestId, 'requestId'),
    actorId: identifier(parsed.actorId, 'actorId'),
    submittedAt: instant(parsed.submittedAt, 'submittedAt'),
    expectedRevision: nullableRevision(parsed.expectedRevision),
    raw: parsed,
    attestation: {
      attestationId: identifier(attestation.attestationId, 'attestation.attestationId'),
      subjectNodeId: identifier(attestation.subjectNodeId, 'attestation.subjectNodeId'),
      category: member(attestation.category, 'attestation.category', SECURITY_CATEGORIES),
      status: member(attestation.status, 'attestation.status', SECURITY_STATUSES),
      observedAt: instant(attestation.observedAt, 'attestation.observedAt'),
      expiresAt: attestation.expiresAt === null || attestation.expiresAt === undefined ? null : instant(attestation.expiresAt, 'attestation.expiresAt'),
      summary: string(attestation.summary, 'attestation.summary', 600),
      signerId: identifier(attestation.signerId, 'attestation.signerId'),
      signature,
    },
  };
}

/** A declared synchronization contract for one physical system and the Fabric. */
export function parseFabricSync(input) {
  const parsed = exactKeys(input, 'fabric sync', ['requestId', 'actorId', 'submittedAt', 'expectedRevision', 'manifest']);
  const manifest = exactKeys(parsed.manifest, 'manifest', ['schema', 'syncId', 'systemNodeId', 'systemIdentity', 'fabricNodeId', 'mode', 'authority', 'identityKinds', 'representations', 'provenanceRequired', 'knownAtRequired']);
  if (manifest.schema !== 'notations.fabric-sync-manifest.v1') throw invalid('manifest.schema must be notations.fabric-sync-manifest.v1.');
  let systemIdentity;
  try {
    systemIdentity = parseCanonicalURI(manifest.systemIdentity);
  } catch (error) {
    throw invalid(`manifest.systemIdentity is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (systemIdentity.kind !== 'node') throw invalid('manifest.systemIdentity must identify the synchronized system as a notation://node/... identity.');
  const modes = new Set(['append_only', 'snapshot', 'event_stream']);
  const authorities = new Set(['evidence_source', 'canonical_state', 'projection', 'derived_compute']);
  const representations = new Set(['object', 'graph', 'spatial', 'vector', 'sql', 'rdf', 'lakehouse', 'compute']);
  if (!Array.isArray(manifest.identityKinds) || !manifest.identityKinds.length || manifest.identityKinds.length > CANONICAL_KINDS.length) throw invalid('manifest.identityKinds must name one or more canonical identity kinds.');
  if (!manifest.identityKinds.every(kind => typeof kind === 'string' && CANONICAL_KINDS.includes(kind))) throw invalid('manifest.identityKinds contains an unsupported canonical identity kind.');
  if (new Set(manifest.identityKinds).size !== manifest.identityKinds.length) throw invalid('manifest.identityKinds must not contain duplicates.');
  if (!Array.isArray(manifest.representations) || !manifest.representations.length || manifest.representations.length > representations.size) throw invalid('manifest.representations must name one or more physical representations.');
  if (!manifest.representations.every(representation => typeof representation === 'string' && representations.has(representation))) throw invalid('manifest.representations contains an unsupported physical representation.');
  if (new Set(manifest.representations).size !== manifest.representations.length) throw invalid('manifest.representations must not contain duplicates.');
  if (typeof manifest.provenanceRequired !== 'boolean' || typeof manifest.knownAtRequired !== 'boolean') throw invalid('manifest provenanceRequired and knownAtRequired must be boolean.');
  if (!manifest.provenanceRequired || !manifest.knownAtRequired) throw invalid('Every Fabric sync must require provenance and knownAt; this cannot be relaxed by a system manifest.');
  return {
    requestId: identifier(parsed.requestId, 'requestId'),
    actorId: identifier(parsed.actorId, 'actorId'),
    submittedAt: instant(parsed.submittedAt, 'submittedAt'),
    expectedRevision: nullableRevision(parsed.expectedRevision),
    raw: parsed,
    manifest: {
      schema: manifest.schema,
      syncId: identifier(manifest.syncId, 'manifest.syncId'),
      systemNodeId: identifier(manifest.systemNodeId, 'manifest.systemNodeId'),
      systemIdentity: systemIdentity.uri,
      fabricNodeId: identifier(manifest.fabricNodeId, 'manifest.fabricNodeId'),
      mode: member(manifest.mode, 'manifest.mode', modes),
      authority: member(manifest.authority, 'manifest.authority', authorities),
      identityKinds: [...manifest.identityKinds],
      representations: [...manifest.representations],
      provenanceRequired: true,
      knownAtRequired: true,
    },
  };
}
