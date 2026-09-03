import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ControlPlane } from '../src/control-plane.js';
import { ControlPlaneError } from '../src/errors.js';
import { HashJournal, digest } from '../src/journal.js';
import { parseAttesters, postureStatement } from '../src/security/attestation.js';
import { buildOperationalIndex, queryOperationalIndex } from '../src/indexing/operational-index.js';
import { parseResultManifest, RESULT_MANIFEST_SCHEMA } from '../src/governance/result-manifest.js';

const NOW = '2026-09-02T00:00:00.000Z';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'notations-control-plane-'));
  const plane = ControlPlane.fromPath(join(directory, 'control-plane.jsonl'), () => NOW);
  return { directory, plane };
}

// Fixtures, not the estate — see the note in security.test.js. The plane's `src/` names
// no node of the Notations Universe, and neither do these ids beyond needing to be ids.
function node(nodeId, kind, capabilities) {
  return {
    requestId: `register-${nodeId}`,
    actorId: 'operator:local',
    submittedAt: NOW,
    expectedRevision: null,
    action: 'register_node',
    node: { nodeId, name: nodeId, kind, description: `${nodeId} is a registered ecosystem node.`, capabilities, metadata: { owner: 'notations' }, location: null },
  };
}

async function submit(plane, command) {
  const snapshot = await plane.snapshot();
  return plane.command({ ...command, expectedRevision: snapshot.revision });
}

