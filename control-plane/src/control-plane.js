import { ControlPlaneError, invalid } from './errors.js';
import { digest, HashJournal } from './journal.js';
import { parseCommand, parseProfileApplication } from './validation.js';

const SCHEMA = 'notations.control-plane.snapshot.v1';

function frozen(value) {
  return Object.freeze(value);
}

function derive(records) {
  const nodes = new Map();
  const relations = new Map();
  const observations = new Map();
  const coordination = new Map();

  for (const { event } of records) {
    switch (event.kind) {
      case 'node_registered':
        nodes.set(event.node.nodeId, event.node);
        break;
      case 'relation_declared':
        relations.set(event.relation.relationId, event.relation);
        break;
      case 'observation_recorded':
        observations.set(event.observation.nodeId, event.observation);
        break;
      case 'coordination_requested':
        coordination.set(event.request.coordinationId, event.request);
        break;
      case 'coordination_resolved': {
        const request = coordination.get(event.coordinationId);
        if (request) {
          coordination.set(event.coordinationId, frozen({
            ...request,
            status: event.decision,
            resolvedAt: event.resolvedAt,
            resolvedBy: event.resolvedBy,
            resolutionNote: event.note,
          }));
        }
        break;
      }
      case 'profile_applied':
        for (const node of event.nodes) nodes.set(node.nodeId, node);
        for (const relation of event.relations) relations.set(relation.relationId, relation);
        break;
      default:
        throw new ControlPlaneError(503, 'JOURNAL_CORRUPT', `Journal contains unsupported event kind ${event.kind}.`, 'Restore a journal produced by a compatible control-plane release.');
    }
  }
  return { nodes, relations, observations, coordination };
}

function makeSnapshot(records, durability, generatedAt) {
  const state = derive(records);
  const nodes = [...state.nodes.values()]
    .map(node => {
      const observed = state.observations.get(node.nodeId);
      return frozen({
        ...node,
        health: observed?.health ?? 'unknown',
        lastObservedAt: observed?.observedAt ?? null,
        lastObservation: observed ? { source: observed.source, detail: observed.detail } : null,
      });
    })
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));

  return frozen({
    schema: SCHEMA,
    revision: records.length ? records[records.length - 1].recordHash : null,
    eventCursor: records.length ? records[records.length - 1].event.eventId : null,
    durability,
    generatedAt,
    nodes,
    relations: [...state.relations.values()].sort((left, right) => left.relationId.localeCompare(right.relationId)),
    coordination: [...state.coordination.values()].sort((left, right) => left.coordinationId.localeCompare(right.coordinationId)),
  });
}

function newEventId(command) {
  return `control-plane:${digest({ actorId: command.actorId, requestId: command.requestId })}`;
}

function eventBase(command, recordedAt) {
  return {
    eventId: newEventId(command),
    recordedAt,
    commandHash: digest(command.raw),
  };
}

function profileEventBase(command, profile, recordedAt) {
  return {
    eventId: `control-plane-profile:${digest({ actorId: command.actorId, requestId: command.requestId, profileId: profile.profileId, version: profile.version })}`,
    recordedAt,
    commandHash: digest(command.raw),
  };
}

function actionEvent(command, state, recordedAt) {
  const base = eventBase(command, recordedAt);

  switch (command.action) {
    case 'register_node': {
      const prior = state.nodes.get(command.node.nodeId);
      return {
        ...base,
        kind: 'node_registered',
        node: frozen({
          ...command.node,
          registeredAt: prior?.registeredAt ?? recordedAt,
          updatedAt: recordedAt,
        }),
      };
    }
    case 'declare_relation': {
      if (!state.nodes.has(command.sourceNodeId) || !state.nodes.has(command.targetNodeId)) {
        throw new ControlPlaneError(404, 'NODE_NOT_FOUND', 'A relation can only join nodes already present in the control plane.', 'Register both ecosystems before declaring their relationship.');
      }
      if (command.sourceNodeId === command.targetNodeId) throw invalid('A control-plane relation cannot connect a node to itself.');
      return {
        ...base,
        kind: 'relation_declared',
        relation: frozen({
          relationId: command.relationId,
          sourceNodeId: command.sourceNodeId,
          targetNodeId: command.targetNodeId,
          kind: command.kind,
          description: command.description,
          declaredAt: recordedAt,
        }),
      };
    }
    case 'record_observation': {
      if (!state.nodes.has(command.nodeId)) throw new ControlPlaneError(404, 'NODE_NOT_FOUND', `Node ${command.nodeId} is not registered.`, 'Register the node before recording its health.');
      return {
        ...base,
        kind: 'observation_recorded',
        observation: frozen({ nodeId: command.nodeId, health: command.health, observedAt: command.observedAt, source: command.source, detail: command.detail }),
      };
    }
    case 'request_capability': {
      const requester = state.nodes.get(command.requesterNodeId);
      const target = state.nodes.get(command.targetNodeId);
      if (!requester || !target) throw new ControlPlaneError(404, 'NODE_NOT_FOUND', 'Capability requests require both a registered requester and target node.', 'Register both nodes before coordinating work between them.');
      const capability = target.capabilities.find(candidate => candidate.capabilityId === command.capabilityId);
      if (!capability) throw new ControlPlaneError(404, 'CAPABILITY_NOT_FOUND', `Node ${target.nodeId} does not declare capability ${command.capabilityId}.`, 'Request a capability listed in the current control-plane snapshot.');
      if (capability.mode !== command.requestedMode) throw new ControlPlaneError(422, 'CAPABILITY_MODE_MISMATCH', `Capability ${capability.capabilityId} is declared for ${capability.mode}, not ${command.requestedMode}.`, 'Request the mode declared by the target; widening a capability requires an explicit node revision.');
      if (state.coordination.has(command.coordinationId)) throw new ControlPlaneError(409, 'COORDINATION_EXISTS', `Coordination id ${command.coordinationId} already exists.`, 'Reuse the original command for a retry or allocate a new coordination id for a new intent.');
      return {
        ...base,
        kind: 'coordination_requested',
        request: frozen({
          coordinationId: command.coordinationId,
          requesterNodeId: requester.nodeId,
          targetNodeId: target.nodeId,
          capabilityId: capability.capabilityId,
          requestedMode: command.requestedMode,
          purpose: command.purpose,
          requestedBy: command.actorId,
          requestedAt: recordedAt,
          dispatch: 'not_dispatched',
          status: capability.approval === 'operator' ? 'approval_required' : 'ready',
          resolvedAt: null,
          resolvedBy: null,
          resolutionNote: null,
        }),
      };
    }
    case 'resolve_coordination': {
      const request = state.coordination.get(command.coordinationId);
      if (!request) throw new ControlPlaneError(404, 'COORDINATION_NOT_FOUND', `Coordination id ${command.coordinationId} is not registered.`, 'Request the capability before resolving it.');
      if (request.status !== 'approval_required') throw new ControlPlaneError(409, 'COORDINATION_NOT_PENDING', `Coordination id ${command.coordinationId} is ${request.status}, not awaiting operator approval.`, 'Only an execution intent awaiting approval can be resolved.');
      return {
        ...base,
        kind: 'coordination_resolved',
        coordinationId: command.coordinationId,
        decision: command.decision,
        resolvedAt: recordedAt,
        resolvedBy: command.actorId,
        note: command.note,
      };
    }
    default:
      throw invalid(`Unsupported action ${command.action}.`);
  }
}

