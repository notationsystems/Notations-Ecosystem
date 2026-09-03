import { dirname, join, resolve } from 'node:path';
import { ControlPlaneError, invalid } from './errors.js';
import { digest, HashJournal } from './journal.js';
import { parseCommand } from './validation.js';
import { buildConstellation } from './security/evidence.js';
import { decisionUri, nodeUri, tryUri } from './identity/uri.js';
import { LOCAL_PRINCIPAL } from './security/identity.js';
import { permissionForAction, requireActorBinding, requireNodeBinding, requireOperatorLocal, requirePermission, requireSeparationOfDuties } from './security/policy.js';
import { parseAttesters, postureStatement, verifyPostureSignature } from './security/attestation.js';

const SCHEMA = 'notations.control-plane.snapshot.v1';

/**
 * Where a journal's signing key lives when nothing says otherwise: beside the journal.
 *
 * Exported so the server derives the same default rather than keeping a second copy of
 * the rule — one of them would eventually be changed alone.
 */
export function defaultKeystorePath(journalPath) {
  return join(dirname(resolve(journalPath)), 'keystore.json');
}

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

/** The identity grammar every fabric sync names its system in (docs/SUBSTRATE.md). */
const IDENTITY_SCHEME = 'notation://<class>/<namespace>/<local-id>[@<version>]';

/**
 * Records written by the plane this one was merged with (codex/control-plane-backend)
 * recorded posture per category with four statuses. Read onto this plane's dimensions and
 * five states, so a journal either plane wrote is one journal. A category nothing maps is
 * kept under its own name, where `buildConstellation` counts it as unrecognised rather
 * than dropping it: a record cannot be withdrawn, and a fold that skips one silently is
 * how two readers of one history come to disagree.
 */
const LEGACY_CATEGORY = Object.freeze({ identity: 'identity', cryptography: 'key_lifecycle', exposure: 'exposure', supply_chain: 'dependency_risk', resilience: 'backup', control_plane_integrity: 'control_plane_integrity' });
const LEGACY_STATUS = Object.freeze({ healthy: 'strong', degraded: 'weak', critical: 'failing', unknown: 'unknown' });

function foldLegacyAttestation(posture, event) {
  const attestation = event.attestation ?? {};
  if (typeof attestation.subjectNodeId !== 'string') return;
  const dimension = LEGACY_CATEGORY[attestation.category] ?? String(attestation.category);
  const signal = {
    dimension,
    state: LEGACY_STATUS[attestation.status] ?? 'unknown',
    ...(typeof attestation.summary === 'string' ? { summary: attestation.summary.slice(0, 280) } : {}),
    ...(attestation.expiresAt ? { expiresAt: attestation.expiresAt } : {}),
  };
  const prior = posture.get(attestation.subjectNodeId);
  const signals = [...(prior?.signals ?? []).filter(existing => existing.dimension !== dimension), signal];
  posture.set(attestation.subjectNodeId, frozen({
    nodeId: attestation.subjectNodeId,
    attestedAt: attestation.observedAt ?? event.recordedAt,
    attestedBy: event.verification?.signerId ?? attestation.signerId ?? 'unknown',
    // Produced and signed outside this plane's principal model: external to it by definition.
    method: 'external_audit',
    signals: frozen(signals.map(frozen)),
    signer: event.verification ? frozen({ signerId: event.verification.signerId, verifiedAt: event.verification.verifiedAt }) : null,
  }));
}

/**
 * The fabric, at the coordination layer.
 *
 * `FABRIC_AUTHORITY_LAYER` is which layer of the platform (docs/PLATFORM.md) each
 * authority lands in; the anchor node must declare that it provides it. `FABRIC_AUTHORITY_BY_ROLE`
 * is what a node's corpus role (docs/CORPUS.md) entitles it to be, and the asymmetry is
 * the doctrine: a projection never writes canonical truth (COR-009, PLAT-004), a feed
 * supplies evidence and nothing else, a transform returns derived state that is a
 * proposal until admitted (COR-006), and canonical state has one owner per domain
 * (COR-002) — so a hold binds as canonical state only when it owns a domain.
 */
const FABRIC_AUTHORITY_LAYER = Object.freeze({ evidence_source: 'evidence', canonical_state: 'canonical', projection: 'projection', derived_compute: 'compute' });
const FABRIC_AUTHORITY_BY_ROLE = Object.freeze({
  hold: Object.freeze(['canonical_state', 'evidence_source']),
  feed: Object.freeze(['evidence_source']),
  transform: Object.freeze(['derived_compute']),
  project: Object.freeze(['projection']),
  coordinate: Object.freeze(['canonical_state']),
});
const FABRIC_AUTHORITY_REMEDY = Object.freeze({
  canonical_state: 'Only a hold that owns a domain (corpus_owner_of), or the coordination journal itself, binds as canonical state. A projection never writes canonical truth (COR-009, PLAT-004).',
  evidence_source: 'Only a hold or a feed supplies evidence into the fabric.',
  projection: 'Only a project node binds as a projection; a projection is rebuildable by definition and owns nothing.',
  derived_compute: 'Only a transform binds as derived compute; what it returns is a proposal until admitted (COR-006).',
});

