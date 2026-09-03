import { NODES_DATASET_ID, RELATIONS_DATASET_ID, type KeplerDataset, type KeplerFieldType } from '../../model/kepler';
import { KIND_COLOR, NODE_KINDS, RELATION_COLOR, RELATION_KINDS, type SnapshotNode } from '../../model/types';

/** Kepler instance id: every action for the universe map is wrapped with `wrapTo(MAP_ID, …)`. */
export const MAP_ID = 'universe';
export const SELECTED_DATASET_ID = 'universe-selected';
export const SELECTED_LAYER_ID = 'universe-selected-ring';

/** The slice of a Kepler instance state the lens reads (kept loose: Kepler's own types are not exported for this). */
export interface KeplerInstanceState {
  visState: {
    clicked: PickedInfo | null;
    layers: Array<{ id: string; config: { dataId: string } }>;
    datasets: Record<string, { fields: Array<{ name: string }>; dataContainer: { valueAt: (row: number, col: number) => unknown; numRows: () => number } }>;
  };
  mapState: { latitude: number; longitude: number; zoom: number; bearing: number; pitch: number; width: number; height: number };
}

/**
 * Shape of `visState.clicked` (a deck.gl PickingInfo, stored by Kepler's layerClickUpdater when `picked` is true).
 * `layer` is the deck.gl layer whose `props.id` is the Kepler layer id (sub-layers add a suffix, e.g. `-label-name`)
 * and whose `props.idx` is the Kepler layer index; `object` is Kepler's per-row datum `{ index, position }` for
 * points and `{ index, sourcePosition, targetPosition }` for arcs, where `index` is the row in the dataset.
 */
export interface PickedInfo {
  picked?: boolean;
  index?: number;
  object?: { index?: number } | null;
  layer?: { id?: string; props?: { id?: string; idx?: number } } | null;
}

/**
 * Map a Kepler click back to a node id.
 *
 * `fieldFor` names, per dataset id, the column that carries the node to select; the
 * default is the universe map's (arcs resolve to their source, everything else to
 * `node_id`). The solar system passes its own, where a moon selects the body it orbits.
 */
export function resolveClickedNodeId(
  instance: KeplerInstanceState | undefined,
  clicked: PickedInfo | null,
  fieldFor: (dataId: string) => string = (dataId) => (dataId === RELATIONS_DATASET_ID ? 'source' : 'node_id'),
): string | null {
  if (!instance || !clicked || clicked.picked === false) return null;
  const deckId = clicked.layer?.props?.id ?? clicked.layer?.id;
  const layers = instance.visState.layers;
  let layer = typeof deckId === 'string' ? layers.find((l) => l.id === deckId) ?? layers.find((l) => deckId.startsWith(`${l.id}-`)) : undefined;
  const idx = clicked.layer?.props?.idx;
  if (!layer && typeof idx === 'number') layer = layers[idx];
  if (!layer) return null;
  const dataset = instance.visState.datasets[layer.config.dataId];
  if (!dataset) return null;
  const row = clicked.object?.index ?? clicked.index;
  if (typeof row !== 'number' || row < 0 || row >= dataset.dataContainer.numRows()) return null;
  const fieldName = fieldFor(layer.config.dataId);
  const col = dataset.fields.findIndex((f) => f.name === fieldName);
  if (col < 0) return null;
  const value = dataset.dataContainer.valueAt(row, col);
  return typeof value === 'string' && value ? value : null;
}

/** type-analyzer names Kepler expects on `field.analyzerType`. */
const ANALYZER_TYPE: Record<KeplerFieldType, string> = { string: 'STRING', real: 'FLOAT', integer: 'INT', boolean: 'BOOLEAN', timestamp: 'DATETIME' };

/**
 * Kepler's input validator (`@kepler.gl/utils` validateInputData) calls Node's `assert` for a field without an
 * `analyzerType`; in a browser bundle `assert` is not a function and addDataToMap throws. Declaring the analyzer
 * type up front keeps the datasets on the validated path, so this runs on every dataset before it is dispatched.
 */
export function withAnalyzerTypes(datasets: KeplerDataset[]): KeplerDataset[] {
  return datasets.map((d) => ({
    ...d,
    data: { ...d.data, fields: d.data.fields.map((f) => ({ ...f, analyzerType: ANALYZER_TYPE[f.type] ?? 'STRING' })) },
  }));
}

/** Explicit value → colour map so a kind keeps its colour whichever kinds survive the filters. */
const KIND_COLOR_MAP = NODE_KINDS.map((k) => [k, KIND_COLOR[k]] as [string, string]);
const RELATION_COLOR_MAP = RELATION_KINDS.map((k) => [k, RELATION_COLOR[k]] as [string, string]);

type LayerConfig = { id: string; type: string; config: { visConfig: Record<string, unknown>; textLabel?: Array<Record<string, unknown>> }; visualChannels: Record<string, unknown> };

