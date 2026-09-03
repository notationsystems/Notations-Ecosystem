/** The logical substrate under Nodes: one identity/provenance authority, many stores. */

const capability = (capabilityId, label, description, mode = 'observe', approval = 'automatic') => ({ capabilityId, label, description, mode, approval });
const node = (nodeId, name, kind, description, capabilities, metadata) => ({ nodeId, name, kind, description, capabilities, metadata, location: null });

export const NOTATION_DATA_FABRIC_PROFILE = Object.freeze({
  profileId: 'notation-data-fabric',
  version: '1.0.0',
  title: 'Notation Data Fabric',
  summary: 'One canonical identity and provenance authority across distinct evidence, state, graph, analytical, retrieval, and compute representations.',
  nodes: Object.freeze([
    node('notation-evidence-lake', 'Notation Evidence Lake', 'information_library', 'Immutable source artifacts, documents, datasets, imagery, scans, and feeds.', [
      capability('artifact.provenance.observe', 'Observe artifact provenance', 'Read immutable artifact identity, origin, and temporal context.'),
    ], { ecosystem: 'Notation', fabric_layer: 'evidence_lake', authority: 'immutable_originals' }),
    node('notation-canonical-state', 'Notation Canonical State', 'world_model', 'Normalized entities, observations, claims, relations, and versioned state transitions.', [
      capability('canonical-state.observe', 'Observe canonical state', 'Read authoritative normalized state and temporal interpretation.'),
      capability('state-transition.propose', 'Propose state transition', 'Propose an explicitly modelled state transition from evidence.', 'propose'),
    ], { ecosystem: 'Notation', fabric_layer: 'canonical_state', authority: 'logical_canonical' }),
    node('notation-identity-ontology', 'Notation Identity and Ontology', 'information_library', 'Shared identity namespace, semantic types, ontology placement, and relationship meaning.', [
      capability('identity.resolve', 'Resolve canonical identity', 'Resolve a notation:// identity across physical representations.'),
      capability('ontology.observe', 'Observe ontology', 'Read type, relation, spatial, and temporal semantics.'),
    ], { ecosystem: 'Notation', fabric_layer: 'identity_ontology', identity_scheme: 'notation://{kind}/{authority}/{local-id}' }),
    node('notation-graph-plane', 'Notation Graph Plane', 'world_model', 'Lineage, dependency, topology, and provenance graph projections.', [
      capability('lineage.observe', 'Observe lineage', 'Read source-to-state-to-decision lineage.'),
      capability('topology.observe', 'Observe topology', 'Read relationships and dependency structure.'),
    ], { ecosystem: 'Notation', fabric_layer: 'graph_plane', representation: 'graph_rdf' }),
    node('notation-analytical-lakehouse', 'Notation Analytical Lakehouse', 'information_library', 'Large-scale tabular, temporal, economic, and scientific analytical representations.', [
      capability('analytics.observe', 'Observe analytical state', 'Read derived analytical tables with source linkage.'),
    ], { ecosystem: 'Notation', fabric_layer: 'analytical_lakehouse', representation: 'lakehouse_sql' }),
    node('notation-retrieval-indexes', 'Notation Retrieval Indexes', 'information_library', 'Rebuildable lexical, vector, graph, spatial, and SQL retrieval projections.', [
      capability('retrieval.observe', 'Observe retrieval projection', 'Read a bounded derived retrieval projection.'),
      capability('index.rebuild', 'Rebuild index', 'Rebuild a disposable index from canonical source state.', 'execute', 'operator'),
    ], { ecosystem: 'Notation', fabric_layer: 'retrieval_indexes', representation: 'lexical_vector_graph_spatial' }),
    node('notation-compute-plane', 'Notation Derived Compute Plane', 'world_model', 'Simulations, models, forecasts, transformations, proofs, and explicitly derived states.', [
      capability('derived-state.observe', 'Observe derived state', 'Read a model output with its declared inputs and transform identity.'),
      capability('compute.propose', 'Propose computation', 'Propose a reproducible derived computation.', 'propose'),
    ], { ecosystem: 'Notation', fabric_layer: 'derived_compute', representation: 'model_state_proof' }),
  ]),
  relations: Object.freeze([
    { relationId: 'evidence-supplies-canonical-state', sourceNodeId: 'notation-evidence-lake', targetNodeId: 'notation-canonical-state', kind: 'supplies_context_to', description: 'Immutable evidence supplies normalised claims and observations.' },
    { relationId: 'identity-governs-canonical-state', sourceNodeId: 'notation-identity-ontology', targetNodeId: 'notation-canonical-state', kind: 'governs', description: 'Identity and ontology govern canonical type and relationship meaning.' },
    { relationId: 'canonical-supplies-graph', sourceNodeId: 'notation-canonical-state', targetNodeId: 'notation-graph-plane', kind: 'supplies_context_to', description: 'Canonical identities and relations materialize graph and lineage projections.' },
    { relationId: 'canonical-supplies-lakehouse', sourceNodeId: 'notation-canonical-state', targetNodeId: 'notation-analytical-lakehouse', kind: 'supplies_context_to', description: 'Canonical observations materialize analytical representations.' },
    { relationId: 'canonical-supplies-retrieval', sourceNodeId: 'notation-canonical-state', targetNodeId: 'notation-retrieval-indexes', kind: 'supplies_context_to', description: 'Canonical state is projected into rebuildable retrieval indexes.' },
    { relationId: 'canonical-supplies-compute', sourceNodeId: 'notation-canonical-state', targetNodeId: 'notation-compute-plane', kind: 'supplies_context_to', description: 'Canonical state and evidence provide declared inputs to derived computation.' },
  ]),
  dock: Object.freeze({
    defaultView: 'fabric_lineage',
    layers: Object.freeze([
      { layerId: 'fabric-authority', label: 'Authority', nodeIds: ['notation-evidence-lake', 'notation-canonical-state', 'notation-identity-ontology'] },
      { layerId: 'fabric-projections', label: 'Representations', nodeIds: ['notation-graph-plane', 'notation-analytical-lakehouse', 'notation-retrieval-indexes', 'notation-compute-plane'] },
    ]),
    detailPanels: Object.freeze(['identity', 'provenance', 'temporal_scope', 'representations', 'sync_contract']),
  }),
});

export function notationDataFabricProfile() {
  return NOTATION_DATA_FABRIC_PROFILE;
}