export class ControlPlane {
  constructor(journal, clock = () => new Date().toISOString()) {
    this.journal = journal;
    this.clock = clock;
  }

  static fromPath(path, clock) {
    return new ControlPlane(new HashJournal(path), clock);
  }

  async snapshot() {
    const records = await this.journal.read();
    return makeSnapshot(records, 'local_jsonl_single_writer', this.clock());
  }

  async events(afterEventId) {
    const records = await this.journal.read();
    let selected = records;
    if (afterEventId) {
      const index = records.findIndex(record => record.event.eventId === afterEventId);
      if (index < 0) throw new ControlPlaneError(409, 'CURSOR_UNKNOWN', `Event cursor ${afterEventId} is not present in the journal.`, 'Refresh the complete snapshot and resume with its eventCursor.');
      selected = records.slice(index + 1);
    }
    return frozen({
      schema: 'notations.control-plane.events.v1',
      revision: records.length ? records[records.length - 1].recordHash : null,
      eventCursor: records.length ? records[records.length - 1].event.eventId : null,
      events: selected,
    });
  }

  async command(input) {
    const command = parseCommand(input);
    const recordedAt = this.clock();
    if (Date.parse(command.submittedAt) > Date.parse(recordedAt) + 60_000) throw invalid('submittedAt is more than one minute ahead of the control-plane clock.', 'Correct the caller clock and submit the same command again.');
    const records = await this.journal.read();
    const event = actionEvent(command, derive(records), recordedAt);
    const append = await this.journal.append(event, command.expectedRevision);
    const current = await this.journal.read();
    return frozen({
      schema: 'notations.control-plane.command-result.v1',
      outcome: append.outcome,
      event: { eventId: append.record.event.eventId, kind: append.record.event.kind, recordHash: append.record.recordHash },
      snapshot: makeSnapshot(current, 'local_jsonl_single_writer', this.clock()),
    });
  }

  /**
   * Atomically materialize a versioned, built-in ecosystem profile. This is
   * the bridge between a detailed real-world ecosystem and a generic graph;
   * the visual dock reads the same profile for its layers and labels.
   */
  async applyProfile(input, profile) {
    const command = parseProfileApplication(input);
    const recordedAt = this.clock();
    if (Date.parse(command.submittedAt) > Date.parse(recordedAt) + 60_000) throw invalid('submittedAt is more than one minute ahead of the control-plane clock.', 'Correct the caller clock and submit the same profile application again.');
    const records = await this.journal.read();
    const state = derive(records);
    const nodes = profile.nodes.map(node => frozen({
      ...node,
      registeredAt: state.nodes.get(node.nodeId)?.registeredAt ?? recordedAt,
      updatedAt: recordedAt,
    }));
    const relations = profile.relations.map(relation => frozen({ ...relation, declaredAt: recordedAt }));
    const event = frozen({
      ...profileEventBase(command, profile, recordedAt),
      kind: 'profile_applied',
      profile: { profileId: profile.profileId, version: profile.version },
      nodes,
      relations,
    });
    const append = await this.journal.append(event, command.expectedRevision);
    const current = await this.journal.read();
    return frozen({
      schema: 'notations.control-plane.command-result.v1',
      outcome: append.outcome,
      event: { eventId: append.record.event.eventId, kind: append.record.event.kind, recordHash: append.record.recordHash },
      snapshot: makeSnapshot(current, 'local_jsonl_single_writer', this.clock()),
    });
  }
}
