/** Types of the control-plane contract (control-plane/openapi/control-plane.openapi.yaml). */

export type NodeKind = 'api' | 'world_model' | 'information_library' | 'reasoning_engine' | 'visual_dock' | 'operator_surface';
export type CapabilityMode = 'observe' | 'propose' | 'execute';
export type Approval = 'automatic' | 'operator';
export type RelationKind = 'supplies_context_to' | 'coordinates' | 'visualizes' | 'governs' | 'depends_on';
export type Health = 'unknown' | 'healthy' | 'degraded' | 'offline';
export type CoordinationStatus = 'approval_required' | 'ready' | 'approved' | 'rejected';
export type ObservationSource = 'operator' | 'health_check' | 'webhook';

export const NODE_KINDS: NodeKind[] = ['api', 'world_model', 'information_library', 'reasoning_engine', 'visual_dock', 'operator_surface'];
export const RELATION_KINDS: RelationKind[] = ['supplies_context_to', 'coordinates', 'visualizes', 'governs', 'depends_on'];
export const CAPABILITY_MODES: CapabilityMode[] = ['observe', 'propose', 'execute'];
export const HEALTHS: Health[] = ['unknown', 'healthy', 'degraded', 'offline'];

export type MetadataValue = string | number | boolean;

export interface Capability {
  capabilityId: string;
  label: string;
  description: string;
  mode: CapabilityMode;
  approval: Approval;
}

export interface Location { longitude: number; latitude: number }

export interface NodeInput {
  nodeId: string;
  name: string;
  kind: NodeKind;
  description: string;
  capabilities: Capability[];
  metadata?: Record<string, MetadataValue>;
  location?: Location | null;
}

export type PostureDimension =
  | 'identity' | 'authorization' | 'encryption_in_transit' | 'encryption_at_rest' | 'key_lifecycle'
  | 'dependency_risk' | 'exposure' | 'audit_integrity' | 'backup' | 'incident' | 'control_plane_integrity';

export type PostureState = 'strong' | 'adequate' | 'weak' | 'failing' | 'unknown';
export type AttestationMethod = 'automated_scan' | 'operator_review' | 'external_audit' | 'self_declared';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * One posture signal. Deliberately thin: a state, a coverage fraction, counts by
 * severity and one sentence. The control plane refuses anything more specific, so the
 * dock never has key material, topology or vulnerability detail to render.
 */
export interface PostureSignal {
  dimension: PostureDimension;
  state: PostureState;
  coverage?: number;
  findings?: Partial<Record<FindingSeverity, number>>;
  summary?: string;
  evidenceRef?: string;
  expiresAt?: string;
}

export interface NodeSecurity {
  attestedAt: string;
  attestedBy: string;
  method: AttestationMethod;
  signals: PostureSignal[];
}

export interface ConstellationDimension {
  dimension: PostureDimension;
  description: string;
  states: Partial<Record<PostureState, number>>;
  nodes: number;
  stale: number;
  coverage: number | null;
  findings: Record<FindingSeverity, number>;
  worst: PostureState;
}

export interface Constellation {
  schema: 'notations.control-plane.constellation.v1';
  generatedAt: string;
  attestedNodes: number;
  staleNodes: number;
  /**
   * Signals in the journal that name a dimension this plane does not have. The
   * projection counts them instead of failing on them, because a record cannot be
   * withdrawn from an append-only history; a non-zero count means recorded posture is
   * not being folded into any dimension, and the operator should know that.
   */
  unrecognisedSignals?: number;
  dimensions: ConstellationDimension[];
  boundary: string;
}

export interface SnapshotNode extends NodeInput {
  metadata: Record<string, MetadataValue>;
  location: Location | null;
  registeredAt: string;
  updatedAt: string;
  health: Health;
  lastObservedAt: string | null;
  lastObservation: { source: ObservationSource; detail: string } | null;
  security: NodeSecurity | null;
}

export interface Relation {
  relationId: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: RelationKind;
  description: string;
  declaredAt: string;
}

