import type { KeplerDataset } from './kepler';
import { HEALTH_COLOR, HEALTHS, POSTURE_STATE_COLOR, RELATION_COLOR, RELATION_KINDS, type PostureState, type Snapshot, type SnapshotNode } from './types';
import { domainOf } from './graph';

/**
 * The estate as a solar system.
 *
 * A metaphor, and one chosen because it carries the architecture rather than decorating
 * it. The control plane is the sun: everything else is registered with it, and it holds
 * nothing of its own to shine by. Each estate domain is an orbit. Each system is a body on
 * its domain's orbit, sized by what it can do and coloured by whether it is up. Each
 * capability is a moon, coloured by what it is allowed to do to the world — observe,
 * propose, execute. Relations are the arcs between bodies.
 *
 * The geometry is synthetic and says so. Kepler.gl renders longitude and latitude, so the
 * system is laid out in degrees around (0, 0) on a map with no basemap. Nothing here is a
 * place; a body's position is its domain and its order of registration, and the layout is
 * deterministic so two operators looking at the same snapshot see the same sky.
 */

export const SOLAR_MAP_ID = 'solar';
export const SOLAR_BODIES = 'solar-bodies';
export const SOLAR_MOONS = 'solar-moons';
export const SOLAR_ORBITS = 'solar-orbits';
export const SOLAR_ARCS = 'solar-arcs';
export const SOLAR_SELECTED = 'solar-selected';
export const SOLAR_COORDINATION = 'solar-coordination';
export const SOLAR_HALOS = 'solar-halos';

/**
 * Orbit order, inner to outer. Platform first because the sun is a platform node and the
 * dock is its nearest body; the physical economy next because it is the estate's oldest
 * canonical state; the rest by how far from the coordination layer their material sits.
 * A domain the catalog does not know orbits outermost rather than being dropped.
 */
export const ORBIT_ORDER = ['platform', 'physical-economy', 'scientific', 'built-environment', 'intelligence', 'geospatial', 'perception-3d', 'archive'] as const;

/**
 * Ring radii in degrees. Kept inside ±25° of latitude: Mercator stretches a circle into
 * an oval by 1/cos(lat), and at 25° that is under 1.1, so an orbit still reads as an orbit.
 */
const INNER_RADIUS = 4;
const RING_STEP = 2.6;
const MOON_RADIUS = 0.62;
const ORBIT_VERTICES = 96;

export interface Body { node: SnapshotNode; lon: number; lat: number; orbit: number; domain: string; isSun: boolean }
export interface Moon { node: SnapshotNode; capabilityId: string; label: string; mode: string; approval: string; lon: number; lat: number }
export interface SolarLayout {
  sun: SnapshotNode | null;
  bodies: Body[];
  moons: Moon[];
  /** One entry per orbit actually drawn, with the domain it carries. */
  orbits: Array<{ index: number; domain: string; radius: number; bodies: number }>;
}

/**
 * Which node is the sun.
 *
 * The coordinate-role node with the most relations touching it. There is no `isSun` flag
 * in the catalog and there should not be: a hub is a fact about the relations, and a flag
 * would eventually disagree with them. Ties go to the lexically first id, so the answer is
 * stable across renders.
 */
export function sunOf(snapshot: Snapshot): SnapshotNode | null {
  const degree = new Map<string, number>();
  for (const r of snapshot.relations) {
    degree.set(r.sourceNodeId, (degree.get(r.sourceNodeId) ?? 0) + 1);
    degree.set(r.targetNodeId, (degree.get(r.targetNodeId) ?? 0) + 1);
  }
  const candidates = snapshot.nodes.filter((n) => n.metadata.corpus_role === 'coordinate');
  if (!candidates.length) return null;
  return candidates.slice().sort((a, b) => (degree.get(b.nodeId) ?? 0) - (degree.get(a.nodeId) ?? 0) || a.nodeId.localeCompare(b.nodeId))[0] ?? null;
}

const orbitIndex = (domain: string): number => {
  const at = (ORBIT_ORDER as readonly string[]).indexOf(domain);
  return at < 0 ? ORBIT_ORDER.length : at;
};
const ringRadius = (index: number): number => INNER_RADIUS + RING_STEP * index;

