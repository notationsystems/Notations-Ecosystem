import { parseUri } from '../identity/uri.js';

/**
 * The identity grammar is the plane's own (`identity/uri.js`): one space, eighteen
 * classes in two families, `resolve()` that throws. This adapter keeps the manifest
 * parser's vocabulary — `kind`, `authority` — while the parsing is done once, here.
 */
function parseCanonicalURI(value) {
  const parsed = parseUri(value);
  return Object.freeze({ uri: parsed.uri, kind: parsed.class, authority: parsed.namespace, localId: parsed.localId });
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,179}$/;
const HASH = /^[a-f0-9]{64}$/;
const UNCERTAINTY_KINDS = new Set(['source_disagreement', 'confidence_interval', 'prediction_interval', 'candidate_probabilities', 'support_significance', 'geometric_uncertainty', 'insufficient_evidence']);
const VERIFICATION_STATUSES = new Set(['verified', 'partially_verified', 'unverified', 'challenged']);

export const RESULT_MANIFEST_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://notations.systems/contracts/result-manifest/v1',
  title: 'Notation Result Manifest',
  description: 'The machine-readable, evidence and methodology sidecar for a human-readable corpus result.',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'manifestId', 'queryId', 'corpusBuild', 'methodology', 'knownAt', 'result', 'entitiesUsed', 'assertionsUsed', 'evidenceUsed', 'computations', 'uncertainties', 'contradictions', 'verification'],
  properties: {
    schema: { const: 'notations.result-manifest.v1' },
    manifestId: { type: 'string' },
    queryId: { type: 'string', description: 'Stable query or request identifier; query text is intentionally not required.' },
    corpusBuild: { type: 'object', required: ['buildId', 'knownAt'], properties: { buildId: { type: 'string' }, knownAt: { type: 'string', format: 'date-time' } } },
    methodology: { type: 'object', required: ['methodologyId', 'version'], properties: { methodologyId: { type: 'string' }, version: { type: 'string' } } },
    knownAt: { type: 'string', format: 'date-time' },
    result: { type: 'object', description: 'Bounded rendered-result data; raw source artifacts remain in their evidence store.' },
    entitiesUsed: { type: 'array', items: { type: 'string', pattern: '^notation://' } },
    assertionsUsed: { type: 'array', items: { type: 'string', pattern: '^notation://' } },
    evidenceUsed: { type: 'array', items: { type: 'string', pattern: '^notation://' } },
    computations: { type: 'array' },
    uncertainties: { type: 'array' },
    contradictions: { type: 'array', items: { type: 'string', pattern: '^notation://' } },
    verification: { type: 'object', required: ['status', 'checkedAt'], properties: { status: { enum: [...VERIFICATION_STATUSES] }, checkedAt: { type: 'string', format: 'date-time' } } },
  },
});

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function exactKeys(value, path, required) {
  const parsed = record(value, path);
  const allowed = new Set(required);
  for (const key of Object.keys(parsed)) if (!allowed.has(key)) throw new Error(`${path}.${key} is not part of the result-manifest contract.`);
  for (const key of required) if (!(key in parsed)) throw new Error(`${path}.${key} is required.`);
  return parsed;
}

function text(value, path, maximum = 1_200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new Error(`${path} must be a non-empty string no longer than ${maximum} characters.`);
  return value.trim();
}

function identifier(value, path) {
  const parsed = text(value, path, 180);
  if (!IDENTIFIER.test(parsed)) throw new Error(`${path} has an invalid identifier.`);
  return parsed;
}

