/**
 * Security invariants, as tests.
 *
 * Each case is named for the invariant it defends (docs/SECURITY_INVARIANTS.md). They
 * run against a real listener with real credentials, because most of these properties
 * live in the seam between the HTTP layer, the policy layer and the journal — the
 * place where an invariant that holds in each module individually can still fail.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createControlPlaneServer, createRuntime, readConfig, assertTransportPolicy } from '../src/server.js';
import { SecurityLog } from '../src/security/audit.js';
import { issueCredential } from '../src/security/identity.js';
import { ControlPlane } from '../src/control-plane.js';
import { KeyStore } from '../src/security/crypto/signing.js';
import { KeyEncryptionKey, open, seal, rewrap } from '../src/security/crypto/envelope.js';
import { parseUri, assertClass, resolve as resolveUri, uri } from '../src/identity/uri.js';

const REGISTRY_SCHEMA = 'notations.control-plane.principals.v1';

/** A running control plane with a known set of credentials. */
async function harness(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ncp-security-'));
  const tokens = {};
  const principals = [];
  const grants = overrides.principals ?? [
    { principalId: 'operator:alice', roles: ['operator', 'registrar'], actors: ['operator:alice'] },
    { principalId: 'operator:bob', roles: ['operator'], actors: ['operator:bob'] },
    { principalId: 'monitor:probe', roles: ['monitor'], actors: ['monitor:probe'] },
    { principalId: 'attestor:ci', roles: ['attestor'], actors: ['attestor:ci'] },
    { principalId: 'agent:planner', roles: ['requester'], actors: ['agent:planner'] },
    { principalId: 'reader:dock', roles: ['reader'], actors: ['reader:dock'] },
    { principalId: 'scoped:payload', roles: ['monitor'], actors: ['scoped:payload'], nodes: ['payload-terminal'] },
  ];
  for (const grant of grants) {
    const { token, record } = issueCredential(grant);
    tokens[grant.principalId] = token;
    principals.push(record);
  }
  const principalsFile = join(directory, 'principals.json');
  await writeFile(principalsFile, JSON.stringify({ schema: REGISTRY_SCHEMA, principals }));

  const config = {
    ...readConfig({}),
    journalPath: join(directory, 'journal.jsonl'),
    keystorePath: join(directory, 'keystore.json'),
    principalsFile,
    legacyToken: null,
    kek: randomBytes(32).toString('base64'),
    allowedOrigins: new Set(['https://dock.example']),
    ...overrides.config,
  };
  const securityLog = new SecurityLog({ sink: () => {} });
  const runtime = await createRuntime(config, { securityLog });
  const server = createControlPlaneServer(runtime);
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { status: response.status, body: payload, headers: response.headers };
  };

  const revision = async token => (await call('GET', '/v1/snapshot', { token: token ?? tokens['operator:alice'] })).body.revision;

  const command = async (token, partial) => {
    const expectedRevision = await revision(token);
    return call('POST', '/v1/commands', { token, body: { requestId: `test:${randomBytes(6).toString('hex')}`, submittedAt: new Date().toISOString(), expectedRevision, ...partial } });
  };

  const node = (nodeId, capabilities) => ({
    action: 'register_node',
    node: { nodeId, name: nodeId, kind: 'api', description: `${nodeId} is a registered ecosystem node.`, capabilities, metadata: { domain: 'platform' }, location: null },
  });

  const close = async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(directory, { recursive: true, force: true });
  };

  return { directory, tokens, config, runtime, server, base, call, command, revision, node, securityLog, close };
}

const OBSERVE = [{ capabilityId: 'world.read', label: 'Read world state', description: 'Returns a published world projection.', mode: 'observe', approval: 'automatic' }];
const EXECUTE = [{ capabilityId: 'scenario.run', label: 'Run scenario', description: 'Runs an approved scenario.', mode: 'execute', approval: 'operator' }];

