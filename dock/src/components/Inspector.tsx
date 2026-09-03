import type { Snapshot, SnapshotNode } from '../model/types';
import { KIND_LABEL, RELATION_LABEL } from '../model/types';

export function Inspector({ snapshot, node, onSelect, onRequest, onObserve }: {
  snapshot: Snapshot;
  node: SnapshotNode | null;
  onSelect: (id: string | null) => void;
  onRequest?: (node: SnapshotNode, capabilityId: string) => void;
  onObserve?: (node: SnapshotNode) => void;
}) {
  if (!node) return <aside className="inspector hidden" />;
  const outgoing = snapshot.relations.filter((r) => r.sourceNodeId === node.nodeId);
  const incoming = snapshot.relations.filter((r) => r.targetNodeId === node.nodeId);
  const coordination = snapshot.coordination.filter((c) => c.targetNodeId === node.nodeId || c.requesterNodeId === node.nodeId);
  const md = node.metadata ?? {};
  return (
    <aside className="inspector">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
        <div>
          <h2>{node.name}</h2>
          <div className="sub mono">{node.nodeId}</div>
        </div>
        <button className="btn small" onClick={() => onSelect(null)}>×</button>
      </div>
      <div style={{ marginBottom: 10 }}>
        <span className="badge">{KIND_LABEL[node.kind]}</span>
        <span className={`badge ${node.health}`}>{node.health}</span>
        {typeof md.domain === 'string' && <span className="badge">{md.domain}</span>}
        {typeof md.maturity === 'string' && md.maturity && <span className="badge">{md.maturity}</span>}
        {node.location && <span className="badge">{node.location.latitude.toFixed(2)}, {node.location.longitude.toFixed(2)}</span>}
      </div>
      <p style={{ marginTop: 0 }}>{node.description}</p>
      {node.lastObservation && <div className="kv" style={{ marginBottom: 10 }}><span>last observed</span><b>{node.lastObservedAt ? new Date(node.lastObservedAt).toLocaleString() : '—'} · {node.lastObservation.source}</b><span>detail</span><b>{node.lastObservation.detail}</b></div>}
      {onObserve && <div style={{ marginBottom: 12 }}><button className="btn small" onClick={() => onObserve(node)}>Record observation</button></div>}

      <h3>Capabilities · {node.capabilities.length}</h3>
      {node.capabilities.map((c) => (
        <div className="cap" key={c.capabilityId}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
            <span className="id">{c.capabilityId}</span>
            <span><span className={`badge ${c.mode}`}>{c.mode}</span><span className={`badge ${c.approval === 'operator' ? 'operator' : ''}`}>{c.approval}</span></span>
          </div>
          <div className="label">{c.label}</div>
          <div className="desc">{c.description}</div>
          {onRequest && <div style={{ marginTop: 6 }}><button className="btn small" onClick={() => onRequest(node, c.capabilityId)}>Request {c.mode}</button></div>}
        </div>
      ))}

      <h3 style={{ marginTop: 14 }}>Relations</h3>
      <div className="linklist">
        {outgoing.map((r) => <a key={r.relationId} href="#" onClick={(e) => { e.preventDefault(); onSelect(r.targetNodeId); }}><span>{RELATION_LABEL[r.kind]} →</span> {r.targetNodeId}</a>)}
        {incoming.map((r) => <a key={r.relationId} href="#" onClick={(e) => { e.preventDefault(); onSelect(r.sourceNodeId); }}>{r.sourceNodeId} <span>→ {RELATION_LABEL[r.kind]}</span></a>)}
        {!outgoing.length && !incoming.length && <div style={{ color: 'var(--muted)' }}>No declared relations.</div>}
      </div>

      {coordination.length > 0 && <>
        <h3 style={{ marginTop: 14 }}>Coordination · {coordination.length}</h3>
        {coordination.map((c) => (
          <div className="cap" key={c.coordinationId}>
            <div className="mono" style={{ fontSize: 11 }}>{c.coordinationId}</div>
            <div>{c.requesterNodeId} → <b>{c.capabilityId}</b> ({c.requestedMode})</div>
            <div><span className={`badge status-${c.status}`}>{c.status}</span><span className="badge not_dispatched">{c.dispatch}</span></div>
          </div>
        ))}
      </>}

      <h3 style={{ marginTop: 14 }}>Metadata</h3>
      <div className="kv">
        {Object.entries(md).map(([k, v]) => <><span key={`${k}-k`}>{k}</span><b key={`${k}-v`}>{k === 'repo' ? <a href={`https://github.com/${String(v)}`} target="_blank" rel="noreferrer">{String(v)}</a> : String(v)}</b></>)}
      </div>
    </aside>
  );
}
