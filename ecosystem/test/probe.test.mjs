import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ControlPlane } from '../../control-plane/src/control-plane.js';
import { loadCatalog } from '../validate.mjs';
import { seed } from '../seed.mjs';
import { MAX_HEALTH_BYTES, TARGETS, configuredBase, evaluatePayloadHealth, probeTarget, recordObservations } from '../payload/probe.mjs';

const NOW = '2026-09-03T00:00:00.000Z';
const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

test('Payload health verdicts distinguish healthy, warming and failing states', () => {
  assert.equal(evaluatePayloadHealth(200, { status: 'operational', build: { version: 'v0.9' } }).health, 'healthy');
  assert.equal(evaluatePayloadHealth(200, { status: 'operational', warm: false }).health, 'degraded');
  assert.equal(evaluatePayloadHealth(200, { status: 'operational', guards: { lapsed: ['copper-scope'] } }).health, 'degraded');
  assert.equal(evaluatePayloadHealth(503, {}).health, 'offline');
  assert.equal(evaluatePayloadHealth(429, {}).health, 'degraded');
});

test('probeTarget reports unreachable hosts as offline without throwing', async () => {
  const target = TARGETS.find((t) => t.nodeId === 'payload-terminal');
  const o = await probeTarget(target, 'http://127.0.0.1:1', () => Promise.reject(new Error('ECONNREFUSED')));
  assert.equal(o.health, 'offline');
  assert.match(o.detail, /unreachable/);
  const ok = await probeTarget(target, 'https://payload.local', () => json(200, { status: 'operational' }));
  assert.equal(ok.health, 'healthy');
  assert.match(ok.detail, /status=operational/);
});

test('the probe holds its origin to the adapter\'s rules: HTTPS outside loopback, a bare origin, no redirects, a bounded body', async () => {
  assert.equal(configuredBase('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  assert.equal(configuredBase('https://payload.example'), 'https://payload.example');
  assert.throws(() => configuredBase('http://payload.example'), /HTTPS outside loopback/);
  // secret-scan:allow a deliberately fake credential in a URL the probe must refuse
  assert.throws(() => configuredBase('https://user:secret@payload.example'), /bare origin/);
  assert.throws(() => configuredBase('https://payload.example/?probe=1'), /bare origin/);
  assert.throws(() => configuredBase('not a url'), /absolute URL/);
  // A misconfigured origin is thrown, never recorded as the target being offline.
  const target = TARGETS.find((t) => t.nodeId === 'payload-terminal');
  await assert.rejects(probeTarget(target, 'http://payload.example', () => json(200, {})), /HTTPS/);
  // Redirects are not followed, and the fetch is told so.
  let init = null;
  await probeTarget(target, 'https://payload.example', (_url, options) => { init = options; return json(200, { status: 'operational' }); });
  assert.equal(init.redirect, 'error');
  // A body past the cap is not parsed and not forwarded; the verdict says it was ignored.
  const huge = await probeTarget(target, 'https://payload.example', () => Promise.resolve(new Response('x'.repeat(MAX_HEALTH_BYTES + 1), { status: 200 })));
  assert.match(huge.detail, /exceeded 64 KiB/);
  assert.equal(huge.detail.length <= 600, true);
});

test('observations land in the journal and derive node health in the snapshot', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notations-probe-test-'));
  try {
    const plane = ControlPlane.fromPath(path.join(dir, 'journal.jsonl'), () => NOW);
    await seed(plane, await loadCatalog(), { now: () => NOW });
    const results = await recordObservations(plane, [
      { nodeId: 'payload-terminal', health: 'degraded', detail: 'state warming', observedAt: NOW },
      { nodeId: 'not-a-node', health: 'healthy', detail: 'ignored', observedAt: NOW },
    ], { now: () => NOW });
    assert.equal(results.length, 1);
    assert.equal(results[0].outcome, 'appended');
    const snapshot = await plane.snapshot();
    const node = snapshot.nodes.find((n) => n.nodeId === 'payload-terminal');
    assert.equal(node.health, 'degraded');
    assert.equal(node.lastObservation.source, 'health_check');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