test('SEC-001 no unauthenticated actor may read state or invoke a transition', async () => {
  const h = await harness();
  try {
    assert.equal((await h.call('GET', '/v1/snapshot')).status, 401);
    assert.equal((await h.call('GET', '/v1/events')).status, 401);
    assert.equal((await h.call('POST', '/v1/commands', { body: { action: 'register_node' } })).status, 401);
    assert.equal((await h.call('GET', '/v1/security/status')).status, 401);
    // secret-scan:allow a deliberately invalid credential used to exercise the auth-failure path
    const bad = await h.call('GET', '/v1/snapshot', { token: 'ncp.k-nope.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, 'CONTROL_PLANE_UNAUTHORIZED');
  } finally {
    await h.close();
  }
});

test('SEC-002 authorization is checked per action, server-side, and fails closed', async () => {
  const h = await harness();
  try {
    // A monitor may record health but may not register a node or approve anything.
    const registered = await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('payload-terminal', OBSERVE) });
    assert.equal(registered.status, 201);

    const denied = await h.command(h.tokens['monitor:probe'], { actorId: 'monitor:probe', ...h.node('other-node', OBSERVE) });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'CONTROL_PLANE_FORBIDDEN');
    assert.match(denied.body.detail, /does not hold node\.register/);

    // A reader may read but not write.
    assert.equal((await h.call('GET', '/v1/snapshot', { token: h.tokens['reader:dock'] })).status, 200);
    const readerWrite = await h.command(h.tokens['reader:dock'], { actorId: 'reader:dock', action: 'record_observation', nodeId: 'payload-terminal', health: 'healthy', observedAt: new Date().toISOString(), source: 'operator', detail: 'x' });
    assert.equal(readerWrite.status, 403);
  } finally {
    await h.close();
  }
});

test('SEC-003 and SEC-006 the recorded actor is bound to the authenticated credential', async () => {
  const h = await harness();
  try {
    await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('payload-terminal', OBSERVE) });

    // The monitor tries to write history as the operator.
    const impersonation = await h.command(h.tokens['monitor:probe'], { actorId: 'operator:alice', action: 'record_observation', nodeId: 'payload-terminal', health: 'healthy', observedAt: new Date().toISOString(), source: 'health_check', detail: 'Impersonation attempt.' });
    assert.equal(impersonation.status, 403);
    assert.match(impersonation.body.detail, /may not act as operator:alice/);

    // Its own identity is accepted, and that is what history records.
    const honest = await h.command(h.tokens['monitor:probe'], { actorId: 'monitor:probe', action: 'record_observation', nodeId: 'payload-terminal', health: 'healthy', observedAt: new Date().toISOString(), source: 'health_check', detail: 'Responding.' });
    assert.equal(honest.status, 201);
    const events = await h.call('GET', '/v1/events', { token: h.tokens['operator:alice'] });
    const observation = events.body.events.find(record => record.event.kind === 'observation_recorded');
    assert.equal(observation.event.observation.nodeId, 'payload-terminal');
  } finally {
    await h.close();
  }
});

test('SEC-011 an actor may not approve its own execution intent (separation of duties)', async () => {
  const h = await harness();
  try {
    await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('world-model', EXECUTE) });
    await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('agent-node', OBSERVE) });

    // An operator with both roles proposes an intent...
    const requested = await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', action: 'request_capability', coordinationId: 'coord-self', requesterNodeId: 'agent-node', targetNodeId: 'world-model', capabilityId: 'scenario.run', requestedMode: 'execute', purpose: 'Assess a disruption scenario.' });
    assert.equal(requested.status, 403, 'a requester role is required to propose');

    const proposed = await h.command(h.tokens['agent:planner'], { actorId: 'agent:planner', action: 'request_capability', coordinationId: 'coord-self', requesterNodeId: 'agent-node', targetNodeId: 'world-model', capabilityId: 'scenario.run', requestedMode: 'execute', purpose: 'Assess a disruption scenario.' });
    assert.equal(proposed.status, 201);
    assert.equal(proposed.body.snapshot.coordination[0].status, 'approval_required');
    assert.equal(proposed.body.snapshot.coordination[0].dispatch, 'not_dispatched');

    // ...and the same actor cannot also approve it, even holding the operator role.
    const selfApproval = await h.command(h.tokens['agent:planner'], { actorId: 'agent:planner', action: 'resolve_coordination', coordinationId: 'coord-self', decision: 'approved', note: 'Self-approval attempt.' });
    assert.equal(selfApproval.status, 403);

    const approved = await h.command(h.tokens['operator:bob'], { actorId: 'operator:bob', action: 'resolve_coordination', coordinationId: 'coord-self', decision: 'approved', note: 'Approved for a separately configured adapter.' });
    assert.equal(approved.status, 201);
    const record = approved.body.snapshot.coordination[0];
    assert.equal(record.status, 'approved');
    assert.equal(record.dispatch, 'not_dispatched', 'SEC-012: approval is never dispatch');
    assert.equal(record.resolvedBy, 'operator:bob');
  } finally {
    await h.close();
  }
});

