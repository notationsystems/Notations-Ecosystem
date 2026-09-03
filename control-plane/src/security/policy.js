/**
 * Authorization: what may this principal do, to which resource, in which context?
 *
 * Authentication answers "who is calling"; this module answers "may they". The two
 * are never interchangeable. Every privileged transition is checked here, centrally,
 * rather than by conditionals scattered through request handlers, so the answer to
 * "who can approve an execution intent?" is one table rather than an audit of every
 * code path.
 *
 * Two rules carry most of the weight:
 *
 *   Least privilege — a role grants the smallest set of permissions that lets its
 *   holder do its job. A monitor may record health; it may not approve anything.
 *
 *   Separation of duties — the actor that proposes an execution intent may not be
 *   the actor that approves it, whatever roles it holds. This is what stops an agent
 *   from granting itself a capability (SEC-011), and it holds even in single-token
 *   deployments because it is enforced on the recorded actor identity.
 */

import { ControlPlaneError } from '../errors.js';
import { lookup, sealedTable } from './table.js';

/** Every permission the control plane recognises. Unknown permissions fail closed. */
export const PERMISSIONS = sealedTable({
  SNAPSHOT_READ: 'snapshot.read',
  EVENTS_READ: 'events.read',
  NODE_REGISTER: 'node.register',
  RELATION_DECLARE: 'relation.declare',
  OBSERVATION_RECORD: 'observation.record',
  SECURITY_ATTEST: 'security.attest',
  CAPABILITY_REQUEST: 'capability.request',
  COORDINATION_RESOLVE: 'coordination.resolve',
  SECURITY_STATUS_READ: 'security.status.read',
  FABRIC_REGISTER: 'fabric.register',
});

const P = PERMISSIONS;

/**
 * Roles are additive sets of permissions. They are deliberately coarse enough to
 * describe a real deployment and fine enough that no role implies approval unless
 * it is the operator role.
 */
export const ROLES = sealedTable({
  reader: Object.freeze([P.SNAPSHOT_READ, P.EVENTS_READ]),
  registrar: Object.freeze([P.SNAPSHOT_READ, P.EVENTS_READ, P.NODE_REGISTER, P.RELATION_DECLARE, P.FABRIC_REGISTER]),
  monitor: Object.freeze([P.SNAPSHOT_READ, P.OBSERVATION_RECORD]),
  attestor: Object.freeze([P.SNAPSHOT_READ, P.SECURITY_ATTEST]),
  requester: Object.freeze([P.SNAPSHOT_READ, P.EVENTS_READ, P.CAPABILITY_REQUEST]),
  operator: Object.freeze([P.SNAPSHOT_READ, P.EVENTS_READ, P.COORDINATION_RESOLVE, P.SECURITY_STATUS_READ]),
  admin: Object.freeze(Object.values(P)),
});

/** The permission each command action requires. An action absent here is refused. */
export const ACTION_PERMISSIONS = sealedTable({
  register_node: P.NODE_REGISTER,
  declare_relation: P.RELATION_DECLARE,
  record_observation: P.OBSERVATION_RECORD,
  record_security_posture: P.SECURITY_ATTEST,
  request_capability: P.CAPABILITY_REQUEST,
  resolve_coordination: P.COORDINATION_RESOLVE,
  register_fabric_sync: P.FABRIC_REGISTER,
});

/**
 * Actions reached from the host and never over a plane — `api_exposure: operator_local`
 * in docs/API_PLANES.md, made a property of the plane rather than of the catalog.
 *
 * Binding a system to the canonical fabric is a declaration about data authority. The
 * plane this one was merged with kept it off HTTP deliberately, and so does this one:
 * the check is on the principal, not on a route, so there is no second path to widen.
 * The in-process caller is the operator at the host; every authenticated caller — the
 * admin role included — is not, and holding the permission does not change that.
 */
export const OPERATOR_LOCAL_ACTIONS = Object.freeze(['register_fabric_sync']);

export function requireOperatorLocal(principal, action, localPrincipal) {
  if (!OPERATOR_LOCAL_ACTIONS.includes(action)) return true;
  if (principal !== localPrincipal) {
    throw new ControlPlaneError(403, 'ACTION_OPERATOR_LOCAL', `${action} is an operator-local action: it is run at the host against the journal, never over a plane.`, 'Run the operator tool directly: node ecosystem/fabric.mjs --journal <path>.');
  }
  return true;
}

/** Expand a set of role names into the permissions they grant. */
export function rolesOf(roles) {
  const permissions = new Set();
  for (const role of roles) {
    const granted = lookup(ROLES, role);
    if (!granted) continue;
    for (const permission of granted) permissions.add(permission);
  }
  return permissions;
}

export function forbidden(detail, remedy) {
  return new ControlPlaneError(403, 'CONTROL_PLANE_FORBIDDEN', detail, remedy ?? 'Use a principal whose role grants this permission.');
}

/** Assert a permission, or throw 403. */
export function requirePermission(principal, permission) {
  if (!principal) throw forbidden('No authenticated principal is bound to this request.');
  if (!principal.permissions.has(permission)) {
    throw forbidden(`Principal ${principal.principalId} does not hold ${permission}.`, `Grant a role containing ${permission}, or submit this command as a principal that already holds it.`);
  }
  return true;
}

/**
 * Bind the recorded actor identity to the authenticated principal. Without this the
 * journal's `actorId` is a claim rather than a fact.
 */
export function requireActorBinding(principal, actorId) {
  if (!principal.mayClaimActor(actorId)) {
    throw forbidden(`Principal ${principal.principalId} may not act as ${actorId}.`, 'Submit the command under an actor identity bound to your credential.');
  }
  return true;
}

/** Bind a command's subject node to the principal, when the principal is node-scoped. */
export function requireNodeBinding(principal, nodeId) {
  if (!principal.mayActOnNode(nodeId)) {
    throw forbidden(`Principal ${principal.principalId} may not submit commands for node ${nodeId}.`, 'Use a credential scoped to this node.');
  }
  return true;
}

/**
 * Separation of duties. The approver must not be the proposer.
 *
 * Enforced on the recorded actor identity rather than the principal, so it holds in
 * a single-credential deployment as well as a fully bound one, and so the journal
 * alone is enough to verify the property after the fact.
 */
export function requireSeparationOfDuties(resolvingActorId, requestingActorId) {
  if (resolvingActorId === requestingActorId) {
    throw forbidden(`Actor ${resolvingActorId} requested this coordination and may not also resolve it.`, 'An execution intent must be approved by a different actor than the one that proposed it.');
  }
  return true;
}

/**
 * The permission a command action requires, or a 422 for an unrecognised action.
 * Unknown actions never acquire privileged semantics by default (SEC-016).
 */
export function permissionForAction(action) {
  const permission = lookup(ACTION_PERMISSIONS, action);
  if (!permission) {
    throw new ControlPlaneError(422, 'CONTROL_PLANE_COMMAND_INVALID', `Action ${action} is not a recognised control-plane action.`, 'Use the published control-plane API contract.');
  }
  return permission;
}

/** A description of the model, for operators and for the security constellation. */
export function describePolicy() {
  return {
    permissions: Object.values(PERMISSIONS),
    roles: Object.fromEntries(Object.entries(ROLES).map(([role, permissions]) => [role, [...permissions]])),
    actions: { ...ACTION_PERMISSIONS },
    operatorLocal: [...OPERATOR_LOCAL_ACTIONS],
    separationOfDuties: 'resolve_coordination requires an actor other than the one that requested it',
  };
}