function instant(value, path) {
  const parsed = text(value, path, 80);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${path} must be an ISO date-time.`);
  return parsed;
}

function jsonObject(value, path) {
  const parsed = record(value, path);
  let encoded;
  try {
    encoded = JSON.stringify(parsed);
  } catch {
    throw new Error(`${path} must be JSON-compatible.`);
  }
  if (encoded.length > 64_000) throw new Error(`${path} exceeds the 64 KiB result-manifest limit.`);
  return parsed;
}

function identities(value, path, allowedKinds) {
  if (!Array.isArray(value) || value.length > 500) throw new Error(`${path} must be an array with at most 500 canonical identities.`);
  const parsed = value.map((identity, index) => {
    const reference = parseCanonicalURI(identity);
    if (allowedKinds && !allowedKinds.has(reference.kind)) throw new Error(`${path}[${index}] has an unsupported canonical identity kind.`);
    return reference.uri;
  });
  if (new Set(parsed).size !== parsed.length) throw new Error(`${path} must not contain duplicate canonical identities.`);
  return parsed;
}

function computations(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('computations must contain at most 100 bounded records.');
  return value.map((entry, index) => {
    const parsed = exactKeys(entry, `computations[${index}]`, ['transformId', 'outputIds', 'deterministic', 'parametersSha256']);
    const transform = parseCanonicalURI(parsed.transformId);
    if (transform.kind !== 'transform') throw new Error(`computations[${index}].transformId must be a transform identity.`);
    if (!Array.isArray(parsed.outputIds) || !parsed.outputIds.length || parsed.outputIds.length > 100) throw new Error(`computations[${index}].outputIds must contain between one and 100 canonical identities.`);
    const outputIds = parsed.outputIds.map((outputId, outputIndex) => parseCanonicalURI(outputId).uri);
    if (new Set(outputIds).size !== outputIds.length) throw new Error(`computations[${index}].outputIds must not contain duplicates.`);
    if (typeof parsed.deterministic !== 'boolean') throw new Error(`computations[${index}].deterministic must be boolean.`);
    if (parsed.parametersSha256 !== null && (typeof parsed.parametersSha256 !== 'string' || !HASH.test(parsed.parametersSha256))) throw new Error(`computations[${index}].parametersSha256 must be null or a SHA-256 digest.`);
    return Object.freeze({ transformId: transform.uri, outputIds, deterministic: parsed.deterministic, parametersSha256: parsed.parametersSha256 });
  });
}

function uncertainties(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('uncertainties must contain at most 100 bounded records.');
  return value.map((entry, index) => {
    const parsed = exactKeys(entry, `uncertainties[${index}]`, ['kind', 'summary']);
    const kind = text(parsed.kind, `uncertainties[${index}].kind`, 80);
    if (!UNCERTAINTY_KINDS.has(kind)) throw new Error(`uncertainties[${index}].kind is not supported.`);
    return Object.freeze({ kind, summary: text(parsed.summary, `uncertainties[${index}].summary`, 600) });
  });
}

/** Validate and normalize a bounded, provenance-oriented result sidecar. */
export function parseResultManifest(input) {
  const value = exactKeys(input, 'result manifest', ['schema', 'manifestId', 'queryId', 'corpusBuild', 'methodology', 'knownAt', 'result', 'entitiesUsed', 'assertionsUsed', 'evidenceUsed', 'computations', 'uncertainties', 'contradictions', 'verification']);
  if (value.schema !== 'notations.result-manifest.v1') throw new Error('result manifest schema must be notations.result-manifest.v1.');
  const corpusBuild = exactKeys(value.corpusBuild, 'corpusBuild', ['buildId', 'knownAt']);
  const methodology = exactKeys(value.methodology, 'methodology', ['methodologyId', 'version']);
  const verification = exactKeys(value.verification, 'verification', ['status', 'checkedAt']);
  const verificationStatus = text(verification.status, 'verification.status', 80);
  if (!VERIFICATION_STATUSES.has(verificationStatus)) throw new Error('verification.status is not supported.');
  return Object.freeze({
    schema: value.schema,
    manifestId: identifier(value.manifestId, 'manifestId'),
    queryId: identifier(value.queryId, 'queryId'),
    corpusBuild: Object.freeze({ buildId: identifier(corpusBuild.buildId, 'corpusBuild.buildId'), knownAt: instant(corpusBuild.knownAt, 'corpusBuild.knownAt') }),
    methodology: Object.freeze({ methodologyId: identifier(methodology.methodologyId, 'methodology.methodologyId'), version: text(methodology.version, 'methodology.version', 80) }),
    knownAt: instant(value.knownAt, 'knownAt'),
    result: jsonObject(value.result, 'result'),
    entitiesUsed: identities(value.entitiesUsed, 'entitiesUsed'),
    assertionsUsed: identities(value.assertionsUsed, 'assertionsUsed', new Set(['claim', 'observation', 'state'])),
    evidenceUsed: identities(value.evidenceUsed, 'evidenceUsed', new Set(['artifact', 'source', 'dataset'])),
    computations: computations(value.computations),
    uncertainties: uncertainties(value.uncertainties),
    contradictions: identities(value.contradictions, 'contradictions', new Set(['claim', 'observation', 'state'])),
    verification: Object.freeze({ status: verificationStatus, checkedAt: instant(verification.checkedAt, 'verification.checkedAt') }),
  });
}