export interface Coordination {
  coordinationId: string;
  requesterNodeId: string;
  targetNodeId: string;
  capabilityId: string;
  requestedMode: CapabilityMode;
  purpose: string;
  requestedBy: string;
  requestedAt: string;
  dispatch: 'not_dispatched';
  status: CoordinationStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

export interface Snapshot {
  schema: 'notations.control-plane.snapshot.v1';
  revision: string | null;
  eventCursor: string | null;
  durability: 'local_jsonl_single_writer';
  generatedAt: string;
  nodes: SnapshotNode[];
  relations: Relation[];
  coordination: Coordination[];
  constellation?: Constellation;
  /** Present only on the bundled offline sample, never on live control-plane state. */
  sample?: boolean;
  sampleNote?: string;
}

export type EventKind = 'node_registered' | 'relation_declared' | 'observation_recorded' | 'security_posture_recorded' | 'coordination_requested' | 'coordination_resolved';

export interface JournalEvent {
  eventId: string;
  recordedAt: string;
  commandHash: string;
  kind: EventKind;
  node?: SnapshotNode;
  relation?: Relation;
  observation?: { nodeId: string; health: Health; observedAt: string; source: ObservationSource; detail: string };
  posture?: { nodeId: string; attestedAt: string; attestedBy: string; method: AttestationMethod; signals: PostureSignal[] };
  request?: Coordination;
  coordinationId?: string;
  decision?: 'approved' | 'rejected';
  resolvedAt?: string;
  resolvedBy?: string;
  note?: string;
}

export interface JournalRecord {
  event: JournalEvent;
  previousHash: string | null;
  recordHash: string;
}

export interface EventsResponse {
  schema: 'notations.control-plane.events.v1';
  revision: string | null;
  eventCursor: string | null;
  events: JournalRecord[];
}

export interface CommandBase {
  requestId: string;
  actorId: string;
  submittedAt: string;
  expectedRevision: string | null;
  action: string;
}

export type Command =
  | (CommandBase & { action: 'register_node'; node: NodeInput })
  | (CommandBase & { action: 'declare_relation'; relationId: string; sourceNodeId: string; targetNodeId: string; kind: RelationKind; description: string })
  | (CommandBase & { action: 'record_security_posture'; nodeId: string; attestedAt: string; method: AttestationMethod; signals: PostureSignal[] })
  | (CommandBase & { action: 'record_observation'; nodeId: string; health: Health; observedAt: string; source: ObservationSource; detail: string })
  | (CommandBase & { action: 'request_capability'; coordinationId: string; requesterNodeId: string; targetNodeId: string; capabilityId: string; requestedMode: CapabilityMode; purpose: string })
  | (CommandBase & { action: 'resolve_coordination'; coordinationId: string; decision: 'approved' | 'rejected'; note: string });

export interface CommandResult {
  schema: 'notations.control-plane.command-result.v1';
  outcome: 'appended' | 'duplicate';
  event: { eventId: string; kind: EventKind; recordHash: string };
  snapshot: Snapshot;
}

export interface HealthResponse {
  status: 'operational';
  service: string;
  revision: string | null;
  nodes: number;
}

export interface ControlPlaneErrorBody { error: string; detail: string; remedy?: string }

/** Presentation constants shared by every lens. Kept here so colours mean the same thing everywhere. */
export const KIND_LABEL: Record<NodeKind, string> = {
  api: 'API',
  world_model: 'World model',
  information_library: 'Information library',
  reasoning_engine: 'Reasoning engine',
  visual_dock: 'Visual dock',
  operator_surface: 'Operator surface',
};

export const KIND_COLOR: Record<NodeKind, string> = {
  api: '#F5B942',
  world_model: '#39C6D8',
  information_library: '#8B7CF6',
  reasoning_engine: '#E86A7A',
  visual_dock: '#5AC77A',
  operator_surface: '#4FA3F7',
};

export const HEALTH_COLOR: Record<Health, string> = {
  healthy: '#5AC77A',
  degraded: '#F5B942',
  offline: '#E8536A',
  unknown: '#6B7280',
};

export const RELATION_COLOR: Record<RelationKind, string> = {
  supplies_context_to: '#39C6D8',
  coordinates: '#F5B942',
  visualizes: '#5AC77A',
  governs: '#E86A7A',
  depends_on: '#9AA5B1',
};

export const RELATION_LABEL: Record<RelationKind, string> = {
  supplies_context_to: 'supplies context to',
  coordinates: 'coordinates',
  visualizes: 'visualizes',
  governs: 'governs',
  depends_on: 'depends on',
};


export const POSTURE_STATE_COLOR: Record<PostureState, string> = {
  strong: '#5AC77A',
  adequate: '#39C6D8',
  weak: '#F5B942',
  failing: '#E8536A',
  unknown: '#6B7280',
};

export const POSTURE_DIMENSION_LABEL: Record<PostureDimension, string> = {
  identity: 'Identity',
  authorization: 'Authorization',
  encryption_in_transit: 'Encryption in transit',
  encryption_at_rest: 'Encryption at rest',
  key_lifecycle: 'Key lifecycle',
  dependency_risk: 'Dependency risk',
  exposure: 'Service exposure',
  audit_integrity: 'Audit integrity',
  backup: 'Backups',
  incident: 'Incident state',
  control_plane_integrity: 'Control-plane integrity',
};

export const POSTURE_DIMENSION_ORDER: PostureDimension[] = [
  'identity', 'authorization', 'encryption_in_transit', 'encryption_at_rest', 'key_lifecycle',
  'dependency_risk', 'exposure', 'audit_integrity', 'backup', 'incident', 'control_plane_integrity',
];
