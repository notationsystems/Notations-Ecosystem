/**
 * The Notation identity space.
 *
 *   notation://<class>/<namespace>/<local-id>[@<version>]
 *
 * One canonical identity space, many physical representations. A `notation://` URI
 * names *what something is* in the Notation substrate — an evidence artifact, a
 * canonical entity, a derived state, a proof — independently of which store happens
 * to hold it today. Postgres, an object store, a graph, a vector index and a
 * simulation output can all back the same identity without the identity changing.
 *
 * Two properties make this a security primitive rather than a naming convention:
 *
 *   Identity classes stay distinct. Evidence identity, canonical-state identity,
 *   execution identity, service identity, agent identity, cryptographic identity,
 *   deployment identity and verification identity are separate classes in one space.
 *   Collapsing them would merge trust domains: an agent identity that can be spelled
 *   like a key identity is an escalation waiting to happen. `sameClass` and the
 *   per-class constructors keep that separation checkable.
 *
 *   A URI is a name, never a location. Nothing in the control plane dereferences a
 *   `notation://` URI; it holds no resolver, no credentials for one, and no network
 *   capability to reach one. This is what lets the plane reference evidence without
 *   holding it — the projection must never become the database, and a compromised
 *   projection must not yield the material it points at.
 */

/** The classes of the identity space. Unknown classes are refused, never coerced. */
export const URI_CLASSES = Object.freeze({
  source: 'An upstream origin of information (a publisher, feed, instrument, registry)',
  artifact: 'Immutable original material in the evidence lake (a scan, capture, dataset file)',
  observation: 'A measured or perceived fact about an entity at a time',
  claim: 'An assertion made by someone, with an author and a warrant',
  entity: 'A canonical entity in the knowledge plane (facility, company, material, document)',
  dataset: 'A named, versioned collection of records',
  model: 'A model or its weights',
  state: 'A canonical or derived state at a version',
  transform: 'A transformation that produced one state from another',
  computation: 'A concrete execution of a transform',
  proof: 'An attestation over a computation or a state',
  node: 'A node of the Nodes universe: a projection identity',
  agent: 'A reasoning agent identity',
  principal: 'An authenticated caller identity (human or service)',
  key: 'A cryptographic key identity',
  deployment: 'A deployed instance identity',
  verification: 'A verification identity, distinct from the execution it verifies',
});

/** Identity classes that name authorities rather than information. */
export const AUTHORITY_CLASSES = Object.freeze(['principal', 'agent', 'key', 'deployment', 'verification']);

/** Identity classes that name information the substrate holds. */
export const INFORMATION_CLASSES = Object.freeze(['source', 'artifact', 'observation', 'claim', 'entity', 'dataset', 'model', 'state', 'transform', 'computation', 'proof', 'node']);

const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const MAX_URI_LENGTH = 512;

export class UriError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UriError';
  }
}

/**
 * Parse a `notation://` URI into its parts.
 *
 * Strict by construction: no percent-encoding, no query, no fragment, no relative
 * segments, no empty segments, no uppercase class. Anything that could produce two
 * spellings of one identity is refused rather than normalised, so equality of
 * identity is equality of string.
 *
 * @returns {{uri: string, class: string, namespace: string, localId: string, path: string[], version: string|null}}
 */
export function parseUri(value) {
  if (typeof value !== 'string') throw new UriError('A Notation URI must be a string.');
  if (value.length > MAX_URI_LENGTH) throw new UriError(`A Notation URI may not exceed ${MAX_URI_LENGTH} characters.`);
  if (!value.startsWith('notation://')) throw new UriError(`"${value}" is not a notation:// URI.`);
  const rest = value.slice('notation://'.length);
  if (rest.includes('?') || rest.includes('#')) throw new UriError('A Notation URI carries no query or fragment: it is a name, not a request.');
  if (rest.includes('%')) throw new UriError('A Notation URI is not percent-encoded; use characters from the identity alphabet.');
  if (rest.includes('//')) throw new UriError('A Notation URI may not contain empty path segments.');

  const [withoutVersion, ...versionParts] = rest.split('@');
  if (versionParts.length > 1) throw new UriError('A Notation URI carries at most one @version.');
  const version = versionParts.length ? versionParts[0] : null;
  if (version !== null && !VERSION.test(version)) throw new UriError(`"${version}" is not a valid version.`);

  const segments = withoutVersion.split('/').filter(segment => segment.length > 0);
  if (withoutVersion.endsWith('/')) throw new UriError('A Notation URI may not end with a separator.');
  if (segments.length < 3) throw new UriError('A Notation URI needs a class, a namespace and a local id.');
  const [className, namespace, ...localSegments] = segments;
  if (!(className in URI_CLASSES)) throw new UriError(`"${className}" is not a Notation identity class. Known classes: ${Object.keys(URI_CLASSES).join(', ')}.`);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') throw new UriError('A Notation URI may not contain relative segments.');
    if (!SEGMENT.test(segment)) throw new UriError(`"${segment}" is not a valid identity segment.`);
  }
  return {
    uri: value,
    class: className,
    namespace,
    localId: localSegments.join('/'),
    path: localSegments,
    version,
  };
}

export function isUri(value) {
  try {
    parseUri(value);
    return true;
  } catch {
    return false;
  }
}

/** Build a URI from its parts, validating the result. */
export function buildUri(className, namespace, localId, version = null) {
  const uri = `notation://${className}/${namespace}/${localId}${version ? `@${version}` : ''}`;
  parseUri(uri);
  return uri;
}

/** Typed constructors, so a call site cannot accidentally mint the wrong class. */
export const uri = Object.freeze(Object.fromEntries(
  Object.keys(URI_CLASSES).map(className => [className, (namespace, localId, version = null) => buildUri(className, namespace, localId, version)]),
));

/** Do two identities belong to the same class? The check that keeps trust domains apart. */
export function sameClass(a, b) {
  return parseUri(a).class === parseUri(b).class;
}

/** Assert that an identity belongs to one of the expected classes. */
export function assertClass(value, expected) {
  const classes = Array.isArray(expected) ? expected : [expected];
  const parsed = parseUri(value);
  if (!classes.includes(parsed.class)) {
    throw new UriError(`Identity ${value} is a ${parsed.class}, but a ${classes.join(' or ')} identity is required here.`);
  }
  return parsed;
}

/** Is this an identity of information the substrate holds (rather than an authority)? */
export function isInformationIdentity(value) {
  return INFORMATION_CLASSES.includes(parseUri(value).class);
}

/** Is this an identity of an authority (a caller, agent, key, deployment, verifier)? */
export function isAuthorityIdentity(value) {
  return AUTHORITY_CLASSES.includes(parseUri(value).class);
}

/**
 * The control plane holds no resolver. This function exists so that the absence is
 * explicit and testable rather than an omission someone later "fixes" by adding a
 * fetch: a projection that can dereference every identity it displays is a
 * credential-bearing gateway to the whole substrate.
 */
export function resolve() {
  throw new UriError('The control plane does not dereference Notation URIs. It records identities; the substrate resolves them, under its own authorization.');
}

/** A URI for a Nodes-universe node id, the projection identity used by this plane. */
export function nodeUri(nodeId, namespace = 'notationsystems') {
  return buildUri('node', namespace, String(nodeId).toLowerCase().replace(/[^a-z0-9._-]/g, '-'));
}
