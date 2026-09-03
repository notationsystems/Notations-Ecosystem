import type { KeplerDataset, KeplerFieldType } from './kepler';

/** A layer of the Payload cluster as described by ecosystem/payload/layers.json. */
export interface LayerEntry {
  id: string;
  name: string;
  group: string;
  source_system: string;
  geometry: 'point' | 'arc' | 'path' | 'polygon';
  file: string;
  provenance: string;
  /**
   * What the rows rest on. `real` is derived from it — a layer is real when its basis is
   * not `synthetic` — rather than asserted beside it, because a boolean forced curated
   * data to claim to be a capture.
   */
  basis: 'capture' | 'manifest' | 'curated' | 'synthetic';
  real: boolean;
  /** Which row provenance fields this layer's rows actually carry. */
  provenance_fields: string[];
  default_visible: boolean;
  time_field?: string;
  kepler: {
    type: 'point' | 'arc' | 'geojson';
    columns: Record<string, string>;
    colorField?: { name: string; type: string };
    sizeField?: { name: string; type: string };
    label?: string;
    radiusRange?: [number, number];
    tooltip?: string[];
  };
}

export interface LayerManifest { schema: string; description: string; groups: Record<string, string>; layers: LayerEntry[] }

export type Row = Record<string, unknown>;

function inferType(name: string, values: unknown[]): KeplerFieldType {
  if (name === '_geojson') return 'geojson' as KeplerFieldType;
  let sawNumber = false;
  let sawInt = true;
  let sawIso = false;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'number') { sawNumber = true; if (!Number.isInteger(v)) sawInt = false; continue; }
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) { sawIso = true; continue; }
    return 'string';
  }
  if (sawIso && !sawNumber) return 'timestamp';
  return sawNumber ? (sawInt ? 'integer' : 'real') : 'string';
}

/** Rows → Kepler dataset with inferred field types (`_geojson` becomes a geojson field). */
export function rowsToDataset(id: string, label: string, rows: Row[]): KeplerDataset {
  const names: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
  const fields = names.map((name) => ({ name, type: inferType(name, rows.map((r) => r[name])) }));
  const data = rows.map((r) => fields.map((f) => { const v = r[f.name]; return v === undefined ? null : v; }));
  return { info: { id, label }, data: { fields, rows: data } };
}

export const datasetIdFor = (layer: LayerEntry) => `payload-${layer.id}`;

const GROUP_PALETTE: Record<string, string[]> = {
  facilities: ['#F5B942', '#E8A33D', '#D98E38', '#C97A33', '#B8672F', '#A6552A'],
  logistics: ['#39C6D8', '#4FA3F7', '#8B7CF6', '#5AC77A', '#F5B942', '#E86A7A'],
  flows: ['#39C6D8', '#5AC77A', '#F5B942', '#E86A7A', '#8B7CF6'],
  disruptions: ['#F5B942', '#E8A33D', '#E86A7A', '#E8536A', '#C72E4A'],
  coverage: ['#5AC77A', '#39C6D8', '#4FA3F7', '#8B7CF6'],
};

/** Kepler.gl v1 layer config for a manifest entry. */
export function layerConfig(layer: LayerEntry, visible = layer.default_visible): Record<string, unknown> {
  const dataId = datasetIdFor(layer);
  const colors = GROUP_PALETTE[layer.group] ?? GROUP_PALETTE.facilities!;
  const colorRange = { name: `payload-${layer.group}`, type: 'custom', category: 'Custom', colors };
  const k = layer.kepler;
  const base = { dataId, label: layer.name, isVisible: visible, columns: k.columns };
  if (k.type === 'point') {
    return {
      id: `layer-${layer.id}`, type: 'point',
      config: { ...base, color: [245, 185, 66], visConfig: { radius: 8, fixedRadius: false, opacity: 0.85, outline: true, thickness: 1.5, strokeColor: [8, 12, 20], radiusRange: k.radiusRange ?? [4, 20], colorRange },
        textLabel: k.label ? [{ field: { name: k.label, type: 'string' }, color: [230, 233, 239], size: 11, offset: [0, 14], anchor: 'middle', alignment: 'center' }] : [] },
      visualChannels: { colorField: k.colorField ?? null, colorScale: k.colorField?.type === 'string' ? 'ordinal' : 'quantile', sizeField: k.sizeField ?? null, sizeScale: 'sqrt' },
    };
  }
  if (k.type === 'arc') {
    return {
      id: `layer-${layer.id}`, type: 'arc',
      config: { ...base, color: [57, 198, 216], visConfig: { opacity: 0.7, thickness: 2, colorRange, sizeRange: [1, 8], targetColor: [245, 185, 66] } },
      visualChannels: { colorField: k.colorField ?? null, colorScale: k.colorField?.type === 'string' ? 'ordinal' : 'quantile', sizeField: k.sizeField ?? null, sizeScale: 'sqrt' },
    };
  }
  return {
    id: `layer-${layer.id}`, type: 'geojson',
    config: { ...base, color: [57, 198, 216], visConfig: { opacity: 0.8, strokeOpacity: 0.8, thickness: 1.5, strokeColor: null, colorRange, strokeColorRange: colorRange, radius: 6, sizeRange: [0.5, 4], stroked: true, filled: false, enable3d: false, wireframe: false },
      textLabel: [] },
    visualChannels: { colorField: null, colorScale: 'quantile', strokeColorField: k.colorField ?? null, strokeColorScale: k.colorField?.type === 'string' ? 'ordinal' : 'quantile', sizeField: k.sizeField ?? null, sizeScale: 'linear', heightField: null, heightScale: 'linear', radiusField: null, radiusScale: 'linear' },
  };
}

