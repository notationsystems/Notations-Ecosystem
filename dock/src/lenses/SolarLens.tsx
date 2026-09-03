import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { KeplerGl } from '@kepler.gl/components';
import { addDataToMap, fitBounds, removeDataset, wrapTo } from '@kepler.gl/actions';
import type { ConsoleIntent } from '../App';
import { SOLAR_CLICK_FIELD, SOLAR_MAP_ID, SOLAR_SELECTED, solarBounds, solarBundle, solarSelection } from '../model/solar';
import type { LensProps } from './types';
import { resolveClickedNodeId, withAnalyzerTypes, type KeplerInstanceState, type PickedInfo } from './map/keplerBridge';
import { SolarOverlay } from './solar/SolarOverlay';

type MapConfig = Parameters<typeof addDataToMap>[0]['config'];
interface KeplerRoot { keplerGl?: Record<string, KeplerInstanceState | undefined> }
const selectClicked = (s: KeplerRoot): PickedInfo | null => s.keplerGl?.[SOLAR_MAP_ID]?.visState?.clicked ?? null;
// Kepler re-registers (and wipes) the instance when this prop changes identity; it must be a constant.
const INITIAL_UI_STATE = { readOnly: false, currentModal: null, activeSidePanel: null };
const clickField = (dataId: string) => SOLAR_CLICK_FIELD[dataId] ?? 'node_id';

/**
 * The estate as a solar system, rendered by Kepler.gl on a sky with no basemap.
 *
 * A second Kepler instance, with its own id, so it never fights the geographic map over
 * viewport or datasets. The geometry is in `model/solar.ts` and is pure; this lens only
 * feeds it to Kepler, maps clicks back to nodes, and hands the operator a palette whose
 * every verb is a governed command or a read.
 */
export function SolarLens({ dock, snapshot, filtered, selected, selectedNode, onSelect, onIntent }: LensProps & { onIntent: (intent: ConsoleIntent) => void }) {
  const dispatch = useDispatch();
  const store = useStore<KeplerRoot>();
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ready = size.width > 0 && size.height > 0;

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const width = Math.round(r.width), height = Math.round(r.height);
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bundle = useMemo(() => solarBundle(filtered), [filtered]);
  const bounds = useMemo(() => solarBounds(bundle.layout), [bundle]);
  const fit = useCallback(() => dispatch(wrapTo(SOLAR_MAP_ID, fitBounds(bounds))), [bounds, dispatch]);
  const focus = useCallback((nodeId: string) => {
    const body = bundle.layout.bodies.find((b) => b.node.nodeId === nodeId);
    if (!body) return;
    const pad = body.isSun ? 2.4 : 1.6;
    dispatch(wrapTo(SOLAR_MAP_ID, fitBounds([body.lon - pad * 1.3, body.lat - pad, body.lon + pad * 1.3, body.lat + pad])));
    onSelect(nodeId);
  }, [bundle, dispatch, onSelect]);

  // Same load discipline as the map: keepExistingConfig:false replaces the layers rather
  // than stacking them, and after the first load the operator's viewport is kept.
  const loads = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const first = loads.current === 0;
    loads.current += 1;
    const live = store.getState().keplerGl?.[SOLAR_MAP_ID]?.mapState;
    const mapState = first || !live
      ? bundle.config.config.mapState
      : { ...bundle.config.config.mapState, latitude: live.latitude, longitude: live.longitude, zoom: live.zoom, bearing: live.bearing, pitch: live.pitch };
    const config = { version: bundle.config.version, config: { ...bundle.config.config, mapState } } as unknown as MapConfig;
    dispatch(wrapTo(SOLAR_MAP_ID, addDataToMap({ datasets: withAnalyzerTypes(bundle.datasets), options: { centerMap: false, readOnly: false, keepExistingConfig: false }, config })));
    if (first) dispatch(wrapTo(SOLAR_MAP_ID, fitBounds(bounds)));
  }, [bundle, ready, dispatch, store]); // eslint-disable-line react-hooks/exhaustive-deps -- bounds only matter on the first load

  const selectedInView = selectedNode && filtered.nodes.some((n) => n.nodeId === selectedNode.nodeId) ? selectedNode : null;
  useEffect(() => {
    if (!ready) return;
    dispatch(wrapTo(SOLAR_MAP_ID, removeDataset(SOLAR_SELECTED)));
    if (!selectedInView) return;
    const sel = solarSelection(bundle.layout, selectedInView.nodeId);
    if (sel) dispatch(wrapTo(SOLAR_MAP_ID, addDataToMap({ datasets: withAnalyzerTypes(sel.datasets), options: { centerMap: false, readOnly: false, keepExistingConfig: true, autoCreateLayers: false }, config: sel.config as MapConfig })));
  }, [bundle, selectedInView, ready, dispatch]);

  const clicked = useSelector(selectClicked);
  useEffect(() => {
    if (!clicked) return;
    const id = resolveClickedNodeId(store.getState().keplerGl?.[SOLAR_MAP_ID], clicked, clickField);
    if (id) onSelect(id);
  }, [clicked, store, onSelect]);

  return (
    <div className="lens map-lens" ref={host} style={{ background: 'radial-gradient(ellipse at center, #0b1020 0%, #05070d 70%)' }}>
      {ready && (
        <KeplerGl
          id={SOLAR_MAP_ID}
          width={size.width}
          height={size.height}
          mapboxApiAccessToken=""
          mapStylesReplaceDefault={false}
          appName="Notations Universe"
          version="dock"
          initialUiState={INITIAL_UI_STATE}
        />
      )}
      <SolarOverlay
        dock={dock}
        snapshot={snapshot}
        layout={bundle.layout}
        arcs={bundle.arcs}
        selected={selected}
        selectedNode={selectedInView}
        onSelect={onSelect}
        onFit={fit}
        onFocus={focus}
        onIntent={onIntent}
      />
    </div>
  );
}
