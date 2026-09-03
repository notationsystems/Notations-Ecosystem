import { useMemo } from 'react';
import { Pipeline, stageOfCoordination } from '../components/Pipeline';
import { KIND_LABEL, type Coordination, type SnapshotNode } from '../model/types';
import type { LensProps } from './types';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface OperatorLensProps extends LensProps { onResolve: (coordinationId: string) => void; onObserve: (nodeId: string) => void }

function ageOf(iso: string | null, now: number): string {
  if (!iso) return 'never observed';
  const h = Math.max(0, Math.round((now - Date.parse(iso)) / 3600000));
  return h < 1 ? 'observed < 1 h ago' : h < 48 ? `observed ${h} h ago` : `observed ${Math.round(h / 24)} d ago`;
}

/**
 * The operator view: what is healthy, what is stale, what needs approval, what is blocked.
 * Everything here derives from the control-plane snapshot; nothing is inferred from providers.
 */
export function OperatorLens({ snapshot, filtered, onSelect, onResolve, onObserve, dock }: OperatorLensProps) {
  const now = Date.now();
  const view = useMemo(() => {
    const nodes = filtered.nodes;
    const healthy = nodes.filter((n) => n.health === 'healthy');
    const stale = nodes.filter((n) => !n.lastObservedAt || now - Date.parse(n.lastObservedAt) > STALE_AFTER_MS);
    const needsApproval = snapshot.coordination.filter((c) => c.status === 'approval_required');
    const dependents = new Map<string, string[]>();
    for (const r of snapshot.relations) if (r.kind === 'depends_on' || r.kind === 'supplies_context_to') {
      const upstream = r.kind === 'depends_on' ? r.targetNodeId : r.sourceNodeId;
      const downstream = r.kind === 'depends_on' ? r.sourceNodeId : r.targetNodeId;
      dependents.set(upstream, [...(dependents.get(upstream) ?? []), downstream]);
    }
    const blockedNodes = nodes.filter((n) => n.health === 'offline' || n.health === 'degraded').map((n) => ({ node: n, blocking: dependents.get(n.nodeId) ?? [] }));
    const rejected = snapshot.coordination.filter((c) => c.status === 'rejected');
    const observed = snapshot.nodes.filter((n) => n.health !== 'unknown').length;
    const proposed = snapshot.coordination.length;
    const approved = snapshot.coordination.filter((c) => c.status === 'approved').length;
    return { healthy, stale, needsApproval, blockedNodes, rejected, observed, proposed, approved };
  }, [snapshot, filtered, now]);

  const NodeItem = ({ n, note }: { n: SnapshotNode; note?: string }) => (
    <div className="item" onClick={() => onSelect(n.nodeId)}>
      <span>{n.name} <small>· {KIND_LABEL[n.kind]}</small></span>
      <small>{note ?? ageOf(n.lastObservedAt, now)}</small>
    </div>
  );
  const CoordItem = ({ c, action }: { c: Coordination; action?: React.ReactNode }) => (
    <div className="item" onClick={() => onSelect(c.targetNodeId)}>
      <span><span className="mono">{c.capabilityId}</span> <small>{c.requesterNodeId} → {c.targetNodeId} · {c.requestedMode}</small><div><Pipeline state={stageOfCoordination(c)} compact title={c.status} /></div></span>
      <span onClick={(e) => e.stopPropagation()}>{action}</span>
    </div>
  );

  return (
    <div className="lens scroll">
      <div className="strip">
        <div className="kpi"><span>observed</span><b>{view.observed} / {snapshot.nodes.length}</b></div>
        <div className="kpi"><span>proposed</span><b>{view.proposed}</b></div>
        <div className="kpi"><span>approved</span><b>{view.approved}</b></div>
        <div className="kpi locked"><span>dispatched</span><b>0</b></div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <Pipeline state={{ reached: 'approved' }} />
          <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>The control plane records intent and approval only. Nothing here dispatches; execution adapters are a separate boundary.</div>
        </div>
      </div>
      {dock.mode !== 'live' && <div className="notice" style={{ marginBottom: 12 }}>Sample snapshot: health, staleness and approvals below are generated from the catalog, not observed from Payload or the control plane.</div>}
      <div className="operator">
        <div className="card healthy">
          <h3>Healthy <b>{view.healthy.length}</b></h3>
          {view.healthy.map((n) => <NodeItem key={n.nodeId} n={n} />)}
          {!view.healthy.length && <small>No node has a healthy observation.</small>}
        </div>
        <div className="card stale">
          <h3>Stale <b>{view.stale.length}</b></h3>
          <small style={{ display: 'block', marginBottom: 6 }}>No observation in the last 24 h. Record one from the inspector or let a health check post it.</small>
          {view.stale.map((n) => <div key={n.nodeId} className="item" onClick={() => onSelect(n.nodeId)}><span>{n.name} <small>· {n.health}</small></span><small>{ageOf(n.lastObservedAt, now)} <button className="btn small" style={{ marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); onObserve(n.nodeId); }}>observe</button></small></div>)}
        </div>
        <div className="card approval">
          <h3>Needs approval <b>{view.needsApproval.length}</b></h3>
          {view.needsApproval.map((c) => <CoordItem key={c.coordinationId} c={c} action={<button className="btn small primary" onClick={() => onResolve(c.coordinationId)}>decide</button>} />)}
          {!view.needsApproval.length && <small>No execute intent is waiting for an operator.</small>}
        </div>
        <div className="card blocked">
          <h3>Blocked <b>{view.blockedNodes.length + view.rejected.length}</b></h3>
          {view.blockedNodes.map(({ node, blocking }) => <NodeItem key={node.nodeId} n={node} note={`${node.health}${blocking.length ? ` · blocks ${blocking.length}: ${blocking.slice(0, 3).join(', ')}${blocking.length > 3 ? '…' : ''}` : ''}`} />)}
          {view.rejected.map((c) => <CoordItem key={c.coordinationId} c={c} />)}
          {!view.blockedNodes.length && !view.rejected.length && <small>No offline or degraded node, no rejected intent.</small>}
        </div>
      </div>
    </div>
  );
}