test('records the graph, health, and event deltas for a visual dock', async () => {
  const { directory, plane } = await fixture();
  try {
    await submit(plane, node('payload-terminal', 'api', [{ capabilityId: 'example.read', label: 'Read a projection', description: 'Returns a published projection.', mode: 'observe', approval: 'automatic' }]));
    await submit(plane, node('kepler-dock', 'visual_dock', [{ capabilityId: 'graph.observe', label: 'Observe coordination graph', description: 'Renders graph state without dispatching a command.', mode: 'observe', approval: 'automatic' }]));
    await submit(plane, { requestId: 'payload-to-dock', actorId: 'operator:local', submittedAt: NOW, action: 'declare_relation', relationId: 'payload-supplies-dock', sourceNodeId: 'payload-terminal', targetNodeId: 'kepler-dock', kind: 'visualizes', description: 'The dock renders Payload state and capability health.' });
    const observation = await submit(plane, { requestId: 'payload-health', actorId: 'monitor:payload', submittedAt: NOW, action: 'record_observation', nodeId: 'payload-terminal', health: 'healthy', observedAt: NOW, source: 'health_check', detail: 'Published query surface is responding.' });

    assert.equal(observation.snapshot.nodes.find(entry => entry.nodeId === 'payload-terminal').health, 'healthy');
    assert.equal(observation.snapshot.relations[0].kind, 'visualizes');
    const events = await plane.events(observation.snapshot.eventCursor);
    assert.deepEqual(events.events, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('makes execution an operator-approved intent and never dispatches it', async () => {
  const { directory, plane } = await fixture();
  try {
    await submit(plane, node('world-model', 'world_model', [{ capabilityId: 'scenario.execute', label: 'Run scenario', description: 'Runs an approved scenario in a configured adapter.', mode: 'execute', approval: 'operator' }]));
    await submit(plane, node('reasoner', 'reasoning_engine', [{ capabilityId: 'plan.propose', label: 'Propose plan', description: 'Forms a non-executing plan.', mode: 'propose', approval: 'automatic' }]));
    const requested = await submit(plane, { requestId: 'scenario-request', actorId: 'reasoner:one', submittedAt: NOW, action: 'request_capability', coordinationId: 'coord-scenario', requesterNodeId: 'reasoner', targetNodeId: 'world-model', capabilityId: 'scenario.execute', requestedMode: 'execute', purpose: 'Assess a disruption scenario before any operational action.' });
    assert.deepEqual(requested.snapshot.coordination[0].status, 'approval_required');
    assert.deepEqual(requested.snapshot.coordination[0].dispatch, 'not_dispatched');

    const approved = await submit(plane, { requestId: 'scenario-approval', actorId: 'operator:local', submittedAt: NOW, action: 'resolve_coordination', coordinationId: 'coord-scenario', decision: 'approved', note: 'Approved for a separately configured execution adapter.' });
    assert.deepEqual(approved.snapshot.coordination[0].status, 'approved');
    assert.deepEqual(approved.snapshot.coordination[0].dispatch, 'not_dispatched');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects credential-shaped metadata and stale writers', async () => {
  const { directory, plane } = await fixture();
  try {
    await assert.rejects(
      plane.command({ ...node('unsafe-node', 'api', [{ capabilityId: 'example.read', label: 'Read a projection', description: 'Reads a published projection.', mode: 'observe', approval: 'automatic' }]), node: { ...node('unsafe-node', 'api', [{ capabilityId: 'example.read', label: 'Read a projection', description: 'Reads a published projection.', mode: 'observe', approval: 'automatic' }]).node, metadata: { api_token: 'must-not-persist' } } }),
      error => error instanceof ControlPlaneError && error.code === 'CONTROL_PLANE_COMMAND_INVALID',
    );

    const first = await submit(plane, node('payload-terminal', 'api', [{ capabilityId: 'example.read', label: 'Read a projection', description: 'Reads a published projection.', mode: 'observe', approval: 'automatic' }]));
    await assert.rejects(
      plane.command({ ...node('another-node', 'api', [{ capabilityId: 'example.read', label: 'Read a projection', description: 'Reads a published projection.', mode: 'observe', approval: 'automatic' }]), expectedRevision: null }),
      error => error instanceof ControlPlaneError && error.code === 'REVISION_CONFLICT',
    );
    assert.ok(first.snapshot.revision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// One observe capability, for nodes whose capabilities are not what a test is about.
const READ = [{ capabilityId: 'example.read', label: 'Read a projection', description: 'Returns a published projection.', mode: 'observe', approval: 'automatic' }];

/** A node with the metadata a fabric or posture test needs; the fixture's default is `{ owner }`. */
function nodeWith(nodeId, kind, metadata, capabilities = READ) {
  const command = node(nodeId, kind, capabilities);
  return { ...command, node: { ...command.node, metadata } };
}

const code = expected => error => error instanceof ControlPlaneError && error.code === expected;

test('binds a system to the fabric under its corpus role, and never a projection as canonical state', async () => {
  const { directory, plane } = await fixture();
  try {
    await submit(plane, nodeWith('platform', 'information_library', { fabric_layers: 'evidence canonical projection compute', corpus_role: 'hold' }));
    await submit(plane, nodeWith('holder', 'api', { corpus_role: 'hold', corpus_owner_of: 'physical-economy' }));
    await submit(plane, nodeWith('viewer', 'world_model', { corpus_role: 'project' }));
    await submit(plane, nodeWith('archive', 'information_library', { corpus_role: 'hold' }));
    const manifest = over => ({
      schema: 'notations.fabric-sync-manifest.v1', syncId: 'holder-canonical', systemNodeId: 'holder', systemIdentity: 'notation://node/notationsystems/holder', fabricNodeId: 'platform',
      mode: 'event_stream', authority: 'canonical_state', identityKinds: ['entity', 'observation', 'claim', 'state'], representations: ['sql', 'spatial'], provenanceRequired: true, knownAtRequired: true, ...over,
    });
    const bind = (requestId, over = {}) => submit(plane, { requestId, actorId: 'operator:local', submittedAt: NOW, action: 'register_fabric_sync', manifest: manifest(over) });

    const bound = await bind('bind-holder');
    assert.equal(bound.event.kind, 'fabric_sync_registered');
    assert.equal(bound.snapshot.fabric.syncs.length, 1);
    assert.equal(bound.snapshot.fabric.syncs[0].authority, 'canonical_state');
    assert.equal(bound.snapshot.fabric.syncs[0].registeredBy, 'operator:local');
    assert.equal(bound.snapshot.fabric.syncs[0].registeredAt, NOW);
    assert.match(bound.snapshot.fabric.identityScheme, /^notation:\/\//);

    // A projection never writes canonical truth (COR-009, PLAT-004) — refused by name.
    await assert.rejects(bind('bind-viewer-canonical', { syncId: 'viewer-canonical', systemNodeId: 'viewer', systemIdentity: 'notation://node/notationsystems/viewer' }), code('FABRIC_AUTHORITY_MISMATCH'));
    const projected = await bind('bind-viewer-projection', { syncId: 'viewer-projection', systemNodeId: 'viewer', systemIdentity: 'notation://node/notationsystems/viewer', authority: 'projection' });
    assert.equal(projected.snapshot.fabric.syncs.length, 2);
    // A hold that owns no domain holds evidence, not canonical state (COR-002).
    await assert.rejects(bind('bind-archive-canonical', { syncId: 'archive-canonical', systemNodeId: 'archive', systemIdentity: 'notation://node/notationsystems/archive' }), code('FABRIC_AUTHORITY_MISMATCH'));
    assert.equal((await bind('bind-archive-evidence', { syncId: 'archive-evidence', systemNodeId: 'archive', systemIdentity: 'notation://node/notationsystems/archive', authority: 'evidence_source', identityKinds: ['artifact', 'source'], representations: ['object'] })).snapshot.fabric.syncs.length, 3);
    // An anchor that does not build the layer cannot receive it.
    await assert.rejects(bind('bind-into-holder', { syncId: 'into-holder', systemNodeId: 'viewer', systemIdentity: 'notation://node/notationsystems/viewer', authority: 'projection', fabricNodeId: 'holder' }), code('FABRIC_ANCHOR_INVALID'));
    // Provenance and knowledge time cannot be relaxed by a manifest (COR-003, COR-004).
    await assert.rejects(bind('bind-relaxed', { syncId: 'relaxed', knownAtRequired: false }), code('CONTROL_PLANE_COMMAND_INVALID'));
    // One system, one spelling: the manifest names the node the way the plane does.
    await assert.rejects(bind('bind-misnamed', { syncId: 'misnamed', systemIdentity: 'notation://node/payload/holder' }), code('CONTROL_PLANE_COMMAND_INVALID'));
    // An identity class outside the information family is not something a fabric carries.
    await assert.rejects(bind('bind-keys', { syncId: 'keys', identityKinds: ['key'] }), code('CONTROL_PLANE_COMMAND_INVALID'));
    // A system with no declared role cannot be checked, and silence is not assent.
    await submit(plane, node('unplaced', 'api', READ));
    await assert.rejects(bind('bind-unplaced', { syncId: 'unplaced', systemNodeId: 'unplaced', systemIdentity: 'notation://node/notationsystems/unplaced' }), code('FABRIC_AUTHORITY_MISMATCH'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('verifies an independent Ed25519 signature over a posture statement, against public keys only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notations-control-plane-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const attesters = parseAttesters(JSON.stringify({ 'collector:ci': publicKey.export({ format: 'jwk' }).x }));
    const plane = ControlPlane.fromPath(join(directory, 'signed.jsonl'), () => NOW, { attesters });
    await submit(plane, node('guarded', 'api', READ));

    const signals = [{ dimension: 'identity', state: 'strong', coverage: 1, summary: 'Every credential is bound to one actor.' }];
    const statement = { nodeId: 'guarded', attestedAt: NOW, method: 'automated_scan', signals, signerId: 'collector:ci' };
    const signature = sign(null, postureStatement(statement), privateKey).toString('base64url');
    const posture = over => ({ requestId: 'signed-posture', actorId: 'attestor:ci', submittedAt: NOW, action: 'record_security_posture', nodeId: 'guarded', attestedAt: NOW, method: 'automated_scan', signals, signerId: 'collector:ci', signature, ...over });

    const recorded = await submit(plane, posture());
    const security = recorded.snapshot.nodes.find(entry => entry.nodeId === 'guarded').security;
    assert.deepEqual(security.signer, { signerId: 'collector:ci', verifiedAt: NOW });
    assert.equal(security.attestedBy, 'attestor:ci');

    // The signature covers the statement: change one word and it no longer verifies.
    await assert.rejects(submit(plane, posture({ requestId: 'tampered', signals: [{ ...signals[0], state: 'weak' }] })), code('SECURITY_ATTESTATION_INVALID'));
    // A signer the plane holds no key for is refused, whatever the signature.
    await assert.rejects(submit(plane, posture({ requestId: 'stranger', signerId: 'collector:stranger' })), code('SECURITY_ATTESTER_UNTRUSTED'));
    // Half a signature is a claim.
    const { signature: _dropped, ...halved } = posture({ requestId: 'half' });
    await assert.rejects(submit(plane, halved), code('CONTROL_PLANE_COMMAND_INVALID'));
    // Unsigned still works, on the principal's authority, and the snapshot says so.
    const { signerId: _s, signature: _g, ...plain } = posture({ requestId: 'plain', method: 'operator_review' });
    const unsigned = await submit(plane, plain);
    assert.equal(unsigned.snapshot.nodes.find(entry => entry.nodeId === 'guarded').security.signer, null);

    // A plane with no attesters cannot verify anything, and says so rather than trusting.
    const bare = ControlPlane.fromPath(join(directory, 'bare.jsonl'), () => NOW);
    await submit(bare, node('guarded', 'api', READ));
    await assert.rejects(submit(bare, posture()), code('SECURITY_ATTESTERS_NOT_CONFIGURED'));

    // The allowlist is public halves only, and a malformed one refuses rather than trusts nobody.
    assert.equal(parseAttesters(''), null);
    assert.throws(() => parseAttesters('{"collector:ci":"not-a-key"}'), /Ed25519 public key/);
    assert.throws(() => parseAttesters('[1,2]'), /JSON object/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reads a journal the merged plane wrote: profiles, per-category attestations and fabric syncs fold', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notations-control-plane-'));
  try {
    const journal = new HashJournal(join(directory, 'legacy.jsonl'), { keyStore: null, requireSignatures: false, anchor: true });
    let revision = null;
    const record = async event => {
      const result = await journal.append(Object.freeze({ recordedAt: NOW, commandHash: digest(event), ...event }), revision);
      revision = result.record.recordHash;
    };
    const legacyNode = (nodeId, kind, capabilities, metadata) => ({ nodeId, name: nodeId, kind, description: `${nodeId} as the merged plane declared it.`, capabilities, metadata, location: null, registeredAt: NOW, updatedAt: NOW });
    await record({
      eventId: 'control-plane-profile:one', kind: 'profile_applied', profile: { profileId: 'payload-terminal', version: '1.0.0' },
      nodes: [
        legacyNode('legacy-corpus', 'information_library', [{ capabilityId: 'evidence.retrieve', label: 'Retrieve evidence', description: 'Read policy-filtered corpus records.', mode: 'observe', approval: 'automatic', maturity: 'research', methodologyVersion: 'payload-methodology/0.1.0' }], { authority: 'canonical' }),
        legacyNode('legacy-fabric', 'world_model', READ, { fabric_layer: 'canonical_state' }),
      ],
      relations: [{ relationId: 'corpus-supplies-fabric', sourceNodeId: 'legacy-corpus', targetNodeId: 'legacy-fabric', kind: 'supplies_context_to', description: 'Canonical records.', declaredAt: NOW }],
    });
    await record({
      eventId: 'security-attestation:one', kind: 'security_attested',
      attestation: { attestationId: 'a-1', subjectNodeId: 'legacy-corpus', category: 'cryptography', status: 'healthy', observedAt: NOW, expiresAt: null, summary: 'Key rotation controls meet the baseline.', signerId: 'security-collector-1', signature: 'AAAA' },
      verification: { signerId: 'security-collector-1', verifiedAt: NOW },
    });
    await record({
      eventId: 'security-attestation:two', kind: 'security_attested',
      attestation: { attestationId: 'a-2', subjectNodeId: 'legacy-corpus', category: 'supply_chain', status: 'critical', observedAt: NOW, expiresAt: null, summary: 'Unremediated dependency findings.', signerId: 'security-collector-1', signature: 'AAAA' },
      verification: { signerId: 'security-collector-1', verifiedAt: NOW },
    });
    await record({
      eventId: 'fabric-sync:one', kind: 'fabric_sync_registered',
      manifest: { schema: 'notations.fabric-sync-manifest.v1', syncId: 'legacy-sync', systemNodeId: 'legacy-corpus', systemIdentity: 'notation://node/payload/legacy-corpus', fabricNodeId: 'legacy-fabric', mode: 'event_stream', authority: 'canonical_state', identityKinds: ['entity'], representations: ['sql'], provenanceRequired: true, knownAtRequired: true },
    });

    const plane = new ControlPlane(journal, () => NOW);
    const snapshot = await plane.snapshot();
    assert.deepEqual(snapshot.nodes.map(entry => entry.nodeId), ['legacy-corpus', 'legacy-fabric']);
    assert.equal(snapshot.relations.length, 1);
    const corpus = snapshot.nodes[0];
    assert.equal(corpus.capabilities[0].maturity, 'research');
    // Category → dimension, status → state; the collector is the signer and the method is external.
    assert.deepEqual(corpus.security.signals.map(signal => [signal.dimension, signal.state]), [['key_lifecycle', 'strong'], ['dependency_risk', 'failing']]);
    assert.equal(corpus.security.method, 'external_audit');
    assert.deepEqual(corpus.security.signer, { signerId: 'security-collector-1', verifiedAt: NOW });
    assert.equal(snapshot.constellation.attestedNodes, 1);
    assert.equal(snapshot.constellation.unrecognisedSignals, 0);
    // The sync is read as registered by nobody this plane knows, at the record's time.
    assert.equal(snapshot.fabric.syncs[0].syncId, 'legacy-sync');
    assert.equal(snapshot.fabric.syncs[0].registeredBy, null);
    assert.equal(snapshot.fabric.syncs[0].registeredAt, NOW);
    // And the time axis works over it: the prefix before the syncs has none.
    const before = await plane.snapshotAt('security-attestation:two');
    assert.equal(before.fabric.syncs.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rebuilds an operational index that names what needs attention and never carries purpose text', async () => {
  const { directory, plane } = await fixture();
  try {
    await submit(plane, nodeWith('reasoner', 'reasoning_engine', { corpus_role: 'transform' }, [{ capabilityId: 'plan.propose', label: 'Propose plan', description: 'Forms a non-executing plan.', mode: 'propose', approval: 'automatic' }]));
    await submit(plane, nodeWith('target', 'world_model', { corpus_role: 'hold', corpus_grade: 'developing' }, [{ capabilityId: 'scenario.run', label: 'Run scenario', description: 'Runs an approved scenario.', mode: 'execute', approval: 'operator', maturity: 'experimental' }]));
    await submit(plane, { requestId: 'observe-reasoner', actorId: 'monitor:one', submittedAt: NOW, action: 'record_observation', nodeId: 'reasoner', health: 'healthy', observedAt: NOW, source: 'health_check', detail: 'Responding.' });
    await submit(plane, { requestId: 'want-scenario', actorId: 'reasoner:one', submittedAt: NOW, action: 'request_capability', coordinationId: 'coord-scenario', requesterNodeId: 'reasoner', targetNodeId: 'target', capabilityId: 'scenario.run', requestedMode: 'execute', purpose: 'unique private reasoning purpose that must not enter the index' });

    const snapshot = await plane.snapshot();
    const index = buildOperationalIndex(snapshot, NOW);
    assert.equal(index.schema, 'notations.control-plane.operational-index.v1');
    assert.equal(index.sourceRevision, snapshot.revision);
    assert.deepEqual(index.signals.unobservedNodeIds, ['target']);
    assert.deepEqual(index.signals.unattestedNodeIds, ['reasoner', 'target']);
    assert.deepEqual(index.signals.unboundSystemNodeIds, ['reasoner', 'target']);
    assert.deepEqual(index.signals.pendingApproval.map(entry => entry.coordinationId), ['coord-scenario']);
    assert.equal(JSON.stringify(index).includes('unique private reasoning purpose'), false);
    assert.deepEqual(index.facets.capabilityMaturity, { undeclared: 1, experimental: 1 });
    assert.deepEqual(index.facets.corpusGrade, { ungraded: 1, developing: 1 });
    // Staleness is a function of when the index is built, and the threshold is stated.
    const later = buildOperationalIndex(snapshot, '2026-09-04T00:00:00.000Z');
    assert.deepEqual(later.signals.staleObservationNodeIds, ['reasoner']);
    assert.equal(later.thresholds.observationStaleAfterMs, 24 * 60 * 60 * 1_000);

    const found = queryOperationalIndex(index, 'run scenario');
    assert.deepEqual(found.results.map(entry => entry.nodeId), ['target']);
    assert.equal(queryOperationalIndex(index, 'unique private').total, 0);
    assert.deepEqual(queryOperationalIndex(index, '', { maturity: 'experimental' }).results.map(entry => entry.nodeId), ['target']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('validates a result manifest against the identity space and refuses a sidecar without knowledge time', () => {
  assert.equal(RESULT_MANIFEST_SCHEMA.$id, 'https://notations.systems/contracts/result-manifest/v1');
  const manifest = parseResultManifest({
    schema: 'notations.result-manifest.v1',
    manifestId: 'result-freeport-capacity-1',
    queryId: 'capacity-query-1',
    corpusBuild: { buildId: 'corpus-2026.09.02', knownAt: NOW },
    methodology: { methodologyId: 'payload-methodology', version: '0.1.0' },
    knownAt: NOW,
    result: { metric: 'capacity', value: 1200000, unit: 'tonnes_per_year' },
    entitiesUsed: ['notation://entity/notationsystems/freeport-plant'],
    assertionsUsed: ['notation://observation/notationsystems/freeport-capacity-2026-1'],
    evidenceUsed: ['notation://artifact/notationsystems/freeport-capacity-report-2026'],
    computations: [{ transformId: 'notation://transform/notationsystems/capacity-normalization-v1', outputIds: ['notation://state/notationsystems/freeport-capacity-current'], deterministic: true, parametersSha256: null }],
    uncertainties: [{ kind: 'source_disagreement', summary: 'One supporting report uses a different effective date.' }],
    contradictions: ['notation://observation/notationsystems/freeport-capacity-conflict-2026-1'],
    verification: { status: 'partially_verified', checkedAt: NOW },
  });
  assert.equal(manifest.verification.status, 'partially_verified');
  assert.throws(() => parseResultManifest({ ...manifest, knownAt: '' }), code('CONTROL_PLANE_COMMAND_INVALID'));
  // A bare date is not a knowledge time: the offset is part of the fact.
  assert.throws(() => parseResultManifest({ ...manifest, knownAt: '2026-09-02' }), code('CONTROL_PLANE_COMMAND_INVALID'));
  // An authority identity is not evidence.
  assert.throws(() => parseResultManifest({ ...manifest, evidenceUsed: ['notation://key/notationsystems/k-1'] }), code('CONTROL_PLANE_COMMAND_INVALID'));
});

test('a retry of the same command is a duplicate, not a conflict, however late it arrives', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notations-control-plane-'));
  try {
    let now = NOW;
    const plane = ControlPlane.fromPath(join(directory, 'retry.jsonl'), () => now);
    const command = node('twice', 'api', READ);
    const first = await plane.command(command);
    assert.equal(first.outcome, 'appended');
    // Five minutes later the same bytes arrive again. Server receipt time is not part of
    // the command, so this is the same command — and used to be a 409.
    now = '2026-09-02T00:05:00.000Z';
    const again = await plane.command(command);
    assert.equal(again.outcome, 'duplicate');
    assert.equal(again.event.recordHash, first.event.recordHash);
    // The same id with different content is still a conflict.
    await assert.rejects(plane.command({ ...command, node: { ...command.node, description: 'Something else entirely.' } }), code('EVENT_ID_CONFLICT'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('records a capability maturity when declared, invents none when not, and admits a critical observation', async () => {
  const { directory, plane } = await fixture();
  try {
    const declared = { capabilityId: 'later.read', label: 'Later', description: 'Planned, not built.', mode: 'observe', approval: 'automatic', maturity: 'planned', methodologyVersion: 'method/0.1.0' };
    const registered = await submit(plane, node('mixed', 'api', [...READ, declared]));
    const [bare, planned] = registered.snapshot.nodes[0].capabilities;
    assert.equal('maturity' in bare, false, 'an undeclared maturity is absent, not defaulted');
    assert.equal(planned.maturity, 'planned');
    assert.equal(planned.methodologyVersion, 'method/0.1.0');
    await assert.rejects(submit(plane, node('vague', 'api', [{ ...declared, maturity: 'shipped' }])), code('CONTROL_PLANE_COMMAND_INVALID'));

    const critical = await submit(plane, { requestId: 'critical', actorId: 'monitor:one', submittedAt: NOW, action: 'record_observation', nodeId: 'mixed', health: 'critical', observedAt: NOW, source: 'health_check', detail: 'A dependency the node relies on reports failure.' });
    assert.equal(critical.snapshot.nodes[0].health, 'critical');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
