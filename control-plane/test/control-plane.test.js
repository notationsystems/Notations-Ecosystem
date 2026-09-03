import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ControlPlane } from '../src/control-plane.js';
import { ControlPlaneError } from '../src/errors.js';
import { observePayloadTerminal } from '../src/adapters/payload-terminal.js';
import { payloadTerminalProfile } from '../src/profiles/payload-terminal.js';
import { securityConstellationProfile } from '../src/profiles/security-constellation.js';
import { notationDataFabricProfile } from '../src/profiles/notation-data-fabric.js';
import { canonicalURI, parseCanonicalURI } from '../src/identity/canonical-uri.js';
import { attestationPayload } from '../src/security/attestation.js';
import { buildOperationalIndex, queryOperationalIndex } from '../src/indexing/operational-index.js';

const NOW = '2026-09-02T00:00:00.000Z';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'notations-control-plane-'));
  const plane = ControlPlane.fromPath(join(directory, 'control-plane.jsonl'), () => NOW);
  return { directory, plane };
}

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
    await submit(plane, node('payload-terminal', 'api', [{ capabilityId: 'world.read', label: 'Read evidence-backed world state', description: 'Returns a published world projection.', mode: 'observe', approval: 'automatic' }]));
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
      plane.command({ ...node('unsafe-node', 'api', [{ capabilityId: 'world.read', label: 'Read world state', description: 'Reads a world projection.', mode: 'observe', approval: 'automatic' }]), node: { ...node('unsafe-node', 'api', [{ capabilityId: 'world.read', label: 'Read world state', description: 'Reads a world projection.', mode: 'observe', approval: 'automatic' }]).node, metadata: { api_token: 'must-not-persist' } } }),
      error => error instanceof ControlPlaneError && error.code === 'CONTROL_PLANE_COMMAND_INVALID',
    );

    const first = await submit(plane, node('payload-terminal', 'api', [{ capabilityId: 'world.read', label: 'Read world state', description: 'Reads a world projection.', mode: 'observe', approval: 'automatic' }]));
    await assert.rejects(
      plane.command({ ...node('another-node', 'api', [{ capabilityId: 'world.read', label: 'Read world state', description: 'Reads a world projection.', mode: 'observe', approval: 'automatic' }]), expectedRevision: null }),
      error => error instanceof ControlPlaneError && error.code === 'REVISION_CONFLICT',
    );
    assert.ok(first.snapshot.revision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('applies the detailed Payload profile as one atomic ecosystem twin', async () => {
  const { directory, plane } = await fixture();
  try {
    const profile = payloadTerminalProfile();
    const applied = await plane.applyProfile({ requestId: 'bootstrap-payload', actorId: 'operator:local', submittedAt: NOW, expectedRevision: null }, profile);
    assert.equal(applied.event.kind, 'profile_applied');
    assert.equal(applied.snapshot.nodes.length, profile.nodes.length);
    assert.equal(applied.snapshot.relations.length, profile.relations.length);
    assert.equal(applied.snapshot.nodes.find(entry => entry.nodeId === 'payload-corpus').metadata.authority, 'canonical');

    const execution = await submit(plane, { requestId: 'compile-payload-read-model', actorId: 'reasoner:one', submittedAt: NOW, action: 'request_capability', coordinationId: 'coord-payload-compile', requesterNodeId: 'payload-mcp', targetNodeId: 'payload-corpus', capabilityId: 'read-model.compile', requestedMode: 'execute', purpose: 'Prepare a policy-filtered query projection for an operator-approved corpus update.' });
    assert.equal(execution.snapshot.coordination[0].status, 'approval_required');
    assert.equal(execution.snapshot.coordination[0].dispatch, 'not_dispatched');

    const repeated = await plane.applyProfile({ requestId: 'bootstrap-payload', actorId: 'operator:local', submittedAt: NOW, expectedRevision: null }, profile);
    assert.equal(repeated.outcome, 'duplicate');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('converts a trusted Payload health response into a bounded observation', async () => {
  const observation = await observePayloadTerminal(
    { PAYLOAD_TERMINAL_URL: 'https://payload.example' },
    async url => {
      assert.equal(url.toString(), 'https://payload.example/api/health');
      return new Response(JSON.stringify({ status: 'operational', platform: 'Payload Terminal', version: '1.0.0' }), { status: 200 });
    },
    () => NOW,
  );
  assert.deepEqual(observation, {
    nodeId: 'payload-terminal', health: 'healthy', observedAt: NOW, source: 'health_check', detail: 'Payload Terminal reported operational at HTTP 200; 1.0.0.',
  });
});

test('never probes arbitrary insecure non-loopback Payload URLs', async () => {
  await assert.rejects(
    observePayloadTerminal({ PAYLOAD_TERMINAL_URL: 'http://payload.example' }),
    error => error instanceof ControlPlaneError && error.code === 'PAYLOAD_ADAPTER_NOT_CONFIGURED',
  );
});

test('materializes independently signed, bounded internal security posture', async () => {
  const { directory, plane } = await fixture();
  try {
    const profile = securityConstellationProfile();
    await plane.applyProfile({ requestId: 'bootstrap-security', actorId: 'operator:local', submittedAt: NOW, expectedRevision: null }, profile);
    const snapshot = await plane.snapshot();
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const attestation = {
      attestationId: 'attestation-crypto-1',
      subjectNodeId: 'notations-key-lifecycle',
      category: 'cryptography',
      status: 'healthy',
      observedAt: NOW,
      expiresAt: '2026-09-03T00:00:00.000Z',
      summary: 'Encryption policy and key rotation controls meet the current internal posture baseline.',
      signerId: 'security-collector-1',
    };
    attestation.signature = sign(null, Buffer.from(JSON.stringify(attestationPayload(attestation))), privateKey).toString('base64url');
    const result = await plane.recordSecurityAttestation({
      requestId: 'record-crypto-posture', actorId: 'security-collector-1', submittedAt: NOW, expectedRevision: snapshot.revision, attestation,
    }, { NOTATIONS_SECURITY_ATTESTERS: JSON.stringify({ 'security-collector-1': publicKey.export({ format: 'jwk' }).x }) });
    const posture = result.snapshot.nodes.find(entry => entry.nodeId === 'notations-key-lifecycle').security;
    assert.equal(posture.overall, 'healthy');
    assert.equal(posture.attestations[0].category, 'cryptography');
    assert.equal(posture.attestations[0].status, 'healthy');
    assert.equal(posture.attestations[0].freshness, 'current');
    assert.equal(posture.attestations[0].signerId, 'security-collector-1');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rebuilds a narrow searchable operational index from existing control-plane state', async () => {
  const { directory, plane } = await fixture();
  try {
    await plane.applyProfile({ requestId: 'bootstrap-payload-index', actorId: 'operator:local', submittedAt: NOW, expectedRevision: null }, payloadTerminalProfile());
    const snapshot = await plane.snapshot();
    await plane.command({
      requestId: 'index-purpose-boundary', actorId: 'reasoner:one', submittedAt: NOW, expectedRevision: snapshot.revision, action: 'request_capability',
      coordinationId: 'coord-index-purpose', requesterNodeId: 'payload-mcp', targetNodeId: 'payload-terminal', capabilityId: 'physical-economy.query', requestedMode: 'observe', purpose: 'unique private reasoning purpose that must not enter the index',
    });
    const index = buildOperationalIndex(await plane.snapshot(), NOW);
    assert.equal(index.schema, 'notations.control-plane.operational-index.v1');
    assert.equal(index.capabilities.some(capability => capability.capabilityId === 'physical-economy.query'), true);
    assert.equal(index.signals.unobservedNodeIds.includes('payload-terminal'), true);
    const result = queryOperationalIndex(index, 'physical economy');
    assert.equal(result.results.some(node => node.nodeId === 'payload-terminal'), true);
    assert.equal(JSON.stringify(index).includes('unique private reasoning purpose'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('binds an ecosystem to the canonical data fabric without copying its evidence', async () => {
  const { directory, plane } = await fixture();
  try {
    await plane.applyProfile({ requestId: 'bootstrap-payload-fabric', actorId: 'operator:local', submittedAt: NOW, expectedRevision: null }, payloadTerminalProfile());
    let snapshot = await plane.snapshot();
    const fabricProfile = notationDataFabricProfile();
    await plane.applyProfile({ requestId: 'bootstrap-notation-fabric', actorId: 'operator:local', submittedAt: NOW, expectedRevision: snapshot.revision }, fabricProfile);
    snapshot = await plane.snapshot();
    const manifest = {
      schema: 'notations.fabric-sync-manifest.v1',
      syncId: 'payload-corpus-canonical-state',
      systemNodeId: 'payload-corpus',
      systemIdentity: canonicalURI('node', 'payload', 'payload-corpus'),
      fabricNodeId: 'notation-canonical-state',
      mode: 'event_stream',
      authority: 'canonical_state',
      identityKinds: ['source', 'artifact', 'entity', 'observation', 'claim', 'dataset', 'state', 'transform', 'proof'],
      representations: ['object', 'graph', 'spatial', 'vector', 'sql', 'compute'],
      provenanceRequired: true,
      knownAtRequired: true,
    };
    const registered = await plane.registerFabricSync({
      requestId: 'register-payload-corpus-fabric', actorId: 'operator:local', submittedAt: NOW, expectedRevision: snapshot.revision, manifest,
    });
    assert.equal(registered.event.kind, 'fabric_sync_registered');
    assert.equal(registered.snapshot.fabric.identityScheme, 'notation://{kind}/{authority}/{local-id}');
    assert.deepEqual(registered.snapshot.fabric.syncs[0], manifest);
    assert.deepEqual(parseCanonicalURI(manifest.systemIdentity), { uri: manifest.systemIdentity, kind: 'node', authority: 'payload', localId: 'payload-corpus' });
    const index = buildOperationalIndex(registered.snapshot, NOW);
    assert.equal(index.fabric.registeredSyncs[0].fabricNodeId, 'notation-canonical-state');
    assert.equal(index.facets.fabricAuthority.canonical_state, 1);

    await assert.rejects(
      plane.registerFabricSync({
        requestId: 'invalid-payload-fabric', actorId: 'operator:local', submittedAt: NOW, expectedRevision: registered.snapshot.revision,
        manifest: { ...manifest, syncId: 'invalid-payload-sync', knownAtRequired: false },
      }),
      error => error instanceof ControlPlaneError && error.code === 'CONTROL_PLANE_COMMAND_INVALID',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
