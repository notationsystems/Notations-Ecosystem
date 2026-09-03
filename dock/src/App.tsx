import { useMemo, useState } from 'react';
import { useControlPlane } from './api/useControlPlane';
import { ConnectionPanel } from './components/ConnectionPanel';
import { Inspector } from './components/Inspector';
import { ApiLens } from './lenses/ApiLens';
import { ConsoleLens } from './lenses/ConsoleLens';
import { CorpusLens } from './lenses/CorpusLens';
import { GraphLens } from './lenses/GraphLens';
import { LedgerLens } from './lenses/LedgerLens';
import { MapLens } from './lenses/MapLens';
import { OperatorLens } from './lenses/OperatorLens';
import { SecurityLens } from './lenses/SecurityLens';
import { TimelineLens } from './lenses/TimelineLens';
import { applyFilters, type Filters } from './lenses/types';
import { domainSummary, snapshotStats } from './model/graph';
import { KIND_COLOR, KIND_LABEL, NODE_KINDS, RELATION_COLOR, RELATION_KINDS, RELATION_LABEL, type NodeKind, type RelationKind } from './model/types';

type LensId = 'operator' | 'security' | 'corpus' | 'api' | 'map' | 'graph' | 'ledger' | 'timeline' | 'console';
const LENSES: Array<{ id: LensId; label: string }> = [
  { id: 'operator', label: 'Operator' }, { id: 'security', label: 'Security' }, { id: 'corpus', label: 'Corpus' }, { id: 'api', label: 'Api' }, { id: 'map', label: 'Map' }, { id: 'graph', label: 'Graph' }, { id: 'ledger', label: 'Ledger' }, { id: 'timeline', label: 'Timeline' }, { id: 'console', label: 'Console' },
];

export interface ConsoleIntent { action: 'request_capability' | 'record_observation' | 'resolve_coordination'; nodeId?: string; capabilityId?: string; coordinationId?: string }

export function App() {
  const dock = useControlPlane();
  const [lens, setLens] = useState<LensId>('operator');
  const [selected, setSelected] = useState<string | null>(null);
  const [intent, setIntent] = useState<ConsoleIntent | null>(null);
  const [filters, setFilters] = useState<Filters>({ kinds: new Set(NODE_KINDS), relationKinds: new Set(RELATION_KINDS), domains: new Set(), locatedOnly: false, search: '' });
  const snapshot = dock.snapshot;
  const filtered = useMemo(() => (snapshot ? applyFilters(snapshot, filters) : null), [snapshot, filters]);
  const stats = useMemo(() => (snapshot ? snapshotStats(snapshot) : null), [snapshot]);
  const domains = useMemo(() => (snapshot ? domainSummary(snapshot) : []), [snapshot]);
  const selectedNode = snapshot?.nodes.find((n) => n.nodeId === selected) ?? null;

  const toggle = <T,>(set: Set<T>, v: T) => { const next = new Set(set); if (next.has(v)) next.delete(v); else next.add(v); return next; };
  const kindCount = (k: NodeKind) => snapshot?.nodes.filter((n) => n.kind === k).length ?? 0;
  const relCount = (k: RelationKind) => snapshot?.relations.filter((r) => r.kind === k).length ?? 0;

  const goConsole = (i: ConsoleIntent) => { setIntent(i); setLens('console'); };

  return (
    <div className="dock">
      <header className="topbar">
        <div className="brand"><span className="hex" />Notations Universe Dock</div>
        <nav className="tabs">{LENSES.map((l) => <button key={l.id} className={`tab ${lens === l.id ? 'active' : ''}`} onClick={() => setLens(l.id)}>{l.label}</button>)}</nav>
        <input className="mono" style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '5px 9px', width: 260 }} placeholder="search nodes and capabilities" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        {stats && <div className="stats"><span>nodes <b>{stats.nodes}</b></span><span>located <b>{stats.located}</b></span><span>relations <b>{stats.relations}</b></span><span>capabilities <b>{stats.capabilities}</b></span><span>execute <b>{stats.execute}</b></span><span>pending <b>{stats.pendingApprovals}</b></span></div>}
        <span className={`mode ${dock.mode}`}><span className="dot" />{dock.mode}</span>
      </header>

      <aside className="rail">
        <ConnectionPanel dock={dock} />
        <section>
          <h3>Node kinds</h3>
          <div className="legend">{NODE_KINDS.map((k) => <div key={k} className={`row ${filters.kinds.has(k) ? 'active' : ''}`} onClick={() => setFilters({ ...filters, kinds: toggle(filters.kinds, k) })}><span className="swatch" style={{ background: KIND_COLOR[k] }} />{KIND_LABEL[k]}<span className="count">{kindCount(k)}</span></div>)}</div>
        </section>
        <section>
          <h3>Relations</h3>
          <div className="legend">{RELATION_KINDS.map((k) => <div key={k} className={`row ${filters.relationKinds.has(k) ? 'active' : ''}`} onClick={() => setFilters({ ...filters, relationKinds: toggle(filters.relationKinds, k) })}><span className="swatch" style={{ background: RELATION_COLOR[k], borderRadius: 2, height: 3 }} />{RELATION_LABEL[k]}<span className="count">{relCount(k)}</span></div>)}</div>
        </section>
        <section>
          <h3>Domains</h3>
          <div className="checks">{domains.map((d) => <button key={d.domain} className={`chip ${filters.domains.size === 0 || filters.domains.has(d.domain) ? 'on' : ''}`} onClick={() => setFilters({ ...filters, domains: toggle(filters.domains, d.domain) })}>{d.domain} · {d.nodes}</button>)}</div>
          <div style={{ marginTop: 8 }}><button className={`chip ${filters.locatedOnly ? 'on' : ''}`} onClick={() => setFilters({ ...filters, locatedOnly: !filters.locatedOnly })}>located only</button></div>
        </section>
      </aside>

      <main className="main">
        {!snapshot || !filtered ? (
          <div className="placeholder">{dock.error ? <div className="error">{dock.error.message}</div> : 'Connecting…'}</div>
        ) : (() => {
          const props = { dock, snapshot, filtered, filters, selected, onSelect: setSelected, selectedNode };
          switch (lens) {
            case 'operator': return <OperatorLens {...props} onResolve={(coordinationId) => goConsole({ action: 'resolve_coordination', coordinationId })} onObserve={(nodeId) => goConsole({ action: 'record_observation', nodeId })} />;
            case 'security': return <SecurityLens {...props} />;
            case 'corpus': return <CorpusLens {...props} />;
            case 'api': return <ApiLens {...props} />;
            case 'map': return <MapLens {...props} />;
            case 'graph': return <GraphLens {...props} />;
            case 'ledger': return <LedgerLens {...props} onResolve={(coordinationId) => goConsole({ action: 'resolve_coordination', coordinationId })} />;
            case 'timeline': return <TimelineLens {...props} />;
            case 'console': return <ConsoleLens {...props} intent={intent} onIntentConsumed={() => setIntent(null)} />;
          }
        })()}
      </main>

      <Inspector
        snapshot={snapshot ?? { schema: 'notations.control-plane.snapshot.v1', revision: null, eventCursor: null, durability: 'local_jsonl_single_writer', generatedAt: '', nodes: [], relations: [], coordination: [] }}
        node={selectedNode}
        onSelect={setSelected}
        onRequest={(node, capabilityId) => goConsole({ action: 'request_capability', nodeId: node.nodeId, capabilityId })}
        onObserve={(node) => goConsole({ action: 'record_observation', nodeId: node.nodeId })}
      />
    </div>
  );
}
