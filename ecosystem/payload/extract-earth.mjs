#!/usr/bin/env node
// Extract Kepler-ready layers from a Payload Earth (Payload-Render-Engine) checkout.
//   PAYLOAD_EARTH_DIR=/path/to/Payload-Render-Engine node --experimental-strip-types ecosystem/payload/extract-earth.mjs
// Every record keeps its provenance.source (synthetic:demo today; payload:canonical later) so the dock
// can answer "is this real?" per row rather than per layer.
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'layers');
const EARTH = process.env.PAYLOAD_EARTH_DIR;
if (!EARTH) { console.error('PAYLOAD_EARTH_DIR is required'); process.exit(2); }

const centroid = (coords) => [coords.reduce((s, c) => s + c[0], 0) / coords.length, coords.reduce((s, c) => s + c[1], 0) / coords.length];

export function earthLayers(snap) {
  const byId = new Map(snap.nodes.map((n) => [n.id, n]));
  const routeById = new Map(snap.routes.map((r) => [r.id, r]));
  const facilities = snap.nodes.filter((n) => n.kind !== 'chokepoint').map((n) => ({
    entity_id: n.id, kind: n.kind, name: n.name, country: n.country ?? '', status: n.status, importance: n.importance,
    capacity: n.capacity ? `${n.capacity.value} ${n.capacity.unit}` : '', operator: n.operator ?? '', routes: (n.connectedRouteIds ?? []).length,
    provenance: n.provenance.source, known_at: n.provenance.knownAt, confidence: n.provenance.confidence ?? null,
    latitude: n.geometry.coordinates[1], longitude: n.geometry.coordinates[0],
  }));
  const constraintsByEntity = new Map();
  for (const c of snap.constraints) constraintsByEntity.set(c.entityId, [...(constraintsByEntity.get(c.entityId) ?? []), c]);
  const chokepoints = snap.nodes.filter((n) => n.kind === 'chokepoint').map((n) => {
    const cs = constraintsByEntity.get(n.id) ?? [];
    return { entity_id: n.id, name: n.name, status: n.status, importance: n.importance, constraint_count: cs.length, max_severity: cs.reduce((m, c) => Math.max(m, c.severity), 0), constraints: cs.map((c) => `${c.type}: ${c.description}`).join(' | '), provenance: n.provenance.source, latitude: n.geometry.coordinates[1], longitude: n.geometry.coordinates[0] };
  });
  const routes = snap.routes.map((r) => ({
    entity_id: r.id, name: r.name, mode: r.mode, status: r.status, distance_km: Math.round(r.distanceKm), duration_h: Math.round(r.estimatedDurationHours), utilization: Math.round(r.utilization * 100) / 100,
    capacity: r.capacity ? `${r.capacity.value} ${r.capacity.unit}` : '', origin: byId.get(r.originId)?.name ?? r.originId, destination: byId.get(r.destinationId)?.name ?? r.destinationId,
    constraints: r.constraints.length, geometry_basis: r.geometryBasis ?? '', provenance: r.provenance.source,
    _geojson: JSON.stringify({ type: 'Feature', properties: { name: r.name, mode: r.mode }, geometry: r.geometry }),
  }));
  const flows = snap.flows.map((f) => {
    const o = byId.get(f.originId); const d = byId.get(f.destinationId);
    const commodity = snap.commodities.find((c) => c.id === f.commodityId);
    return { entity_id: f.id, name: f.name, commodity: commodity?.name ?? f.commodityId, category: commodity?.category ?? '', status: f.status, intensity: f.intensity, segments: f.segments.length, modes: [...new Set(f.segments.map((s) => s.mode))].join('+'), origin: o?.name ?? f.originId, destination: d?.name ?? f.destinationId, provenance: f.provenance.source,
      source_lat: o?.geometry.coordinates[1] ?? null, source_lng: o?.geometry.coordinates[0] ?? null, target_lat: d?.geometry.coordinates[1] ?? null, target_lng: d?.geometry.coordinates[0] ?? null };
  }).filter((f) => f.source_lat !== null && f.target_lat !== null);
  const events = snap.events.map((e) => {
    const pts = e.affects.map((id) => byId.get(id)?.geometry.coordinates ?? (routeById.get(id) ? centroid(routeById.get(id).geometry.coordinates) : null)).filter(Boolean);
    const [lng, lat] = pts.length ? centroid(pts) : [null, null];
    return { entity_id: e.id, name: e.name, category: e.category, severity: e.severity, description: e.description, affects: e.affects.length, affected: e.affects.map((id) => byId.get(id)?.name ?? routeById.get(id)?.name ?? id).join(' | '), start: e.start, end: e.end ?? '', provenance: e.provenance.source, latitude: lat, longitude: lng };
  }).filter((e) => e.latitude !== null);
  return { 'earth-facilities': facilities, 'earth-chokepoints': chokepoints, 'earth-routes': routes, 'earth-flows': flows, 'earth-events': events, meta: { label: snap.meta.label, disclaimer: snap.meta.disclaimer, generatedAt: snap.meta.generatedAt, timeRange: snap.timeRange } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const world = await import(pathToFileURL(path.join(EARTH, 'src/data/synthetic/world.ts')).href);
  const snap = world.buildWorldSnapshot();
  const layers = earthLayers(snap);
  await mkdir(OUT, { recursive: true });
  for (const [id, rows] of Object.entries(layers)) {
    const file = path.join(OUT, `${id}.json`);
    await writeFile(file, JSON.stringify(rows));
    console.log(`${id}: ${Array.isArray(rows) ? rows.length + ' rows' : 'meta'} -> ${path.relative(process.cwd(), file)} (${Math.round((await readFile(file)).length / 1024)} KB)`);
  }
}
