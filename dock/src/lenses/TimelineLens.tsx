import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KIND_COLOR, KIND_LABEL, NODE_KINDS, type EventKind, type JournalRecord, type SnapshotNode } from '../model/types';
import type { LensProps } from './types';
import { fmtTime, monthLabel, shortHash } from './ops/format';
import './ops/ops.css';

const EVENT_KINDS: EventKind[] = ['node_registered', 'relation_declared', 'observation_recorded', 'coordination_requested', 'coordination_resolved'];

interface EventView { subject: string; nodeId: string | null; detail: string }

/** What one journal record is about, and a one-line description of what it did. */
function describe(r: JournalRecord): EventView {
  const e = r.event;
  switch (e.kind) {
    case 'node_registered':
      return { subject: e.node?.nodeId ?? '—', nodeId: e.node?.nodeId ?? null, detail: e.node ? `${e.node.name} · ${KIND_LABEL[e.node.kind]} · ${e.node.capabilities.length} capabilit${e.node.capabilities.length === 1 ? 'y' : 'ies'}` : 'node registered' };
    case 'relation_declared':
      return { subject: e.relation?.relationId ?? '—', nodeId: null, detail: e.relation ? `${e.relation.sourceNodeId} ${e.relation.kind.replace(/_/g, ' ')} ${e.relation.targetNodeId} · ${e.relation.description}` : 'relation declared' };
    case 'observation_recorded':
      return { subject: e.observation?.nodeId ?? '—', nodeId: e.observation?.nodeId ?? null, detail: e.observation ? `${e.observation.health} · ${e.observation.source} · ${e.observation.detail}` : 'observation recorded' };
    case 'coordination_requested':
      return { subject: e.request?.coordinationId ?? '—', nodeId: null, detail: e.request ? `${e.request.requesterNodeId} → ${e.request.targetNodeId} · ${e.request.capabilityId} (${e.request.requestedMode}) · ${e.request.purpose}` : 'capability requested' };
    case 'coordination_resolved':
      return { subject: e.coordinationId ?? '—', nodeId: null, detail: e.decision ? `${e.decision}${e.decision === 'approved' ? ' · not dispatched' : ''}${e.note ? ` · ${e.note}` : ''}` : 'coordination resolved' };
    default:
      return { subject: '—', nodeId: null, detail: '' };
  }
}

interface Placed { node: SnapshotNode; t: number; x: number; lane: number }

const MONTH_MS = 30 * 24 * 3600 * 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const LABEL_OFFSET = 10;
const CHAR_PX = 6.3;
const RIGHT_PAD = 12;

/** Nodes placed on a month axis by metadata.last_pushed_at; labels packed into lanes (in pixels) so they never overlap. */
function placeNodes(nodes: SnapshotNode[], width: number): { placed: Placed[]; unplaced: SnapshotNode[]; start: number; end: number; months: Array<{ t: number; label: string }>; weeks: number[]; lanes: number } {
  const placed: Placed[] = [];
  const unplaced: SnapshotNode[] = [];
  for (const node of nodes) {
    const raw = node.metadata.last_pushed_at;
    const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
    if (Number.isFinite(t)) placed.push({ node, t, x: 0, lane: 0 }); else unplaced.push(node);
  }
  placed.sort((a, b) => a.t - b.t || a.node.name.localeCompare(b.node.name));
  if (!placed.length) return { placed, unplaced, start: 0, end: 0, months: [], weeks: [], lanes: 0 };

  const minT = placed[0]!.t;
  const maxT = placed[placed.length - 1]!.t;
  const s = new Date(minT); const e = new Date(maxT);
  let start = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1);
  let end = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1);
  if (end - start < 2 * MONTH_MS) { start = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1); end = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 2, 1); }
  const span = end - start;

  const months: Array<{ t: number; label: string }> = [];
  for (let d = new Date(start); d.getTime() < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push({ t: d.getTime(), label: monthLabel(d) });

  const weeks: number[] = [];
  for (let t = start + WEEK_MS; t < end; t += WEEK_MS) weeks.push(t);

  // Greedy lane packing: a node takes the first lane whose previous label has ended before this dot.
  const usable = Math.max(200, width - RIGHT_PAD);
  const laneEnd: number[] = [];
  for (const p of placed) {
    p.x = ((p.t - start) / span) * usable;
    const labelW = LABEL_OFFSET + p.node.name.length * CHAR_PX;
    let lane = laneEnd.findIndex((endX) => endX <= p.x - 8);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(0); }
    laneEnd[lane] = p.x + labelW;
    p.lane = lane;
  }
  return { placed, unplaced, start, end, months, weeks, lanes: laneEnd.length };
}

/**
 * Two clocks: the control plane's journal (what happened, hash-linked) and the repositories' own
 * maturity (when each node last moved, from its registered metadata).
 */
