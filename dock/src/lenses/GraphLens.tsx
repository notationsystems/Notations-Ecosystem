import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { neighbourhood, toGraphData, type GraphLinkDatum, type GraphNodeDatum } from '../model/graph';
import { CHARGE_STRENGTH, LINK_DISTANCE, collideForce } from './graph/forces';
import { endpointId, linkColor, linkTooltip, nodeTooltip, paintNode, paintPointerArea } from './graph/render';
import type { LensProps } from './types';

type FGNode = NodeObject<GraphNodeDatum>;
type FGLink = LinkObject<GraphNodeDatum, GraphLinkDatum>;
type FGMethods = ForceGraphMethods<FGNode, FGLink>;

const DBLCLICK_MS = 350;

/** Force-directed capability graph: size = capabilities, ring = health, colour = kind, links coloured by relation kind. */
export function GraphLens({ filtered, selected, onSelect }: LensProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FGMethods>();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [focus, setFocus] = useState<string | null>(null);
  const fitPending = useRef(true);
  const lastClick = useRef<{ id: string; at: number } | null>(null);

  // Measure the container; the graph canvas must match it exactly.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ width: Math.floor(el.clientWidth), height: Math.floor(el.clientHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(() => toGraphData(filtered), [filtered]);
  useEffect(() => { fitPending.current = true; }, [graphData]);

  // Tune the physics once the graph is mounted: calmer charge, longer links and a collision force so discs never overlap.
  const mounted = size.width > 0 && size.height > 0;
  useEffect(() => {
    const fg = fgRef.current;
    if (!mounted || !fg) return;
    (fg.d3Force('charge') as { strength?: (s: number) => unknown } | undefined)?.strength?.(CHARGE_STRENGTH);
    (fg.d3Force('link') as { distance?: (d: number) => unknown } | undefined)?.distance?.(LINK_DISTANCE);
    fg.d3Force('collide', collideForce());
    fg.d3ReheatSimulation();
  }, [mounted, graphData]);

  // Drop focus when the focused node leaves the filtered snapshot.
  useEffect(() => {
    if (focus && !filtered.nodes.some((n) => n.nodeId === focus)) setFocus(null);
  }, [focus, filtered]);

  const hood = useMemo(() => (focus ? neighbourhood(filtered, focus) : null), [focus, filtered]);
  const focusNode = focus ? filtered.nodes.find((n) => n.nodeId === focus) ?? null : null;

  const fit = useCallback(() => { fgRef.current?.zoomToFit(400, 40); }, []);

  // Re-fit when the container is resized (e.g. the inspector opening) so no node is pushed off-canvas.
  const sizeSeen = useRef(false);
  useEffect(() => {
    if (!mounted) return;
    if (!sizeSeen.current) { sizeSeen.current = true; return; }
    const raf = requestAnimationFrame(() => { if (!fitPending.current) fit(); });
    return () => cancelAnimationFrame(raf);
  }, [size, mounted, fit]);
  const onEngineStop = useCallback(() => {
    if (!fitPending.current) return;
    fitPending.current = false;
    fit();
  }, [fit]);

  const paint = useCallback((node: FGNode, ctx: CanvasRenderingContext2D, scale: number) => {
    paintNode(node, ctx, scale, { selected: node.id === selected, inFocus: !hood || hood.has(String(node.id)) });
  }, [selected, hood]);

  const linkInFocus = useCallback((l: FGLink) => !hood || (hood.has(endpointId(l.source)) && hood.has(endpointId(l.target))), [hood]);
  const colorLink = useCallback((l: FGLink) => linkColor(l, linkInFocus(l)), [linkInFocus]);

  const onNodeClick = useCallback((node: FGNode) => {
    const id = String(node.id);
    const now = performance.now();
    const prev = lastClick.current;
    lastClick.current = { id, at: now };
    if (prev && prev.id === id && now - prev.at < DBLCLICK_MS) {
      lastClick.current = null;
      setFocus((f) => (f === id ? null : id));
    }
    onSelect(id);
  }, [onSelect]);

  const onBackgroundClick = useCallback(() => { lastClick.current = null; onSelect(null); }, [onSelect]);

  return (
    <div className="lens" ref={containerRef} style={{ overflow: 'hidden' }}>
      <div className="overlay" style={{ top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
        <div style={{ display: 'flex', gap: 14, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: 'var(--muted)' }}>nodes <b style={{ color: 'var(--text)' }}>{filtered.nodes.length}</b></span>
          <span style={{ color: 'var(--muted)' }}>relations <b style={{ color: 'var(--text)' }}>{filtered.relations.length}</b></span>
          <button className="btn small" style={{ marginLeft: 'auto' }} onClick={fit} title="Zoom to fit the whole graph">Fit</button>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '0.02em' }}>size = capabilities · ring = health · colour = kind</div>
        <div style={{ color: 'var(--muted)', fontSize: 11 }}>click selects · double-click focuses a neighbourhood</div>
        {focusNode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="chip on" style={{ color: 'var(--amber)', borderColor: 'rgba(245, 185, 66, 0.5)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Focus: {focusNode.name}
              <button className="btn small" style={{ padding: '0 5px', lineHeight: 1.2 }} onClick={() => setFocus(null)} title="Clear focus" aria-label="Clear focus">×</button>
            </span>
          </div>
        )}
      </div>
      {mounted && (
        <ForceGraph2D<GraphNodeDatum, GraphLinkDatum>
          ref={fgRef}
          width={size.width}
          height={size.height}
          backgroundColor="#07090f"
          graphData={graphData}
          nodeId="id"
          nodeLabel={(n) => nodeTooltip(n)}
          nodeCanvasObject={paint}
          nodeCanvasObjectMode={() => 'replace'}
          nodePointerAreaPaint={(n, color, ctx, scale) => paintPointerArea(n, color, ctx, scale)}
          linkLabel={(l) => linkTooltip(l)}
          linkColor={colorLink}
          linkWidth={1.2}
          linkCurvature={0.15}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={colorLink}
          linkHoverPrecision={5}
          d3VelocityDecay={0.35}
          cooldownTicks={120}
          onEngineStop={onEngineStop}
          onNodeClick={onNodeClick}
          onBackgroundClick={onBackgroundClick}
          enableNodeDrag={true}
        />
      )}
    </div>
  );
}
