import { useState } from 'react';
import type { DockMode } from '../../api/useControlPlane';
import { KIND_COLOR, KIND_LABEL, type SnapshotNode } from '../../model/types';

const num: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', color: 'var(--text)', fontWeight: 600 };

export function MapOverlay({ located, unlocated, arcs, mode, selected, onSelect, onFit, basemap }: {
  located: number;
  unlocated: SnapshotNode[];
  arcs: number;
  mode: DockMode;
  selected: string | null;
  onSelect: (nodeId: string | null) => void;
  onFit: () => void;
  basemap: 'loading' | 'ready' | 'unavailable';
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overlay map-overlay" style={{ top: 12, left: 52, width: 250, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Universe map</span>
        <button className="btn small" style={{ marginLeft: 'auto' }} onClick={onFit} disabled={located === 0} title="Fit the view to the located nodes">Fit</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
        <div><div style={num}>{located}</div><div style={{ color: 'var(--muted)' }}>located</div></div>
        <div><div style={num}>{unlocated.length}</div><div style={{ color: 'var(--muted)' }}>unlocated</div></div>
        <div><div style={num}>{arcs}</div><div style={{ color: 'var(--muted)' }}>arcs</div></div>
      </div>
      {arcs === 0 && located > 0 && <div style={{ color: 'var(--muted)', marginTop: 6 }}>Arcs need both ends located.</div>}
      {unlocated.length > 0 && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
          <button className="btn small" style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--cyan)' }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? '▾' : '▸'} unlocated nodes · {unlocated.length}
          </button>
          {open && (
            <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, maxHeight: 220, overflow: 'auto' }}>
              {unlocated.map((n) => (
                <li key={n.nodeId}>
                  <button
                    onClick={() => onSelect(n.nodeId)}
                    title={`${KIND_LABEL[n.kind]} · ${n.nodeId}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', background: selected === n.nodeId ? 'var(--bg-3)' : 'transparent', border: 'none', borderRadius: 4, padding: '3px 4px', cursor: 'pointer', color: selected === n.nodeId ? 'var(--amber)' : 'var(--text)' }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: KIND_COLOR[n.kind], flex: 'none' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(mode === 'sample' || basemap === 'unavailable') && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {mode === 'sample' && <span style={{ color: 'var(--amber)' }}>sample snapshot · not a live control plane</span>}
          {basemap === 'unavailable' && <span style={{ color: 'var(--muted)' }}>basemap tiles unavailable (offline); nodes and arcs still render</span>}
        </div>
      )}
    </div>
  );
}
