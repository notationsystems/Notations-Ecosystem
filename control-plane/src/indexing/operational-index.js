/**
 * Rebuildable internal index for the Control Plane's already-authorised state.
 *
 * It indexes declared topology and bounded posture only. It does not crawl
 * external systems, copy Payload source records, or expand a raw security
 * finding into the dock or a reasoning-engine context.
 */

const DEFAULTS = Object.freeze({
  observationStaleAfterMs: 24 * 60 * 60 * 1_000,
  securityAttestationStaleAfterMs: 7 * 24 * 60 * 60 * 1_000,
});

function lower(value) {
  return String(value || '').toLocaleLowerCase();
}

function tokens(value) {
  return lower(value).split(/[^a-z0-9]+/).filter(token => token.length >= 2);
}

function valuesBy(object, selector) {
  const output = {};
  for (const item of object) {
    const key = selector(item) || 'unclassified';
    output[key] = (output[key] || 0) + 1;
  }
  return output;
}

function observationState(node, builtAt, options) {
  if (!node.lastObservedAt) return 'unobserved';
  if (Date.parse(builtAt) - Date.parse(node.lastObservedAt) > options.observationStaleAfterMs) return 'stale';
  return 'current';
}

function securityState(node, builtAt, options) {
  if (!node.security || node.security.overall === 'unattested') return 'unattested';
  const isStale = node.security.attestations.some(attestation =>
    attestation.freshness === 'expired' || Date.parse(builtAt) - Date.parse(attestation.verifiedAt) > options.securityAttestationStaleAfterMs,
  );
  return isStale ? 'stale' : 'current';
}

function searchText(node) {
  return [
    node.nodeId,
    node.name,
    node.kind,
    node.description,
    ...node.capabilities.flatMap(capability => [capability.capabilityId, capability.label, capability.description, capability.mode]),
    ...Object.entries(node.metadata || {}).flatMap(([key, value]) => [key, String(value)]),
  ].join(' ');
}

/** Build a projection that can always be discarded and rebuilt from the journal. */
export function buildOperationalIndex(snapshot, builtAt = new Date().toISOString(), overrides = {}) {
  const options = { ...DEFAULTS, ...overrides };
  const fabricSyncs = (snapshot.fabric?.syncs || []).map(sync => ({
    syncId: sync.syncId,
    systemNodeId: sync.systemNodeId,
    systemIdentity: sync.systemIdentity,
    fabricNodeId: sync.fabricNodeId,
    mode: sync.mode,
    authority: sync.authority,
    identityKinds: [...sync.identityKinds],
    representations: [...sync.representations],
  })).sort((left, right) => left.syncId.localeCompare(right.syncId));
  const nodes = snapshot.nodes.map(node => ({
    nodeId: node.nodeId,
    name: node.name,
    kind: node.kind,
    description: node.description,
    metadata: node.metadata,
    health: node.health,
    observationState: observationState(node, builtAt, options),
    lastObservedAt: node.lastObservedAt,
    securityOverall: node.security?.overall || 'unattested',
    securityState: securityState(node, builtAt, options),
    capabilities: node.capabilities.map(capability => ({
      capabilityId: capability.capabilityId,
      label: capability.label,
      mode: capability.mode,
      approval: capability.approval,
      maturity: capability.maturity || 'research',
      methodologyVersion: capability.methodologyVersion || null,
    })),
    searchTokens: [...new Set(tokens(searchText(node)))].sort(),
  })).sort((left, right) => left.nodeId.localeCompare(right.nodeId));

  const capabilities = nodes.flatMap(node => node.capabilities.map(capability => ({ ...capability, nodeId: node.nodeId, nodeName: node.name, nodeKind: node.kind, health: node.health, securityOverall: node.securityOverall })));
  const pendingApproval = snapshot.coordination.filter(item => item.status === 'approval_required').map(item => ({
    coordinationId: item.coordinationId,
    requesterNodeId: item.requesterNodeId,
    targetNodeId: item.targetNodeId,
    capabilityId: item.capabilityId,
    requestedMode: item.requestedMode,
    requestedAt: item.requestedAt,
  }));

  return Object.freeze({
    schema: 'notations.control-plane.operational-index.v1',
    sourceRevision: snapshot.revision,
    sourceEventCursor: snapshot.eventCursor,
    builtAt,
    fabric: {
      identityScheme: snapshot.fabric?.identityScheme || 'notation://{kind}/{authority}/{local-id}',
      registeredSyncs: fabricSyncs,
    },
    nodes,
    relations: snapshot.relations.map(relation => ({ ...relation })),
    capabilities,
    facets: {
      nodeKinds: valuesBy(nodes, node => node.kind),
      health: valuesBy(nodes, node => node.health),
      observation: valuesBy(nodes, node => node.observationState),
      security: valuesBy(nodes, node => node.securityOverall),
      capabilityMode: valuesBy(capabilities, capability => capability.mode),
      capabilityMaturity: valuesBy(capabilities, capability => capability.maturity),
      fabricAuthority: valuesBy(fabricSyncs, sync => sync.authority),
    },
    signals: {
      unobservedNodeIds: nodes.filter(node => node.observationState === 'unobserved').map(node => node.nodeId),
      staleObservationNodeIds: nodes.filter(node => node.observationState === 'stale').map(node => node.nodeId),
      unavailableNodeIds: nodes.filter(node => node.health === 'offline' || node.health === 'critical').map(node => node.nodeId),
      criticalSecurityNodeIds: nodes.filter(node => node.securityOverall === 'critical').map(node => node.nodeId),
      unattestedSecurityNodeIds: nodes.filter(node => node.securityOverall === 'unattested').map(node => node.nodeId),
      pendingApproval,
    },
  });
}

/**
 * Local query over the projection. Purpose text and attestation signatures are
 * intentionally absent from the index, so a broad search cannot surface them.
 */
export function queryOperationalIndex(index, query = '', filters = {}) {
  const wanted = tokens(query);
  const matches = index.nodes.filter(node => {
    if (filters.kind && node.kind !== filters.kind) return false;
    if (filters.health && node.health !== filters.health) return false;
    if (filters.security && node.securityOverall !== filters.security) return false;
    return wanted.every(token => node.searchTokens.includes(token));
  });
  return Object.freeze({
    schema: 'notations.control-plane.operational-query.v1',
    sourceRevision: index.sourceRevision,
    query,
    filters,
    results: matches.slice(0, 50).map(node => ({
      nodeId: node.nodeId,
      name: node.name,
      kind: node.kind,
      health: node.health,
      observationState: node.observationState,
      securityOverall: node.securityOverall,
      securityState: node.securityState,
      capabilities: node.capabilities,
    })),
  });
}
