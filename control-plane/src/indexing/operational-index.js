/**
 * The operational index: a rebuildable projection over one snapshot.
 *
 * It answers the questions an operator asks first — what has never been observed, what
 * has gone stale, what is failing its posture, what is waiting on a decision, what is not
 * yet bound to the fabric — and it can always be thrown away and rebuilt from the journal.
 * That is the test of a projection (docs/PLATFORM.md §5): if losing it would lose
 * information, it is not one.
 *
 * It indexes declared topology, health and bounded posture only. It does not crawl the
 * systems it names, copy a corpus record, or expand a posture signal into the finding
 * behind it. Two things are deliberately absent so that a broad search can never surface
 * them: the purpose text of a coordination request, and any signature bytes.
 */
import { worstState } from '../security/evidence.js';

export const INDEX_SCHEMA = 'notations.control-plane.operational-index.v1';
export const QUERY_SCHEMA = 'notations.control-plane.operational-query.v1';

/** This process's thresholds — stated in the response's limitations, never implied. */
export const INDEX_DEFAULTS = Object.freeze({
  observationStaleAfterMs: 24 * 60 * 60 * 1_000,
  attestationStaleAfterMs: 7 * 24 * 60 * 60 * 1_000,
});

/** Roles that hold, feed, transform or project a corpus and therefore have a place in the fabric. */
const FABRIC_ROLES = new Set(['hold', 'feed', 'transform', 'project']);

const lower = value => String(value ?? '').toLocaleLowerCase();
const tokens = value => lower(value).split(/[^a-z0-9]+/).filter(token => token.length >= 2);

