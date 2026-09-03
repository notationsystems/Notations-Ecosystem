/**
 * Payload Terminal is the first detailed Notations ecosystem twin.
 *
 * This profile contains only declared surfaces and provenance-safe provider
 * identities. It never contains provider credentials, account details, or
 * opaque source content. Health arrives independently through observations.
 */

const capability = (capabilityId, label, description, mode = 'observe', approval = 'automatic', maturity = 'research') => ({ capabilityId, label, description, mode, approval, maturity, methodologyVersion: 'payload-methodology/0.1.0' });

const node = (nodeId, name, kind, description, capabilities, metadata) => ({
  nodeId,
  name,
  kind,
  description,
  capabilities,
  metadata,
  location: null,
});

export const PAYLOAD_TERMINAL_PROFILE = Object.freeze({
  profileId: 'payload-terminal',
  version: '1.0.0',
  title: 'Payload Terminal — physical economy intelligence',
  summary: 'An evidence-bearing physical-economy ecosystem whose answers carry provenance, basis, and knowledge time.',
  governance: Object.freeze({
    methodology: Object.freeze({ methodologyId: 'payload-methodology', version: '0.1.0', status: 'research' }),
    exclusions: Object.freeze([
      'Does not infer supplier relationships solely from geographic proximity.',
      'Does not treat modeled capacity as reported capacity.',
      'Does not equate corporate parent ownership with operational control.',
      'Does not interpret a missing observation as zero.',
    ]),
  }),
  nodes: Object.freeze([
    node('payload-terminal', 'Payload Terminal', 'api', 'The human and machine query surface for the physical-economy corpus and operating workflows.', [
      capability('physical-economy.query', 'Query physical economy', 'Read provenance-bearing entities, observations, flows, dependencies, and market context.'),
      capability('world-state.explore', 'Explore world state', 'Read the current or historical evidence-backed world projection.'),
      capability('scenario.propose', 'Propose scenario', 'Create a non-executing counterfactual for a declared disruption or dependency change.', 'propose'),
      capability('source-health.observe', 'Observe source health', 'Inspect cadence, freshness, degradation rung, and coverage of declared sources.'),
    ], { ecosystem: 'Payload', role: 'orchestrator', domain: 'physical_economy', spatial_scope: 'global' }),
    node('payload-corpus', 'Payload Corpus', 'information_library', 'The canonical, evidence-linked record of organisations, facilities, materials, processes, networks, markets, and flows.', [
      capability('evidence.retrieve', 'Retrieve evidence', 'Read policy-filtered corpus records with provenance and knowledge time.'),
      capability('evidence.verify', 'Verify claim basis', 'Inspect evidence identity, uncertainty, warrants, and calculation basis.'),
      capability('read-model.compile', 'Compile read model', 'Publish a policy-filtered query projection from canonical records.', 'execute', 'operator'),
    ], { ecosystem: 'Payload', role: 'canonical_knowledge', domain: 'evidence_and_identity', authority: 'canonical' }),
    node('payload-spatial-world', 'Payload Spatial World', 'world_model', 'The spatial and temporal model of facilities, routes, dependencies, trade, disruptions, and physical flows.', [
      capability('topology.observe', 'Observe topology', 'Read facility, corridor, dependency, and flow topology.'),
      capability('spatial-layer.observe', 'Observe spatial layer', 'Read map-ready facilities, routes, constraints, and event layers.'),
      capability('flow-scenario.propose', 'Propose flow scenario', 'Model a non-executing dependency or disruption propagation.', 'propose'),
    ], { ecosystem: 'Payload', role: 'spatial_world_model', domain: 'flows_and_dependencies', spatial_scope: 'global' }),
    node('payload-mcp', 'Payload MCP Surface', 'api', 'The local reasoning-engine access surface for Payload’s evidence-bearing tools and context.', [
      capability('reasoning-context.observe', 'Read reasoning context', 'Read bounded, evidence-bearing context for a reasoning engine.'),
      capability('tool-catalog.observe', 'Inspect tool catalog', 'Discover declared Payload tools and their input contracts.'),
    ], { ecosystem: 'Payload', role: 'reasoning_adapter', protocol: 'mcp', exposure: 'local_stdio' }),
    node('payload-operations', 'Payload Operations', 'operator_surface', 'The private freight, procurement, commercial, and project-cargo operating surfaces.', [
      capability('operations.observe', 'Observe operations', 'Read authorised operational state, exceptions, commitments, and outcomes.'),
      capability('operator-action.execute', 'Execute operator action', 'Advance an authorised durable operating workflow through its typed action surface.', 'execute', 'operator'),
    ], { ecosystem: 'Payload', role: 'operator_workflow', domain: 'freight_procurement_commercial', access: 'private' }),
    node('usgs-mcs', 'USGS Mineral Commodity Summaries', 'information_library', 'A public source of mineral production, reserves, and commodity context.', [
      capability('commodity-observations.observe', 'Observe commodity data', 'Read cited public mineral commodity observations.'),
    ], { ecosystem: 'external', provider: 'USGS', domain: 'mineral_production', redistribution: 'public_domain' }),
    node('un-comtrade', 'UN Comtrade', 'information_library', 'A public trade-statistics source used for provenance-bearing physical trade observations.', [
      capability('trade-observations.observe', 'Observe trade data', 'Read attributed bilateral commodity trade observations.'),
    ], { ecosystem: 'external', provider: 'UN Comtrade', domain: 'trade', redistribution: 'attributed' }),
    node('cftc-cot', 'CFTC Commitments of Traders', 'information_library', 'A public positioning source used as market context, not physical evidence.', [
      capability('positioning.observe', 'Observe positioning', 'Read public futures positioning context.'),
    ], { ecosystem: 'external', provider: 'CFTC', domain: 'market_positioning', redistribution: 'public_domain' }),
    node('open-sanctions', 'OpenSanctions', 'information_library', 'An organisational counterparty-screening source for sanctioned entities, vessels, and aircraft.', [
      capability('organisation-screening.observe', 'Observe organisational screening', 'Read organisation, vessel, and aircraft screening context; never a natural-person research capability.'),
    ], { ecosystem: 'external', provider: 'OpenSanctions', domain: 'counterparty_screening', subject_scope: 'organisations_vessels_aircraft' }),
  ]),
  relations: Object.freeze([
    { relationId: 'usgs-supplies-payload-corpus', sourceNodeId: 'usgs-mcs', targetNodeId: 'payload-corpus', kind: 'supplies_context_to', description: 'USGS mineral observations provide cited commodity evidence.' },
    { relationId: 'comtrade-supplies-payload-corpus', sourceNodeId: 'un-comtrade', targetNodeId: 'payload-corpus', kind: 'supplies_context_to', description: 'UN Comtrade observations provide attributed physical trade evidence.' },
    { relationId: 'cftc-supplies-payload-terminal', sourceNodeId: 'cftc-cot', targetNodeId: 'payload-terminal', kind: 'supplies_context_to', description: 'CFTC positioning supplies market context and never substitutes for physical evidence.' },
    { relationId: 'sanctions-supplies-payload-operations', sourceNodeId: 'open-sanctions', targetNodeId: 'payload-operations', kind: 'supplies_context_to', description: 'Organisational counterparty screening supplies operational context.' },
    { relationId: 'payload-corpus-supplies-terminal', sourceNodeId: 'payload-corpus', targetNodeId: 'payload-terminal', kind: 'supplies_context_to', description: 'The corpus supplies canonical records and warrant-bearing answers to the Terminal.' },
    { relationId: 'payload-corpus-supplies-spatial-world', sourceNodeId: 'payload-corpus', targetNodeId: 'payload-spatial-world', kind: 'supplies_context_to', description: 'The corpus supplies canonical identities and observed relationships to the spatial world model.' },
    { relationId: 'payload-spatial-world-supplies-terminal', sourceNodeId: 'payload-spatial-world', targetNodeId: 'payload-terminal', kind: 'supplies_context_to', description: 'Spatial topology and flow context are available through the Terminal.' },
    { relationId: 'payload-terminal-supplies-mcp', sourceNodeId: 'payload-terminal', targetNodeId: 'payload-mcp', kind: 'supplies_context_to', description: 'The Terminal exposes bounded evidence-bearing context through its local MCP surface.' },
    { relationId: 'payload-operations-coordinates-terminal', sourceNodeId: 'payload-operations', targetNodeId: 'payload-terminal', kind: 'coordinates', description: 'Private operating workflows are coordinated with the Terminal’s evidence and world-state surfaces.' },
  ]),
  dock: Object.freeze({
    defaultView: 'topology',
    layers: Object.freeze([
      { layerId: 'payload-core', label: 'Payload core', nodeIds: ['payload-terminal', 'payload-corpus', 'payload-spatial-world', 'payload-mcp', 'payload-operations'] },
      { layerId: 'payload-evidence', label: 'Evidence sources', nodeIds: ['usgs-mcs', 'un-comtrade', 'cftc-cot', 'open-sanctions'] },
    ]),
    detailPanels: Object.freeze(['capabilities', 'health', 'provenance', 'relations', 'coordination']),
  }),
});

export function payloadTerminalProfile() {
  return PAYLOAD_TERMINAL_PROFILE;
}