export function solarLayout(snapshot: Snapshot): SolarLayout {
  const sun = sunOf(snapshot);
  const others = snapshot.nodes.filter((n) => n.nodeId !== sun?.nodeId).slice().sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  const byOrbit = new Map<number, SnapshotNode[]>();
  for (const node of others) {
    const index = orbitIndex(domainOf(node));
    byOrbit.set(index, [...(byOrbit.get(index) ?? []), node]);
  }

  const bodies: Body[] = [];
  const orbits: SolarLayout['orbits'] = [];
  if (sun) bodies.push({ node: sun, lon: 0, lat: 0, orbit: -1, domain: domainOf(sun), isSun: true });

  for (const [index, nodes] of [...byOrbit.entries()].sort((a, b) => a[0] - b[0])) {
    const radius = ringRadius(index);
    // Stagger each ring by a fraction of a turn so bodies on adjacent orbits do not line up
    // along one radius and read as a single spoke.
    const phase = (index * Math.PI) / 7;
    nodes.forEach((node, i) => {
      const theta = phase + (2 * Math.PI * i) / nodes.length;
      bodies.push({ node, lon: radius * Math.cos(theta), lat: radius * Math.sin(theta), orbit: index, domain: domainOf(node), isSun: false });
    });
    orbits.push({ index, domain: nodes[0] ? domainOf(nodes[0]) : ORBIT_ORDER[index] ?? 'unassigned', radius, bodies: nodes.length });
  }

  // Moons ride a small ring around their body. A body with one capability gets one moon
  // straight "north"; a body with many gets an even spread, so the count is legible.
  const moons: Moon[] = [];
  for (const body of bodies) {
    const caps = body.node.capabilities;
    const radius = body.isSun ? MOON_RADIUS * 2.2 : MOON_RADIUS;
    caps.forEach((c, i) => {
      const theta = Math.PI / 2 + (2 * Math.PI * i) / caps.length;
      moons.push({ node: body.node, capabilityId: c.capabilityId, label: c.label, mode: c.mode, approval: c.approval, lon: body.lon + radius * Math.cos(theta), lat: body.lat + radius * Math.sin(theta) });
    });
  }

  return { sun, bodies, moons, orbits };
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

export function bodiesDataset(layout: SolarLayout): KeplerDataset {
  const fields: KeplerDataset['data']['fields'] = [
    { name: 'node_id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'kind', type: 'string' },
    { name: 'domain', type: 'string' }, { name: 'health', type: 'string' }, { name: 'corpus_grade', type: 'string' },
    { name: 'corpus_role', type: 'string' }, { name: 'capabilities', type: 'integer' }, { name: 'writes', type: 'integer' },
    { name: 'api_planes', type: 'string' }, { name: 'body', type: 'string' },
    { name: 'latitude', type: 'real' }, { name: 'longitude', type: 'real' },
  ];
  const rows = layout.bodies.map((b) => [
    b.node.nodeId, b.node.name, b.node.kind, b.domain, b.node.health,
    String(b.node.metadata.corpus_grade ?? 'undeclared'), String(b.node.metadata.corpus_role ?? ''),
    b.node.capabilities.length, Number(b.node.metadata.api_writes ?? 0), String(b.node.metadata.api_planes ?? ''),
    b.isSun ? 'sun' : 'planet', round(b.lat), round(b.lon),
  ]);
  return { info: { id: SOLAR_BODIES, label: 'Bodies' }, data: { fields, rows } };
}

export function moonsDataset(layout: SolarLayout): KeplerDataset {
  const fields: KeplerDataset['data']['fields'] = [
    { name: 'node_id', type: 'string' }, { name: 'capability_id', type: 'string' }, { name: 'label', type: 'string' },
    { name: 'mode', type: 'string' }, { name: 'approval', type: 'string' },
    { name: 'latitude', type: 'real' }, { name: 'longitude', type: 'real' },
  ];
  const rows = layout.moons.map((m) => [m.node.nodeId, m.capabilityId, m.label, m.mode, m.approval, round(m.lat), round(m.lon)]);
  return { info: { id: SOLAR_MOONS, label: 'Capabilities' }, data: { fields, rows } };
}

/** Each orbit as a closed GeoJSON ring, so Kepler draws it as a faint line. */
export function orbitsDataset(layout: SolarLayout): KeplerDataset {
  const fields: KeplerDataset['data']['fields'] = [{ name: 'domain', type: 'string' }, { name: 'bodies', type: 'integer' }, { name: '_geojson', type: 'string' }];
  const rows = layout.orbits.map((o) => {
    const ring: number[][] = [];
    for (let i = 0; i <= ORBIT_VERTICES; i++) {
      const t = (2 * Math.PI * i) / ORBIT_VERTICES;
      ring.push([round(o.radius * Math.cos(t)), round(o.radius * Math.sin(t))]);
    }
    return [o.domain, o.bodies, JSON.stringify({ type: 'Feature', properties: { domain: o.domain }, geometry: { type: 'LineString', coordinates: ring } })];
  });
  return { info: { id: SOLAR_ORBITS, label: 'Orbits' }, data: { fields, rows } };
}

export function arcsDataset(snapshot: Snapshot, layout: SolarLayout): KeplerDataset {
  const at = new Map(layout.bodies.map((b) => [b.node.nodeId, b]));
  const fields: KeplerDataset['data']['fields'] = [
    { name: 'relation_id', type: 'string' }, { name: 'kind', type: 'string' }, { name: 'source', type: 'string' }, { name: 'target', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'source_lat', type: 'real' }, { name: 'source_lng', type: 'real' }, { name: 'target_lat', type: 'real' }, { name: 'target_lng', type: 'real' },
  ];
  const rows: unknown[][] = [];
  for (const r of snapshot.relations) {
    const s = at.get(r.sourceNodeId);
    const t = at.get(r.targetNodeId);
    if (!s || !t) continue;
    rows.push([r.relationId, r.kind, r.sourceNodeId, r.targetNodeId, r.description, round(s.lat), round(s.lon), round(t.lat), round(t.lon)]);
  }
  return { info: { id: SOLAR_ARCS, label: 'Relations' }, data: { fields, rows } };
}

/**
 * The coordination ledger, drawn. A request is an arc from requester to target, coloured
 * by where it stands: awaiting a decision, approved, ready, rejected. An approved arc is
 * still `not_dispatched` — the plane records decisions and executes nothing — and the
 * tooltip carries that word so a green arc is never read as "done".
 */
export const COORDINATION_STATUS_COLOR: Array<[string, string]> = [
  ['approval_required', '#F5B942'], ['approved', '#5AC77A'], ['ready', '#39C6D8'], ['rejected', '#E8536A'],
];

export function coordinationDataset(snapshot: Snapshot, layout: SolarLayout): KeplerDataset {
  const at = new Map(layout.bodies.map((b) => [b.node.nodeId, b]));
  const fields: KeplerDataset['data']['fields'] = [
    { name: 'coordination_id', type: 'string' }, { name: 'status', type: 'string' }, { name: 'dispatch', type: 'string' },
    { name: 'requester', type: 'string' }, { name: 'target', type: 'string' }, { name: 'capability', type: 'string' },
    { name: 'mode', type: 'string' }, { name: 'purpose', type: 'string' },
    { name: 'source_lat', type: 'real' }, { name: 'source_lng', type: 'real' }, { name: 'target_lat', type: 'real' }, { name: 'target_lng', type: 'real' },
  ];
  const rows: unknown[][] = [];
  for (const c of snapshot.coordination) {
    const s = at.get(c.requesterNodeId);
    const t = at.get(c.targetNodeId);
    if (!s || !t) continue;
    rows.push([c.coordinationId, c.status, c.dispatch, c.requesterNodeId, c.targetNodeId, c.capabilityId, c.requestedMode, c.purpose, round(s.lat), round(s.lon), round(t.lat), round(t.lon)]);
  }
  return { info: { id: SOLAR_COORDINATION, label: 'Coordination' }, data: { fields, rows } };
}

/** Weakest link first: the state a body's halo takes is the worst any dimension reports. */
const WORST_FIRST: PostureState[] = ['failing', 'weak', 'unknown', 'adequate', 'strong'];

export function weakestState(node: SnapshotNode): PostureState | null {
  if (!node.security || !node.security.signals.length) return null;
  const present = new Set(node.security.signals.map((s) => s.state));
  return WORST_FIRST.find((state) => present.has(state)) ?? null;
}

/**
 * Security halos: an unfilled ring around every attested body, coloured by its weakest
 * dimension. A body with no attestation gets no halo rather than a grey one — the absence
 * is the information, and drawing it as a neutral ring would make "never attested" look
 * like "attested, unremarkable".
 */
export function haloDataset(layout: SolarLayout): KeplerDataset {
  const fields: KeplerDataset['data']['fields'] = [
    { name: 'node_id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'weakest', type: 'string' },
    { name: 'dimensions', type: 'integer' }, { name: 'attested_at', type: 'string' }, { name: 'method', type: 'string' },
    { name: 'latitude', type: 'real' }, { name: 'longitude', type: 'real' },
  ];
  const rows: unknown[][] = [];
  for (const b of layout.bodies) {
    const weakest = weakestState(b.node);
    if (!weakest) continue;
    rows.push([b.node.nodeId, b.node.name, weakest, b.node.security!.signals.length, b.node.security!.attestedAt, b.node.security!.method, round(b.lat), round(b.lon)]);
  }
  return { info: { id: SOLAR_HALOS, label: 'Posture' }, data: { fields, rows } };
}

const POSTURE_MAP = WORST_FIRST.map((s) => [s, POSTURE_STATE_COLOR[s]] as [string, string]);

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const HEALTH_MAP = HEALTHS.map((h) => [h, HEALTH_COLOR[h]] as [string, string]);
const MODE_MAP: Array<[string, string]> = [['observe', '#39C6D8'], ['propose', '#8B7CF6'], ['execute', '#F5B942']];
const RELATION_MAP = RELATION_KINDS.map((k) => [k, RELATION_COLOR[k]] as [string, string]);

/**
 * Kepler config for the system: no basemap, bodies coloured by health and sized by
 * capability count, moons by mode, arcs by relation kind, orbits as faint rings.
 *
 * Colour scales are `customOrdinal` with explicit maps, never `ordinal`: an ordinal scale
 * assigns palette colours by the sorted values present, so a filter that removed every
 * offline node would silently recolour healthy ones.
 */
export function solarConfig() {
  return {
    version: 'v1',
    config: {
      visState: {
        layers: [
          {
            id: 'solar-orbit-rings', type: 'geojson',
            config: {
              dataId: SOLAR_ORBITS, label: 'Orbits', color: [90, 100, 118], columns: { geojson: '_geojson' }, isVisible: true,
              visConfig: { opacity: 0.55, strokeOpacity: 0.55, thickness: 0.6, strokeColor: [90, 100, 118], filled: false, stroked: true, enable3d: false },
            },
            visualChannels: { colorField: null, colorScale: 'quantile', sizeField: null, sizeScale: 'linear', strokeColorField: null, strokeColorScale: 'quantile', heightField: null, heightScale: 'linear', radiusField: null, radiusScale: 'linear' },
          },
          {
            id: 'solar-relation-arcs', type: 'arc',
            config: {
              dataId: SOLAR_ARCS, label: 'Relations', color: [57, 198, 216],
              columns: { lat0: 'source_lat', lng0: 'source_lng', lat1: 'target_lat', lng1: 'target_lng' }, isVisible: true,
              visConfig: { opacity: 0.45, thickness: 1.4, colorRange: { name: 'Relations', type: 'qualitative', category: 'Custom', colors: RELATION_MAP.map(([, c]) => c), colorMap: RELATION_MAP }, sizeRange: [0, 10], targetColor: null },
            },
            visualChannels: { colorField: { name: 'kind', type: 'string' }, colorScale: 'customOrdinal', sizeField: null, sizeScale: 'linear' },
          },
          {
            id: 'solar-coordination-arcs', type: 'arc',
            config: {
              dataId: SOLAR_COORDINATION, label: 'Coordination', color: [245, 185, 66],
              columns: { lat0: 'source_lat', lng0: 'source_lng', lat1: 'target_lat', lng1: 'target_lng' }, isVisible: true,
              visConfig: { opacity: 0.9, thickness: 3.2, colorRange: { name: 'Coordination', type: 'qualitative', category: 'Custom', colors: COORDINATION_STATUS_COLOR.map(([, c]) => c), colorMap: COORDINATION_STATUS_COLOR }, sizeRange: [0, 10], targetColor: null },
            },
            visualChannels: { colorField: { name: 'status', type: 'string' }, colorScale: 'customOrdinal', sizeField: null, sizeScale: 'linear' },
          },
          {
            id: 'solar-halo-rings', type: 'point',
            config: {
              dataId: SOLAR_HALOS, label: 'Posture', color: [90, 199, 122], columns: { lat: 'latitude', lng: 'longitude', altitude: null }, isVisible: true,
              visConfig: { radius: 150, fixedRadius: false, opacity: 0.95, outline: true, filled: false, thickness: 2.5, strokeColor: [90, 199, 122], strokeColorRange: { name: 'Posture', type: 'qualitative', category: 'Custom', colors: POSTURE_MAP.map(([, c]) => c), colorMap: POSTURE_MAP } },
            },
            visualChannels: { colorField: null, colorScale: 'quantile', sizeField: null, sizeScale: 'linear', strokeColorField: { name: 'weakest', type: 'string' }, strokeColorScale: 'customOrdinal' },
          },
          {
            id: 'solar-moons-points', type: 'point',
            config: {
              dataId: SOLAR_MOONS, label: 'Capabilities', color: [57, 198, 216], columns: { lat: 'latitude', lng: 'longitude', altitude: null }, isVisible: true,
              visConfig: { radius: 9, fixedRadius: false, opacity: 0.85, outline: false, thickness: 1, radiusRange: [4, 12], colorRange: { name: 'Modes', type: 'qualitative', category: 'Custom', colors: MODE_MAP.map(([, c]) => c), colorMap: MODE_MAP } },
            },
            visualChannels: { colorField: { name: 'mode', type: 'string' }, colorScale: 'customOrdinal', sizeField: null, sizeScale: 'linear', strokeColorField: null, strokeColorScale: 'quantile' },
          },
          {
            id: 'solar-bodies-points', type: 'point',
            config: {
              dataId: SOLAR_BODIES, label: 'Systems', color: [245, 185, 66], columns: { lat: 'latitude', lng: 'longitude', altitude: null }, isVisible: true,
              visConfig: { radius: 40, fixedRadius: false, opacity: 0.92, outline: true, thickness: 2, strokeColor: [8, 12, 20], radiusRange: [26, 120], colorRange: { name: 'Health', type: 'qualitative', category: 'Custom', colors: HEALTH_MAP.map(([, c]) => c), colorMap: HEALTH_MAP } },
              textLabel: [{ field: { name: 'name', type: 'string' }, color: [235, 238, 243], size: 12, offset: [0, 0], anchor: 'middle', alignment: 'bottom' }],
            },
            visualChannels: { colorField: { name: 'health', type: 'string' }, colorScale: 'customOrdinal', sizeField: { name: 'capabilities', type: 'integer' }, sizeScale: 'sqrt', strokeColorField: null, strokeColorScale: 'quantile' },
          },
        ],
        interactionConfig: {
          tooltip: {
            enabled: true, compareMode: false, compareType: 'absolute',
            fieldsToShow: {
              [SOLAR_BODIES]: [{ name: 'name', format: null }, { name: 'domain', format: null }, { name: 'health', format: null }, { name: 'corpus_grade', format: null }, { name: 'capabilities', format: null }, { name: 'writes', format: null }, { name: 'api_planes', format: null }],
              [SOLAR_MOONS]: [{ name: 'capability_id', format: null }, { name: 'label', format: null }, { name: 'mode', format: null }, { name: 'approval', format: null }],
              [SOLAR_ARCS]: [{ name: 'source', format: null }, { name: 'kind', format: null }, { name: 'target', format: null }, { name: 'description', format: null }],
              [SOLAR_ORBITS]: [{ name: 'domain', format: null }, { name: 'bodies', format: null }],
              [SOLAR_COORDINATION]: [{ name: 'requester', format: null }, { name: 'capability', format: null }, { name: 'target', format: null }, { name: 'status', format: null }, { name: 'dispatch', format: null }, { name: 'purpose', format: null }],
              [SOLAR_HALOS]: [{ name: 'name', format: null }, { name: 'weakest', format: null }, { name: 'dimensions', format: null }, { name: 'method', format: null }, { name: 'attested_at', format: null }],
            },
          },
          brush: { enabled: false, size: 0.5 }, geocoder: { enabled: false }, coordinate: { enabled: false },
        },
        layerBlending: 'additive',
      },
      mapState: { bearing: 0, dragRotate: false, latitude: 0, longitude: 0, pitch: 0, zoom: 3.6, isSplit: false },
      // No basemap. This is not a place, and a coastline under it would say it was.
      mapStyle: { styleType: 'no_map', topLayerGroups: {}, visibleLayerGroups: {} },
    },
  };
}

/** One-row dataset and an unfilled amber ring around the selected body. */
export function solarSelection(layout: SolarLayout, nodeId: string): { datasets: KeplerDataset[]; config: unknown } | null {
  const body = layout.bodies.find((b) => b.node.nodeId === nodeId);
  if (!body) return null;
  const dataset: KeplerDataset = {
    info: { id: SOLAR_SELECTED, label: 'Selected' },
    data: { fields: [{ name: 'node_id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'latitude', type: 'real' }, { name: 'longitude', type: 'real' }], rows: [[body.node.nodeId, body.node.name, round(body.lat), round(body.lon)]] },
  };
  const config = {
    version: 'v1',
    config: {
      visState: {
        layers: [{
          id: 'solar-selected-ring', type: 'point',
          config: { dataId: SOLAR_SELECTED, label: 'Selected', color: [245, 185, 66], columns: { lat: 'latitude', lng: 'longitude', altitude: null }, isVisible: true, visConfig: { radius: body.isSun ? 300 : 170, fixedRadius: false, opacity: 1, outline: true, filled: false, thickness: 3, strokeColor: [245, 185, 66] } },
          visualChannels: { colorField: null, colorScale: 'quantile', sizeField: null, sizeScale: 'linear', strokeColorField: null, strokeColorScale: 'quantile' },
        }],
        interactionConfig: { tooltip: { enabled: true, compareMode: false, compareType: 'absolute', fieldsToShow: { [SOLAR_SELECTED]: [{ name: 'name', format: null }] } } },
      },
    },
  };
  return { datasets: [dataset], config };
}

/** Which dataset column names the node a click should select. Moons select their body; arcs their source. */
export const SOLAR_CLICK_FIELD: Record<string, string> = { [SOLAR_BODIES]: 'node_id', [SOLAR_MOONS]: 'node_id', [SOLAR_ARCS]: 'source', [SOLAR_SELECTED]: 'node_id', [SOLAR_COORDINATION]: 'target', [SOLAR_HALOS]: 'node_id' };

export interface SolarBundle { datasets: KeplerDataset[]; config: ReturnType<typeof solarConfig>; layout: SolarLayout; arcs: number; coordination: number; halos: number }

export function solarBundle(snapshot: Snapshot): SolarBundle {
  const layout = solarLayout(snapshot);
  const arcs = arcsDataset(snapshot, layout);
  const coordination = coordinationDataset(snapshot, layout);
  const halos = haloDataset(layout);
  return {
    datasets: [orbitsDataset(layout), arcs, coordination, halos, moonsDataset(layout), bodiesDataset(layout)],
    config: solarConfig(), layout, arcs: arcs.data.rows.length, coordination: coordination.data.rows.length, halos: halos.data.rows.length,
  };
}

/** Kepler bounds around the whole system, padded so the outer orbit is not on the edge. */
export function solarBounds(layout: SolarLayout): [number, number, number, number] {
  const outer = layout.orbits.reduce((max, o) => Math.max(max, o.radius), INNER_RADIUS) + RING_STEP * 0.9;
  return [-outer * 1.25, -outer, outer * 1.25, outer];
}

export { rgb as solarRgb };
