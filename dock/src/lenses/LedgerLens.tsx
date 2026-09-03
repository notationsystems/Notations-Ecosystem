import { useMemo, useState } from 'react';
import type { Coordination, CoordinationStatus } from '../model/types';
import type { LensProps } from './types';
import { fmtTime } from './ops/format';
import './ops/ops.css';

export interface LedgerLensProps extends LensProps { onResolve: (coordinationId: string) => void }

type StatusFilter = 'all' | CoordinationStatus;
const STATUS_FILTERS: StatusFilter[] = ['all', 'approval_required', 'ready', 'approved', 'rejected'];

/**
 * The coordination ledger: every capability request the control plane has recorded, newest first.
 * Approval is a decision, not an action — every row carries the control plane's own `not_dispatched` marker.
 */
export function LedgerLens({ snapshot, onSelect, onResolve }: LedgerLensProps) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const byId = useMemo(() => new Map(snapshot.nodes.map((n) => [n.nodeId, n])), [snapshot.nodes]);

  const sorted = useMemo(
    () => [...snapshot.coordination].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt) || a.coordinationId.localeCompare(b.coordinationId)),
    [snapshot.coordination],
  );
  const rows = status === 'all' ? sorted : sorted.filter((c) => c.status === status);
  const count = (s: StatusFilter) => (s === 'all' ? sorted.length : sorted.filter((c) => c.status === s).length);

  const NodeLink = ({ id }: { id: string }) => {
    const node = byId.get(id);
    return <button className="ops-link" title={node ? `${node.name} · ${id}` : id} onClick={() => onSelect(id)}>{node?.name ?? id}</button>;
  };

  const statusLabel = (c: Coordination) => (c.status === 'approved' ? 'approved · not dispatched' : c.status.replace('_', ' '));

  return (
    <div className="lens scroll ledger">
      <div className="ops-head">
        <div>
          <h2>Coordination ledger</h2>
          <p className="lede">Approval is not execution. Every record stays not_dispatched; execution adapters are a separate boundary.</p>
        </div>
        <span className="meta num">{sorted.length} record{sorted.length === 1 ? '' : 's'} · {count('approval_required')} awaiting decision</span>
      </div>

      <div className="ops-chips">
        {STATUS_FILTERS.map((s) => (
          <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s === 'all' ? 'all' : s.replace('_', ' ')}<span className="n">{count(s)}</span></button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="ops-empty">
          {sorted.length === 0
            ? 'No coordination records yet. A capability request from the console appears here the moment the control plane journals it.'
            : `No records with status “${status.replace('_', ' ')}”.`}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="grid">
            <colgroup>
              <col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '11%' }} /><col style={{ width: '17%' }} />
              <col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '9%' }} /><col style={{ width: '13%' }} /><col style={{ width: 132 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Coordination</th>
                <th>Requester → target</th>
                <th>Capability</th>
                <th>Purpose</th>
                <th>Requested</th>
                <th>Status</th>
                <th>Dispatch</th>
                <th>Resolution</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.coordinationId} className={c.status}>
                  <td className="mono cid">{c.coordinationId}</td>
                  <td>
                    <div className="pair"><NodeLink id={c.requesterNodeId} /><span className="arrow">→ target</span><NodeLink id={c.targetNodeId} /></div>
                    <div className="ids mono">{c.requesterNodeId} → {c.targetNodeId}</div>
                  </td>
                  <td>
                    <span className="mono" style={{ color: 'var(--amber)' }}>{c.capabilityId}</span>
                    <div style={{ marginTop: 3 }}><span className={`badge ${c.requestedMode}`}>{c.requestedMode}</span></div>
                  </td>
                  <td className="purpose">{c.purpose}</td>
                  <td>
                    <div>{c.requestedBy}</div>
                    <div className="mono num" style={{ color: 'var(--muted)' }}>{fmtTime(c.requestedAt)}</div>
                  </td>
                  <td><span className={`badge status-${c.status}`}>{statusLabel(c)}</span></td>
                  <td><span className="badge not_dispatched">not dispatched</span></td>
                  <td className="resolution">
                    {c.resolvedAt || c.resolvedBy || c.resolutionNote ? (
                      <>
                        <div><b>{c.resolvedBy ?? '—'}</b></div>
                        <div className="mono num">{fmtTime(c.resolvedAt)}</div>
                        {c.resolutionNote && <div style={{ marginTop: 2 }}>{c.resolutionNote}</div>}
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                  <td>
                    {c.status === 'approval_required' && (
                      <div className="actions">
                        <button className="btn small primary" onClick={() => onResolve(c.coordinationId)} title="Open the console to record the decision">Approve</button>
                        <button className="btn small danger" onClick={() => onResolve(c.coordinationId)} title="Open the console to record the decision">Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
