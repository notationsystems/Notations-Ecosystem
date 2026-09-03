import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodesDataset, relationsDataset, universeMapBundle } from '../src/model/kepler';
import { domainSummary, neighbourhood, snapshotStats, toGraphData } from '../src/model/graph';
import { applyFilters } from '../src/lenses/types';
import { NODE_KINDS, RELATION_KINDS, type Snapshot } from '../src/model/types';

const sample = JSON.parse(readFileSync(path.resolve(__dirname, '../public/sample-snapshot.json'), 'utf8')) as Snapshot;

describe('sample snapshot', () => {
  it('has the control-plane schema and only not_dispatched coordination', () => {
    expect(sample.schema).toBe('notations.control-plane.snapshot.v1');
    expect(sample.nodes.length).toBeGreaterThanOrEqual(9);
    expect(sample.coordination.every((c) => c.dispatch === 'not_dispatched')).toBe(true);
  });
});

describe('kepler mapping', () => {
  it('puts only located nodes on the map and reports the rest', () => {
    const { dataset, unlocated } = nodesDataset(sample);
    const located = sample.nodes.filter((n) => n.location);
    expect(dataset.data.rows).toHaveLength(located.length);
    expect(unlocated).toHaveLength(sample.nodes.length - located.length);
    const latIdx = dataset.data.fields.findIndex((f) => f.name === 'latitude');
    for (const row of dataset.data.rows) expect(typeof row[latIdx]).toBe('number');
  });
  it('draws arcs only between two located nodes', () => {
    const byId = new Map(sample.nodes.map((n) => [n.nodeId, n]));
    const arcs = relationsDataset(sample);
    const expected = sample.relations.filter((r) => byId.get(r.sourceNodeId)?.location && byId.get(r.targetNodeId)?.location).length;
    expect(arcs.data.rows).toHaveLength(expected);
  });
  it('bundles datasets with a point and an arc layer bound to them', () => {
    const b = universeMapBundle(sample);
    const layers = b.config.config.visState.layers;
    expect(layers.map((l) => l.type)).toEqual(['point', 'arc']);
    expect(layers[0]!.config.dataId).toBe(b.datasets[0]!.info.id);
    expect(layers[1]!.config.dataId).toBe(b.datasets[1]!.info.id);
    expect(b.config.config.mapStyle.styleType).toBe('dark-matter');
  });
});

describe('graph mapping', () => {
  it('links only registered nodes and sizes by capabilities', () => {
    const g = toGraphData(sample);
    expect(g.nodes).toHaveLength(sample.nodes.length);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const l of g.links) { expect(ids.has(l.source)).toBe(true); expect(ids.has(l.target)).toBe(true); }
    const cp = g.nodes.find((n) => n.id === 'control-plane')!;
    expect(cp.val).toBeCloseTo(Math.sqrt(cp.capabilities));
    expect(cp.executeCapabilities).toBeGreaterThan(0);
  });
  it('computes neighbourhoods, domain summary and stats', () => {
    const n = neighbourhood(sample, 'control-plane');
    expect(n.has('control-plane')).toBe(true);
    expect(n.has('notations-dock')).toBe(true);
    const domains = domainSummary(sample);
    expect(domains.reduce((s, d) => s + d.nodes, 0)).toBe(sample.nodes.length);
    const stats = snapshotStats(sample);
    expect(stats.capabilities).toBe(sample.nodes.reduce((s, x) => s + x.capabilities.length, 0));
    expect(stats.located).toBe(sample.nodes.filter((x) => x.location).length);
  });
});

describe('filters', () => {
  const base = { kinds: new Set(NODE_KINDS), relationKinds: new Set(RELATION_KINDS), domains: new Set<string>(), locatedOnly: false, search: '' };
  it('drops relations whose ends were filtered out', () => {
    const f = applyFilters(sample, { ...base, kinds: new Set(['visual_dock'] as const) });
    expect(f.nodes.every((n) => n.kind === 'visual_dock')).toBe(true);
    const ids = new Set(f.nodes.map((n) => n.nodeId));
    expect(f.relations.every((r) => ids.has(r.sourceNodeId) && ids.has(r.targetNodeId))).toBe(true);
  });
  it('searches ids, names and capability ids', () => {
    expect(applyFilters(sample, { ...base, search: 'snapshot.read' }).nodes.map((n) => n.nodeId)).toEqual(['control-plane']);
    expect(applyFilters(sample, { ...base, locatedOnly: true }).nodes.every((n) => n.location)).toBe(true);
  });
});
