/**
 * A versioned, inspectable research methodology—not a marketing claim.
 * The associated API profile deliberately marks Payload capabilities as research
 * until their individual implementation and validation evidence is recorded.
 */
export const PAYLOAD_METHODOLOGY = Object.freeze({
  schema: 'notations.corpus-methodology.v1',
  methodologyId: 'payload-methodology',
  version: '0.1.0',
  status: 'research',
  effectiveAt: '2026-09-02T00:00:00.000Z',
  scope: 'Evidence-bearing physical-economy entities, facilities, materials, processes, networks, markets, and flows.',
  ontology: 'Canonical identities use notation://<kind>/<authority>/<local-id>; relationships and assertions retain source and temporal context.',
  sourceClasses: ['public_statistical_source', 'public_regulatory_source', 'public_trade_source', 'licensed_organisational_source', 'operator_authorised_private_source'],
  ingestion: 'Original artifacts are immutable, content-addressed, and registered before evidence-backed observations are recorded.',
  extraction: 'Extraction produces bounded assertions linked to original artifacts; unsupported inference is excluded.',
  normalization: 'Units, names, locations, and temporal fields are normalized with the transform version recorded as lineage.',
  entityResolution: 'Ambiguous mentions are treated as candidates; high-risk resolutions require review rather than silent merging.',
  temporalSemantics: 'observedAt describes source observation time; knownAt describes when the corpus could use the information; valid time is distinct when supplied.',
  evidenceModel: 'Claims, observations, transformations, and derived state preserve canonical identities and upstream artifact lineage.',
  contradictionHandling: 'Conflicting supported evidence remains visible as disagreement; it is not averaged into an unsupported synthetic fact.',
  uncertainty: 'Uncertainty representation matches the object: disagreement, interval, candidate probabilities, significance, geometric uncertainty, or insufficient evidence.',
  spatialMethodology: 'Spatial representations preserve source, geometry precision, and temporal scope; approximate location is not a facility boundary.',
  licensing: 'Source policy records permitted use and redistribution before data is exposed in a corpus projection.',
  verification: 'Published results expose a machine-readable result manifest with corpus build, methodology, evidence, transformations, uncertainty, contradictions, and verification state.',
  exclusions: Object.freeze([
    'Payload does not infer supplier relationships solely from geographic proximity.',
    'Payload does not treat modeled capacity as reported capacity.',
    'Payload does not equate corporate parent ownership with operational control.',
    'Payload does not interpret a missing observation as zero.',
    'Payload does not present planned or research capabilities as deployed production features.',
  ]),
  knownLimitations: Object.freeze([
    'Coverage and refresh cadence vary by source class and jurisdiction.',
    'Entity resolution can remain ambiguous when evidence lacks discriminating attributes.',
    'Observed flows may be incomplete or delayed relative to physical activity.',
  ]),
  changelog: Object.freeze([
    Object.freeze({ version: '0.1.0', changedAt: '2026-09-02T00:00:00.000Z', summary: 'Initial research methodology and explicit negative boundaries.' }),
  ]),
});

export function payloadMethodology() {
  return PAYLOAD_METHODOLOGY;
}
