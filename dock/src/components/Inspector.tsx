import type { Snapshot, SnapshotNode } from '../model/types';
import { CORPUS_GRADE_COLOR, CORPUS_ROLE_LABEL, KIND_LABEL, PERSON_DATA_COLOR, PERSON_DATA_LABEL, POSTURE_DIMENSION_LABEL, POSTURE_STATE_COLOR, RELATION_LABEL, collectionStanding, corpusStanding } from '../model/types';
import { githubRepoUrl } from '../model/links';

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
  const corpus = corpusStanding(node);
  const collection = collectionStanding(node);
  // Per-capability annotations stay in the catalog; the set a node touches crosses, so
  // "which systems touch trade-flows?" is answerable from a snapshot alone.
  const subjects = typeof md.data_domains === 'string' && md.data_domains.trim() ? md.data_domains.trim().split(/\s+/) : [];
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
      {node.uri && (
        <div className="sub mono" style={{ marginBottom: 10 }} title="This node's name in the canonical identity space. A name, not an address: nothing here dereferences one.">
          {node.uri}
        </div>
      )}
      {corpus && (
        <div className="kv" style={{ marginBottom: 10 }}>
          <span>corpus</span>
          <b>
            <span className="badge" style={{ borderColor: CORPUS_GRADE_COLOR[corpus.grade], color: CORPUS_GRADE_COLOR[corpus.grade] }}>{corpus.grade}</span>
            {corpus.role ? ` ${CORPUS_ROLE_LABEL[corpus.role].toLowerCase()}` : ''}
            {corpus.coverage === null ? '' : ` · ${Math.round(corpus.coverage * 100)}% of applicable invariants`}
          </b>
          {corpus.ownerOf.length > 0 && (<><span>owns canonical state</span><b>{corpus.ownerOf.join(', ')}</b></>)}
          {corpus.fails.length > 0 && (
            <>
              <span title="Invariants this node declares it does not hold. Naming a failure is the point.">declared failures</span>
              <b>{corpus.fails.join(' ')}</b>
            </>
          )}
        </div>
      )}
      {collection && (
        <div className="kv" style={{ marginBottom: 10 }}>
          <span title="Where this node sits under the estate's collection policy — docs/COLLECTION_POLICY.md.">person data</span>
          <b>
            <span className="badge" style={{ borderColor: PERSON_DATA_COLOR[collection.standing], color: PERSON_DATA_COLOR[collection.standing] }}>{collection.standing}</span>
            {` ${PERSON_DATA_LABEL[collection.standing].toLowerCase()}`}
          </b>
          {collection.exception && (
            <>
              <span title="A node that answers questions about people must say what it serves and what would end it. This sentence is that declaration.">exception</span>
              <b style={{ fontWeight: 400 }}>{collection.exception}</b>
            </>
          )}
        </div>
      )}
      {subjects.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="sub" style={{ marginBottom: 4 }}>data domains · {subjects.length}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {subjects.map((subject) => <span className="badge" key={subject}>{subject}</span>)}
          </div>
        </div>
      )}
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

      {node.security && (
        <>
          <h3 style={{ marginTop: 14 }}>Security posture · {node.security.signals.length} signals</h3>
          <div className="sub" style={{ marginTop: -4, marginBottom: 6 }}>
            {node.security.method.replace(/_/g, ' ')} · {new Date(node.security.attestedAt).toLocaleString()} · by {node.security.attestedBy}
          </div>
          {node.security.signals.map((signal) => {
            const counts = (['critical', 'high', 'medium', 'low'] as const).filter((severity) => (signal.findings?.[severity] ?? 0) > 0);
            return (
              <div className="cap" key={signal.dimension}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <span className="label">{POSTURE_DIMENSION_LABEL[signal.dimension] ?? signal.dimension}</span>
                  <span className="badge" style={{ color: POSTURE_STATE_COLOR[signal.state], borderColor: POSTURE_STATE_COLOR[signal.state] }}>{signal.state}</span>
                </div>
                {signal.summary && <div className="desc">{signal.summary}</div>}
                <div className="desc" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {signal.coverage !== undefined && <span>coverage {Math.round(signal.coverage * 100)}%</span>}
                  {counts.map((severity) => <span key={severity} className={`sec-count ${severity}`}>{signal.findings?.[severity]} {severity}</span>)}
                  {signal.evidenceRef && <span className="mono" title="An opaque reference. The dock never dereferences it.">{signal.evidenceRef.slice(0, 24)}…</span>}
                </div>
              </div>
            );
          })}
        </>
      )}

      <h3 style={{ marginTop: 14 }}>Metadata</h3>
      <div className="kv">
        {Object.entries(md).map(([k, v]) => (
          <>
            <span key={`${k}-k`}>{k}</span>
            <b key={`${k}-v`}>
              {k === 'repo' && githubRepoUrl(v)
                ? <a href={githubRepoUrl(v)!} target="_blank" rel="noreferrer">{String(v)}</a>
                : String(v)}
            </b>
          </>
        ))}
      </div>
    </aside>
  );
}
