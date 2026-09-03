#!/usr/bin/env node
// Payload health-probe adapter: observe Payload's own health surfaces and record them in the control plane.
//   PAYLOAD_URL=http://localhost:3000 node ecosystem/payload/probe.mjs --journal control-plane/data/control-plane.jsonl
//   PAYLOAD_URL=... OSIRIS_INTEL_URL=http://localhost:4000 node ecosystem/payload/probe.mjs --url http://127.0.0.1:8787 --token ...
//   add --loop 60 to keep probing every 60 s.
// The probe never forwards response bodies into the journal: only a health verdict and a ≤600-char detail.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS = [
  { nodeId: 'payload-terminal', env: 'PAYLOAD_URL', path: '/api/health', evaluate: evaluatePayloadHealth },
  { nodeId: 'osiris-intel', env: 'OSIRIS_INTEL_URL', path: '/health', evaluate: evaluateGenericHealth },
];

/** Payload Terminal /api/health → { health, detail }. Warm state and guard verdicts decide between healthy and degraded. */
export function evaluatePayloadHealth(status, body) {
  if (status >= 500) return { health: 'offline', detail: `Payload /api/health answered ${status}.` };
  if (status >= 400) return { health: 'degraded', detail: `Payload /api/health answered ${status}.` };
  const warm = body?.warm ?? body?.state?.warm ?? body?.seaDogTerminal?.warm;
  const guards = body?.guards ?? body?.seaDogTerminal?.guards;
  const lapsed = Array.isArray(guards?.lapsed) ? guards.lapsed.length : typeof guards?.lapsed === 'number' ? guards.lapsed : 0;
  const version = body?.build?.version ?? body?.version ?? body?.buildVersion;
  const parts = [`status=${body?.status ?? 'unknown'}`];
  if (version) parts.push(`build=${version}`);
  if (warm === false) parts.push('state warming');
  if (lapsed) parts.push(`${lapsed} guard condition(s) lapsed`);
  const health = body?.status !== 'operational' ? 'degraded' : warm === false || lapsed ? 'degraded' : 'healthy';
  return { health, detail: parts.join('; ').slice(0, 600) };
}

export function evaluateGenericHealth(status, body) {
  if (status >= 500) return { health: 'offline', detail: `health endpoint answered ${status}.` };
  if (status >= 400) return { health: 'degraded', detail: `health endpoint answered ${status}.` };
  return { health: 'healthy', detail: `health endpoint answered ${status}${body?.status ? `; status=${body.status}` : ''}.`.slice(0, 600) };
}

export async function probeTarget(target, base, fetchImpl = fetch, timeoutMs = 5000) {
  const url = `${base.replace(/\/$/, '')}${target.path}`;
  const started = Date.now();
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json', 'x-machine-client': 'notations-control-plane-probe' }, signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    const { health, detail } = target.evaluate(res.status, body);
    return { nodeId: target.nodeId, health, detail: `${detail} (${Date.now() - started} ms)`.slice(0, 600), observedAt: new Date().toISOString() };
  } catch (e) {
    return { nodeId: target.nodeId, health: 'offline', detail: `${url} unreachable: ${(e && e.message) || e}`.slice(0, 600), observedAt: new Date().toISOString() };
  }
}

/** Record one observation per configured target. `plane` has snapshot() and command(). */
export async function recordObservations(plane, observations, { actorId = 'monitor:payload-probe', now = () => new Date().toISOString(), log = () => {} } = {}) {
  let snapshot = await plane.snapshot();
  const results = [];
  for (const o of observations) {
    if (!snapshot.nodes.some((n) => n.nodeId === o.nodeId)) { log(`skip ${o.nodeId}: not registered in the control plane`); continue; }
    const cmd = { requestId: `probe:${o.nodeId}:${o.observedAt}`, actorId, submittedAt: now(), expectedRevision: snapshot.revision, action: 'record_observation', nodeId: o.nodeId, health: o.health, observedAt: o.observedAt, source: 'health_check', detail: o.detail };
    const result = await plane.command(cmd);
    snapshot = result.snapshot;
    log(`${result.outcome} ${o.nodeId} ${o.health}: ${o.detail}`);
    results.push({ nodeId: o.nodeId, health: o.health, outcome: result.outcome, revision: snapshot.revision });
  }
  return results;
}

class HttpPlane {
  constructor(base, token) { this.base = base.replace(/\/$/, ''); this.token = token; }
  headers(json = false) { return { authorization: `Bearer ${this.token}`, accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}) }; }
  async snapshot() { const r = await fetch(`${this.base}/v1/snapshot`, { headers: this.headers() }); if (!r.ok) throw new Error(`snapshot ${r.status}: ${await r.text()}`); return r.json(); }
  async command(cmd) { const r = await fetch(`${this.base}/v1/commands`, { method: 'POST', headers: this.headers(true), body: JSON.stringify(cmd) }); if (!r.ok) throw new Error(`command ${cmd.requestId} ${r.status}: ${await r.text()}`); return r.json(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const journal = opt('--journal');
  const url = opt('--url');
  const token = opt('--token') ?? process.env.NOTATIONS_CONTROL_PLANE_TOKEN;
  const loop = Number(opt('--loop') ?? 0);
  let plane;
  if (journal) { const { ControlPlane } = await import('../../control-plane/src/control-plane.js'); plane = ControlPlane.fromPath(path.resolve(journal)); }
  else if (url && token) plane = new HttpPlane(url, token);
  else { console.error('usage: node ecosystem/payload/probe.mjs --journal <path> | --url <base> [--token <token>] [--loop <seconds>]'); process.exit(2); }
  const configured = TARGETS.filter((t) => process.env[t.env]);
  if (!configured.length) { console.error(`no targets configured; set ${TARGETS.map((t) => t.env).join(' and/or ')}`); process.exit(2); }
  const once = async () => {
    const observations = await Promise.all(configured.map((t) => probeTarget(t, process.env[t.env])));
    await recordObservations(plane, observations, { log: (l) => console.log(`${new Date().toISOString()} ${l}`) });
  };
  await once();
  if (loop > 0) setInterval(() => { once().catch((e) => console.error('probe failed:', e.message)); }, loop * 1000);
}