function countBy(items, selector) {
  const out = {};
  for (const item of items) {
    const key = selector(item) ?? 'unclassified';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function observationState(node, builtAt, options) {
  if (!node.lastObservedAt) return 'unobserved';
  return Date.parse(builtAt) - Date.parse(node.lastObservedAt) > options.observationStaleAfterMs ? 'stale' : 'current';
}

function postureState(node, builtAt, options) {
  if (!node.security) return 'unattested';
  const now = Date.parse(builtAt);
  const attestedAt = Date.parse(node.security.attestedAt);
  if (!Number.isFinite(attestedAt) || now - attestedAt > options.attestationStaleAfterMs) return 'stale';
  const expired = (node.security.signals ?? []).some(signal => signal.expiresAt && Date.parse(signal.expiresAt) <= now);
  return expired ? 'stale' : 'current';
}

function weakestPosture(node) {
  if (!node.security) return null;
  return worstState((node.security.signals ?? []).map(signal => signal.state));
}

function searchText(node) {
  return [
    node.nodeId,
    node.name,
    node.kind,
    node.description,
    ...(node.capabilities ?? []).flatMap(capability => [capability.capabilityId, capability.label, capability.description, capability.mode, capability.maturity ?? '']),
    ...Object.entries(node.metadata ?? {}).flatMap(([key, value]) => [key, String(value)]),
  ].join(' ');
}

/** Build the index. Pure over its inputs, so a rebuild from the same snapshot is the same index. */
export function buildOperationalIndex(snapshot, builtAt = new Date().toISOString(), overrides = {}) {
  const options = { ...INDEX_DEFAULTS, ...overrides };

  const syncs = [...(snapshot.fabric?.syncs ?? [])]
    .map(sync => ({
      syncId: sync.syncId,
      systemNodeId: sync.systemNodeId,
      systemIdentity: sync.systemIdentity,
      fabricNodeId: sync.fabricNodeId,
      mode: sync.mode,
      authority: sync.authority,
      identityKinds: [...sync.identityKinds],
      representations: [...sync.representations],
      registeredAt: sync.registeredAt ?? null,
    }))
    .sort((left, right) => left.syncId.localeCompare(right.syncId));
  const bound = new Set(syncs.map(sync => sync.systemNodeId));

  const nodes = [...snapshot.nodes]
    .map(node => ({
      nodeId: node.nodeId,
      name: node.name,
      kind: node.kind,
      description: node.description,
      metadata: node.metadata ?? {},
      health: node.health,
      observationState: observationState(node, builtAt, options),
      lastObservedAt: node.lastObservedAt ?? null,
      posture: {
        state: postureState(node, builtAt, options),
        weakest: weakestPosture(node),
        // Who vouched: an independent signer, or the submitting principal alone.
        signer: node.security?.signer?.signerId ?? null,
      },
      corpusRole: typeof node.metadata?.corpus_role === 'string' ? node.metadata.corpus_role : null,
      corpusGrade: typeof node.metadata?.corpus_grade === 'string' ? node.metadata.corpus_grade : null,
      fabricBound: bound.has(node.nodeId),
      capabilities: (node.capabilities ?? []).map(capability => ({
        capabilityId: capability.capabilityId,
        label: capability.label,
        mode: capability.mode,
        approval: capability.approval,
        // Undeclared stays undeclared. A default here would be the index asserting
        // something about code the plane has never seen.
        maturity: capability.maturity ?? null,
        methodologyVersion: capability.methodologyVersion ?? null,
      })),
      searchTokens: [...new Set(tokens(searchText(node)))].sort(),
    }))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));

  const capabilities = nodes.flatMap(node => node.capabilities.map(capability => ({ ...capability, nodeId: node.nodeId, nodeName: node.name, nodeKind: node.kind, health: node.health })));

  // The approval queue without its purpose text: an index is searched broadly, and the
  // reason an agent gave for wanting a capability is not something a search should find.
  const pendingApproval = snapshot.coordination
    .filter(record => record.status === 'approval_required')
    .map(record => ({ coordinationId: record.coordinationId, requesterNodeId: record.requesterNodeId, targetNodeId: record.targetNodeId, capabilityId: record.capabilityId, requestedMode: record.requestedMode, requestedAt: record.requestedAt }));

  return Object.freeze({
    schema: INDEX_SCHEMA,
    sourceRevision: snapshot.revision,
    sourceEventCursor: snapshot.eventCursor,
    builtAt,
    thresholds: { observationStaleAfterMs: options.observationStaleAfterMs, attestationStaleAfterMs: options.attestationStaleAfterMs },
    fabric: { identityScheme: snapshot.fabric?.identityScheme ?? null, registeredSyncs: syncs },
    nodes,
    relations: snapshot.relations.map(relation => ({ ...relation })),
    capabilities,
    facets: {
      nodeKinds: countBy(nodes, node => node.kind),
      health: countBy(nodes, node => node.health),
      observation: countBy(nodes, node => node.observationState),
      posture: countBy(nodes, node => node.posture.state),
      postureWeakest: countBy(nodes.filter(node => node.posture.weakest), node => node.posture.weakest),
      corpusGrade: countBy(nodes, node => node.corpusGrade ?? 'ungraded'),
      capabilityMode: countBy(capabilities, capability => capability.mode),
      capabilityMaturity: countBy(capabilities, capability => capability.maturity ?? 'undeclared'),
      fabricAuthority: countBy(syncs, sync => sync.authority),
    },
    signals: {
      unobservedNodeIds: nodes.filter(node => node.observationState === 'unobserved').map(node => node.nodeId),
      staleObservationNodeIds: nodes.filter(node => node.observationState === 'stale').map(node => node.nodeId),
      unavailableNodeIds: nodes.filter(node => node.health === 'offline' || node.health === 'critical').map(node => node.nodeId),
      failingPostureNodeIds: nodes.filter(node => node.posture.weakest === 'failing').map(node => node.nodeId),
      stalePostureNodeIds: nodes.filter(node => node.posture.state === 'stale').map(node => node.nodeId),
      unattestedNodeIds: nodes.filter(node => node.posture.state === 'unattested').map(node => node.nodeId),
      // Attested on a principal's word alone, with no collector's signature to check.
      unsignedPostureNodeIds: nodes.filter(node => node.posture.state !== 'unattested' && !node.posture.signer).map(node => node.nodeId),
      // Systems with a place in the fabric that have not been bound to it.
      unboundSystemNodeIds: nodes.filter(node => FABRIC_ROLES.has(node.corpusRole) && !node.fabricBound).map(node => node.nodeId),
      pendingApproval,
    },
  });
}

/** A local query over the index. Every-token match over the node's search tokens, then filters. */
export function queryOperationalIndex(index, query = '', filters = {}) {
  const wanted = tokens(query);
  const matches = index.nodes.filter(node => {
    if (filters.kind && node.kind !== filters.kind) return false;
    if (filters.health && node.health !== filters.health) return false;
    if (filters.posture && node.posture.state !== filters.posture) return false;
    if (filters.maturity && !node.capabilities.some(capability => (capability.maturity ?? 'undeclared') === filters.maturity)) return false;
    return wanted.every(token => node.searchTokens.includes(token));
  });
  return Object.freeze({
    schema: QUERY_SCHEMA,
    sourceRevision: index.sourceRevision,
    query,
    filters,
    total: matches.length,
    results: matches.slice(0, 50).map(node => ({
      nodeId: node.nodeId,
      name: node.name,
      kind: node.kind,
      health: node.health,
      observationState: node.observationState,
      posture: node.posture,
      corpusRole: node.corpusRole,
      corpusGrade: node.corpusGrade,
      fabricBound: node.fabricBound,
      capabilities: node.capabilities,
    })),
  });
}
