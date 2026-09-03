import type { Snapshot, SnapshotNode } from './types';
import { domainOf } from './graph';

export type KeplerFieldType = 'string' | 'real' | 'integer' | 'boolean' | 'timestamp';

export interface KeplerDataset {
  info: { id: string; label: string };
  data: { fields: Array<{ name: string; type: KeplerFieldType }>; rows: unknown[][] };
}

export const NODES_DATASET_ID = 'universe-nodes';
export const RELATIONS_DATASET_ID = 'universe-relations';

/** Located nodes as a Kepler point dataset. Unlocated nodes are reported separately so the map never invents a position. */
export function nodesDataset(snapshot: Snapshot): { dataset: KeplerDataset; unlocated: SnapshotNode[] } {
  const fields: KeplerDataset['data']['fields'] = [
    { name: 'node_id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'kind', type: 'string' },
    { name: 'domain', type: 'string' }, { name: 'maturity', type: 'string' }, { name: 'health', type: 'string' },
    { name: 'capabilities', type: 'integer' }, { name: 'execute_capabilities', type: 'integer' },
    { name: 'last_observed_at', type: 'timestamp' }, { name: 'label', type: 'string' },
    { name: 'latitude', type: 'real' }, { name: 'longitude', type: 'real' },
  ];
  const rows: unknown[][] = [];
  const unlocated: SnapshotNode[] = [];
  for (const n of snapshot.nodes) {
    if (!n.location) { unlocated.push(n); continue; }
    rows.push([
      n.nodeId, n.name, n.kind, domainOf(n), String(n.metadata.maturity ?? ''), n.health,
      n.capabilities.length, n.capabilities.filter((c) => c.mode === 'execute').length,
      n.lastObservedAt, String(n.metadata.location_label ?? n.name),
      n.location.latitude, n.location.longitude,
    ]);
  }
  return { dataset: { info: { id: NODES_DATASET_ID, label: 'Universe nodes' }, data: { fields, rows } }, unlocated };
}

/** Relations whose both ends are located, as a Kepler arc dataset. */
export function relationsDataset(snapshot: Snapshot): KeplerDataset {
  const byId = new Map(snapshot.nodes.map((n) => [n.nodeId, n]));
  const fields: KeplerDataset['data']['fields'] = [
    { name: 'relation_id', type: 'string' }, { name: 'kind', type: 'string' }, { name: 'source', type: 'string' }, { name: 'target', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'source_lat', type: 'real' }, { name: 'source_lng', type: 'real' }, { name: 'target_lat', type: 'real' }, { name: 'target_lng', type: 'real' },
  ];
  const rows: unknown[][] = [];
  for (const r of snapshot.relations) {
    const s = byId.get(r.sourceNodeId)?.location;
    const t = byId.get(r.targetNodeId)?.location;
    if (!s || !t) continue;
    rows.push([r.relationId, r.kind, r.sourceNodeId, r.targetNodeId, r.description, s.latitude, s.longitude, t.latitude, t.longitude]);
  }
  return { info: { id: RELATIONS_DATASET_ID, label: 'Universe relations' }, data: { fields, rows } };
}

const KIND_RANGE = { name: 'Universe kinds', type: 'qualitative', category: 'Custom', colors: ['#F5B942', '#39C6D8', '#8B7CF6', '#E86A7A', '#5AC77A', '#4FA3F7'] };
const RELATION_RANGE = { name: 'Universe relations', type: 'qualitative', category: 'Custom', colors: ['#39C6D8', '#F5B942', '#5AC77A', '#E86A7A', '#9AA5B1'] };

/** Kepler.gl v1 map config: a point layer for nodes and an arc layer for relations, on the token-free dark basemap. */
export function universeMapConfig(center: { latitude: number; longitude: number; zoom: number } = { latitude: 18, longitude: 40, zoom: 1.6 }) {
  return {
    version: 'v1',
    config: {
      visState: {
        layers: [
          {
            id: 'universe-nodes-points', type: 'point',
            config: {
              dataId: NODES_DATASET_ID, label: 'Nodes', color: [245, 185, 66],
              columns: { lat: 'latitude', lng: 'longitude', altitude: null },
              isVisible: true,
              visConfig: { radius: 14, fixedRadius: false, opacity: 0.92, outline: true, thickness: 2, strokeColor: [8, 12, 20], radiusRange: [10, 34], colorRange: KIND_RANGE },
              textLabel: [{ field: { name: 'name', type: 'string' }, color: [235, 238, 243], size: 13, offset: [0, 22], anchor: 'middle', alignment: 'center' }],
            },
            visualChannels: { colorField: { name: 'kind', type: 'string' }, colorScale: 'ordinal', sizeField: { name: 'capabilities', type: 'integer' }, sizeScale: 'sqrt', strokeColorField: null, strokeColorScale: 'quantile' },
          },
          {
            id: 'universe-relations-arcs', type: 'arc',
            config: {
              dataId: RELATIONS_DATASET_ID, label: 'Relations', color: [57, 198, 216],
              columns: { lat0: 'source_lat', lng0: 'source_lng', lat1: 'target_lat', lng1: 'target_lng' },
              isVisible: true,
              visConfig: { opacity: 0.75, thickness: 2.5, colorRange: RELATION_RANGE, sizeRange: [0, 10], targetColor: [245, 185, 66] },
            },
            visualChannels: { colorField: { name: 'kind', type: 'string' }, colorScale: 'ordinal', sizeField: null, sizeScale: 'linear' },
          },
        ],
        interactionConfig: {
          tooltip: {
            enabled: true,
            compareMode: false,
            compareType: 'absolute',
            fieldsToShow: {
              [NODES_DATASET_ID]: [{ name: 'name', format: null }, { name: 'kind', format: null }, { name: 'domain', format: null }, { name: 'health', format: null }, { name: 'capabilities', format: null }, { name: 'execute_capabilities', format: null }],
              [RELATIONS_DATASET_ID]: [{ name: 'source', format: null }, { name: 'kind', format: null }, { name: 'target', format: null }, { name: 'description', format: null }],
            },
          },
          brush: { enabled: false, size: 0.5 },
          geocoder: { enabled: false },
          coordinate: { enabled: false },
        },
        layerBlending: 'normal',
      },
      mapState: { bearing: 0, dragRotate: false, latitude: center.latitude, longitude: center.longitude, pitch: 0, zoom: center.zoom, isSplit: false },
      mapStyle: { styleType: 'dark-matter', topLayerGroups: {}, visibleLayerGroups: { label: true, road: false, border: true, building: false, water: true, land: true } },
    },
  };
}

export interface UniverseMapBundle { datasets: KeplerDataset[]; config: ReturnType<typeof universeMapConfig>; unlocated: SnapshotNode[]; located: number; arcs: number }

export function universeMapBundle(snapshot: Snapshot): UniverseMapBundle {
  const { dataset: nodes, unlocated } = nodesDataset(snapshot);
  const relations = relationsDataset(snapshot);
  return { datasets: [nodes, relations], config: universeMapConfig(), unlocated, located: nodes.data.rows.length, arcs: relations.data.rows.length };
}
