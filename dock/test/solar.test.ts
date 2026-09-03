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

  it('bundles a no-basemap config with pinned colour maps on every coloured layer', () => {
    const bundle = solarBundle(sample);
    expect(bundle.datasets.length).toBe(6);
    expect(bundle.config.config.mapStyle.styleType).toBe('no_map');
    // customOrdinal with an explicit map, never ordinal: an ordinal scale recolours healthy
    // nodes the moment a filter removes every offline one.
    for (const layer of bundle.config.config.visState.layers) {
      const channels = layer.visualChannels as { colorField?: unknown; colorScale?: string; strokeColorField?: unknown; strokeColorScale?: string };
      const vis = layer.config.visConfig as { colorRange?: { colorMap: unknown[] }; strokeColorRange?: { colorMap: unknown[] } };
      if (channels.colorField) {
        expect(channels.colorScale).toBe('customOrdinal');
        expect(vis.colorRange!.colorMap.length).toBeGreaterThan(0);
      }
      if (channels.strokeColorField) {
        expect(channels.strokeColorScale).toBe('customOrdinal');
        expect(vis.strokeColorRange!.colorMap.length).toBeGreaterThan(0);
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

describe('the twin\'s coordination arcs and posture halos', () => {
  it('draws one arc per coordination record between placed bodies, coloured by status and carrying not_dispatched', async () => {
    const { coordinationDataset, COORDINATION_STATUS_COLOR } = await import('../src/model/solar');
    const layout = solarLayout(sample);
    const [requester, target] = sample.nodes;
    const live: Snapshot = {
      ...sample,
      coordination: [{
        coordinationId: 'coord-twin', requesterNodeId: requester!.nodeId, targetNodeId: target!.nodeId, capabilityId: target!.capabilities[0]!.capabilityId,
        requestedMode: target!.capabilities[0]!.mode, purpose: 'Twin test.', requestedBy: 'operator:test', requestedAt: '2026-09-03T00:00:00Z',
        dispatch: 'not_dispatched', status: 'approved', resolvedAt: '2026-09-03T00:01:00Z', resolvedBy: 'operator:test', resolutionNote: 'ok',
      }],
    };
    const ds = coordinationDataset(live, layout);
    expect(ds.data.rows).toHaveLength(1);
    const row = ds.data.rows[0]!;
    expect(row[1]).toBe('approved');
    expect(row[2]).toBe('not_dispatched');
    // Every status the plane can emit has a pinned colour; a status with none would fall
    // back to a palette position and recolour as the set present changed.
    for (const status of ['approval_required', 'approved', 'ready', 'rejected']) expect(COORDINATION_STATUS_COLOR.some(([s]) => s === status)).toBe(true);
    expect(coordinationDataset(sample, layout).data.rows).toHaveLength(0);
  });

  it('gives an attested body a halo coloured by its weakest dimension, and none to an unattested one', async () => {
    const { haloDataset, weakestState } = await import('../src/model/solar');
    const [plain, ...rest] = sample.nodes;
    const attested = {
      ...plain!,
      security: {
        attestedAt: '2026-09-03T00:00:00Z', attestedBy: 'attestor:ci', method: 'automated_scan' as const,
        signals: [
          { dimension: 'identity' as const, state: 'strong' as const, coverage: 1, summary: 'Bound.', evidenceRef: null, findings: [], expiresAt: null },
          { dimension: 'transport' as const, state: 'weak' as const, coverage: 0.5, summary: 'Plaintext loopback.', evidenceRef: null, findings: [], expiresAt: null },
        ],
      },
    } as unknown as typeof plain;
    expect(weakestState(attested!)).toBe('weak');
    expect(weakestState(plain!)).toBeNull();
    // Counted against what the sample already carries, never assumed about it.
    const sampleAttested = sample.nodes.filter((n) => n.security !== null).length;
    const layout = solarLayout({ ...sample, nodes: [attested!, ...rest] });
    const halos = haloDataset(layout);
    expect(halos.data.rows).toHaveLength(sampleAttested + 1);
    const mine = halos.data.rows.find((r) => r[0] === plain!.nodeId)!;
    expect(mine[2]).toBe('weak');
    // One halo per attested body and none for the rest: absence is the information, and a
    // neutral ring on an unattested body would read as "attested, unremarkable".
    expect(haloDataset(solarLayout(sample)).data.rows).toHaveLength(sampleAttested);
    expect(sampleAttested).toBeLessThan(sample.nodes.length);
  });

  it('bundles six datasets in draw order: orbits under everything, bodies on top', () => {
    const bundle = solarBundle(sample);
    expect(bundle.datasets.map((d) => d.info.id)).toEqual(['solar-orbits', 'solar-arcs', 'solar-coordination', 'solar-halos', 'solar-moons', 'solar-bodies']);
    expect(bundle.coordination).toBe(sample.coordination.length);
    expect(bundle.halos).toBe(sample.nodes.filter((n) => n.security !== null).length);
    expect(SOLAR_CLICK_FIELD['solar-coordination']).toBe('target');
  });
});
