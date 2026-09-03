/** The durable, storage-independent identity space of the Notation Substrate. */

export const CANONICAL_KINDS = Object.freeze([
  'source', 'artifact', 'entity', 'observation', 'claim', 'dataset',
  'model', 'state', 'transform', 'proof', 'node',
]);

const KIND_SET = new Set(CANONICAL_KINDS);
const AUTHORITY = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9:_.\/-]{0,255}$/;

/** Build the storage-independent identity grammar used by the Evidence Lake. */
export function canonicalURI(kind, authority, localId) {
  if (!KIND_SET.has(kind)) throw new Error(`Unsupported canonical identity kind ${kind}.`);
  if (typeof authority !== 'string' || !AUTHORITY.test(authority)) throw new Error('Canonical identity authority is invalid.');
  if (typeof localId !== 'string' || !LOCAL_ID.test(localId) || localId.includes('//') || localId.endsWith('/')) throw new Error('Canonical identity local id is invalid.');
  return `notation://${kind}/${authority}/${localId}`;
}

export function parseCanonicalURI(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Canonical identity must be a non-empty string.');
  const match = /^notation:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(value.trim());
  if (!match) throw new Error('Canonical identity must follow notation://<kind>/<authority>/<local-id>.');
  const [, kind, authority, localId] = match;
  return Object.freeze({ uri: canonicalURI(kind, authority, localId), kind, authority, localId });
}
