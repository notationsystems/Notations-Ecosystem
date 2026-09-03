import { useMemo, useState } from 'react';
import type { LensProps } from './types';
import {
  API_PLANE_BLURB,
  API_PLANE_LABEL,
  API_PLANE_ORDER,
  API_PLANE_PUBLIC,
  apiStanding,
  type ApiPlane,
  type SnapshotNode,
} from '../model/types';

/**
 * The four planes, and which systems are served on each.
 *
 * The other lenses answer what a system holds and whether it can be trusted to hold it.
 * This answers the third question — who may reach it, and in what shape — from
 * [docs/API_PLANES.md](../../docs/API_PLANES.md): four roles, four planes, thirteen module
 * families, and one invariant that every response either carries a proof root or says it
 * is an observation.
 *
 * The number worth looking at is not the plane count. It is **writes on a public plane**,
 * which must be zero: a capability whose role mutates reaches canonical state through
 * governance or the operator plane or not at all. The catalog refuses the combination and
 * `ecosystem/api.mjs` exits non-zero on it; this is where an operator sees that it held.
 */
const PLANE_COLOR: Record<ApiPlane, string> = {
  tenant_read: '#58a6ff',
  verification: '#3fb950',
  governance: '#d29922',
  internal_operator: '#bc8cff',
};

export function ApiLens({ filtered, selected, onSelect }: LensProps) {
  const [plane, setPlane] = useState<ApiPlane | null>(null);

  const placed = useMemo(
    () =>
      filtered.nodes
        .map((node) => ({ node, api: apiStanding(node) }))
        .filter((entry): entry is { node: SnapshotNode; api: NonNullable<ReturnType<typeof apiStanding>> } => entry.api !== null),
    [filtered.nodes],
  );

  const onPlane = (id: ApiPlane) => placed.filter((entry) => entry.api.planes.includes(id));
  const writes = placed.reduce((sum, entry) => sum + entry.api.writes, 0);
  const operatorOnly = placed.reduce((sum, entry) => sum + entry.api.operatorOnly, 0);
  const deviations = placed.filter((entry) => entry.api.deviations);
  // The invariant, computed from what actually crossed rather than asserted: a node that
  // writes and is served on a public plane would appear here.
  const publicWriters = placed.filter((entry) => entry.api.writes && entry.api.planes.some((p) => API_PLANE_PUBLIC[p] && !entry.api.planes.some((q) => !API_PLANE_PUBLIC[q])));

  const shown = plane ? onPlane(plane) : placed;

  if (!placed.length) {
    return (
      <div className="lens scroll">
        <p className="empty-note">
          No node in this snapshot states where it sits in the API architecture. The planes are
          derived from each capability's module family by <code>ecosystem/api.mjs</code> and seeded as
          node metadata; a journal written before that existed carries none.
        </p>
      </div>
    );
  }

  return (
    <div className="lens scroll">
      <div className="strip">
        <div className="kpi">
          <span>placed nodes</span>
          <b>
            {placed.length} / {filtered.nodes.length}
          </b>
        </div>
        <div className="kpi">
          <span>capabilities that write</span>
          <b>{writes}</b>
        </div>
        <div className="kpi">
          <span title="Actions a person triggers rather than endpoints anyone calls: key rotation, credential issue, site activation, runtime switches. An agent cannot reach one.">
            on no plane
          </span>
          <b>{operatorOnly}</b>
        </div>
        <div className="kpi">
          <span title="Writes the architecture would not serve, declared rather than hidden or forced into a family that fits.">declared deviations</span>
          <b style={{ color: deviations.length ? '#d29922' : undefined }}>{deviations.reduce((sum, e) => sum + e.api.deviations, 0)}</b>
        </div>
        <div className="kpi">
          <span title="A capability whose role mutates may not be served on a plane anyone may call. This is the rule the four planes exist for.">
            public canonical CRUD
          </span>
          <b style={{ color: publicWriters.length ? '#f85149' : '#3fb950' }}>{publicWriters.length}</b>
        </div>
        <div style={{ marginLeft: 'auto', maxWidth: 460, textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>
          Every response this plane returns carries a canonical reference and the proof root it was
          read at, or says it is an operational observation and states what it does not cover.
        </div>
      </div>

      <div className="corpus-roles">
        <button type="button" className={`tab ${plane === null ? 'active' : ''}`} onClick={() => setPlane(null)}>
          all planes ({placed.length})
        </button>
        {API_PLANE_ORDER.map((id) => {
          const count = onPlane(id).length;
          if (!count) return null;
          return (
            <button
              key={id}
              type="button"
              className={`tab ${plane === id ? 'active' : ''}`}
              onClick={() => setPlane(plane === id ? null : id)}
              title={API_PLANE_BLURB[id]}
              style={{ borderColor: plane === id ? PLANE_COLOR[id] : undefined }}
            >
              {API_PLANE_LABEL[id]} ({count}){API_PLANE_PUBLIC[id] ? '' : ' ·'}
            </button>
          );
        })}
      </div>

      {plane && (
        <p className="empty-note" style={{ marginTop: 10, marginBottom: 0 }}>
          <b style={{ color: PLANE_COLOR[plane] }}>{API_PLANE_LABEL[plane]}</b>
          {API_PLANE_PUBLIC[plane] ? ' · public' : ' · not public'} — {API_PLANE_BLURB[plane]}
        </p>
      )}

      <div className="sec-grid" style={{ marginTop: 12 }}>
        {shown.map(({ node, api }) => (
          <button
            key={node.nodeId}
            type="button"
            className={`sec-card ${selected === node.nodeId ? 'active' : ''}`}
            style={{ borderLeftColor: api.planes.length ? PLANE_COLOR[api.planes[0]!] : 'var(--line)' }}
            onClick={() => onSelect(selected === node.nodeId ? null : node.nodeId)}
          >
            <span className="sec-head">
              <span className="sec-dot" style={{ background: api.planes.length ? PLANE_COLOR[api.planes[0]!] : 'var(--line)' }} />
              {node.name}
            </span>
            <span className="sec-findings">
              {api.planes.map((id) => (
                <span key={id} className="badge" style={{ borderColor: PLANE_COLOR[id], color: PLANE_COLOR[id] }} title={API_PLANE_BLURB[id]}>
                  {API_PLANE_LABEL[id]}
                </span>
              ))}
              {!api.planes.length && <span className="sec-findings none">on no plane</span>}
            </span>
            <span className="sec-meta">
              <span title="Capabilities whose role mutates. Each passes a governed gate; none is served where anyone may call it.">
                {api.writes} write{api.writes === 1 ? '' : 's'}
              </span>
              {api.operatorOnly > 0 && (
                <span title="Actions a person triggers, off every plane. No agent surface reaches one.">{api.operatorOnly} operator-only</span>
              )}
              {api.deviations > 0 && (
                <span className="sec-count medium" title="A write the architecture would not serve, named rather than hidden. See the node's capabilities in the catalog for the sentence.">
                  {api.deviations} deviation{api.deviations === 1 ? '' : 's'}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      <p className="empty-note" style={{ marginTop: 14 }}>
        Four roles, four planes, thirteen module families — <code>docs/API_PLANES.md</code>. A
        capability declares only which family it belongs to; its role, the planes it may be served
        on and the shape its response must take all follow from that. The two planes marked
        <b> not public</b> are where every write lives, because a read API that also writes is what
        every canonical-CRUD leak starts as.
      </p>
    </div>
  );
}
