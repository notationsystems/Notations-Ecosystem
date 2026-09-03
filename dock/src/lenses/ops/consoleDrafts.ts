/**
 * Draft state for the operator console and the translation of each draft into a control-plane
 * command. Kept free of React so the mapping can be unit-tested.
 */
import type { ConsoleIntent } from '../../App';
import { declareRelation, recordObservation, recordSecurityPosture, registerNode, requestCapability, resolveCoordination, type CommandContext } from '../../model/commands';
import type { Approval, AttestationMethod, CapabilityMode, Command, Health, MetadataValue, NodeKind, ObservationSource, PostureDimension, PostureState, RelationKind, Snapshot } from '../../model/types';

export type ConsoleAction = 'register_node' | 'declare_relation' | 'record_observation' | 'record_security_posture' | 'request_capability' | 'resolve_coordination';
export const CONSOLE_ACTIONS: Array<{ id: ConsoleAction; label: string; blurb: string }> = [
  { id: 'register_node', label: 'Register node', blurb: 'Add a node and the capabilities it declares. Execute capabilities always require an operator decision.' },
  { id: 'declare_relation', label: 'Declare relation', blurb: 'Record how two registered nodes relate. Relations are descriptive; they grant nothing.' },
  { id: 'record_observation', label: 'Record observation', blurb: 'Journal a health observation for a node from the operator, a health check, or a webhook.' },
  { id: 'record_security_posture', label: 'Record posture', blurb: 'Attest one or more security dimensions for a node. Evidence only: a summary carrying an address, an advisory id, a package version or a link is refused at the boundary.' },
  { id: 'request_capability', label: 'Request capability', blurb: 'Ask for one node to use another node’s capability. The request becomes a coordination record; nothing is dispatched.' },
  { id: 'resolve_coordination', label: 'Resolve coordination', blurb: 'Approve or reject a pending request. Approval is recorded, never executed, by the control plane.' },
];

export interface CapabilityDraft { capabilityId: string; label: string; description: string; mode: CapabilityMode; approval: Approval }
export interface MetadataRow { key: string; value: string }

export interface RegisterDraft {
  nodeId: string; name: string; kind: NodeKind; description: string;
  capabilities: CapabilityDraft[]; metadata: MetadataRow[];
  latitude: string; longitude: string;
}
export interface RelationDraft { sourceNodeId: string; targetNodeId: string; kind: RelationKind; description: string }
export interface ObservationDraft { nodeId: string; health: Health; source: ObservationSource; detail: string }
export interface RequestDraft { requesterNodeId: string; targetNodeId: string; capabilityId: string; requestedMode: CapabilityMode; purpose: string }
export interface ResolveDraft { coordinationId: string; decision: 'approved' | 'rejected'; note: string }
export interface SignalDraft { dimension: PostureDimension; state: PostureState; coverage: string; summary: string }
export interface PostureDraft { nodeId: string; method: AttestationMethod; signals: SignalDraft[] }

export interface Drafts { register: RegisterDraft; relation: RelationDraft; observation: ObservationDraft; posture: PostureDraft; request: RequestDraft; resolve: ResolveDraft }

export const blankCapability = (): CapabilityDraft => ({ capabilityId: '', label: '', description: '', mode: 'observe', approval: 'automatic' });
export const blankSignal = (): SignalDraft => ({ dimension: 'identity', state: 'unknown', coverage: '', summary: '' });

export function initialDrafts(snapshot: Snapshot): Drafts {
  const first = snapshot.nodes[0]?.nodeId ?? '';
  const second = snapshot.nodes[1]?.nodeId ?? first;
  const pending = snapshot.coordination.find((c) => c.status === 'approval_required');
  return {
    register: { nodeId: '', name: '', kind: 'api', description: '', capabilities: [blankCapability()], metadata: [{ key: 'domain', value: '' }], latitude: '', longitude: '' },
    relation: { sourceNodeId: first, targetNodeId: second, kind: 'depends_on', description: '' },
    observation: { nodeId: first, health: 'healthy', source: 'operator', detail: '' },
    posture: { nodeId: first, method: 'operator_review', signals: [blankSignal()] },
    request: { requesterNodeId: first, targetNodeId: second, capabilityId: '', requestedMode: 'observe', purpose: '' },
    resolve: { coordinationId: pending?.coordinationId ?? '', decision: 'approved', note: '' },
  };
}

