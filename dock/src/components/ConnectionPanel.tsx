import { useState } from 'react';
import type { DockState } from '../api/useControlPlane';

export function ConnectionPanel({ dock }: { dock: DockState }) {
  const [draft, setDraft] = useState(dock.connection);
  const dirty = draft.baseUrl !== dock.connection.baseUrl || draft.token !== dock.connection.token || draft.actorId !== dock.connection.actorId;
  return (
    <section>
      <h3>Control plane</h3>
      <div className="field"><label>Base URL</label><input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="/cp or http://127.0.0.1:8787" /></div>
      <div className="field"><label>Bearer token (session only)</label><input type="password" value={draft.token} onChange={(e) => setDraft({ ...draft, token: e.target.value })} placeholder="NOTATIONS_CONTROL_PLANE_TOKEN" autoComplete="off" /></div>
      <div className="field"><label>Actor id</label><input value={draft.actorId} onChange={(e) => setDraft({ ...draft, actorId: e.target.value })} /></div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn primary" onClick={() => dock.setConnection(draft)} disabled={!dirty}>Connect</button>
        <button className="btn" onClick={() => { void dock.refresh(); }}>Refresh</button>
      </div>
      <div style={{ color: 'var(--muted)', marginTop: 8, fontSize: 11 }}>
        {dock.mode === 'live' && <>Live · revision <span className="mono">{dock.snapshot?.revision?.slice(0, 12) ?? '—'}</span> · synced {dock.lastSync ? new Date(dock.lastSync).toLocaleTimeString() : '—'}</>}
        {dock.mode === 'sample' && <>Showing the bundled sample snapshot generated from the catalog. Enter a token to see live control-plane state.</>}
        {dock.mode === 'disconnected' && <>Not connected.</>}
      </div>
      {dock.error && <div className="error" style={{ marginTop: 8 }}><b>{'code' in dock.error ? dock.error.code : dock.error.name}</b> {dock.error.message}{'remedy' in dock.error && dock.error.remedy ? <div className="remedy">{dock.error.remedy}</div> : null}</div>}
    </section>
  );
}