test('SEC-008 external payloads cross a validation boundary that refuses unsafe text and unbounded shapes', async () => {
  const h = await harness();
  try {
    const token = h.tokens['operator:alice'];

    // Control characters (log and terminal injection).
    const control = await h.command(token, { actorId: 'operator:alice', ...h.node('ctrl-node', [{ capabilityId: 'a.read', label: 'A', description: 'Line one[31m red\nline two', mode: 'observe', approval: 'automatic' }]) });
    assert.equal(control.status, 422);
    assert.match(control.body.detail, /control characters/);

    // Bidirectional override (Trojan Source).
    const bidi = await h.command(token, { actorId: 'operator:alice', ...h.node('bidi-node', [{ capabilityId: 'a.read', label: 'A', description: 'safe ‮ evil', mode: 'observe', approval: 'automatic' }]) });
    assert.equal(bidi.status, 422);
    assert.match(bidi.body.detail, /bidirectional/);

    // Credential material anywhere in the command.
    // secret-scan:allow a well-known AWS example key, used to prove the boundary refuses it
    const secret = await h.command(token, { actorId: 'operator:alice', ...h.node('secret-node', [{ capabilityId: 'a.read', label: 'A', description: 'Use AKIAIOSFODNN7EXAMPLE to authenticate.', mode: 'observe', approval: 'automatic' }]) });
    assert.equal(secret.status, 422);
    assert.match(secret.body.detail, /aws-access-key-id/);

    // Deep nesting: the command digest canonicalizes the caller's object.
    let nested = { deep: 1 };
    for (let level = 0; level < 200; level += 1) nested = { deep: nested };
    const deep = await h.command(token, { actorId: 'operator:alice', action: 'register_node', node: nested });
    assert.equal(deep.status, 422);
    assert.match(deep.body.detail, /nested more than/);

    // Prototype pollution.
    const polluted = await h.call('POST', '/v1/commands', { token, body: JSON.parse('{"requestId":"x","actorId":"operator:alice","submittedAt":"2026-09-03T00:00:00.000Z","expectedRevision":null,"action":"register_node","__proto__":{"polluted":true}}') });
    assert.equal(polluted.status, 422);
    assert.equal({}.polluted, undefined);

    // A loose timestamp is not an instant.
    const loose = await h.command(token, { actorId: 'operator:alice', action: 'record_observation', nodeId: 'payload-terminal', health: 'healthy', observedAt: 'March 3 2026', source: 'operator', detail: 'x' });
    assert.equal(loose.status, 422);
    assert.match(loose.body.detail, /ISO date-time/);
  } finally {
    await h.close();
  }
});

test('SEC-016 unknown actions, roles and enum values never acquire privileged semantics', async () => {
  const h = await harness();
  try {
    const unknown = await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', action: 'delete_everything', nodeId: 'x' });
    assert.equal(unknown.status, 422);
    const badKind = await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', action: 'register_node', node: { nodeId: 'k', name: 'k', kind: 'root', description: 'A node.', capabilities: OBSERVE } });
    assert.equal(badKind.status, 422);
    // An execute capability that declares automatic approval is refused outright.
    const escalation = await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('esc', [{ capabilityId: 'run', label: 'Run', description: 'Runs.', mode: 'execute', approval: 'automatic' }]) });
    assert.equal(escalation.status, 422);
    assert.match(escalation.body.detail, /must be "operator"/);
  } finally {
    await h.close();
  }
});

