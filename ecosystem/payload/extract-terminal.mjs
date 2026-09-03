#!/usr/bin/env node
// Extract Kepler-ready layers from a Payload Terminal checkout (real captures, real infrastructure).
//   PAYLOAD_TERMINAL_DIR=/path/to/Payload-Terminal-V0 node ecosystem/payload/extract-terminal.mjs
// Writes ecosystem/payload/layers/{comtrade-flows,archive-coverage,submarine-cables,nuclear-facilities}.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowProvenance } from './provenance.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'layers');
const SRC = process.env.PAYLOAD_TERMINAL_DIR;
if (!SRC) { console.error('PAYLOAD_TERMINAL_DIR is required'); process.exit(2); }
const EARTH = process.env.PAYLOAD_EARTH_DIR;

/* ---------- country centroids from TopoJSON (countries-110m, M49 ids) ---------- */
export function topojsonCentroids(topo) {
  const { scale, translate } = topo.transform ?? { scale: [1, 1], translate: [0, 0] };
  const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; }); });
  const ring = (indices) => indices.flatMap((i) => (i < 0 ? [...arcs[~i]].reverse() : arcs[i]));
  const out = new Map();
  for (const g of topo.objects.countries.geometries) {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    // Use the largest outer ring by vertex count as the representative polygon (good enough for arc endpoints).
    let best = null;
    for (const poly of polys) { const pts = ring(poly[0]); if (!best || pts.length > best.length) best = pts; }
    if (!best) continue;
    const lon = best.reduce((s, p) => s + p[0], 0) / best.length;
    const lat = best.reduce((s, p) => s + p[1], 0) / best.length;
    out.set(String(Number(g.id)), { lon, lat, name: g.properties?.name ?? g.id });
  }
  return out;
}

// M49 codes Comtrade uses that are not in Natural Earth 110m (dependencies, aggregates) — fixed centroids or skipped.
const EXTRA_CENTROIDS = { '0': null, '490': { lon: 121.0, lat: 23.7, name: 'Other Asia, nes (Taiwan)' }, '344': { lon: 114.17, lat: 22.32, name: 'Hong Kong' }, '702': { lon: 103.82, lat: 1.35, name: 'Singapore' }, '446': { lon: 113.55, lat: 22.2, name: 'Macao' }, '48': { lon: 50.55, lat: 26.07, name: 'Bahrain' }, '470': { lon: 14.38, lat: 35.9, name: 'Malta' }, '480': { lon: 57.55, lat: -20.3, name: 'Mauritius' }, '52': { lon: -59.55, lat: 13.19, name: 'Barbados' }, '899': null, '97': { lon: 9.0, lat: 50.0, name: 'EU-27' } };

const M49_NAME = { 152: 'Chile', 604: 'Peru', 360: 'Indonesia', 156: 'China', 180: 'DR Congo', 246: 'Finland', 608: 'Philippines', 752: 'Sweden', 410: 'Rep. of Korea', 392: 'Japan', 724: 'Spain', 276: 'Germany', 356: 'India', 76: 'Brazil', 124: 'Canada', 840: 'USA' };

async function comtradeFlows(centroids) {
  const vintages = JSON.parse(await readFile(path.join(SRC, 'src/data/economy/snapshots/comtrade-flow-vintages.json'), 'utf8'));
  const rows = [];
  for (const [key, res] of Object.entries(vintages.responses ?? {})) {
    const [reporter, cmd, flow, year] = key.split('-');
    for (const r of res.data ?? []) {
      const s = centroids.get(String(r.reporterCode)) ?? EXTRA_CENTROIDS[String(r.reporterCode)];
      const t = centroids.get(String(r.partnerCode)) ?? EXTRA_CENTROIDS[String(r.partnerCode)];
      if (!s || !t) continue;
      const value = Number(r.primaryValue ?? r.fobvalue ?? r.cifvalue ?? 0);
      const weight = Number(r.netWgt ?? 0);
      rows.push({
        request_key: key, reporter: r.reporterDesc ?? M49_NAME[r.reporterCode] ?? s.name, partner: r.partnerDesc ?? M49_NAME[r.partnerCode] ?? t.name,
        reporter_code: r.reporterCode, partner_code: r.partnerCode, commodity_hs: String(r.cmdCode ?? cmd), flow: r.flowCode ?? flow, year: Number(r.refYear ?? year),
        value_usd: value, net_weight_kg: weight, value_musd: Math.round(value / 1e4) / 100,
        // Comtrade revises in place, so the capture date IS the knowledge time: this row
        // is what the reporter said on that day about that reporting year, and no later
        // retrieval can reconstruct it.
        ...rowProvenance({
          source: `UN Comtrade capture ${vintages.capturedAt} (Payload Terminal snapshot comtrade-flow-vintages.json)`,
          knownAt: vintages.capturedAt,
          validFrom: `${Number(r.refYear ?? year)}-01-01`,
          validTo: `${Number(r.refYear ?? year)}-12-31`,
        }),
        source_lat: s.lat, source_lng: s.lon, target_lat: t.lat, target_lng: t.lon,
      });
    }
  }
  rows.sort((a, b) => b.value_usd - a.value_usd);
  return rows;
}

