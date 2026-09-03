import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { KeplerGl } from '@kepler.gl/components';
import { addDataToMap, fitBounds, removeDataset, wrapTo } from '@kepler.gl/actions';
import { universeMapBundle } from '../model/kepler';

type MapConfig = Parameters<typeof addDataToMap>[0]['config'];
import type { LensProps } from './types';
import { MapOverlay } from './map/MapOverlay';
import { MAP_ID, SELECTED_DATASET_ID, locatedBounds, resolveClickedNodeId, selectionBundle, withAnalyzerTypes, withPresentation, type KeplerInstanceState, type PickedInfo } from './map/keplerBridge';

interface KeplerRoot { keplerGl?: Record<string, (KeplerInstanceState & { mapStyle?: { styleType: string; isLoading: Record<string, boolean>; mapStyles: Record<string, { style?: unknown }> } }) | undefined> }

const selectClicked = (s: KeplerRoot): PickedInfo | null => s.keplerGl?.[MAP_ID]?.visState?.clicked ?? null;
const selectBasemapLoaded = (s: KeplerRoot): boolean => { const ms = s.keplerGl?.[MAP_ID]?.mapStyle; return Boolean(ms && ms.mapStyles?.[ms.styleType]?.style); };
const BASEMAP_TIMEOUT_MS = 8000;
// Kepler's container re-registers (and wipes) the instance whenever this prop changes identity, so it must be a constant.
const INITIAL_UI_STATE = { readOnly: false, currentModal: null, activeSidePanel: null };

/**
 * Kepler.gl universe map. Located nodes are points (colour = kind, size = capabilities), relations between two
 * located nodes are arcs, and the selected node gets an amber ring. Unlocated nodes are listed in the overlay
 * instead of being invented on the map.
 */
export function MapLens({ dock, filtered, selected, selectedNode, onSelect }: LensProps) {
  const dispatch = useDispatch();
  const store = useStore<KeplerRoot>();
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ready = size.width > 0 && size.height > 0;

  // Kepler needs numeric width/height; follow the lens container.
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

  const bundle = useMemo(() => universeMapBundle(filtered), [filtered]);
  const bounds = useMemo(() => locatedBounds(filtered.nodes), [filtered]);
  const fit = useCallback(() => { if (bounds) dispatch(wrapTo(MAP_ID, fitBounds(bounds))); }, [bounds, dispatch]);

  // Datasets + layer config. keepExistingConfig:false resets the instance's visState first, so re-adding datasets
  // with the same ids replaces the layers instead of stacking duplicates (verified in the rendered page). The reset
  // also wipes mapState, so after the first load the config carries the operator's current viewport instead of the
  // bundle's default centre, and a filter change never yanks the map.
  const loads = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const first = loads.current === 0;
    loads.current += 1;
    const live = store.getState().keplerGl?.[MAP_ID]?.mapState;
    const mapState = first || !live
      ? bundle.config.config.mapState
      : { ...bundle.config.config.mapState, latitude: live.latitude, longitude: live.longitude, zoom: live.zoom, bearing: live.bearing, pitch: live.pitch };
    const config = withPresentation({ version: bundle.config.version, config: { ...bundle.config.config, mapState } }) as unknown as MapConfig;
    dispatch(wrapTo(MAP_ID, addDataToMap({ datasets: withAnalyzerTypes(bundle.datasets), options: { centerMap: false, readOnly: false, keepExistingConfig: false }, config })));
    if (first && bounds) dispatch(wrapTo(MAP_ID, fitBounds(bounds)));
  }, [bundle, ready, dispatch, store]); // eslint-disable-line react-hooks/exhaustive-deps -- bounds only matter on the first load

  // Selection ring: its own one-row dataset layered on top, re-added whenever the base data or the selection changes.
  const selectedLocated = selectedNode && selectedNode.location && filtered.nodes.some((n) => n.nodeId === selectedNode.nodeId) ? selectedNode : null;
  useEffect(() => {
    if (!ready) return;
    dispatch(wrapTo(MAP_ID, removeDataset(SELECTED_DATASET_ID)));
    if (!selectedLocated) return;
    const sel = selectionBundle(selectedLocated);
    if (sel) dispatch(wrapTo(MAP_ID, addDataToMap({ datasets: sel.datasets, options: { centerMap: false, readOnly: false, keepExistingConfig: true, autoCreateLayers: false }, config: sel.config as MapConfig })));
  }, [bundle, selectedLocated, ready, dispatch]);

  // Picking: Kepler stores the deck.gl PickingInfo in visState.clicked; map its row back to a node id.
  const clicked = useSelector(selectClicked);
  useEffect(() => {
    if (!clicked) return;
    const id = resolveClickedNodeId(store.getState().keplerGl?.[MAP_ID], clicked);
    if (id) onSelect(id);
  }, [clicked, store, onSelect]);

  // Basemap: Kepler fetches the CARTO style JSON; a failed fetch rejects outside the reducer (no isLoading flip),
  // so "unavailable" is a timeout, not an error state Kepler reports.
  const basemapLoaded = useSelector(selectBasemapLoaded);
  const [basemapTimedOut, setBasemapTimedOut] = useState(false);
  useEffect(() => {
    if (!ready || basemapLoaded) return;
    const id = window.setTimeout(() => setBasemapTimedOut(true), BASEMAP_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [ready, basemapLoaded]);
  const basemap = basemapLoaded ? 'ready' : basemapTimedOut ? 'unavailable' : 'loading';

  return (
    <div className="lens map-lens" ref={host} style={{ background: 'var(--bg)' }}>
      {ready && (
        <KeplerGl
          id={MAP_ID}
          width={size.width}
          height={size.height}
          mapboxApiAccessToken=""
          mapStylesReplaceDefault={false}
          appName="Notations Universe"
          version="dock"
          initialUiState={INITIAL_UI_STATE}
        />
      )}
      <MapOverlay
        located={bundle.located}
        unlocated={bundle.unlocated}
        arcs={bundle.arcs}
        mode={dock.mode}
        selected={selected}
        onSelect={onSelect}
        onFit={fit}
        basemap={basemap}
      />
    </div>
  );
}