/** Sync request draft to the target's declared capability: mode follows the capability, and the id snaps to one it has. */
export function alignRequestToTarget(draft: RequestDraft, snapshot: Snapshot): RequestDraft {
  const target = snapshot.nodes.find((n) => n.nodeId === draft.targetNodeId);
  if (!target) return draft;
  const cap = target.capabilities.find((c) => c.capabilityId === draft.capabilityId) ?? target.capabilities[0];
  if (!cap) return { ...draft, capabilityId: '' };
  return { ...draft, capabilityId: cap.capabilityId, requestedMode: cap.mode };
}

/**
 * Apply an edit to a capability row. Switching the mode to execute forces approval to operator, the only
 * value the control plane accepts; an operator who then overrides it sees the server's own rejection in the preview.
 */
export function applyCapabilityPatch(cap: CapabilityDraft, patch: Partial<CapabilityDraft>): CapabilityDraft {
  const next = { ...cap, ...patch };
  if (patch.mode === 'execute' && cap.mode !== 'execute') next.approval = 'operator';
  return next;
}

export function applyIntent(drafts: Drafts, intent: ConsoleIntent, snapshot: Snapshot): { action: ConsoleAction; drafts: Drafts } {
  switch (intent.action) {
    case 'record_observation':
      return { action: 'record_observation', drafts: { ...drafts, observation: { ...drafts.observation, nodeId: intent.nodeId ?? drafts.observation.nodeId } } };
    case 'request_capability': {
      const targetNodeId = intent.nodeId ?? drafts.request.targetNodeId;
      const requester = drafts.request.requesterNodeId === targetNodeId ? (snapshot.nodes.find((n) => n.nodeId !== targetNodeId)?.nodeId ?? drafts.request.requesterNodeId) : drafts.request.requesterNodeId;
      return { action: 'request_capability', drafts: { ...drafts, request: alignRequestToTarget({ ...drafts.request, requesterNodeId: requester, targetNodeId, capabilityId: intent.capabilityId ?? '' }, snapshot) } };
    }
    case 'resolve_coordination':
      return { action: 'resolve_coordination', drafts: { ...drafts, resolve: { ...drafts.resolve, coordinationId: intent.coordinationId ?? drafts.resolve.coordinationId } } };
  }
}

/** "42" → 42, "true" → true, anything else stays a string. Operators can quote a value to keep it a string. */
export function parseMetadataValue(raw: string): MetadataValue {
  const v = raw.trim();
  if (/^".*"$/.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Build the command for the active action. Never throws: validation happens afterwards with the server's parser. */
export function buildCommand(action: ConsoleAction, d: Drafts, ctx: CommandContext): Command {
  switch (action) {
    case 'register_node': {
      const r = d.register;
      const metadata: Record<string, MetadataValue> = {};
      for (const row of r.metadata) if (row.key.trim()) metadata[row.key.trim()] = parseMetadataValue(row.value);
      const lat = r.latitude.trim(); const lon = r.longitude.trim();
      const location = lat === '' && lon === '' ? null : { latitude: Number(lat), longitude: Number(lon) };
      return registerNode(ctx, { nodeId: r.nodeId, name: r.name, kind: r.kind, description: r.description, capabilities: r.capabilities.map((c) => ({ ...c })), metadata, location });
    }
    case 'declare_relation':
      return declareRelation(ctx, d.relation);
    case 'record_observation':
      return recordObservation(ctx, d.observation);
    case 'record_security_posture': {
      // An empty coverage box means "not measured", never zero: the plane distinguishes
      // an absent coverage from a measured 0, and so must the draft.
      const signals = d.posture.signals.map((s) => ({
        dimension: s.dimension,
        state: s.state,
        ...(s.coverage.trim() === '' ? {} : { coverage: Number(s.coverage) }),
        ...(s.summary.trim() === '' ? {} : { summary: s.summary.trim() }),
      }));
      return recordSecurityPosture(ctx, { nodeId: d.posture.nodeId, method: d.posture.method, signals: signals as never });
    }
    case 'request_capability':
      return requestCapability(ctx, d.request);
    case 'resolve_coordination':
      return resolveCoordination(ctx, d.resolve);
  }
}