async function archiveCoverage(centroids) {
  const manifest = JSON.parse(await readFile(path.join(SRC, 'data-archive/MANIFEST.json'), 'utf8'));
  const byReporter = new Map();
  for (const f of manifest.files ?? []) {
    const m = /comtrade\/(\d{4}-\d{2}-\d{2})\/(\d+)-(\d+)-([A-Z])-(\d{4})(?:-\d+)?\.json$/.exec(f.path);
    if (!m) continue;
    const [, captured, reporter, cmd, flow, year] = m;
    const c = centroids.get(String(Number(reporter))) ?? EXTRA_CENTROIDS[String(Number(reporter))];
    if (!c) continue;
    const cur = byReporter.get(reporter) ?? { reporter_code: Number(reporter), reporter: M49_NAME[Number(reporter)] ?? c.name, latitude: c.lat, longitude: c.lon, captures: 0, unreconstructable: 0, commodities: new Set(), flows: new Set(), years: new Set(), first_capture: captured, last_capture: captured, bytes: 0, digests: 0 };
    cur.captures += 1; cur.bytes += f.bytes ?? 0;
    if (typeof f.sha256 === 'string' && /^[a-f0-9]{64}$/.test(f.sha256)) cur.digests += 1;
    if (f.class === 'unreconstructable') cur.unreconstructable += 1;
    cur.commodities.add(cmd); cur.flows.add(flow); cur.years.add(year);
    if (captured < cur.first_capture) cur.first_capture = captured;
    if (captured > cur.last_capture) cur.last_capture = captured;
    byReporter.set(reporter, cur);
  }
  // first_capture/last_capture were a private spelling of knowledge time; keep them as
  // the human-readable span and state the same fact in the shape every layer uses.
  return [...byReporter.values()].map((r) => ({
    ...r,
    commodities: [...r.commodities].sort().join(' '),
    flows: [...r.flows].sort().join(' '),
    years: [...r.years].sort().join(' '),
    ...rowProvenance({
      // What this extractor actually did: read the manifest's index. It does not open a
      // capture and it does not recompute a digest, so it may not say "sha256-verified"
      // — a provenance string that claims a verification nobody performed is the same
      // fabrication the estate refuses in its values, committed in the field that exists
      // to prevent it. `verify.mjs` in the archive repository is what checks the digests.
      source: `Payload Terminal data-archive/MANIFEST.json (index read, ${r.digests} of ${r.captures} entries carry a sha256; digests not recomputed here)`,
      knownAt: r.last_capture,
      validFrom: [...r.years].sort()[0] ? `${[...r.years].sort()[0]}-01-01` : undefined,
      validTo: [...r.years].sort().at(-1) ? `${[...r.years].sort().at(-1)}-12-31` : undefined,
    }),
  }));
}

function simplify(coords, max = 10) {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]);
}

async function submarineCables() {
  const gj = JSON.parse(await readFile(path.join(SRC, 'public/data/submarine-cables-filtered.json'), 'utf8'));
  // Keep the long-haul cables (the ones that matter for chokepoints); short landing links are noise at globe scale.
  const features = (gj.features ?? []).filter((f) => (f.properties.length_km ?? 0) >= 1500).sort((a, b) => (b.properties.length_km ?? 0) - (a.properties.length_km ?? 0)).slice(0, 220);
  return features.map((f) => {
    const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    const round = (c) => [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
    const geometry = { type: 'MultiLineString', coordinates: lines.map((l) => simplify(l).map(round)) };
    return { cable_id: f.properties.id, name: f.properties.name, length_km: Math.round(f.properties.length_km ?? 0), ...rowProvenance({ source: 'Payload Terminal public/data/submarine-cables-filtered.json (long-haul subset, simplified)' }), _geojson: JSON.stringify({ type: 'Feature', properties: { name: f.properties.name }, geometry }) };
  });
}

async function nuclearFacilities() {
  const src = await readFile(path.join(SRC, 'src/app/api/infrastructure/route.ts'), 'utf8');
  const rows = [];
  const re = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*city:\s*'([^']*)',\s*country:\s*'([^']+)',\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+),\s*status:\s*'([^']+)'(?:,\s*reactors:\s*(\d+))?(?:,\s*capacity(?:MW)?:\s*([\d.]+))?/g;
  let m;
  while ((m = re.exec(src))) rows.push({ facility_id: m[1], name: m[2], city: m[3], country: m[4], latitude: Number(m[5]), longitude: Number(m[6]), status: m[7], reactors: m[8] ? Number(m[8]) : null, capacity_mw: m[9] ? Number(m[9]) : null, ...rowProvenance({ source: 'Payload Terminal src/app/api/infrastructure/route.ts (curated list)' }) });
  return rows;
}

export async function extractTerminal() {
  const topoPath = EARTH ? path.join(EARTH, 'public/data/countries-110m.json') : path.join(SRC, 'public/data/countries-110m.json');
  const centroids = topojsonCentroids(JSON.parse(await readFile(topoPath, 'utf8')));
  const layers = {
    'comtrade-flows': await comtradeFlows(centroids),
    'archive-coverage': await archiveCoverage(centroids),
    'submarine-cables': await submarineCables(),
    'nuclear-facilities': await nuclearFacilities(),
  };
  return layers;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(OUT, { recursive: true });
  const layers = await extractTerminal();
  for (const [id, rows] of Object.entries(layers)) {
    const file = path.join(OUT, `${id}.json`);
    await writeFile(file, JSON.stringify(rows));
    console.log(`${id}: ${rows.length} rows -> ${path.relative(process.cwd(), file)} (${Math.round((await readFile(file)).length / 1024)} KB)`);
  }
}
