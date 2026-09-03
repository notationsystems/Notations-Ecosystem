import type { DockState } from '../api/useControlPlane';
import type { NodeKind, RelationKind, Snapshot, SnapshotNode } from '../model/types';

export interface Filters {
  kinds: Set<NodeKind>;
  relationKinds: Set<RelationKind>;
  domains: Set<string>;
  locatedOnly: boolean;
  search: string;
}

export interface LensProps {
  dock: DockState;
  snapshot: Snapshot;
  /** Snapshot narrowed by the rail filters (nodes + relations between surviving nodes). */
  filtered: Snapshot;
  filters: Filters;
  selected: string | null;
  onSelect: (nodeId: string | null) => void;
  selectedNode: SnapshotNode | null;
}

export function applyFilters(snapshot: Snapshot, f: Filters): Snapshot {
  const q = f.search.trim().toLowerCase();
  const nodes = snapshot.nodes.filter((n) => {
    if (!f.kinds.has(n.kind)) return false;
    const domain = typeof n.metadata.domain === 'string' ? n.metadata.domain : 'unassigned';
    if (f.domains.size && !f.domains.has(domain)) return false;
    if (f.locatedOnly && !n.location) return false;
    if (q) {
      // The two closed vocabularies are in the haystack deliberately. They exist so the
      // estate can be asked "which systems touch sanctions?" and "which are reachable
      // over MCP?"; a vocabulary nothing can be searched by is a vocabulary that only
      // validates.
      const vocabulary = `${typeof n.metadata.data_domains === 'string' ? n.metadata.data_domains : ''} ${typeof n.metadata.surfaces === 'string' ? n.metadata.surfaces : ''}`;
      const hay = `${n.nodeId} ${n.name} ${n.description} ${vocabulary} ${n.capabilities.map((c) => `${c.capabilityId} ${c.label}`).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const ids = new Set(nodes.map((n) => n.nodeId));
  const relations = snapshot.relations.filter((r) => f.relationKinds.has(r.kind) && ids.has(r.sourceNodeId) && ids.has(r.targetNodeId));
  return { ...snapshot, nodes, relations };
}
