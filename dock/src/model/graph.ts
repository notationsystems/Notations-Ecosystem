import type { Relation, Snapshot, SnapshotNode } from './types';
import { KIND_COLOR, HEALTH_COLOR } from './types';

export interface GraphNodeDatum {
  id: string;
  name: string;
  kind: SnapshotNode['kind'];
  health: SnapshotNode['health'];
  domain: string;
  color: string;
  ring: string;
  val: number;
  capabilities: number;
  executeCapabilities: number;
  located: boolean;
  node: SnapshotNode;
}

export interface GraphLinkDatum {
  id: string;
  source: string;
  target: string;
  kind: Relation['kind'];
  description: string;
  relation: Relation;
}

export interface GraphData { nodes: GraphNodeDatum[]; links: GraphLinkDatum[] }

export function domainOf(node: SnapshotNode): string {
  const d = node.metadata?.domain;
  return typeof d === 'string' && d ? d : 'unassigned';
}

/** Force-graph data for every node and relation in the snapshot. */
export function toGraphData(snapshot: Snapshot): GraphData {
  const ids = new Set(snapshot.nodes.map((n) => n.nodeId));
  const nodes = snapshot.nodes.map<GraphNodeDatum>((node) => ({
    id: node.nodeId,
    name: node.name,
    kind: node.kind,
    health: node.health,
    domain: domainOf(node),
    color: KIND_COLOR[node.kind] ?? '#9AA5B1',
    ring: HEALTH_COLOR[node.health] ?? HEALTH_COLOR.unknown,
    val: Math.max(1, Math.sqrt(node.capabilities.length)),
    capabilities: node.capabilities.length,
    executeCapabilities: node.capabilities.filter((c) => c.mode === 'execute').length,
    located: node.location !== null,
    node,
  }));
  const links = snapshot.relations
    .filter((r) => ids.has(r.sourceNodeId) && ids.has(r.targetNodeId))
    .map<GraphLinkDatum>((relation) => ({ id: relation.relationId, source: relation.sourceNodeId, target: relation.targetNodeId, kind: relation.kind, description: relation.description, relation }));
  return { nodes, links };
}

/** Ids within one hop of `id` (including itself). */
export function neighbourhood(snapshot: Snapshot, id: string): Set<string> {
  const set = new Set<string>([id]);
  for (const r of snapshot.relations) {
    if (r.sourceNodeId === id) set.add(r.targetNodeId);
    if (r.targetNodeId === id) set.add(r.sourceNodeId);
  }
  return set;
}

export interface DomainSummary { domain: string; nodes: number; capabilities: number; members: string[] }

export function domainSummary(snapshot: Snapshot): DomainSummary[] {
  const acc = new Map<string, DomainSummary>();
  for (const n of snapshot.nodes) {
    const d = domainOf(n);
    const cur = acc.get(d) ?? { domain: d, nodes: 0, capabilities: 0, members: [] };
    cur.nodes += 1;
    cur.capabilities += n.capabilities.length;
    cur.members.push(n.nodeId);
    acc.set(d, cur);
  }
  return [...acc.values()].sort((a, b) => b.nodes - a.nodes || b.capabilities - a.capabilities || a.domain.localeCompare(b.domain));
}

export interface SnapshotStats { nodes: number; located: number; relations: number; capabilities: number; execute: number; healthy: number; pendingApprovals: number }

export function snapshotStats(snapshot: Snapshot): SnapshotStats {
  return {
    nodes: snapshot.nodes.length,
    located: snapshot.nodes.filter((n) => n.location).length,
    relations: snapshot.relations.length,
    capabilities: snapshot.nodes.reduce((n, x) => n + x.capabilities.length, 0),
    execute: snapshot.nodes.reduce((n, x) => n + x.capabilities.filter((c) => c.mode === 'execute').length, 0),
    healthy: snapshot.nodes.filter((n) => n.health === 'healthy').length,
    pendingApprovals: snapshot.coordination.filter((c) => c.status === 'approval_required').length,
  };
}
