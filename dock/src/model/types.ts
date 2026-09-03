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
  /**
   * The node's name in the canonical identity space, derived by the control plane from
   * its id. Present on reads only, and a name rather than an address: nothing in this
   * estate dereferences one, least of all a browser.
   */
  uri?: string;
}

/** What part a node plays in the program of building corpora (docs/CORPUS.md). */
export type CorpusRole = 'hold' | 'feed' | 'transform' | 'project' | 'coordinate';
export type CorpusGrade = 'sound' | 'developing' | 'bare' | 'unsound' | 'unbuilt' | 'n/a' | 'undeclared';

export const CORPUS_ROLE_ORDER: CorpusRole[] = ['hold', 'feed', 'transform', 'project', 'coordinate'];

export const CORPUS_ROLE_LABEL: Record<CorpusRole, string> = {
  hold: 'Holds a corpus',
  feed: 'Feeds one',
  transform: 'Transforms over one',
  project: 'Projects one',
  coordinate: 'Coordinates between them',
};

export const CORPUS_GRADE_COLOR: Record<CorpusGrade, string> = {
  sound: '#3fb950',
  developing: '#d29922',
  bare: '#db6d28',
  unsound: '#f85149',
  unbuilt: '#6e7681',
  'n/a': '#6e7681',
  undeclared: '#6e7681',
};

/**
 * A node's corpus standing, read from the derived metadata the seed writes. The
 * declaration and its evidence paths stay in the catalog; only the result crosses.
 */
export interface CorpusStanding {
  role: CorpusRole | null;
  grade: CorpusGrade;
  coverage: number | null;
  /** How many invariants apply. `sound` on three is not `sound` on ten. */
  applicable: number | null;
  fails: string[];
  /** Invariants not yet assessed. Silence is not assent, so these count against a node. */
  unknown: string[];
  /** Domains whose canonical state this node owns. Holding a corpus is not owning one. */
  ownerOf: string[];
}

export function corpusStanding(node: SnapshotNode): CorpusStanding | null {
  const role = node.metadata.corpus_role;
  const grade = node.metadata.corpus_grade;
  if (typeof role !== 'string' || typeof grade !== 'string') return null;
  const coverage = node.metadata.corpus_coverage;
  const fails = node.metadata.corpus_fails;
  const ownerOf = node.metadata.corpus_owner_of;
  const words = (value: unknown): string[] => (typeof value === 'string' && value.trim() ? value.trim().split(/\s+/) : []);
  return {
    role: (CORPUS_ROLE_ORDER as string[]).includes(role) ? (role as CorpusRole) : null,
    grade: grade as CorpusGrade,
    coverage: typeof coverage === 'number' ? coverage : null,
    applicable: typeof node.metadata.corpus_applicable === 'number' ? node.metadata.corpus_applicable : null,
    fails: words(fails),
    unknown: words(node.metadata.corpus_unknown),
    ownerOf: words(ownerOf),
  };
}

/**
 * Where a node sits under the estate's collection policy (docs/COLLECTION_POLICY.md).
 *
 * `refused` — the node holds no data about identifiable people, and that is a property
 * of what it is for, not of what happens to be in it today.
 * `incidental` — people appear in what it holds (an author, an operator, a signatory)
 * but no capability answers a question about a person.
 * `serves` — a capability answers questions about people. On a first-party node that
 * requires a written exception saying what it serves and what would end it, and it is
 * the same fact the corpus grade records as a `COR-010` failure.
 */
export type PersonDataStanding = 'refused' | 'incidental' | 'serves';

export const PERSON_DATA_ORDER: PersonDataStanding[] = ['refused', 'incidental', 'serves'];

export const PERSON_DATA_LABEL: Record<PersonDataStanding, string> = {
  refused: 'Refuses person data',
  incidental: 'People appear incidentally',
  serves: 'Answers questions about people',
};

export const PERSON_DATA_COLOR: Record<PersonDataStanding, string> = {
  refused: '#3fb950',
  incidental: '#d29922',
  serves: '#f85149',
};

export interface CollectionStanding {
  standing: PersonDataStanding;
  /**
   * The written exception, on a node that serves. Absent on an upstream mirror, whose
   * collection posture is the upstream's to declare and this estate's only to record.
   */
  exception: string | null;
}

/**
 * A node's collection standing. Every catalog node declares one and the validator
 * refuses a node that does not, so a node without one here is a node seeded before the
 * policy existed — reported as such rather than silently read as `refused`.
 */
export function collectionStanding(node: SnapshotNode): CollectionStanding | null {
  const value = node.metadata.person_data;
  if (typeof value !== 'string' || !(PERSON_DATA_ORDER as string[]).includes(value)) return null;
  const exception = node.metadata.person_data_exception;
  return {
    standing: value as PersonDataStanding,
    exception: typeof exception === 'string' && exception.trim() ? exception.trim() : null,
  };
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
  /** The server capped this page. More records exist after `nextCursor`. */
  truncated?: boolean;
  nextCursor?: string | null;
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

/** How a posture was established. The four the contract declares, in the plane's order. */
export const ATTESTATION_METHODS: AttestationMethod[] = ['operator_review', 'automated_scan', 'external_audit', 'self_declared'];

export const POSTURE_DIMENSION_ORDER: PostureDimension[] = [
  'identity', 'authorization', 'encryption_in_transit', 'encryption_at_rest', 'key_lifecycle',
  'dependency_risk', 'exposure', 'audit_integrity', 'backup', 'incident', 'control_plane_integrity',
];