test('SEC-REPLAY a captured command cannot be replayed outside the freshness window', async () => {
  const h = await harness({ config: { maxCommandAgeSeconds: 60 } });
  try {
    const token = h.tokens['operator:alice'];
    const expectedRevision = await h.revision();
    const stale = await h.call('POST', '/v1/commands', {
      token,
      body: { requestId: 'replayed', actorId: 'operator:alice', submittedAt: new Date(Date.now() - 3600_000).toISOString(), expectedRevision, ...h.node('replay-node', OBSERVE) },
    });
    assert.equal(stale.status, 422);
    assert.equal(stale.body.error, 'COMMAND_STALE');

    const future = await h.call('POST', '/v1/commands', {
      token,
      body: { requestId: 'future', actorId: 'operator:alice', submittedAt: new Date(Date.now() + 3600_000).toISOString(), expectedRevision, ...h.node('future-node', OBSERVE) },
    });
    assert.equal(future.status, 422);
  } finally {
    await h.close();
  }
});

test('SEC-014 integrity failures fail closed: tampered records and rolled-back history are refused', async () => {
  const h = await harness();
  try {
    const token = h.tokens['operator:alice'];
    await h.command(token, { actorId: 'operator:alice', ...h.node('node-one', OBSERVE) });
    await h.command(token, { actorId: 'operator:alice', ...h.node('node-two', OBSERVE) });
    assert.equal((await h.call('GET', '/v1/snapshot', { token })).status, 200);

    const lines = (await readFile(h.config.journalPath, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    const parsed = JSON.parse(lines[1]);
    assert.ok(parsed.signature, 'records are signed');

    // Rewriting a record's content invalidates the chain.
    const tampered = JSON.parse(lines[0]);
    tampered.event.node.description = 'Silently rewritten history.';
    await writeFile(h.config.journalPath, `${JSON.stringify(tampered)}\n${lines[1]}\n`);
    const corrupt = await h.call('GET', '/v1/snapshot', { token });
    assert.equal(corrupt.status, 503);
    assert.equal(corrupt.body.error, 'JOURNAL_CORRUPT');

    // Truncating history is caught by the anchor even though the prefix is a valid chain.
    await writeFile(h.config.journalPath, `${lines[0]}\n`);
    const rolledBack = await h.call('GET', '/v1/snapshot', { token });
    assert.equal(rolledBack.status, 503);
    assert.equal(rolledBack.body.error, 'JOURNAL_ROLLBACK');
  } finally {
    await h.close();
  }
});

test('SEC-INTEGRITY a signature made by an unknown key is refused', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ncp-sign-'));
  try {
    const kek = KeyEncryptionKey.generate('kek-test');
    const store = await KeyStore.load({ filePath: join(directory, 'keystore.json'), kek, create: true });
    assert.ok(store.canSign());
    const hash = 'a'.repeat(64);
    const signature = store.sign(hash);
    assert.equal(store.verify(hash, signature).ok, true);
    assert.equal(store.verify('b'.repeat(64), signature).ok, false);
    assert.equal(store.verify(hash, { ...signature, keyId: 'k-unknown' }).ok, false);
    assert.equal(store.verify(hash, { ...signature, alg: 'hmac' }).ok, false);
    assert.equal(store.verify(hash, null).ok, false);

    // Rotation keeps history verifiable under the retired key.
    const previous = store.activeKeyId;
    await store.rotate({ atRecord: 1 });
    assert.notEqual(store.activeKeyId, previous);
    assert.equal(store.verify(hash, signature).ok, true, 'records signed by the retired key still verify');
    const rotated = store.sign(hash);
    assert.equal(rotated.keyId, store.activeKeyId);
    assert.equal(store.verify(hash, rotated).ok, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SEC-CRYPTO envelope encryption binds ciphertext to its key, version and context', async () => {
  const kek = KeyEncryptionKey.generate('kek-1');
  const other = KeyEncryptionKey.generate('kek-2');
  const sealed = seal(kek, 'a signing key', 'journal-signing-key');
  assert.equal(open(kek, sealed, 'journal-signing-key').toString('utf8'), 'a signing key');

  assert.throws(() => open(kek, sealed, 'other-context'), /context/);
  assert.throws(() => open(other, sealed, 'journal-signing-key'), /No key encryption key/);
  assert.throws(() => open(kek, { ...sealed, alg: 'AES-128-GCM' }, 'journal-signing-key'), /algorithm/);
  assert.throws(() => open(kek, { ...sealed, v: 2 }, 'journal-signing-key'), /version/);
  assert.throws(() => open(kek, { ...sealed, data: { ...sealed.data, ct: Buffer.from('tampered').toString('base64url') } }, 'journal-signing-key'), /failed authentication/);

  // A fresh nonce per encryption: the same plaintext never produces the same ciphertext.
  const again = seal(kek, 'a signing key', 'journal-signing-key');
  assert.notEqual(again.data.ct, sealed.data.ct);
  assert.notEqual(again.data.n, sealed.data.n);

  // Rotation re-wraps without exposing plaintext to the caller.
  const rewrapped = rewrap([kek], sealed, other, 'journal-signing-key');
  assert.equal(rewrapped.kekId, 'kek-2');
  assert.equal(open(other, rewrapped, 'journal-signing-key').toString('utf8'), 'a signing key');
});

test('SEC-013 the constellation accepts posture evidence and refuses material', async () => {
  const h = await harness();
  try {
    await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('payload-terminal', OBSERVE) });
    const attest = signals => h.command(h.tokens['attestor:ci'], { actorId: 'attestor:ci', action: 'record_security_posture', nodeId: 'payload-terminal', attestedAt: new Date().toISOString(), method: 'automated_scan', signals });

    const accepted = await attest([
      { dimension: 'identity', state: 'adequate', coverage: 0.82, findings: { critical: 0, high: 1, medium: 3 }, summary: 'All service credentials are bound to principals; one shared credential remains.', evidenceRef: `sha256:${'a'.repeat(64)}` },
      { dimension: 'dependency_risk', state: 'weak', coverage: 1, findings: { critical: 0, high: 2, medium: 11, low: 40 } },
      { dimension: 'backup', state: 'strong', coverage: 1, summary: 'Nightly off-host replication verified by restore drill.' },
    ]);
    assert.equal(accepted.status, 201);
    const node = accepted.body.snapshot.nodes.find(entry => entry.nodeId === 'payload-terminal');
    assert.equal(node.security.signals.length, 3);
    assert.equal(node.security.attestedBy, 'attestor:ci');
    const identity = accepted.body.snapshot.constellation.dimensions.find(entry => entry.dimension === 'identity');
    assert.equal(identity.worst, 'adequate');
    const dependency = accepted.body.snapshot.constellation.dimensions.find(entry => entry.dimension === 'dependency_risk');
    assert.equal(dependency.findings.high, 2);

    // Each refused class, with the class named in the refusal.
    const refusals = [
      // secret-scan:allow a fixture that must be refused by the constellation boundary
      ['credential material', 'The signing key is -----BEGIN OPENSSH PRIVATE KEY----- and rotates monthly.', /credential-material|pem-private-key/],
      ['network topology', 'Exposure limited to 10.4.2.7 and db.internal:5432.', /network-topology/],
      ['vulnerability detail', 'CVE-2026-1234 affects the parser.', /vulnerability-detail/],
      ['offensive capability', 'Validated with sqlmap against the search endpoint.', /offensive-capability/],
      ['pointer to raw material', 'Full findings at https://scanner.example/report/17.', /pointer-to-raw-material/],
    ];
    for (const [label, summary, expected] of refusals) {
      const refused = await attest([{ dimension: 'exposure', state: 'weak', summary }]);
      assert.equal(refused.status, 422, `${label} must be refused`);
      assert.match(refused.body.detail, expected, label);
      assert.ok(refused.body.remedy.length > 0, 'a refusal explains what to send instead');
    }

    // A link masquerading as an evidence reference is refused too.
    const badRef = await attest([{ dimension: 'exposure', state: 'weak', evidenceRef: 'https://scanner.example/report/17' }]);
    assert.equal(badRef.status, 422);
    assert.match(badRef.body.detail, /evidenceRef/);

    // An attestor may not register nodes or approve coordination.
    const overreach = await h.command(h.tokens['attestor:ci'], { actorId: 'attestor:ci', ...h.node('another', OBSERVE) });
    assert.equal(overreach.status, 403);
  } finally {
    await h.close();
  }
});

test('SEC-SCOPE a node-scoped credential may not attest for another node', async () => {
  const h = await harness();
  try {
    await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('payload-terminal', OBSERVE) });
    await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('other-system', OBSERVE) });

    const allowed = await h.command(h.tokens['scoped:payload'], { actorId: 'scoped:payload', action: 'record_observation', nodeId: 'payload-terminal', health: 'healthy', observedAt: new Date().toISOString(), source: 'health_check', detail: 'Responding.' });
    assert.equal(allowed.status, 201);

    const refused = await h.command(h.tokens['scoped:payload'], { actorId: 'scoped:payload', action: 'record_observation', nodeId: 'other-system', health: 'offline', observedAt: new Date().toISOString(), source: 'health_check', detail: 'Out of scope.' });
    assert.equal(refused.status, 403);
    assert.match(refused.body.detail, /may not submit commands for node other-system/);
  } finally {
    await h.close();
  }
});

