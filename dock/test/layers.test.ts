import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { datasetIdFor, layerConfig, rowsToDataset, withPayloadLayers, type LayerManifest, type Row } from '../src/model/layers';
import type { KeplerDataset } from '../src/model/kepler';

const root = path.resolve(__dirname, '../../ecosystem/payload');
const manifest = JSON.parse(readFileSync(path.join(root, 'layers.json'), 'utf8')) as LayerManifest;

describe('payload layer manifest', () => {
  it('references existing files whose columns exist in the data', () => {
    expect(manifest.layers.length).toBeGreaterThanOrEqual(8);
    for (const layer of manifest.layers) {
      const rows = JSON.parse(readFileSync(path.join(root, 'layers', layer.file), 'utf8')) as Row[];
      expect(rows.length, layer.id).toBeGreaterThan(0);
      const keys = new Set(Object.keys(rows[0]!));
      for (const col of Object.values(layer.kepler.columns)) expect(keys.has(col), `${layer.id}.${col}`).toBe(true);
      if (layer.kepler.colorField) expect(keys.has(layer.kepler.colorField.name), `${layer.id} colorField`).toBe(true);
      if (layer.kepler.sizeField) expect(keys.has(layer.kepler.sizeField.name), `${layer.id} sizeField`).toBe(true);
      for (const t of layer.kepler.tooltip ?? []) expect(keys.has(t), `${layer.id} tooltip ${t}`).toBe(true);
      expect(rows.every((r) => typeof r.provenance === 'string' && (r.provenance as string).length > 0), `${layer.id} provenance per row`).toBe(true);
      const ds = rowsToDataset(datasetIdFor(layer), layer.name, rows);
      expect(ds.data.rows).toHaveLength(rows.length);
      const cfg = layerConfig(layer) as { type: string; config: { dataId: string } };
      expect(cfg.type).toBe(layer.kepler.type);
      expect(cfg.config.dataId).toBe(ds.info.id);
    }
  });
  it('infers geojson, timestamp and numeric field types', () => {
    const ds = rowsToDataset('t', 't', [{ _geojson: '{"type":"Feature"}', start: '2026-09-01T00:00:00Z', severity: 0.7, n: 3, name: 'x' }]);
    const types = Object.fromEntries(ds.data.fields.map((f) => [f.name, f.type]));
    expect(types).toEqual({ _geojson: 'geojson', start: 'timestamp', severity: 'real', n: 'integer', name: 'string' });
  });
  it('flags real versus synthetic layers honestly', () => {
    const real = manifest.layers.filter((l) => l.real).map((l) => l.id);
    expect(real).toEqual(expect.arrayContaining(['comtrade-flows', 'archive-coverage', 'submarine-cables', 'nuclear-facilities']));
    expect(manifest.layers.find((l) => l.id === 'earth-facilities')?.real).toBe(false);
  });
});

describe('folding the Payload layers into the universe map', () => {
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../ecosystem/payload/layers.json'), 'utf8')) as LayerManifest;

  type Bundle = {
    datasets: KeplerDataset[];
    config: { version: string; config: { visState: { layers: unknown[]; interactionConfig: { tooltip: { enabled: boolean; fieldsToShow: Record<string, unknown> } } } } };
    located: number; arcs: number; unlocated: unknown[];
  };
  const universe = (): Bundle => ({
    datasets: [{ info: { id: 'universe-nodes', label: 'Nodes' }, data: { fields: [], rows: [[1]] } }],
    config: { version: 'v1', config: { visState: { layers: [{ id: 'universe-nodes-points' }], interactionConfig: { tooltip: { enabled: true, fieldsToShow: { 'universe-nodes': [] } } } } } },
    located: 7, arcs: 5, unlocated: [],
  });
  const load = (layers: LayerManifest['layers']) => ({
    manifest,
    datasets: new Map<string, KeplerDataset>(layers.map((l) => [l.id, { info: { id: datasetIdFor(l), label: l.name }, data: { fields: [], rows: [[1], [2]] } }])),
  });

  it('adds one Kepler layer and one dataset per loaded manifest entry', () => {
    const folded = withPayloadLayers(universe(), load(manifest.layers));
    expect(folded.payloadLayers).toBe(manifest.layers.length);
    expect(folded.payloadRows).toBe(manifest.layers.length * 2);
    expect(folded.datasets).toHaveLength(1 + manifest.layers.length);
    expect(folded.config.config.visState.layers).toHaveLength(1 + manifest.layers.length);
  });

  it('shows every layer its provenance in the tooltip, which is what makes "is this real?" a per-row query', () => {
    const folded = withPayloadLayers(universe(), load(manifest.layers));
    const shown = folded.config.config.visState.interactionConfig.tooltip.fieldsToShow as Record<string, Array<{ name: string }>>;
    for (const layer of manifest.layers) {
      const fields = shown[datasetIdFor(layer)]!.map((f) => f.name);
      expect(fields).toContain('provenance');
      if (layer.provenance_fields.includes('known_at')) expect(fields).toContain('known_at');
    }
  });

  it('draws the universe unchanged when the layers are not there', () => {
    const bare = withPayloadLayers(universe(), null);
    expect(bare.payloadLayers).toBe(0);
    expect(bare.datasets).toHaveLength(1);
    expect(bare.config.config.visState.layers).toHaveLength(1);
  });

  it('skips a manifest entry whose file failed to load rather than drawing an empty layer', () => {
    const folded = withPayloadLayers(universe(), load([manifest.layers[0]!]));
    expect(folded.payloadLayers).toBe(1);
    expect(folded.config.config.visState.layers).toHaveLength(2);
  });
});
