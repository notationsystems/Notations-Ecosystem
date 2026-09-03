import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORBIT_ORDER, SOLAR_CLICK_FIELD, arcsDataset, moonsDataset, orbitsDataset, solarBundle, solarLayout, solarSelection, sunOf } from '../src/model/solar';
import type { Snapshot } from '../src/model/types';

const sample = JSON.parse(readFileSync(path.resolve(__dirname, '../public/sample-snapshot.json'), 'utf8')) as Snapshot;

describe('the solar layout', () => {
  const layout = solarLayout(sample);

  it('places every node exactly once, and the sun is the most-related coordinate node', () => {
    expect(layout.bodies).toHaveLength(sample.nodes.length);
    expect(new Set(layout.bodies.map((b) => b.node.nodeId)).size).toBe(sample.nodes.length);
    // A hub is a fact about the relations, not a flag in the catalog.
    expect(layout.sun?.metadata.corpus_role).toBe('coordinate');
    expect(layout.sun?.nodeId).toBe('control-plane');
    const sun = layout.bodies.find((b) => b.isSun)!;
    expect([sun.lon, sun.lat]).toEqual([0, 0]);
  });

  it('gives every other body its own position on its domain\'s orbit', () => {
    const positions = new Set(layout.bodies.map((b) => `${b.lon.toFixed(4)},${b.lat.toFixed(4)}`));
    expect(positions.size).toBe(layout.bodies.length);
    for (const body of layout.bodies.filter((b) => !b.isSun)) {
      const orbit = layout.orbits.find((o) => o.index === body.orbit)!;
      expect(Math.hypot(body.lon, body.lat)).toBeCloseTo(orbit.radius, 6);
      // Domains the order names sit on the ring the order says; unknown ones sit outermost.
      const expected = (ORBIT_ORDER as readonly string[]).indexOf(body.domain);
      expect(body.orbit).toBe(expected < 0 ? ORBIT_ORDER.length : expected);
    }
  });

  it('stays inside the latitudes where an orbit still reads as a circle', () => {
    // Mercator stretches by 1/cos(lat); under 25° that is below 1.1.
    for (const b of layout.bodies) expect(Math.abs(b.lat)).toBeLessThan(25);
    for (const m of layout.moons) expect(Math.abs(m.lat)).toBeLessThan(26);
  });

  it('gives each body one moon per capability, coloured by what it may do to the world', () => {
    expect(layout.moons).toHaveLength(sample.nodes.reduce((n, x) => n + x.capabilities.length, 0));
    const ds = moonsDataset(layout);
    const modes = new Set(ds.data.rows.map((r) => r[3]));
    expect([...modes].sort()).toEqual(['execute', 'observe', 'propose']);
    // Every moon rides within a body's small ring, never out in the void.
    const at = new Map(layout.bodies.map((b) => [b.node.nodeId, b]));
    for (const m of layout.moons) {
      const body = at.get(m.node.nodeId)!;
      expect(Math.hypot(m.lon - body.lon, m.lat - body.lat)).toBeLessThan(1.5);
    }
  });

  it('draws one closed orbit per populated ring and one arc per relation between bodies', () => {
    const orbits = orbitsDataset(layout);
    expect(orbits.data.rows).toHaveLength(layout.orbits.length);
    for (const row of orbits.data.rows) {
      const feature = JSON.parse(row[2] as string) as { geometry: { coordinates: number[][] } };
      const ring = feature.geometry.coordinates;
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
    // Every relation joins two placed bodies, so none is dropped the way the geographic
    // map drops arcs to unlocated nodes.
    expect(arcsDataset(sample, layout).data.rows).toHaveLength(sample.relations.length);
  });

  it('bundles four datasets, a no-basemap config, and pinned colour maps', () => {
    const bundle = solarBundle(sample);
    expect(bundle.datasets.map((d) => d.info.id)).toEqual(['solar-orbits', 'solar-arcs', 'solar-moons', 'solar-bodies']);
    expect(bundle.config.config.mapStyle.styleType).toBe('no_map');
    // customOrdinal with an explicit map, never ordinal: an ordinal scale recolours healthy
    // nodes the moment a filter removes every offline one.
    for (const layer of bundle.config.config.visState.layers) {
      if (layer.visualChannels.colorField) {
        expect(layer.visualChannels.colorScale).toBe('customOrdinal');
        expect((layer.config.visConfig as { colorRange: { colorMap: unknown[] } }).colorRange.colorMap.length).toBeGreaterThan(0);
      }
    }
  });

  it('rings the selected body and resolves clicks on moons and arcs back to a node', () => {
    const selected = solarSelection(layout, 'payload-terminal');
    expect(selected?.datasets[0]?.data.rows[0]?.[0]).toBe('payload-terminal');
    expect(solarSelection(layout, 'not-a-node')).toBeNull();
    expect(SOLAR_CLICK_FIELD['solar-moons']).toBe('node_id');
    expect(SOLAR_CLICK_FIELD['solar-arcs']).toBe('source');
  });

  it('is deterministic: the same snapshot lays out the same sky', () => {
    const again = solarLayout(sample);
    expect(again.bodies.map((b) => [b.node.nodeId, b.lon, b.lat])).toEqual(layout.bodies.map((b) => [b.node.nodeId, b.lon, b.lat]));
  });

  it('has no sun when nothing coordinates, and says so rather than inventing one', () => {
    const noHub: Snapshot = { ...sample, nodes: sample.nodes.filter((n) => n.metadata.corpus_role !== 'coordinate') };
    expect(sunOf(noHub)).toBeNull();
    const laid = solarLayout(noHub);
    expect(laid.sun).toBeNull();
    expect(laid.bodies.some((b) => b.isSun)).toBe(false);
    expect(laid.bodies).toHaveLength(noHub.nodes.length);
  });
});