export function TimelineLens({ dock, snapshot, filtered, onSelect, selected }: LensProps) {
  const [kinds, setKinds] = useState<Set<EventKind>>(() => new Set(EVENT_KINDS));
  const toggleKind = (k: EventKind) => setKinds((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });

  const byId = useMemo(() => new Map(snapshot.nodes.map((n) => [n.nodeId, n])), [snapshot.nodes]);
  const events = useMemo(
    () => [...dock.events].sort((a, b) => Date.parse(b.event.recordedAt) - Date.parse(a.event.recordedAt)),
    [dock.events],
  );
  const shown = events.filter((r) => kinds.has(r.event.kind));
  const countOf = (k: EventKind) => events.filter((r) => r.event.kind === k).length;

  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const axis = useMemo(() => placeNodes(filtered.nodes, width), [filtered.nodes, width]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(320, el.clientWidth - 24));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const LANE_H = 34; const TOP = 18; const AXIS_PAD = 12;
  const axisY = TOP + axis.lanes * LANE_H + AXIS_PAD;
  const height = axisY + 30;

  return (
    <div className="lens scroll timeline">
      <section className="ops-section journal">
        <div className="ops-head">
          <div>
            <h2>Journal events</h2>
            <p className="lede">The control plane's append-only, hash-linked record. Newest first.</p>
          </div>
          <span className="meta">
            {dock.mode === 'live'
              ? <><span className="dot" style={{ color: 'var(--green)' }} />polling every 5 s{dock.lastSync ? ` · synced ${fmtTime(dock.lastSync)}` : ''}</>
              : <><span className="dot" style={{ color: 'var(--amber)' }} />sample snapshot: journal not available</>}
          </span>
        </div>
        <div className="ops-chips">
          {EVENT_KINDS.map((k) => (
            <button key={k} className={`chip k-${k} ${kinds.has(k) ? 'on' : ''}`} onClick={() => toggleKind(k)}>{k.replace(/_/g, ' ')}<span className="n">{countOf(k)}</span></button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="ops-empty">
            {dock.mode !== 'live'
              ? 'The bundled sample carries no journal. Connect to a live control plane to read its events.'
              : events.length === 0 ? 'The journal is empty so far.' : 'No events of the selected kinds.'}
          </div>
        ) : (
          <div>
            <div className="row head"><span>recorded</span><span>kind</span><span>subject</span><span>detail</span><span style={{ textAlign: 'right' }}>record hash</span></div>
            {shown.map((r) => {
              const v = describe(r);
              const node = v.nodeId ? byId.get(v.nodeId) : undefined;
              return (
                <div className="row" key={`${r.event.eventId}:${r.recordHash}`}>
                  <span className="time num">{fmtTime(r.event.recordedAt)}</span>
                  <span><span className={`pill ${r.event.kind}`}>{r.event.kind.replace(/_/g, ' ')}</span></span>
                  <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.nodeId ? <button className="ops-link mono" title={node ? node.name : v.nodeId} onClick={() => onSelect(v.nodeId)}>{v.subject}</button> : v.subject}
                  </span>
                  <span className="detail" title={v.detail}>{v.detail}</span>
                  <span className="hash" title={r.recordHash}>{shortHash(r.recordHash)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="ops-section">
        <div className="ops-head">
          <div>
            <h2>Maturity timeline</h2>
            <p className="lede">Each node by its repository's last push (<span className="mono">metadata.last_pushed_at</span>). Colour is node kind; click a node to inspect it.</p>
          </div>
          <span className="meta num">{axis.placed.length} placed · {axis.unplaced.length} without a push date</span>
        </div>
        <div className="maturity" ref={box}>
          {axis.placed.length === 0 ? (
            <div className="ops-empty" style={{ border: 0 }}>No node in view carries a last_pushed_at date.</div>
          ) : (
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
              <line className="axis" x1={0} x2={width} y1={axisY} y2={axisY} />
              {axis.weeks.map((t) => {
                const x = ((t - axis.start) / (axis.end - axis.start)) * (width - RIGHT_PAD);
                return <line key={t} className="week" x1={x} x2={x} y1={axisY - 4} y2={axisY + 4} />;
              })}
              {axis.months.map((m) => {
                const x = ((m.t - axis.start) / (axis.end - axis.start)) * (width - RIGHT_PAD);
                return (
                  <g className="tick" key={m.t}>
                    <line x1={x} x2={x} y1={TOP - 6} y2={axisY + 6} strokeDasharray="2 4" />
                    <text x={x + 4} y={axisY + 20}>{m.label}</text>
                  </g>
                );
              })}
              {axis.placed.map((p) => <line key={`stem-${p.node.nodeId}`} className="stem" x1={p.x} x2={p.x} y1={TOP + p.lane * LANE_H + LANE_H / 2} y2={axisY} />)}
              {axis.placed.map((p) => {
                const y = TOP + p.lane * LANE_H + LANE_H / 2;
                const isSel = selected === p.node.nodeId;
                return (
                  <g className={`dot ${isSel ? 'selected' : ''}`} key={p.node.nodeId} onClick={() => onSelect(p.node.nodeId)}>
                    <title>{`${p.node.name} · ${KIND_LABEL[p.node.kind]} · pushed ${fmtTime(p.node.metadata.last_pushed_at as string)}`}</title>
                    <circle cx={p.x} cy={y} r={isSel ? 7 : 5.5} fill={KIND_COLOR[p.node.kind]} />
                    <text x={p.x + LABEL_OFFSET} y={y + 4}>{p.node.name}</text>
                  </g>
                );
              })}
            </svg>
          )}
          <div className="legend">
            {NODE_KINDS.map((k) => <span key={k}><i style={{ background: KIND_COLOR[k] }} />{KIND_LABEL[k]}</span>)}
          </div>
        </div>
        {axis.unplaced.length > 0 && (
          <div className="unplaced">
            <span>No push date:</span>
            {axis.unplaced.map((n) => <button key={n.nodeId} className="chip" style={{ borderColor: KIND_COLOR[n.kind] }} title={n.nodeId} onClick={() => onSelect(n.nodeId)}>{n.name}</button>)}
          </div>
        )}
      </section>
    </div>
  );
}
