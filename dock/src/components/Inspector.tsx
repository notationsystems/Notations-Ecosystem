import type { Snapshot, SnapshotNode } from '../model/types';
import { CORPUS_GRADE_COLOR, CORPUS_ROLE_LABEL, FABRIC_AUTHORITY_COLOR, FABRIC_AUTHORITY_LABEL, KIND_LABEL, MATURITY_COLOR, PERSON_DATA_COLOR, PERSON_DATA_LABEL, POSTURE_DIMENSION_LABEL, POSTURE_STATE_COLOR, RELATION_LABEL, collectionStanding, corpusStanding } from '../model/types';
import { githubRepoUrl } from '../model/links';
import { healthTruth, postureTruth } from '../model/truth';
import { Evidenced } from './Evidence';

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
  const words = (value: unknown): string[] => (typeof value === 'string' && value.trim() ? value.trim().split(/\s+/) : []);
  const subjects = words(md.data_domains);
  // The fabric: bindings this node holds as a system, and bindings that name it as anchor.
  const bindings = (snapshot.fabric?.syncs ?? []).filter((s) => s.systemNodeId === node.nodeId);
  const anchored = (snapshot.fabric?.syncs ?? []).filter((s) => s.fabricNodeId === node.nodeId);
  // How the node is spoken to, never where it lives: a surface is `mcp_tool` or `cli`,
  // not a URL, a port or an internal hostname.
  const surfaces = words(md.surfaces);
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
          {typeof md.methodology === 'string' && (
            <>
              <span title="The versioned methodology this corpus owner produces its answers under, declared in its catalog entry. The text stays there; the name and status cross.">methodology</span>
              <b className="mono">{md.methodology}{typeof md.methodology_status === 'string' ? ` · ${md.methodology_status}` : ''}</b>
            </>
          )}
        </div>
      )}
      {(bindings.length > 0 || anchored.length > 0) && (
        <div className="kv" style={{ marginBottom: 10 }}>
          <span title="How this node participates in the canonical data platform. A binding is a contract the plane checked against the node's corpus role — a projection is never accepted as canonical state — not a record that bytes moved.">fabric</span>
          <b>
            {bindings.map((b) => (
              <span key={b.syncId} className="badge" style={{ borderColor: FABRIC_AUTHORITY_COLOR[b.authority], color: FABRIC_AUTHORITY_COLOR[b.authority] }} title={`${b.syncId}: ${b.mode}; carries ${b.identityKinds.join(', ')} as ${b.representations.join(', ')}. Declared, not synced.`}>{FABRIC_AUTHORITY_LABEL[b.authority]}</span>
            ))}
            {anchored.length > 0 && <span style={{ fontWeight: 400 }}>anchor for {anchored.length} bound system{anchored.length === 1 ? '' : 's'}{typeof md.fabric_layers === 'string' ? ` · provides ${md.fabric_layers}` : ''}</span>}
          </b>
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
      {surfaces.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="sub" style={{ marginBottom: 4 }} title="How this node's capabilities are reached. A kind, not an address.">surfaces · {surfaces.length}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {surfaces.map((surface) => <span className="badge" key={surface}>{surface}</span>)}
          </div>
        </div>
      )}
      {/* API-001: health is an observation, and a node nothing has looked at is UNOBSERVED — not healthy,
          and not a dash that reads as none. Both are rendered as the class they are. */}
      <div className="kv" style={{ marginBottom: 10 }}>
        <span>health</span>
        <b><Evidenced truth={healthTruth(node)} render={(v) => <span>{v}</span>} /></b>
        <span>posture</span>
        <b><Evidenced truth={postureTruth(node)} render={(v) => <span>{v}</span>} /></b>
      </div>
      {onObserve && <div style={{ marginBottom: 12 }}><button className="btn small" onClick={() => onObserve(node)}>Record observation</button></div>}

      <h3>Capabilities · {node.capabilities.length}</h3>
      {node.capabilities.map((c) => (
        <div className="cap" key={c.capabilityId}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
            <span className="id">{c.capabilityId}</span>
            <span>
              <span className={`badge ${c.mode}`}>{c.mode}</span>
              <span className={`badge ${c.approval === 'operator' ? 'operator' : ''}`}>{c.approval}</span>
              <span className="badge" style={{ color: MATURITY_COLOR[c.maturity ?? 'undeclared'], borderColor: MATURITY_COLOR[c.maturity ?? 'undeclared'] }} title={c.maturity ? `Declared maturity: ${c.maturity}` : 'Undeclared: nobody has assessed how far this is from being relied on, and the plane does not guess'}>{c.maturity ?? 'undeclared'}</span>
            </span>
          </div>
          <div className="label">{c.label}{c.methodologyVersion ? <span className="sub mono" style={{ marginLeft: 6 }} title="The methodology this capability answers under">{c.methodologyVersion}</span> : null}</div>
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
            {node.security.signer
              ? <> · <span title="An independent collector signed this statement with its own key, and the plane verified the signature against the public half it holds.">signed by <span className="mono">{node.security.signer.signerId}</span></span></>
              : <> · <span style={{ color: '#F5B942' }} title="No collector's signature: this posture rests on the submitting principal's authority, which the plane vouched for and nobody else did.">unsigned</span></>}
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