export function tooltipFields(layer: LayerEntry): Array<{ name: string; format: null }> {
  return (layer.kepler.tooltip ?? []).map((name) => ({ name, format: null }));
}

/** Fetch the manifest and every layer file from the dock's public dir. */
export async function loadPayloadLayers(base = `${import.meta.env.BASE_URL}layers/payload/`): Promise<{ manifest: LayerManifest; datasets: Map<string, KeplerDataset>; errors: string[] }> {
  const res = await fetch(`${base}layers.json`);
  if (!res.ok) throw new Error(`layers.json missing at ${base}; run \`npm run sync\` in dock/`);
  const manifest = (await res.json()) as LayerManifest;
  const datasets = new Map<string, KeplerDataset>();
  const errors: string[] = [];
  await Promise.all(manifest.layers.map(async (layer) => {
    try {
      const r = await fetch(`${base}${layer.file}`);
      if (!r.ok) throw new Error(`${layer.file}: HTTP ${r.status}`);
      const rows = (await r.json()) as Row[];
      datasets.set(layer.id, rowsToDataset(datasetIdFor(layer), layer.name, rows));
    } catch (e) { errors.push(`${layer.id}: ${(e as Error).message}`); }
  }));
  return { manifest, datasets, errors };
}

/**
 * Fold the Payload layers into a universe map bundle.
 *
 * The extractors have always produced these — 562 rows across nine layers, each carrying
 * its own provenance — the sync script has always copied them into `public/layers/payload/`,
 * and `loadPayloadLayers` has always been able to read them. Nothing called it. The Map
 * lens drew nodes and relation arcs while three documents said it drew the Payload
 * layers, so the estate's one worked example of per-row provenance was built, shipped and
 * never seen.
 *
 * Every layer's tooltip carries `provenance`, and `known_at` where the rows have it, so
 * "is this real?" and "when was it knowable?" are answerable by hovering a row rather
 * than by reading a manifest.
 */
export function withPayloadLayers<T extends { datasets: KeplerDataset[]; config: { config: { visState: { layers: unknown[]; interactionConfig: { tooltip: { fieldsToShow: Record<string, unknown> } } } } } }>(
  bundle: T,
  loaded: { manifest: LayerManifest; datasets: Map<string, KeplerDataset> } | null,
): T & { payloadLayers: number; payloadRows: number } {
  if (!loaded || !loaded.datasets.size) return { ...bundle, payloadLayers: 0, payloadRows: 0 };
  const present = loaded.manifest.layers.filter((layer) => loaded.datasets.has(layer.id));
  const datasets = present.map((layer) => loaded.datasets.get(layer.id)!);
  const fieldsToShow: Record<string, unknown> = { ...bundle.config.config.visState.interactionConfig.tooltip.fieldsToShow };
  for (const layer of present) fieldsToShow[datasetIdFor(layer)] = tooltipFields(layer);
  return {
    ...bundle,
    datasets: [...bundle.datasets, ...datasets],
    config: {
      ...bundle.config,
      config: {
        ...bundle.config.config,
        visState: {
          ...bundle.config.config.visState,
          layers: [...bundle.config.config.visState.layers, ...present.map((layer) => layerConfig(layer))],
          interactionConfig: {
            ...bundle.config.config.visState.interactionConfig,
            tooltip: { ...bundle.config.config.visState.interactionConfig.tooltip, fieldsToShow },
          },
        },
      },
    },
    payloadLayers: present.length,
    payloadRows: datasets.reduce((sum, d) => sum + d.data.rows.length, 0),
  };
}
