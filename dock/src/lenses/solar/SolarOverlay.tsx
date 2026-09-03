import { useState } from 'react';
import type { DockState } from '../../api/useControlPlane';
import type { ConsoleIntent } from '../../App';
import { HEALTH_COLOR, HEALTHS, type Snapshot, type SnapshotNode } from '../../model/types';
import type { SolarLayout } from '../../model/solar';
import { downloadJson, exportName } from '../ops/download';

const num: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', color: 'var(--text)', fontWeight: 600 };
const MODE_COLOR: Record<string, string> = { observe: '#39C6D8', propose: '#8B7CF6', execute: '#F5B942' };

/**
 * The legend and the command palette.
 *
 * Every verb an operator can reach from here is one of two things: a read the dock already
 * holds, or a command the control plane already accepts. There is no third kind. In
 * particular there is no delete — canonical history is append-only, so retiring a body is
 * a revision — and there is no dispatch: asking a body to mine, scan or run lands in the
 * coordination ledger as `not_dispatched`, which is the plane's whole model of control.
 * The palette says so on the buttons rather than in a footnote.
 */
export function SolarOverlay({ dock, snapshot, layout, arcs, selected, selectedNode, onSelect, onFit, onFocus, onIntent }: {
  dock: DockState;
  snapshot: Snapshot;
  layout: SolarLayout;
  arcs: number;
  selected: string | null;
  selectedNode: SnapshotNode | null;
  onSelect: (nodeId: string | null) => void;
  onFit: () => void;
  onFocus: (nodeId: string) => void;
  onIntent: (intent: ConsoleIntent) => void;
}) {
  const [legendOpen, setLegendOpen] = useState(true);
  const live = dock.mode === 'live';
  const writeTitle = live ? undefined : 'Connect to a live control plane to submit commands. The sample snapshot is read-only.';

  const revision = snapshot.revision;
  const downloadSnapshot = () => downloadJson(exportName('snapshot', revision), snapshot);
  const downloadEvents = () => downloadJson(exportName('events', revision), {
    schema: 'notations.dock.export.events.v1',
    apiResponse: snapshot.apiResponse ?? null,
    reference: snapshot.reference ?? null,
    proofRoot: snapshot.proofRoot ?? null,
    // Said out loud in the file: a page that stopped following is not the whole journal.
    truncated: dock.truncated,
    events: dock.events,
  });
  const downloadBody = (node: SnapshotNode) => downloadJson(exportName(`body-${node.nodeId}`, revision), {
    schema: 'notations.dock.export.body.v1',
    reference: snapshot.reference ?? null,
    proofRoot: snapshot.proofRoot ?? null,
    node,
    relations: snapshot.relations.filter((r) => r.sourceNodeId === node.nodeId || r.targetNodeId === node.nodeId),
    coordination: snapshot.coordination.filter((c) => c.requesterNodeId === node.nodeId || c.targetNodeId === node.nodeId),
  });

  return (
    <>
      <div className="overlay" style={{ top: 12, left: 52, width: 262, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Solar system</span>
          <button className="btn small" style={{ marginLeft: 'auto' }} onClick={onFit} title="Fit the whole system in view">Fit</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
          <div><div style={num}>{layout.bodies.length}</div><div style={{ color: 'var(--muted)' }}>bodies</div></div>
          <div><div style={num}>{layout.moons.length}</div><div style={{ color: 'var(--muted)' }}>moons</div></div>
          <div><div style={num}>{arcs}</div><div style={{ color: 'var(--muted)' }}>arcs</div></div>
        </div>
        <div style={{ color: 'var(--muted)', marginTop: 6 }}>
          {layout.sun
            ? <>Sun: <button className="btn small" style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--amber)' }} onClick={() => onSelect(layout.sun!.nodeId)}>{layout.sun.name}</button> — everything else is registered with it.</>
            : <>No coordinating node in view, so no sun. Nothing was invented to fill the centre.</>}
        </div>

        <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
          <button className="btn small" style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--cyan)' }} onClick={() => setLegendOpen((o) => !o)} aria-expanded={legendOpen}>
            {legendOpen ? '▾' : '▸'} what the sky means
          </button>
          {legendOpen && (
            <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>orbits · one per domain, inner to outer</div>
                <ol style={{ margin: '3px 0 0', paddingLeft: 18, color: 'var(--text)' }}>
                  {layout.orbits.map((o) => <li key={o.index}>{o.domain} <span style={{ color: 'var(--muted)' }}>· {o.bodies}</span></li>)}
                </ol>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>bodies · size is capability count, colour is health</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 3 }}>
                  {HEALTHS.map((h) => <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: HEALTH_COLOR[h] }} />{h}</span>)}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>moons · one per capability, colour is what it may do</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                  {Object.entries(MODE_COLOR).map(([mode, color]) => <span key={mode} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />{mode}</span>)}
                </div>
              </div>
              <div style={{ color: 'var(--muted)' }}>Nothing here is a place. Positions are domain and registration order, laid out the same for everyone.</div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn small" onClick={downloadSnapshot} title="The current snapshot, with the reference and proof root it was read at">↓ snapshot</button>
          <button className="btn small" onClick={downloadEvents} disabled={!dock.events.length} title="The journal events the dock has followed">↓ events</button>
          <button className="btn small primary" onClick={() => onIntent({ action: 'register_node' })} disabled={!live} title={writeTitle ?? 'Register a new body: a register_node command, validated client-side before it is sent'}>+ body</button>
        </div>
        {dock.mode === 'sample' && <div style={{ color: 'var(--amber)', marginTop: 6 }}>sample snapshot · not a live control plane</div>}
      </div>

      {selectedNode && (
        <ActionPalette node={selectedNode} live={live} writeTitle={writeTitle} isSun={layout.sun?.nodeId === selectedNode.nodeId} onFocus={onFocus} onIntent={onIntent} onDownload={() => downloadBody(selectedNode)} onClose={() => onSelect(null)} selectedId={selected} />
      )}
    </>
  );
}

