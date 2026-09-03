/**
 * Security is represented as an independently attested ecosystem, never as a
 * self-authored green status inside the Control Plane itself.
 */

const capability = (capabilityId, label, description, mode = 'observe', approval = 'automatic') => ({ capabilityId, label, description, mode, approval, maturity: 'research', methodologyVersion: null });
const node = (nodeId, name, kind, description, capabilities, metadata) => ({ nodeId, name, kind, description, capabilities, metadata, location: null });

export const SECURITY_CONSTELLATION_PROFILE = Object.freeze({
  profileId: 'security-constellation',
  version: '1.0.0',
  title: 'Notations Security Constellation',
  summary: 'An independently attested posture graph for identity, cryptography, exposure, supply chain, resilience, and Control Plane integrity.',
  nodes: Object.freeze([
    node('notations-control-plane', 'Notations Control Plane', 'api', 'The private API-only coordination journal and ecosystem graph.', [
      capability('control-plane.observe', 'Observe control plane', 'Read the current private ecosystem graph, revisions, and audit state.'),
      capability('coordination.execute', 'Resolve coordination', 'Approve or reject a pending execution intent without dispatching a provider action.', 'execute', 'operator'),
    ], { ecosystem: 'Notations', role: 'coordination', access: 'private_api' }),
    node('notations-identity', 'Notations Identity Posture', 'information_library', 'The bounded security posture of human, service, and machine authorization controls.', [
      capability('identity-posture.observe', 'Observe identity posture', 'Read independently attested identity and authorization health.'),
    ], { ecosystem: 'Notations', security_domain: 'identity_and_authorization', evidence: 'signed_attestation' }),
    node('notations-key-lifecycle', 'Notations Cryptographic Posture', 'information_library', 'The bounded posture of encryption coverage, key ownership, algorithm policy, and rotation state.', [
      capability('cryptography-posture.observe', 'Observe cryptographic posture', 'Read signed encryption and key-lifecycle posture without key material.'),
    ], { ecosystem: 'Notations', security_domain: 'cryptography', evidence: 'signed_attestation', secret_material: 'never_present' }),
    node('notations-api-gateway', 'Notations API Exposure Posture', 'api', 'The protected product API perimeter and its bounded exposure posture.', [
      capability('exposure-posture.observe', 'Observe API exposure posture', 'Read signed external-exposure and boundary health.'),
    ], { ecosystem: 'Notations', security_domain: 'api_exposure', access: 'private_api' }),
    node('notations-supply-chain', 'Notations Supply Chain Posture', 'information_library', 'The bounded posture of dependencies, builds, provenance, and remediation state.', [
      capability('supply-chain-posture.observe', 'Observe supply-chain posture', 'Read signed dependency and build-integrity posture.'),
    ], { ecosystem: 'Notations', security_domain: 'software_supply_chain', evidence: 'signed_attestation' }),
    node('notations-resilience', 'Notations Resilience Posture', 'information_library', 'The bounded posture of recovery, backups, audit continuity, and incident readiness.', [
      capability('resilience-posture.observe', 'Observe resilience posture', 'Read signed recovery and operational-resilience posture.'),
    ], { ecosystem: 'Notations', security_domain: 'resilience', evidence: 'signed_attestation' }),
    node('notations-audit-integrity', 'Notations Audit Integrity Posture', 'information_library', 'The bounded posture of audit continuity, append-only integrity, and verification coverage.', [
      capability('audit-integrity.observe', 'Observe audit integrity', 'Read signed audit-chain, retention, and verification posture without raw audit contents.'),
    ], { ecosystem: 'Notations', security_domain: 'audit_integrity', evidence: 'signed_attestation', raw_audit_data: 'never_present' }),
    node('notations-incident-state', 'Notations Incident Posture', 'operator_surface', 'The bounded state of active incidents, containment, remediation, and readiness.', [
      capability('incident-posture.observe', 'Observe incident posture', 'Read signed incident severity and remediation posture without raw investigative findings.'),
    ], { ecosystem: 'Notations', security_domain: 'incident_state', evidence: 'signed_attestation', raw_findings: 'never_present' }),
    node('notations-security-attesters', 'Notations Security Attesters', 'operator_surface', 'Independent security collectors that sign bounded posture statements with their own private keys.', [
      capability('security-attestation.propose', 'Submit security attestation', 'Submit a signed bounded posture statement for verification.', 'propose'),
    ], { ecosystem: 'Notations', role: 'independent_attestation', cryptography: 'ed25519_public_key_verification' }),
  ]),
  relations: Object.freeze([
    { relationId: 'attesters-supply-identity', sourceNodeId: 'notations-security-attesters', targetNodeId: 'notations-identity', kind: 'supplies_context_to', description: 'Independent attesters supply signed identity posture statements.' },
    { relationId: 'attesters-supply-cryptography', sourceNodeId: 'notations-security-attesters', targetNodeId: 'notations-key-lifecycle', kind: 'supplies_context_to', description: 'Independent attesters supply signed cryptographic posture statements.' },
    { relationId: 'attesters-supply-exposure', sourceNodeId: 'notations-security-attesters', targetNodeId: 'notations-api-gateway', kind: 'supplies_context_to', description: 'Independent attesters supply signed API exposure posture statements.' },
    { relationId: 'attesters-supply-supply-chain', sourceNodeId: 'notations-security-attesters', targetNodeId: 'notations-supply-chain', kind: 'supplies_context_to', description: 'Independent attesters supply signed software supply-chain posture statements.' },
    { relationId: 'attesters-supply-resilience', sourceNodeId: 'notations-security-attesters', targetNodeId: 'notations-resilience', kind: 'supplies_context_to', description: 'Independent attesters supply signed resilience posture statements.' },
    { relationId: 'attesters-supply-audit-integrity', sourceNodeId: 'notations-security-attesters', targetNodeId: 'notations-audit-integrity', kind: 'supplies_context_to', description: 'Independent attesters supply signed audit-integrity posture statements.' },
    { relationId: 'attesters-supply-incident-state', sourceNodeId: 'notations-security-attesters', targetNodeId: 'notations-incident-state', kind: 'supplies_context_to', description: 'Independent attesters supply signed incident posture statements.' },
    { relationId: 'security-governs-control-plane', sourceNodeId: 'notations-security-attesters', targetNodeId: 'notations-control-plane', kind: 'governs', description: 'Independent attestation provides the Control Plane integrity posture rather than self-attestation.' },
  ]),
  dock: Object.freeze({
    defaultView: 'security_posture',
    layers: Object.freeze([
      { layerId: 'security-core', label: 'Security core', nodeIds: ['notations-control-plane', 'notations-security-attesters'] },
      { layerId: 'security-posture', label: 'Posture domains', nodeIds: ['notations-identity', 'notations-key-lifecycle', 'notations-api-gateway', 'notations-supply-chain', 'notations-resilience', 'notations-audit-integrity', 'notations-incident-state'] },
    ]),
    detailPanels: Object.freeze(['security_posture', 'attestation_freshness', 'trust_boundary', 'coordination']),
  }),
});

export function securityConstellationProfile() {
  return SECURITY_CONSTELLATION_PROFILE;
}
