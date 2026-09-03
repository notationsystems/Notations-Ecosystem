import { ControlPlaneError, invalid } from './errors.js';
import { digest, HashJournal } from './journal.js';
import { parseCommand } from './validation.js';
import { buildConstellation } from './security/evidence.js';
import { LOCAL_PRINCIPAL } from './security/identity.js';
import { permissionForAction, requireActorBinding, requireNodeBinding, requirePermission, requireSeparationOfDuties } from './security/policy.js';

const SCHEMA = 'notations.control-plane.snapshot.v1';

/**
 * How far in the past a command may have been signed and still be accepted.
 *
 * The event id already makes an identical replay a no-op, but a bounded freshness
 * window means a captured command cannot be held indefinitely and released at a
 * chosen moment. Clock skew in the other direction is bounded separately and more
 * tightly, because a future-dated command would otherwise sit in history claiming to
 * predate events it actually followed.
 */
const DEFAULT_MAX_COMMAND_AGE_SECONDS = 900;
const MAX_CLOCK_SKEW_SECONDS = 60;

function frozen(value) {
  return Object.freeze(value);
}

function derive(records) {
  const nodes = new Map();
  const relations = new Map();
  const observations = new Map();
  const coordination = new Map();
  const posture = new Map();

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
      case 'security_posture_recorded':
        posture.set(event.posture.nodeId, event.posture);
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
      default:
        throw new ControlPlaneError(503, 'JOURNAL_CORRUPT', `Journal contains unsupported event kind ${event.kind}.`, 'Restore a journal produced by a compatible control-plane release.');
    }
  }
  return { nodes, relations, observations, coordination, posture };
}