/**
 * Presentation overrides on the model's Kepler config, applied at dispatch time and written so they are no-ops once
 * the model adopts the same values:
 * - Kepler scales a point's `radius` by 2^(14 - zoom) metres, i.e. ~0.1·radius screen pixels below zoom 14, so the
 *   model's 10-34 renders as a 1-3 px dot; the floor here keeps nodes legible at continental zoom.
 * - A text label is positioned by anchor/alignment (offset is recomputed from the radius), so `middle`/`center`
 *   centres the text on the point; `bottom` puts it under the point.
 * - An ordinal colour scale assigns palette colours by sorted domain order, so the kind → colour mapping drifts as
 *   filters remove kinds; a `customOrdinal` scale with a colorMap pins each kind to KIND_COLOR (the only non-ordinal colour scale a string field accepts).
 */
export function withPresentation<T extends { config: { visState: { layers: unknown[] } } }>(config: T): T {
  const layers = (config.config.visState.layers as LayerConfig[]).map((layer) => {
    if (layer.type === 'point') {
      const vc = layer.config.visConfig;
      const range = Array.isArray(vc.radiusRange) ? (vc.radiusRange as number[]) : [10, 34];
      const visConfig = {
        ...vc,
        radius: Math.max(Number(vc.radius) || 0, 50),
        radiusRange: [Math.max(range[0] ?? 10, 50), Math.max(range[1] ?? 34, 110)],
        ...(layer.visualChannels.colorField ? { colorRange: { ...(vc.colorRange as object), colorMap: KIND_COLOR_MAP } } : {}),
      };
      const textLabel = layer.config.textLabel?.map((t) => ({ ...t, anchor: 'middle', alignment: 'bottom' }));
      const visualChannels = layer.visualChannels.colorField ? { ...layer.visualChannels, colorScale: 'customOrdinal' } : layer.visualChannels;
      return { ...layer, config: { ...layer.config, visConfig, ...(textLabel ? { textLabel } : {}) }, visualChannels };
    }
    if (layer.type === 'arc' && layer.visualChannels.colorField) {
      const vc = layer.config.visConfig;
      return { ...layer, config: { ...layer.config, visConfig: { ...vc, colorRange: { ...(vc.colorRange as object), colorMap: RELATION_COLOR_MAP } } }, visualChannels: { ...layer.visualChannels, colorScale: 'customOrdinal' } };
    }
    return layer;
  });
  return { ...config, config: { ...config.config, visState: { ...config.config.visState, layers } } };
}

export type Bounds = [minLng: number, minLat: number, maxLng: number, maxLat: number];

/** Bounding box of the located nodes, padded so a single point or a tight cluster still yields a sane zoom. */
export function locatedBounds(nodes: SnapshotNode[]): Bounds | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const n of nodes) {
    if (!n.location) continue;
    minLng = Math.min(minLng, n.location.longitude); maxLng = Math.max(maxLng, n.location.longitude);
    minLat = Math.min(minLat, n.location.latitude); maxLat = Math.max(maxLat, n.location.latitude);
  }
  if (!Number.isFinite(minLng)) return null;
  const padLng = Math.max(3, (maxLng - minLng) * 0.25);
  const padLat = Math.max(3, (maxLat - minLat) * 0.25);
  return [Math.max(-180, minLng - padLng), Math.max(-85, minLat - padLat), Math.min(180, maxLng + padLng), Math.min(85, maxLat + padLat)];
}

/** One-row dataset plus an unfilled ring layer that marks the selected node on top of the point layer. */
export function selectionBundle(node: SnapshotNode): { datasets: KeplerDataset[]; config: unknown } | null {
  if (!node.location) return null;
  const dataset: KeplerDataset = {
    info: { id: SELECTED_DATASET_ID, label: 'Selected node' },
    data: {
      fields: [{ name: 'node_id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'latitude', type: 'real' }, { name: 'longitude', type: 'real' }],
      rows: [[node.nodeId, node.name, node.location.latitude, node.location.longitude]],
    },
  };
  const config = {
    version: 'v1',
    config: {
      visState: {
        layers: [{
          id: SELECTED_LAYER_ID, type: 'point',
          config: {
            dataId: SELECTED_DATASET_ID, label: 'Selected', color: [245, 185, 66],
            columns: { lat: 'latitude', lng: 'longitude', altitude: null },
            isVisible: true,
            visConfig: { radius: 150, fixedRadius: false, opacity: 1, outline: true, filled: false, thickness: 3, strokeColor: [245, 185, 66] },
          },
          visualChannels: { colorField: null, colorScale: 'quantile', sizeField: null, sizeScale: 'linear', strokeColorField: null, strokeColorScale: 'quantile' },
        }],
        interactionConfig: { tooltip: { enabled: true, compareMode: false, compareType: 'absolute', fieldsToShow: { [SELECTED_DATASET_ID]: [{ name: 'name', format: null }] } } },
      },
    },
  };
  return { datasets: withAnalyzerTypes([dataset]), config };
}

export { NODES_DATASET_ID, RELATIONS_DATASET_ID };
