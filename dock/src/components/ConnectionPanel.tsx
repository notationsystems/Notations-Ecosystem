import { useState } from 'react';
import type { DockState } from '../api/useControlPlane';
import { checkBaseUrl } from '../api/controlPlane';

export function ConnectionPanel({ dock }: { dock: DockState }) {
  const [draft, setDraft] = useState(dock.connection);
  const dirty = draft.baseUrl !== dock.connection.baseUrl || draft.token !== dock.connection.token || draft.actorId !== dock.connection.actorId;
  const baseUrl = checkBaseUrl(draft.baseUrl);
  return (
    <section>
      <h3>Control plane</h3>
      <div className="field"><label>Base URL</label><input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="/cp or http://127.0.0.1:8787" /></div>
      <div className="field"><label>Bearer token (held in memory only)</label><input type="password" value={draft.token} onChange={(e) => setDraft({ ...draft, token: e.target.value })} placeholder="NOTATIONS_CONTROL_PLANE_TOKEN" autoComplete="off" /></div>
      <div className="field"><label>Actor id</label><input value={draft.actorId} onChange={(e) => setDraft({ ...draft, actorId: e.target.value })} /></div>
      {!baseUrl.ok && <div className="error" style={{ marginBottom: 8 }}>{baseUrl.reason}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn primary" onClick={() => dock.setConnection(draft)} disabled={!dirty || !baseUrl.ok}>Connect</button>
        <button className="btn" onClick={() => { void dock.refresh(); }}>Refresh</button>
        {dock.connection.token && <button className="btn danger" onClick={() => { setDraft({ ...draft, token: '' }); dock.setConnection({ ...dock.connection, token: '' }); }}>Forget token</button>}
      </div>
      <div style={{ color: 'var(--muted)', marginTop: 6, fontSize: 11 }}>
        The credential is kept in memory for this page only. It is never written to browser storage, so a reload asks
        for it again.
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