function derive(records) {
  const nodes = new Map();
  const relations = new Map();
  const observations = new Map();
  const coordination = new Map();
  const posture = new Map();
  const fabric = new Map();

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
      case 'fabric_sync_registered':
        // Written by this plane, or by the one it was merged with (no registeredBy then).
        fabric.set(event.manifest.syncId, frozen({ ...event.manifest, registeredBy: event.registeredBy ?? null, registeredAt: event.registeredAt ?? event.recordedAt }));
        break;
      // The two kinds below were written only by the merged plane. A fold over an
      // append-only history must be total over everything that history can hold.
      case 'profile_applied':
        for (const node of event.nodes ?? []) nodes.set(node.nodeId, node);
        for (const relation of event.relations ?? []) relations.set(relation.relationId, relation);
        break;
      case 'security_attested':
        foldLegacyAttestation(posture, event);
        break;
      default:
        throw new ControlPlaneError(503, 'JOURNAL_CORRUPT', `Journal contains unsupported event kind ${event.kind}.`, 'Restore a journal produced by a compatible control-plane release.');
    }
  }
  return { nodes, relations, observations, coordination, posture, fabric };
}

function makeSnapshot(records, durability, generatedAt) {
  const state = derive(records);
  const nodes = [...state.nodes.values()]
    .map(node => {
      const observed = state.observations.get(node.nodeId);
      const posture = state.posture.get(node.nodeId);
      return frozen({
        ...node,
        // The node's name in the one canonical identity space (docs/SUBSTRATE.md).
        // Derived here rather than stored: a name that had to be written down could
        // disagree with the id it names, and two spellings of one identity is exactly
        // what the typed space exists to prevent. `resolve()` still throws, so this is
        // a name and not an address.
        //
        // Null when the id cannot carry one — the plane's identifier grammar admits `:`
        // and `/`, which a segment may not. A mangled name would let two nodes collide,
        // and a thrown one would brick every later read of an append-only history.
        uri: tryUri(nodeUri, node.nodeId),
        health: observed?.health ?? 'unknown',
        lastObservedAt: observed?.observedAt ?? null,
        lastObservation: observed ? { source: observed.source, detail: observed.detail } : null,
        // `signer` is who vouched beyond the submitting principal: an independent collector
        // whose signature the plane verified, or null when the statement rests on the
        // principal's authority alone. Both are honest; the snapshot says which.
        security: posture ? frozen({ attestedAt: posture.attestedAt, method: posture.method, attestedBy: posture.attestedBy, signals: posture.signals, signer: posture.signer ?? null }) : null,
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
    coordination: [...state.coordination.values()]
      .map(record => frozen({ ...record, uri: tryUri(decisionUri, record.coordinationId) }))
      .sort((left, right) => left.coordinationId.localeCompare(right.coordinationId)),
    constellation: buildConstellation(Object.fromEntries(state.posture), { now: Date.parse(generatedAt) || Date.now() }),
    // Which systems participate in the canonical fabric, under which authority. Names and
    // closed vocabularies only: the fabric's bytes stay where the platform holds them.
    fabric: frozen({
      identityScheme: IDENTITY_SCHEME,
      syncs: [...state.fabric.values()].sort((left, right) => left.syncId.localeCompare(right.syncId)),
    }),
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

function actionEvent(command, state, recordedAt, { attesters = null } = {}) {
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
      // An independent signature, when one is offered, is verified before anything is
      // written, against public keys only. A statement the plane cannot verify is
      // refused; it is never recorded as "signed by someone".
      const signer = command.signature
        ? verifyPostureSignature({
          attesters,
          statement: postureStatement({ nodeId: command.nodeId, attestedAt: command.attestedAt, method: command.method, signals: command.signals, signerId: command.signerId }),
          signerId: command.signerId,
          signature: command.signature,
          clock: () => recordedAt,
        })
        : null;
      return {
        ...base,
        kind: 'security_posture_recorded',
        posture: frozen({
          nodeId: command.nodeId,
          attestedAt: command.attestedAt,
          attestedBy: command.actorId,
          method: command.method,
          signals: frozen(command.signals.map(frozen)),
          ...(signer ? { signer } : {}),
        }),
      };
    }
    case 'register_fabric_sync': {
      const { manifest } = command;
      const system = state.nodes.get(manifest.systemNodeId);
      if (!system) throw new ControlPlaneError(404, 'NODE_NOT_FOUND', `Fabric sync names system ${manifest.systemNodeId}, which is not registered.`, 'Register the system before binding it to the fabric.');
      const anchor = state.nodes.get(manifest.fabricNodeId);
      if (!anchor) throw new ControlPlaneError(404, 'NODE_NOT_FOUND', `Fabric sync names anchor ${manifest.fabricNodeId}, which is not registered.`, 'Register the platform node before binding systems to it.');

      const layer = FABRIC_AUTHORITY_LAYER[manifest.authority];
      const layers = String(anchor.metadata?.fabric_layers ?? '').split(/\s+/).filter(Boolean);
      if (!layers.includes(layer)) {
        throw new ControlPlaneError(422, 'FABRIC_ANCHOR_INVALID', `${anchor.nodeId} does not provide the ${layer} layer of the fabric${layers.length ? ` (it declares: ${layers.join(', ')})` : ' (it declares no fabric_layers)'}.`, 'Bind the system to a node whose metadata.fabric_layers names this layer. The platform node declares the layers platform/sql actually builds.');
      }

      const role = system.metadata?.corpus_role;
      const allowed = FABRIC_AUTHORITY_BY_ROLE[role];
      if (!allowed) throw new ControlPlaneError(422, 'FABRIC_AUTHORITY_MISMATCH', `${system.nodeId} declares no corpus role, so its authority over the fabric cannot be checked.`, 'Declare reference.corpus.role in the catalog and re-seed. Silence is not assent.');
      const ownsDomain = typeof system.metadata?.corpus_owner_of === 'string' && system.metadata.corpus_owner_of.trim().length > 0;
      if (!allowed.includes(manifest.authority) || (manifest.authority === 'canonical_state' && role === 'hold' && !ownsDomain)) {
        throw new ControlPlaneError(422, 'FABRIC_AUTHORITY_MISMATCH', `${system.nodeId} is a ${role} node${role === 'hold' && !ownsDomain ? ' that owns no domain' : ''} and may not bind to the fabric as ${manifest.authority}.`, FABRIC_AUTHORITY_REMEDY[manifest.authority]);
      }

      return {
        ...base,
        kind: 'fabric_sync_registered',
        manifest: frozen({ ...manifest, identityKinds: frozen([...manifest.identityKinds]), representations: frozen([...manifest.representations]) }),
        registeredBy: command.actorId,
        registeredAt: recordedAt,
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
    case 'register_fabric_sync':
      return command.manifest.systemNodeId;
    default:
      return null;
  }
}

export class ControlPlane {
  constructor(journal, clock = () => new Date().toISOString(), { maxCommandAgeSeconds = DEFAULT_MAX_COMMAND_AGE_SECONDS, attesters = null } = {}) {
    this.journal = journal;
    this.clock = clock;
    this.maxCommandAgeSeconds = maxCommandAgeSeconds;
    /** Trusted collectors' public keys, or null when posture rests on principals alone. */
    this.attesters = attesters;
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
   *
   * The key store follows the journal for the same reason, and it is not a
   * convenience. `data/keystore.json` resolved against the working directory means a
   * seed run from the repository root signs `control-plane/data/control-plane.jsonl`
   * with a key written to `<root>/data/keystore.json` — after which the server, started
   * from `control-plane/`, creates its own key, cannot find the one that signed the
   * chain, and refuses every read with `JOURNAL_CORRUPT`. Following the documented
   * commands was enough to produce it. The rollback anchor already lives beside the
   * journal; a signing key that does not is a key separated from the only history it
   * can verify, and a `CRYPTOGRAPHIC_SECRET` written wherever the operator happened to
   * be standing.
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
      keyStore = await KeyStore.load({ filePath: environment.CONTROL_PLANE_KEYSTORE || defaultKeystorePath(journalPath), kek, create: true });
    }
    return ControlPlane.fromPath(journalPath, clock, {
      keyStore,
      requireSignatures: ['1', 'true', 'yes', 'on'].includes(String(environment.CONTROL_PLANE_REQUIRE_SIGNATURES ?? '').toLowerCase()),
      maxCommandAgeSeconds: Number.parseInt(environment.CONTROL_PLANE_MAX_COMMAND_AGE_S ?? '', 10) || undefined,
      attesters: parseAttesters(environment.NOTATIONS_SECURITY_ATTESTERS),
    });
  }

  async snapshot() {
    const records = await this.journal.read();
    return makeSnapshot(records, 'local_jsonl_single_writer', this.clock());
  }

  /**
   * The state as it stood when a given event was the head of the journal.
   *
   * The same fold as `snapshot()` over a prefix of the same records, so there is one
   * derivation and not two: a client that replayed events itself would eventually
   * disagree with the plane about what they meant. The revision of the result is the
   * record hash at that cursor — a proof root a replica can re-derive — and the fold is
   * total over any prefix, because every prefix of an append-only chain was once the
   * whole of it.
   */
  async snapshotAt(eventId) {
    const records = await this.journal.read();
    const index = records.findIndex(record => record.event.eventId === eventId);
    if (index < 0) throw new ControlPlaneError(409, 'CURSOR_UNKNOWN', `Event cursor ${eventId} is not present in the journal.`, 'Refresh the complete snapshot and pick a cursor from its events.');
    return makeSnapshot(records.slice(0, index + 1), 'local_jsonl_single_writer', this.clock());
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
    requireOperatorLocal(principal, command.action, LOCAL_PRINCIPAL);
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
    const event = actionEvent(command, derive(records), recordedAt, { attesters: this.attesters });
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