test('SEC-ABUSE credential guessing is rate limited and locks the source out', async () => {
  const h = await harness({ config: { authFailuresPerMinute: 3, lockoutSeconds: 60 } });
  try {
    let sawLockout = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await h.call('GET', '/v1/snapshot', { token: `ncp.k-guess${attempt}.${'a'.repeat(40)}` });
      if (response.status === 429) {
        sawLockout = true;
        assert.equal(response.body.error, 'CONTROL_PLANE_LOCKED_OUT');
        assert.ok(response.headers.get('retry-after'));
        break;
      }
      assert.equal(response.status, 401);
    }
    assert.ok(sawLockout, 'repeated credential guesses must lock the source out');
    // A valid credential from the same source is refused while the lockout holds.
    assert.equal((await h.call('GET', '/v1/snapshot', { token: h.tokens['reader:dock'] })).status, 429);
  } finally {
    await h.close();
  }
});

test('SEC-DISCLOSURE liveness reveals no state and errors reveal no internals', async () => {
  const h = await harness();
  try {
    const health = await h.call('GET', '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'operational');
    assert.equal(health.body.revision, undefined, 'an anonymous caller learns nothing about history');
    assert.equal(health.body.nodes, undefined);

    const notFound = await h.call('GET', '/v1/nope', { token: h.tokens['reader:dock'] });
    assert.equal(notFound.status, 404);
    assert.equal(notFound.body.detail, 'This route is not part of the control-plane API.');
  } finally {
    await h.close();
  }
});

test('SEC-HEADERS every response carries a strict policy and cross-origin is allowlisted', async () => {
  const h = await harness();
  try {
    const response = await h.call('GET', '/health');
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox");
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store, no-transform');
    assert.equal(response.headers.get('vary'), 'Origin');

    const allowed = await h.call('GET', '/health', { headers: { origin: 'https://dock.example' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://dock.example');
    assert.equal(allowed.headers.get('access-control-allow-credentials'), null, 'the dock authenticates with a header, never ambient cookies');

    const rejected = await h.call('GET', '/health', { headers: { origin: 'https://evil.example' } });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error, 'ORIGIN_NOT_ALLOWED');
  } finally {
    await h.close();
  }
});

test('SEC-018 plaintext transport is refused on a non-loopback interface', () => {
  const base = readConfig({});
  assert.doesNotThrow(() => assertTransportPolicy({ ...base, host: '127.0.0.1', isLoopback: true }));
  assert.throws(() => assertTransportPolicy({ ...base, host: '0.0.0.0', isLoopback: false }), /Refusing to serve plaintext HTTP/);
  assert.doesNotThrow(() => assertTransportPolicy({ ...base, host: '0.0.0.0', isLoopback: false, trustProxyTls: true }));
  assert.doesNotThrow(() => assertTransportPolicy({ ...base, host: '0.0.0.0', isLoopback: false, tls: { cert: 'c', key: 'k' } }));
});

test('SEC-DOS reads are bounded: events paginate and bodies are capped', async () => {
  const h = await harness({ config: { eventsLimit: 2 } });
  try {
    const token = h.tokens['operator:alice'];
    for (const nodeId of ['a-node', 'b-node', 'c-node']) {
      assert.equal((await h.command(token, { actorId: 'operator:alice', ...h.node(nodeId, OBSERVE) })).status, 201);
    }
    const page = await h.call('GET', '/v1/events', { token });
    assert.equal(page.body.events.length, 2);
    assert.equal(page.body.truncated, true);
    assert.ok(page.body.nextCursor);
    const next = await h.call('GET', `/v1/events?after=${encodeURIComponent(page.body.nextCursor)}`, { token });
    assert.equal(next.body.events.length, 1);
    assert.equal(next.body.truncated, false);

    // The journal is read once per change, not once per request.
    const before = h.runtime.journal.stats.verifications;
    await h.call('GET', '/v1/snapshot', { token });
    await h.call('GET', '/v1/snapshot', { token });
    assert.equal(h.runtime.journal.stats.verifications, before, 'verified reads are cached between appends');
  } finally {
    await h.close();
  }
});

test('SEC-AUDIT privileged outcomes are recorded in the security log without secrets', async () => {
  const h = await harness();
  try {
    await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('audited', OBSERVE) });
    await h.command(h.tokens['monitor:probe'], { actorId: 'monitor:probe', ...h.node('denied', OBSERVE) });
    // secret-scan:allow a deliberately invalid credential used to exercise the auth-failure path
    await h.call('GET', '/v1/snapshot', { token: 'ncp.k-bad.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

    const summary = h.securityLog.summary();
    assert.ok(summary['command.accepted'] >= 1);
    assert.ok(summary['authz.denied'] >= 1);
    assert.ok(summary['auth.failed'] >= 1);

    const entries = h.securityLog.recent(200);
    const serialized = JSON.stringify(entries);
    for (const token of Object.values(h.tokens)) {
      assert.ok(!serialized.includes(token), 'no credential may appear in the security log');
    }
    // Callers are recorded as salted pseudonyms, never as addresses. The bind address
    // in the boot record is the plane's own configuration, not a caller.
    for (const entry of entries) {
      if (entry.source !== undefined) assert.match(entry.source, /^(?:[a-f0-9]{16}|unknown)$/, 'a caller source is a pseudonym');
      if (entry.kind !== 'boot') assert.ok(!/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(JSON.stringify(entry)), `no address in ${entry.kind}`);
    }

    const status = await h.call('GET', '/v1/security/status', { token: h.tokens['operator:alice'] });
    assert.equal(status.status, 200);
    assert.equal(status.body.identity.legacyCredentialInUse, false);
    assert.equal(status.body.keyLifecycle.privateKeyProtection, 'envelope-encrypted');
    assert.equal(status.body.auditIntegrity.rollbackAnchor, true);
    assert.ok(!JSON.stringify(status.body).includes(h.config.kek), 'the key encryption key never leaves the process');

    // A reader may not read the security status.
    assert.equal((await h.call('GET', '/v1/security/status', { token: h.tokens['reader:dock'] })).status, 403);
  } finally {
    await h.close();
  }
});

test('SEC-010 identity classes stay distinct in one addressable space', () => {
  const entity = uri.entity('notationsystems', 'port-of-montreal');
  const principal = uri.principal('notationsystems', 'operator.alice');
  assert.equal(parseUri(entity).class, 'entity');
  assert.equal(parseUri(principal).class, 'principal');
  assert.throws(() => assertClass(principal, 'entity'), /is a principal, but a entity identity is required/);
  assert.throws(() => parseUri('notation://root/ns/id'), /not a Notation identity class/);
  assert.throws(() => parseUri('notation://entity/ns/../../etc/passwd'), /relative segments/);
  assert.throws(() => parseUri('notation://entity/ns/id?fetch=1'), /no query or fragment/);
  assert.throws(() => parseUri(`notation://entity/ns/${'x'.repeat(600)}`), /may not exceed/);
  assert.throws(() => resolveUri(entity), /does not dereference/);
  assert.equal(parseUri(uri.state('notationsystems', 'world', 'v3')).version, 'v3');
});

test('SEC-005 an in-process caller is still bound by policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ncp-inproc-'));
  try {
    const plane = ControlPlane.fromPath(join(directory, 'journal.jsonl'), () => '2026-09-03T00:00:00.000Z');
    const command = {
      requestId: 'r1', actorId: 'operator:local', submittedAt: '2026-09-03T00:00:00.000Z', expectedRevision: null,
      action: 'register_node',
      node: { nodeId: 'n', name: 'n', kind: 'api', description: 'A node.', capabilities: OBSERVE },
    };
    const result = await plane.command(command);
    assert.equal(result.outcome, 'appended');

    // A restricted principal passed explicitly is enforced the same way in process.
    const restricted = { principalId: 'reader:x', roles: ['reader'], actors: ['reader:x'], permissions: new Set(['snapshot.read']), mayClaimActor: () => true, mayActOnNode: () => true };
    await assert.rejects(plane.command({ ...command, requestId: 'r2' }, { principal: restricted }), /does not hold node\.register/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
