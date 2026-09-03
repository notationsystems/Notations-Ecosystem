import { parseCommand } from '@control-plane/validation.js';
import type { Approval, AttestationMethod, CapabilityMode, Command, Health, NodeInput, ObservationSource, PostureSignal, RelationKind } from './types';

/** Identifier alphabet accepted by the control plane. */
export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,179}$/;

function requestId(action: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `dock:${action}:${rand}`;
}

export interface CommandContext {
  actorId: string;
  /** Snapshot revision the operator last saw; the control plane rejects the command if it moved. */
  expectedRevision: string | null;
  now?: () => string;
}

const stamp = (ctx: CommandContext) => (ctx.now ?? (() => new Date().toISOString()))();

export function registerNode(ctx: CommandContext, node: NodeInput): Command {
  return { requestId: requestId('register_node'), actorId: ctx.actorId, submittedAt: stamp(ctx), expectedRevision: ctx.expectedRevision, action: 'register_node', node };
}

export function declareRelation(ctx: CommandContext, input: { relationId?: string; sourceNodeId: string; targetNodeId: string; kind: RelationKind; description: string }): Command {
  const relationId = input.relationId?.trim() || `${input.sourceNodeId}--${input.kind}--${input.targetNodeId}`;
  return { requestId: requestId('declare_relation'), actorId: ctx.actorId, submittedAt: stamp(ctx), expectedRevision: ctx.expectedRevision, action: 'declare_relation', relationId, sourceNodeId: input.sourceNodeId, targetNodeId: input.targetNodeId, kind: input.kind, description: input.description };
}

export function recordObservation(ctx: CommandContext, input: { nodeId: string; health: Health; source?: ObservationSource; detail: string; observedAt?: string }): Command {
  return { requestId: requestId('record_observation'), actorId: ctx.actorId, submittedAt: stamp(ctx), expectedRevision: ctx.expectedRevision, action: 'record_observation', nodeId: input.nodeId, health: input.health, observedAt: input.observedAt ?? stamp(ctx), source: input.source ?? 'operator', detail: input.detail };
}

export function requestCapability(ctx: CommandContext, input: { coordinationId?: string; requesterNodeId: string; targetNodeId: string; capabilityId: string; requestedMode: CapabilityMode; purpose: string }): Command {
  const coordinationId = input.coordinationId?.trim() || `coord:${input.requesterNodeId}:${input.targetNodeId}:${input.capabilityId}:${Date.now().toString(36)}`;
  return { requestId: requestId('request_capability'), actorId: ctx.actorId, submittedAt: stamp(ctx), expectedRevision: ctx.expectedRevision, action: 'request_capability', coordinationId, requesterNodeId: input.requesterNodeId, targetNodeId: input.targetNodeId, capabilityId: input.capabilityId, requestedMode: input.requestedMode, purpose: input.purpose };
}

export function resolveCoordination(ctx: CommandContext, input: { coordinationId: string; decision: 'approved' | 'rejected'; note: string }): Command {
  return { requestId: requestId('resolve_coordination'), actorId: ctx.actorId, submittedAt: stamp(ctx), expectedRevision: ctx.expectedRevision, action: 'resolve_coordination', coordinationId: input.coordinationId, decision: input.decision, note: input.note };
}

/**
 * Record posture for a node.
 *
 * The security lens has always told an operator to "record an operator review from the
 * console", and the console had five actions to the plane's six. `operator_review` is one
 * of the four attestation methods the contract declares, and it existed with no way to
 * use it.
 *
 * The signals go through the plane's own `parseSignals` in `validateCommand`, so the
 * evidence boundary applies here with the server's wording: a summary carrying an
 * address, an advisory id, a package version, a tooling invocation, a URL or a path is
 * refused before it is ever sent.
 */
export function recordSecurityPosture(ctx: CommandContext, input: { nodeId: string; method: AttestationMethod; signals: PostureSignal[]; attestedAt?: string }): Command {
  return {
    requestId: requestId('record_security_posture'),
    actorId: ctx.actorId,
    submittedAt: stamp(ctx),
    expectedRevision: ctx.expectedRevision,
    action: 'record_security_posture',
    nodeId: input.nodeId,
    attestedAt: input.attestedAt ?? stamp(ctx),
    method: input.method,
    signals: input.signals,
  } as unknown as Command;
}

export type ValidationOutcome = { ok: true; command: Command } | { ok: false; detail: string; remedy?: string };

/** Validate with the control plane's own parser, so the dock refuses exactly what the server would refuse. */
export function validateCommand(cmd: unknown): ValidationOutcome {
  try {
    parseCommand(cmd);
    return { ok: true, command: cmd as Command };
  } catch (e) {
    const err = e as { detail?: string; remedy?: string; message?: string };
    return { ok: false, detail: err.detail ?? err.message ?? String(e), remedy: err.remedy };
  }
}

/** A blank node an operator can fill in from the console. */
export function blankNode(): NodeInput {
  return {
    nodeId: '',
    name: '',
    kind: 'api',
    description: '',
    capabilities: [{ capabilityId: '', label: '', description: '', mode: 'observe', approval: 'automatic' as Approval }],
    metadata: {},
    location: null,
  };
}
