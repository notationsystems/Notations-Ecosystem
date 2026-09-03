import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ControlPlane } from '../src/control-plane.js';
import { ControlPlaneError } from '../src/errors.js';

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
