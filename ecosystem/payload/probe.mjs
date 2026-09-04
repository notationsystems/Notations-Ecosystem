#!/usr/bin/env node
// Payload health-probe adapter: observe Payload's own health surfaces and record them in the control plane.
//   PAYLOAD_URL=http://localhost:3000 node ecosystem/payload/probe.mjs --journal control-plane/data/control-plane.jsonl
//   PAYLOAD_URL=... OSIRIS_INTEL_URL=http://localhost:4000 node ecosystem/payload/probe.mjs --url http://127.0.0.1:8787 --token ...
//   add --loop 60 to keep probing every 60 s.
// The probe never forwards response bodies into the journal: only a health verdict and a ≤600-char detail.
//
// The origin it probes is configuration, never a request parameter, and it is held to the
// same rules the merged plane's in-process adapter held its target to: HTTPS outside
// loopback, no credentials, query or fragment in the URL, no redirects followed, and a
// 64 KiB cap on what is read. The difference is where this runs — outside the plane, which
// fetches nothing (docs/SUBSTRATE.md) — not what it refuses.
import path from 'node:path';
import { HttpControlPlane } from '../../control-plane/src/client.js';
import { OutboundRefusal, checkUrl, outboundFetch } from '../../security/outbound.mjs';
import { fileURLToPath } from 'node:url';

export const MAX_HEALTH_BYTES = 64 * 1024;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The trusted origin a target may be probed at. Refuses anything but a bare origin: a
 * credential in the URL would be sent to whatever answers; a query or fragment is not part
 * of an origin; plaintext to a non-loopback host is a verdict fetched from a network the
 * probe does not control. Thrown, not recorded — a misconfigured probe is not "offline".
 */
export function configuredBase(value, name = 'PAYLOAD_URL') {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`${name} must be an absolute URL: the trusted service origin.`);
  }
  if (url.username || url.password || url.search || url.hash) throw new Error(`${name} must be a bare origin, with no credentials, query or fragment.`);
  if (url.protocol !== 'https:' && !LOOPBACK.has(url.hostname)) throw new Error(`${name} must use HTTPS outside loopback; a health verdict fetched in plaintext from a network the probe does not control is not a verdict.`);
  return url.origin;
}

/**
 * The address check, which the origin check above cannot make.
 *
 * A bare HTTPS origin passes every syntactic rule and can still name the cloud metadata service or
 * an internal host: `https://169.254.169.254` is a well-formed origin. The probe's target is
 * configuration rather than a request parameter, so this is defence in depth rather than the last
 * line — but a probe is exactly the shape an attacker wants when they can influence configuration,
 * and the check costs one resolution. Loopback stays allowed, because probing a service on the same
 * host is the probe's normal local profile.
 */
export async function assertReachable(base, name = 'PAYLOAD_URL') {
  const origin = configuredBase(base, name);
  try {
    await checkUrl(origin, { allowLoopback: true, schemes: ['https:'] });
  } catch (e) {
    if (e instanceof OutboundRefusal) throw new Error(`${name} is refused by the outbound policy: ${e.message} ${e.remedy}`);
    throw e;
  }
  return origin;
}

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

/**
 * The probe's default transport: the outbound policy, which resolves the host, refuses every
 * non-public address, and then pins the connection to the address it verified. A caller may inject
 * a transport instead — the tests do — and that injection is the seam, not a way around the policy.
 */
export async function policyFetch(url, init = {}) {
  const timeoutMs = 5000;
  const r = await outboundFetch(url, { allowLoopback: true, schemes: ['https:'], maxBytes: MAX_HEALTH_BYTES, timeoutMs });
  return { status: r.status, text: async () => r.body };
}

export async function probeTarget(target, base, fetchImpl = policyFetch, timeoutMs = 5000) {
  const url = `${configuredBase(base, target.env)}${target.path}`;
  const started = Date.now();
  try {
    // No redirects: a health route that answers 3xx is a route that has moved, and following
    // it would probe whatever it points at.
    const res = await fetchImpl(url, { headers: { accept: 'application/json', 'x-machine-client': 'notations-control-plane-probe' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    let oversized = false;
    try {
      const text = await res.text();
      if (text.length > MAX_HEALTH_BYTES) oversized = true;
      else body = JSON.parse(text);
    } catch { body = null; }
    const { health, detail } = target.evaluate(res.status, body);
    return { nodeId: target.nodeId, health, detail: `${detail}${oversized ? '; health body exceeded 64 KiB and was ignored' : ''} (${Date.now() - started} ms)`.slice(0, 600), observedAt: new Date().toISOString() };
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const journal = opt('--journal');
  const url = opt('--url');
  const token = opt('--token') ?? process.env.NOTATIONS_CONTROL_PLANE_TOKEN;
  const loop = Number(opt('--loop') ?? 0);
  const actorId = opt('--actor') ?? 'monitor:payload-probe';
  let plane;
  if (journal) { const { ControlPlane } = await import('../../control-plane/src/control-plane.js'); plane = await ControlPlane.fromEnvironment(path.resolve(journal)); }
  else if (url && token) plane = new HttpControlPlane(url, token, { log: (m) => console.error(`  ${m}`) });
  else { console.error('usage: node ecosystem/payload/probe.mjs --journal <path> | --url <base> [--token <token>] [--actor <actorId>] [--loop <seconds>]'); process.exit(2); }
  const configured = TARGETS.filter((t) => process.env[t.env]);
  if (!configured.length) { console.error(`no targets configured; set ${TARGETS.map((t) => t.env).join(' and/or ')}`); process.exit(2); }
  // Refuse a bad origin before the first probe, not as an "offline" observation after it.
  for (const t of configured) {
    configuredBase(process.env[t.env], t.env);
    try {
      await checkUrl(new URL(process.env[t.env]).origin, { allowLoopback: true, schemes: ['https:'] });
    } catch (e) {
      // A host that does not resolve at startup is left to the probe, which records it as offline.
      // An address that resolves into private or link-local space is a configuration the probe
      // refuses to start with, because a probe pointed at the metadata service is not a probe.
      if (e instanceof OutboundRefusal && e.code === 'OUTBOUND_ADDRESS_REFUSED') {
        throw new Error(`${t.env} is refused by the outbound policy: ${e.message} ${e.remedy}`);
      }
    }
  }
  const once = async () => {
    const observations = await Promise.all(configured.map((t) => probeTarget(t, process.env[t.env])));
    await recordObservations(plane, observations, { actorId, log: (l) => console.log(`${new Date().toISOString()} ${l}`) });
  };
  await once();
  if (loop > 0) setInterval(() => { once().catch((e) => console.error('probe failed:', e.message)); }, loop * 1000);
}