function makeSnapshot(records, durability, generatedAt) {
  const state = derive(records);
  const nodes = [...state.nodes.values()]
    .map(node => {
      const observed = state.observations.get(node.nodeId);
      const posture = state.posture.get(node.nodeId);
      return frozen({
        ...node,
        health: observed?.health ?? 'unknown',
        lastObservedAt: observed?.observedAt ?? null,
        lastObservation: observed ? { source: observed.source, detail: observed.detail } : null,
        security: posture ? frozen({ attestedAt: posture.attestedAt, method: posture.method, attestedBy: posture.attestedBy, signals: posture.signals }) : null,
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
    constellation: buildConstellation(Object.fromEntries(state.posture), { now: Date.parse(generatedAt) || Date.now() }),
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
    case 'record_security_posture': {
      if (!state.nodes.has(command.nodeId)) throw new ControlPlaneError(404, 'NODE_NOT_FOUND', `Node ${command.nodeId} is not registered.`, 'Register the node before attesting its security posture.');
      return {
        ...base,
        kind: 'security_posture_recorded',
        posture: frozen({
          nodeId: command.nodeId,
          attestedAt: command.attestedAt,
          attestedBy: command.actorId,
          method: command.method,
          signals: frozen(command.signals.map(frozen)),
        }),
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
      // Separation of duties: the actor that proposed an execution intent may not be
      // the actor that approves it, whatever roles it holds. This is what stops an
      // agent from granting itself a capability.
      requireSeparationOfDuties(command.actorId, request.requestedBy);
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

/**
 * The subject node a command concerns, for node-scoped credentials. `null` means the
 * command is not about one particular node.
 */
function subjectNode(command) {
  switch (command.action) {
    case 'register_node':
      return command.node.nodeId;
    case 'declare_relation':
      // A relation is declared from the source's point of view, so the source is the
      // node a scoped credential must be entitled to speak for.
      return command.sourceNodeId;
    case 'record_observation':
    case 'record_security_posture':
      return command.nodeId;
    case 'request_capability':
      return command.requesterNodeId;
    default:
      return null;
  }
}

export class ControlPlane {
  constructor(journal, clock = () => new Date().toISOString(), { maxCommandAgeSeconds = DEFAULT_MAX_COMMAND_AGE_SECONDS } = {}) {
    this.journal = journal;
    this.clock = clock;
    this.maxCommandAgeSeconds = maxCommandAgeSeconds;
  }

  static fromPath(path, clock, options = {}) {
    const { keyStore = null, requireSignatures = false, anchor = true, ...rest } = options;
    return new ControlPlane(new HashJournal(path, { keyStore, requireSignatures, anchor }), clock, rest);
  }

  /**
   * A control plane configured the way the server configures itself.
   *
   * Offline tools — seeding, probing, attesting — write to the same journal as the
   * server. If they skipped signing, the chain would be signed only where the server
   * happened to be the writer, and "is this history signed?" would have no useful
   * answer. This makes the signing configuration a property of the journal rather
   * than of whoever opened it.
   */
  static async fromEnvironment(journalPath, environment = process.env, clock = undefined) {
    const [{ KeyStore }, { KeyEncryptionKey }] = await Promise.all([
      import('./security/crypto/signing.js'),
      import('./security/crypto/envelope.js'),
    ]);
    const enabled = !['0', 'false', 'no', 'off'].includes(String(environment.CONTROL_PLANE_SIGNING ?? '').toLowerCase());
    let keyStore = null;
    if (enabled) {
      const kek = environment.CONTROL_PLANE_KEK ? KeyEncryptionKey.fromBase64('kek-primary', environment.CONTROL_PLANE_KEK) : null;
      keyStore = await KeyStore.load({ filePath: environment.CONTROL_PLANE_KEYSTORE || 'data/keystore.json', kek, create: true });
    }
    return ControlPlane.fromPath(journalPath, clock, {
      keyStore,
      requireSignatures: ['1', 'true', 'yes', 'on'].includes(String(environment.CONTROL_PLANE_REQUIRE_SIGNATURES ?? '').toLowerCase()),
      maxCommandAgeSeconds: Number.parseInt(environment.CONTROL_PLANE_MAX_COMMAND_AGE_S ?? '', 10) || undefined,
    });
  }

  async snapshot() {
    const records = await this.journal.read();
    return makeSnapshot(records, 'local_jsonl_single_writer', this.clock());
  }

  async events(afterEventId, { limit = null } = {}) {
    const records = await this.journal.read();
    let selected = records;
    if (afterEventId) {
      const index = records.findIndex(record => record.event.eventId === afterEventId);
      if (index < 0) throw new ControlPlaneError(409, 'CURSOR_UNKNOWN', `Event cursor ${afterEventId} is not present in the journal.`, 'Refresh the complete snapshot and resume with its eventCursor.');
      selected = records.slice(index + 1);
    }
    const truncated = limit !== null && selected.length > limit;
    const page = truncated ? selected.slice(0, limit) : selected;
    return frozen({
      schema: 'notations.control-plane.events.v1',
      revision: records.length ? records[records.length - 1].recordHash : null,
      eventCursor: records.length ? records[records.length - 1].event.eventId : null,
      events: page,
      truncated,
      nextCursor: truncated && page.length ? page[page.length - 1].event.eventId : null,
    });
  }

  /**
   * Append one coordination command.
   *
   * @param {unknown} input the caller's command
   * @param {object} [context]
   * @param {import('./security/identity.js').Principal} [context.principal] the authenticated caller
   */
  async command(input, context = {}) {
    const principal = context.principal ?? LOCAL_PRINCIPAL;
    const command = parseCommand(input);

    // Authorization happens before any state is read or written, and every check
    // fails closed: an unrecognised action has no permission, a principal without the
    // permission is refused, and an actor identity that is not bound to the
    // credential cannot be written into history.
    requirePermission(principal, permissionForAction(command.action));
    requireActorBinding(principal, command.actorId);
    const subject = subjectNode(command);
    if (subject) requireNodeBinding(principal, subject);

    const recordedAt = this.clock();
    const submittedAtMs = Date.parse(command.submittedAt);
    const recordedAtMs = Date.parse(recordedAt);
    if (submittedAtMs > recordedAtMs + MAX_CLOCK_SKEW_SECONDS * 1000) {
      throw invalid('submittedAt is more than one minute ahead of the control-plane clock.', 'Correct the caller clock and submit the same command again.');
    }
    if (this.maxCommandAgeSeconds > 0 && submittedAtMs < recordedAtMs - this.maxCommandAgeSeconds * 1000) {
      throw new ControlPlaneError(422, 'COMMAND_STALE', `submittedAt is older than the ${this.maxCommandAgeSeconds}-second freshness window.`, 'Re-sign the command with a current timestamp. A captured command cannot be replayed at a chosen moment.');
    }

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
}