function ActionPalette({ node, live, writeTitle, isSun, onFocus, onIntent, onDownload, onClose, selectedId }: {
  node: SnapshotNode; live: boolean; writeTitle: string | undefined; isSun: boolean;
  onFocus: (nodeId: string) => void; onIntent: (intent: ConsoleIntent) => void; onDownload: () => void; onClose: () => void; selectedId: string | null;
}) {
  const byMode = (mode: string) => node.capabilities.filter((c) => c.mode === mode);
  const acting = byMode('execute').concat(byMode('propose'));
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? acting : acting.slice(0, 6);
  return (
    <div className="overlay" style={{ top: 12, right: 12, width: 300, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'start', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>{isSun ? 'sun' : 'body'}</div>
          <div style={{ fontWeight: 600 }}>{node.name}</div>
          <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{node.nodeId}</div>
        </div>
        <button className="btn small" style={{ marginLeft: 'auto' }} onClick={onClose}>×</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
        <button className="btn small" onClick={() => onFocus(node.nodeId)} title="Fly the view to this body">navigate</button>
        <button className="btn small" onClick={onDownload} title="This body, its relations and its coordination records, with the proof root they were read at">↓ download</button>
        <button className="btn small" onClick={() => onIntent({ action: 'record_observation', nodeId: node.nodeId })} disabled={!live} title={writeTitle ?? 'Record a health observation'}>observe</button>
        <button className="btn small" onClick={() => onIntent({ action: 'record_security_posture', nodeId: node.nodeId })} disabled={!live} title={writeTitle ?? 'Attest this body\'s security posture. Evidence only: nothing that names a version, an address or an advisory crosses'}>secure</button>
        <button className="btn small" onClick={() => onIntent({ action: 'register_node', nodeId: node.nodeId })} disabled={!live} title={writeTitle ?? 'Revise this body. Re-registration is journaled as a revision; nothing is overwritten in place'}>edit</button>
        <button className="btn small" onClick={() => onIntent({ action: 'register_node', nodeId: node.nodeId })} disabled={!live} title={writeTitle ?? 'There is no delete: history is append-only. Retiring a body is a revision with maturity set to archived, and every earlier state stays in the journal'}>retire</button>
      </div>

      <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
        <div style={{ color: 'var(--muted)', fontSize: 11 }}>
          control · mine · scan — request a capability. It lands in the ledger as <span className="badge not_dispatched" style={{ margin: 0 }}>not dispatched</span>; approval is not execution.
        </div>
        {acting.length === 0 && <div style={{ color: 'var(--muted)', marginTop: 4 }}>This body only observes. There is nothing to request that would act on the world.</div>}
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 4 }}>
          {shown.map((c) => (
            <li key={c.capabilityId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: MODE_COLOR[c.mode], flex: 'none' }} />
              <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={`${c.label} — ${c.description}`}>{c.capabilityId}</span>
              <span className={`badge ${c.approval === 'operator' ? 'operator' : ''}`} style={{ margin: 0 }}>{c.approval}</span>
              <button className="btn small" onClick={() => onIntent({ action: 'request_capability', nodeId: node.nodeId, capabilityId: c.capabilityId })} disabled={!live} title={writeTitle ?? `Request ${c.mode} of ${c.capabilityId}`}>request</button>
            </li>
          ))}
        </ul>
        {acting.length > 6 && (
          <button className="btn small" style={{ marginTop: 6, background: 'transparent', border: 'none', padding: 0, color: 'var(--cyan)' }} onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'fewer' : `all ${acting.length}`}
          </button>
        )}
      </div>

      <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 11 }}>
        {byMode('observe').length} observe · {byMode('propose').length} propose · {byMode('execute').length} execute
        {selectedId === node.nodeId ? ' · details in the inspector →' : ''}
      </div>
    </div>
  );
}
