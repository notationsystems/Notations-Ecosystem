import { useState } from 'react';
import type { Drift, Fidelity, TimePoint } from '../../model/twin';

const num: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', color: 'var(--text)', fontWeight: 600 };
const short = (id: string) => (id.includes(':') ? id.split(':')[1]!.slice(0, 10) : id.slice(0, 10));

/**
 * What makes the sky a twin and not a picture: a time axis, a statement of what the twin
 * knows, and the drift between the blueprint and the estate.
 *
 * Each figure here is countable from the snapshot and the journal, and nothing is rounded
 * into a score. "Fidelity 40%" would be a number nobody can act on; "27 bodies never
 * observed" is the work.
 */
export function TwinPanel({ axis, cursor, onCursor, atRevision, live, fidelity, drift, blueprintLoaded, travelling }: {
  axis: TimePoint[];
  cursor: string | null;
  onCursor: (eventId: string | null) => void;
  /** The revision of the sky currently drawn — the head, or the record scrubbed to. */
  atRevision: string | null;
  live: boolean;
  fidelity: Fidelity;
  drift: Drift | null;
  blueprintLoaded: boolean;
  travelling: boolean;
}) {
  const [driftOpen, setDriftOpen] = useState(false);
  const index = cursor ? axis.findIndex((p) => p.eventId === cursor) : axis.length - 1;
  const point = index >= 0 ? axis[index] : null;

  return (
    <div className="overlay" style={{ bottom: 12, left: 52, width: 420, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Twin</span>
        <span style={{ marginLeft: 'auto', color: cursor ? 'var(--amber)' : 'var(--muted)' }}>
          {cursor ? 'past' : 'now'} · <span className="mono">{atRevision ? atRevision.slice(0, 12) : '—'}</span>
        </span>
      </div>

      {/* Time axis. The plane folds the prefix; the dock only asks. */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>time · {axis.length} records</span>
          {cursor && <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => onCursor(null)}>back to now</button>}
        </div>
        {live && axis.length > 1 ? (
          <>
            <input
              type="range"
              min={0}
              max={axis.length - 1}
              value={index < 0 ? axis.length - 1 : index}
              onChange={(e) => {
                const i = Number(e.target.value);
                onCursor(i >= axis.length - 1 ? null : axis[i]!.eventId);
              }}
              style={{ width: '100%', marginTop: 6, accentColor: cursor ? '#F5B942' : '#39C6D8' }}
              title="Scrub the sky back through the journal. Every position is a snapshot the plane folded, referenced at that record's hash."
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: 11 }}>
              <span className="mono">{point ? `#${point.index + 1} ${point.kind}` : ''}</span>
              <span>{point?.recordedAt ? new Date(point.recordedAt).toLocaleString() : ''}{travelling ? ' · folding…' : ''}</span>
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--muted)', marginTop: 4 }}>
            {live ? 'One record: nothing to travel back to yet.' : 'The sample snapshot has no journal. Connect to a live plane to travel.'}
          </div>
        )}
      </div>

      {/* What the twin knows. */}
      <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
        <div style={{ color: 'var(--muted)', fontSize: 11 }}>what this twin knows</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 4 }}>
          <div><div style={num}>{fidelity.observed}</div><div style={{ color: 'var(--muted)' }}>observed</div></div>
          <div><div style={num}>{fidelity.attested}</div><div style={{ color: 'var(--muted)' }}>attested</div></div>
          <div><div style={{ ...num, color: fidelity.blind ? '#F5B942' : undefined }}>{fidelity.blind}</div><div style={{ color: 'var(--muted)' }}>blind</div></div>
          <div><div style={num}>{fidelity.syncAgeSeconds === null ? '—' : `${fidelity.syncAgeSeconds}s`}</div><div style={{ color: 'var(--muted)' }}>sync age</div></div>
        </div>
        <div style={{ color: 'var(--muted)', marginTop: 4 }}>
          {fidelity.blind > 0
            ? <>{fidelity.blind} of {fidelity.total} bodies have never been observed or attested. They are drawn grey and without a halo; the twin knows they exist and nothing else.</>
            : <>Every body has been observed or attested at least once.</>}
        </div>
        {fidelity.proofRoot && (
          <div style={{ color: 'var(--muted)', marginTop: 4 }} title={fidelity.reference ?? undefined}>
            proof root · {fidelity.proofRoot.chain}{fidelity.proofRoot.signing === 'active' ? ', signed' : `, signing ${fidelity.proofRoot.signing}`}{fidelity.proofRoot.rollbackAnchor ? ', anchored' : ''}
          </div>
        )}
      </div>

      {/* Drift from the blueprint. */}
      <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>drift from the catalog blueprint</span>
          {drift && !drift.clean && (
            <button className="btn small" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', padding: 0, color: 'var(--cyan)' }} onClick={() => setDriftOpen((o) => !o)}>
              {driftOpen ? 'less' : 'detail'}
            </button>
          )}
        </div>
        {!blueprintLoaded && <div style={{ color: 'var(--muted)', marginTop: 4 }}>Blueprint not loaded.</div>}
        {drift && drift.clean && <div style={{ color: '#5AC77A', marginTop: 4 }}>{live ? 'The estate is the catalog: nothing missing, nothing unplanned, no capability changed.' : 'The sample is the blueprint; drift needs a live plane to measure.'}</div>}
        {drift && !drift.clean && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 4 }}>
              <div><div style={{ ...num, color: drift.missing.length ? '#E8536A' : undefined }}>{drift.missing.length}</div><div style={{ color: 'var(--muted)' }}>missing</div></div>
              <div><div style={{ ...num, color: drift.unplanned.length ? '#F5B942' : undefined }}>{drift.unplanned.length}</div><div style={{ color: 'var(--muted)' }}>unplanned</div></div>
              <div><div style={{ ...num, color: drift.changed.length ? '#F5B942' : undefined }}>{drift.changed.length}</div><div style={{ color: 'var(--muted)' }}>changed</div></div>
              <div><div style={num}>{drift.relationsMissing + drift.relationsUnplanned}</div><div style={{ color: 'var(--muted)' }}>relations</div></div>
            </div>
            {driftOpen && (
              <div style={{ marginTop: 6, maxHeight: 160, overflow: 'auto', display: 'grid', gap: 3 }}>
                {drift.missing.map((id) => <div key={`m-${id}`}><span style={{ color: '#E8536A' }}>missing</span> <span className="mono">{id}</span></div>)}
                {drift.unplanned.map((id) => <div key={`u-${id}`}><span style={{ color: '#F5B942' }}>unplanned</span> <span className="mono">{id}</span></div>)}
                {drift.changed.map((c) => (
                  <div key={`c-${c.nodeId}`}>
                    <span style={{ color: '#F5B942' }}>changed</span> <span className="mono">{c.nodeId}</span> <span style={{ color: 'var(--muted)' }}>{c.blueprint} → {c.live} capabilities{c.added.length ? `, +${c.added.length}` : ''}{c.removed.length ? `, −${c.removed.length}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ color: 'var(--muted)', marginTop: 4 }}>Drift is not an error — a body revised in the field is the system working. Drift nobody can see is how a catalog and a plane come to describe two estates.</div>
          </>
        )}
      </div>
      {cursor && point && <div style={{ color: 'var(--muted)', marginTop: 6, fontSize: 11 }}>Showing the sky as of record {short(point.eventId)}. Writes act on now, not on then.</div>}
    </div>
  );
}
