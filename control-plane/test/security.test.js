/**
 * Security invariants, as tests.
 *
 * Each case is named for the invariant it defends (docs/SECURITY_INVARIANTS.md). They
 * run against a real listener with real credentials, because most of these properties
 * live in the seam between the HTTP layer, the policy layer and the journal — the
 * place where an invariant that holds in each module individually can still fail.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createControlPlaneServer, createRuntime, readConfig, assertTransportPolicy } from '../src/server.js';
import { SecurityLog } from '../src/security/audit.js';
import { issueCredential } from '../src/security/identity.js';
import { ControlPlane, defaultKeystorePath } from '../src/control-plane.js';
import { checkApiZero, observed } from '../src/api/response.js';
import { KeyStore } from '../src/security/crypto/signing.js';
import { KeyEncryptionKey, open, seal, rewrap } from '../src/security/crypto/envelope.js';
import { parseUri, assertClass, isAuthorityIdentity, isInformationIdentity, nodeUri, resolve as resolveUri, uri } from '../src/identity/uri.js';

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

// Fixtures, not the estate. The control plane knows no catalog: `src/` names no node of
// the Notations Universe, and these ids are here because a test needs *a* node id, one of
// them shaped like `payload-*` because a prefix scope has to be tested against something.
// A capability id here is deliberately not one any catalog node declares, so nothing in
// this repository can be read as the plane having an opinion about what Payload can do.
const OBSERVE = [{ capabilityId: 'example.read', label: 'Read a projection', description: 'Returns a published projection.', mode: 'observe', approval: 'automatic' }];
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

test('SEC-030 the constellation accepts posture evidence and refuses material', async () => {
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

test('SEC-ABUSE a legitimate bulk writer backs off rather than defeating the budget', async () => {
  // The command budget is a real control: a client that crashed on 429 would create
  // pressure to raise the limit, which is the wrong direction. It waits instead.
  const { HttpControlPlane, ControlPlaneHttpError } = await import('../src/client.js');
  const responses = [
    new Response(JSON.stringify({ error: 'CONTROL_PLANE_RATE_LIMITED', detail: 'budget spent', retryAfterSeconds: 3 }), { status: 429, headers: { 'retry-after': '3' } }),
    new Response(JSON.stringify({ ok: true }), { status: 201 }),
  ];
  const waited = [];
  // secret-scan:allow a deliberately fake credential in a mocked-transport test
  const plane = new HttpControlPlane('http://127.0.0.1:1', 'ncp.k-x.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
    fetchImpl: async () => responses.shift(),
    sleep: async ms => { waited.push(ms); },
  });
  assert.deepEqual(await plane.command({ requestId: 'bulk' }), { ok: true });
  assert.deepEqual(waited, [3000], 'the client waits exactly the Retry-After the server named');

  // Authorization failures are never retried: the answer will not change.
  // secret-scan:allow a deliberately fake credential in a mocked-transport test
  const denied = new HttpControlPlane('http://127.0.0.1:1', 'ncp.k-x.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
    fetchImpl: async () => new Response(JSON.stringify({ error: 'CONTROL_PLANE_FORBIDDEN', detail: 'no' }), { status: 403 }),
    sleep: async () => { throw new Error('must not sleep on a 403'); },
  });
  await assert.rejects(denied.command({ requestId: 'x' }), error => error instanceof ControlPlaneHttpError && error.status === 403);
});

test('SEC-013 no credential or key material can leave through an API response', async () => {
  const h = await harness();
  try {
    const token = h.tokens['operator:alice'];
    await h.command(token, { actorId: 'operator:alice', ...h.node('payload-terminal', OBSERVE) });
    await h.command(h.tokens['attestor:ci'], { actorId: 'attestor:ci', action: 'record_security_posture', nodeId: 'payload-terminal', attestedAt: new Date().toISOString(), method: 'automated_scan', signals: [{ dimension: 'identity', state: 'strong', coverage: 1, summary: 'All credentials are bound to principals.' }] });

    // Everything an authenticated caller — including an agent's LLM context — can read.
    const surfaces = await Promise.all([
      h.call('GET', '/v1/snapshot', { token }),
      h.call('GET', '/v1/events', { token }),
      h.call('GET', '/v1/security/status', { token }),
      h.call('GET', '/health'),
    ]);

    for (const response of surfaces) {
      const body = JSON.stringify(response.body);
      for (const [name, credential] of Object.entries(h.tokens)) {
        assert.ok(!body.includes(credential), `${name}'s credential must never appear in a response`);
        // Nor the secret half on its own.
        assert.ok(!body.includes(credential.split('.')[2]), `${name}'s secret must never appear in a response`);
      }
      assert.ok(!body.includes(h.config.kek), 'the key encryption key must never appear in a response');
      // No private key material, in any encoding the key store might hold.
      assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(body), 'no private key may appear in a response');
      assert.ok(!/"privateKey"/.test(body), 'no private key field may appear in a response');
      assert.ok(!/"secretHash"/.test(body), 'no credential digest may appear in a response');
    }

    // The security status describes the key lifecycle without exposing the keys.
    const status = surfaces[2].body;
    assert.equal(status.keyLifecycle.privateKeyProtection, 'envelope-encrypted');
    assert.ok(status.keyLifecycle.keys.every(key => typeof key.publicKey === 'string' && key.privateKey === undefined), 'only public halves are described');
  } finally {
    await h.close();
  }
});

test('SEC-SERIALIZATION the plane parses only JSON, and only into a fixed contract', async () => {
  const h = await harness();
  try {
    const token = h.tokens['operator:alice'];
    // A body that is not JSON is refused before anything else looks at it.
    const notJson = await h.call('POST', '/v1/commands', { token, headers: { 'content-type': 'application/json' }, body: undefined });
    assert.equal(notJson.status, 400);
    assert.equal(notJson.body.error, 'COMMAND_NOT_JSON');

    // A body that is JSON but not a command object is refused by shape, not coerced.
    for (const shape of [[], 'a string', 42, true, null]) {
      const response = await h.call('POST', '/v1/commands', { token, body: shape });
      assert.ok(response.status === 400 || response.status === 422, `shape ${JSON.stringify(shape)} must be refused, got ${response.status}`);
    }

    // Unknown fields are refused rather than ignored: nothing enters the journal that
    // the contract does not name.
    const extra = await h.command(token, { actorId: 'operator:alice', ...h.node('extra-node', OBSERVE), unexpected: 'field' });
    assert.equal(extra.status, 422);
    assert.match(extra.body.detail, /not part of the control-plane contract/);
  } finally {
    await h.close();
  }
});

test('SEC-003 actor binding is exact: no prefix pattern may stand in for an identity', async () => {
  const { Principal, validatePrincipalRecord, issueCredential } = await import('../src/security/identity.js');
  const principal = new Principal({ principalId: 'operator:alice', roles: ['operator'], actors: ['operator:alice'] });
  assert.equal(principal.mayClaimActor('operator:alice'), true);
  for (const near of ['operator:alice-evil', 'operator:Alice', 'operator:alic', 'operator:alice.', 'OPERATOR:ALICE']) {
    assert.equal(principal.mayClaimActor(near), false, `${near} must not satisfy an exact binding`);
  }
  // The matcher and the validator must agree: a pattern the matcher would never honour
  // must be refused at configuration time, not silently dropped into a 401 at runtime.
  const { record } = issueCredential({ principalId: 'pre:fix', roles: ['registrar'], actors: ['pre:*'] });
  assert.deepEqual(validatePrincipalRecord(record), ['invalid actor pattern pre:*']);
  // Node scoping is where a prefix is useful, and it is validated.
  const scoped = new Principal({ principalId: 's', roles: ['monitor'], actors: ['s'], nodes: ['payload-*'] });
  assert.equal(scoped.mayActOnNode('payload-terminal'), true);
  assert.equal(scoped.mayActOnNode('osiris-intel'), false);
  const bad = issueCredential({ principalId: 's', roles: ['monitor'], nodes: ['pay load*'] });
  assert.ok(validatePrincipalRecord(bad.record).some(problem => problem.includes('invalid node pattern')));
});

test('SEC-024 a node-scoped credential cannot declare relations for nodes it does not speak for', async () => {
  const h = await harness({
    principals: [
      { principalId: 'operator:alice', roles: ['operator', 'registrar'], actors: ['operator:alice'] },
      { principalId: 'reg:scoped', roles: ['registrar'], actors: ['reg:scoped'], nodes: ['own-node'] },
    ],
  });
  try {
    for (const id of ['own-node', 'other-node']) {
      assert.equal((await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node(id, OBSERVE) })).status, 201);
    }
    // A relation is declared from the source's point of view, so the source is scoped.
    const foreign = await h.command(h.tokens['reg:scoped'], { actorId: 'reg:scoped', action: 'declare_relation', relationId: 'r-foreign', sourceNodeId: 'other-node', targetNodeId: 'own-node', kind: 'depends_on', description: 'A relation from a node I do not speak for.' });
    assert.equal(foreign.status, 403);
    assert.match(foreign.body.detail, /may not submit commands for node other-node/);

    const own = await h.command(h.tokens['reg:scoped'], { actorId: 'reg:scoped', action: 'declare_relation', relationId: 'r-own', sourceNodeId: 'own-node', targetNodeId: 'other-node', kind: 'depends_on', description: 'A relation from the node I speak for.' });
    assert.equal(own.status, 201);
  } finally {
    await h.close();
  }
});

test('SEC-021 disabling a credential takes effect immediately, despite the verification cache', async () => {
  const h = await harness();
  try {
    const token = h.tokens['reader:dock'];
    assert.equal((await h.call('GET', '/v1/snapshot', { token })).status, 200, 'warm the cache');

    // Disable it in the live registry, as `cli.js disable` does.
    for (const entry of h.runtime.registry.byKeyId.values()) {
      if (entry.principal.principalId === 'reader:dock') entry.record.disabled = true;
    }

    const after = await h.call('GET', '/v1/snapshot', { token });
    assert.equal(after.status, 401, 'a cached verification must not outlive the credential');
    assert.equal(after.body.error, 'CONTROL_PLANE_UNAUTHORIZED');
  } finally {
    await h.close();
  }
});

test('SEC-030 the evidence boundary refuses encoded pointers, spaced advisories and port claims', async () => {
  const { detectRefusedMaterial } = await import('../src/security/evidence.js');
  const refused = [
    ['scheme-less-url', 'See report at scanner.example/findings/17 for detail.'],
    ['cve-with-status', 'Affected by cve 2026 1234 in the parser.'],
    ['cve-with-status', 'CVE_2026_1234 is present.'],
    ['ghsa-id', 'GHSA abcd efgh ijkl affects it.'],
    ['report-artifact-path', 'Findings archived under ops/scan.json'],
    ['report-artifact-path', 'Results in reports/scan-2026.sarif'],
    ['port-claim', 'The service listens on 5432.'],
    ['port-claim', 'Only port 443 is exposed.'],
  ];
  for (const [rule, text] of refused) {
    const found = detectRefusedMaterial(text);
    assert.ok(found, `must refuse: ${text}`);
    assert.equal(found.id, rule, text);
  }

  // A boundary that refused ordinary posture prose would push attestors toward vaguer
  // summaries, which is worse. These must pass.
  for (const text of [
    'All service credentials are bound to principals; one shared credential remains.',
    'Dependency audit complete: 0 critical, 2 high, 9 medium, 31 low.',
    'Nightly off-host replication verified by a restore drill.',
    '30 catalogued systems: 1 externally reachable, 23 local, 6 with undeclared exposure.',
    'Controls implemented in the security module and covered by the invariant suite.',
    'Rotation overdue for 1 of 4 signing keys.',
    'Coverage rose from 0.75 to 0.92 this quarter.',
  ]) {
    assert.equal(detectRefusedMaterial(text), null, `must allow: ${text}`);
  }
});

test('SEC-031 an inherited property name is never a member of an allowlist', async () => {
  const h = await harness();
  try {
    await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('payload-terminal', OBSERVE) });

    // `'toString' in {}` is true and `{}['toString']` is a function. Every allowlist
    // in the plane is consulted with a name the caller chose, so a table that
    // inherits from Object.prototype admits names nobody granted. The posture
    // dimension is the worst case: the record would be signed into an append-only
    // journal, and every later projection of the whole snapshot would fail.
    for (const inherited of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      const refused = await h.command(h.tokens['attestor:ci'], {
        actorId: 'attestor:ci',
        action: 'record_security_posture',
        nodeId: 'payload-terminal',
        attestedAt: new Date().toISOString(),
        method: 'automated_scan',
        signals: [{ dimension: inherited, state: 'strong' }],
      });
      assert.equal(refused.status, 422, `${inherited} must not name a constellation dimension`);
      assert.match(refused.body.detail, /not a constellation dimension/);

      const action = await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', action: inherited });
      assert.equal(action.status, 422, `${inherited} must not name an action`);
    }

    // The snapshot is still readable, which is the property the refusal protects.
    const snapshot = await h.call('GET', '/v1/snapshot', { token: h.tokens['operator:alice'] });
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.constellation.unrecognisedSignals, 0);

    // A dimension is not a member merely because String() can produce its name.
    const coerced = await h.command(h.tokens['attestor:ci'], {
      actorId: 'attestor:ci',
      action: 'record_security_posture',
      nodeId: 'payload-terminal',
      attestedAt: new Date().toISOString(),
      method: 'automated_scan',
      signals: [{ dimension: ['identity'], state: 'strong' }],
    });
    assert.equal(coerced.status, 422);
  } finally {
    await h.close();
  }
});

test('SEC-031 a role name outside the table is refused, not resolved through the prototype', async () => {
  const { validatePrincipalRecord } = await import('../src/security/identity.js');
  const { rolesOf } = await import('../src/security/policy.js');
  const { record } = issueCredential({ principalId: 'p:x', roles: ['reader'], actors: ['p:x'] });

  for (const inherited of ['toString', 'constructor', '__proto__', 'valueOf']) {
    const problems = validatePrincipalRecord({ ...record, roles: [inherited] });
    assert.ok(problems.some(problem => problem.includes('unknown role')), `${inherited} must not validate as a role`);
    // And even if such a record reached the registry, expanding it grants nothing
    // rather than throwing an unhandled error out of the authentication path.
    assert.equal(rolesOf([inherited]).size, 0);
  }
  assert.ok(rolesOf(['reader']).size > 0);
});

test('SEC-032 the projection is total over anything the journal can hold', async () => {
  const { buildConstellation } = await import('../src/security/evidence.js');
  // A record cannot be withdrawn from an append-only history, so a projection that
  // throws on one stored signal takes every future read of the snapshot with it.
  const hostile = {
    'node-a': { attestedAt: new Date().toISOString(), signals: [
      { dimension: 'toString', state: 'strong', coverage: 0.5 },
      { dimension: '__proto__', state: 'failing' },
      { dimension: 'identity', state: 'weak', coverage: 0.4, findings: { high: 'many' } },
    ] },
    'node-b': { attestedAt: 'not a date', signals: null },
    'node-c': null,
  };
  const constellation = buildConstellation(hostile);
  assert.equal(constellation.unrecognisedSignals, 2);
  const identity = constellation.dimensions.find(entry => entry.dimension === 'identity');
  assert.equal(identity.worst, 'weak');
  assert.equal(identity.findings.high, 0, 'a non-numeric count contributes nothing rather than NaN');
  assert.equal(constellation.attestedNodes, 2);
});

test('SEC-033 no single field can make the plane stop answering', async () => {
  const { safeText, MAX_SAFE_TEXT_LENGTH, detectSecretShape } = await import('../src/security/text.js');
  // Detector cost is quadratic in the length of the subject, and the process has one
  // thread: an oversized field is not a slow request, it is an unavailable service.
  // The bound is applied ahead of the first pattern rather than by the caller.
  const pathological = 'a.'.repeat(125_000);
  const started = process.hrtime.bigint();
  assert.throws(() => safeText(pathological, 'description'), /exceeds 4096 characters/);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 250, `boundary spent ${elapsedMs.toFixed(0)}ms on one field`);

  // The bound does not blunt the detector inside it.
  const atLimit = 'a.'.repeat(MAX_SAFE_TEXT_LENGTH / 2 - 1);
  const inner = process.hrtime.bigint();
  safeText(atLimit, 'description');
  assert.ok(Number(process.hrtime.bigint() - inner) / 1e6 < 250, 'a legal field is checked promptly');
  // secret-scan:allow a credential-shaped fixture the detector must still catch
  assert.equal(detectSecretShape('https://admin:hunter2hunter2@example.com/x').id, 'basic-auth-url');
});

test('SEC-033 an oversized field is refused over HTTP without stalling the listener', async () => {
  const h = await harness();
  try {
    const started = Date.now();
    const refused = await h.command(h.tokens['operator:alice'], {
      actorId: 'operator:alice',
      ...h.node('payload-terminal', OBSERVE),
      node: { nodeId: 'payload-terminal', name: 'payload-terminal', kind: 'api', description: 'a.'.repeat(100_000), capabilities: OBSERVE, metadata: {}, location: null },
    });
    assert.equal(refused.status, 422);
    // The listener is still answering, which is the whole point.
    const live = await h.call('GET', '/health');
    assert.equal(live.status, 200);
    assert.ok(Date.now() - started < 10_000, 'the refusal did not block the event loop');
  } finally {
    await h.close();
  }
});

test('SEC-034 a record field outside the contract is covered by nothing and is refused', async () => {
  const h = await harness();
  try {
    await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('payload-terminal', OBSERVE) });
    const lines = (await readFile(h.config.journalPath, 'utf8')).trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    // The record hash covers the event and the preceding hash; the signature covers
    // the record hash. Neither covers the rest of the line, so an annotation added by
    // anyone who can write the file would be served verbatim from /v1/events with the
    // chain still reporting the history as intact.
    record.note = 'approved out of band by the platform team';
    lines[lines.length - 1] = JSON.stringify(record);
    await writeFile(h.config.journalPath, `${lines.join('\n')}\n`);

    const events = await h.call('GET', '/v1/events', { token: h.tokens['operator:alice'] });
    assert.equal(events.status, 503);
    assert.equal(events.body.error, 'JOURNAL_CORRUPT');
    assert.match(events.body.detail, /carries the field note/);
  } finally {
    await h.close();
  }
});

test('SEC-035 a retired signing key cannot sign new history, and loses its private half', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ncp-rotate-'));
  try {
    const kek = KeyEncryptionKey.generate('kek-primary');
    const keystorePath = join(directory, 'keystore.json');
    const journalPath = join(directory, 'journal.jsonl');
    const store = await KeyStore.load({ filePath: keystorePath, kek, create: true });
    const plane = ControlPlane.fromPath(journalPath, undefined, { keyStore: store, anchor: false });

    const submit = async (nodeId, revisionOverride) => {
      const snapshot = await plane.snapshot();
      return plane.command({
        requestId: `rotate:${nodeId}`,
        submittedAt: new Date().toISOString(),
        expectedRevision: revisionOverride === undefined ? snapshot.revision : revisionOverride,
        actorId: 'operator:alice',
        action: 'register_node',
        node: { nodeId, name: nodeId, kind: 'api', description: `${nodeId} is a registered ecosystem node.`, capabilities: OBSERVE, metadata: {}, location: null },
      });
    };
    await submit('node-before');

    const retiredKeyId = store.activeKeyId;
    const rotation = await store.rotate({ atRecord: 1 });
    assert.equal(rotation.retired, retiredKeyId);

    // Rotation is a reduction in what a stolen copy of the old key is worth.
    const persisted = JSON.parse(await readFile(keystorePath, 'utf8'));
    const retired = persisted.keys.find(key => key.keyId === retiredKeyId);
    assert.equal(retired.privateKey, null, 'the retired private half is gone from the store');
    assert.equal(retired.retiredAtRecord, 1);
    assert.equal(store.retirementBounds().length, 0);

    // History the retired key signed still verifies; anything it signs afterwards
    // does not, however well-formed the signature is.
    await submit('node-after');
    const records = (await readFile(journalPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records[0].signature.keyId, retiredKeyId);
    assert.equal(records[1].signature.keyId, store.activeKeyId);

    const forged = { ...records[1], signature: { ...records[1].signature, keyId: retiredKeyId } };
    assert.equal(store.verify(forged.recordHash, forged.signature, { index: 1 }).ok, false);
    assert.match(store.verify(forged.recordHash, forged.signature, { index: 1 }).reason, /retired at record 1/);
    assert.equal(store.verify(records[0].recordHash, records[0].signature, { index: 0 }).ok, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SEC-036 a control that cannot run is refused, never reported as running', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ncp-signing-'));
  try {
    const config = {
      ...readConfig({}),
      journalPath: join(directory, 'journal.jsonl'),
      keystorePath: join(directory, 'keystore.json'),
      principalsFile: null,
      legacyToken: 'local-development-token',
      signing: false,
      requireSignatures: true,
    };
    // Requiring signatures with signing off checks nothing, and the security status
    // surface would have reported the requirement as in force at every read.
    await assert.rejects(
      createRuntime(config, { securityLog: new SecurityLog({ sink: () => {} }) }),
      /REQUIRE_SIGNATURES is set but signing is disabled/,
    );

    const runtime = await createRuntime({ ...config, signing: true }, { securityLog: new SecurityLog({ sink: () => {} }) });
    assert.equal(runtime.journal.integrity().requireSignatures, true);
    assert.equal(runtime.journal.integrity().signing, 'active');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SEC-037 material with no legitimate reading is refused in every field, not only in posture', async () => {
  const h = await harness();
  try {
    const register = (nodeId, description, metadata = { domain: 'platform' }) => h.command(h.tokens['operator:alice'], {
      actorId: 'operator:alice',
      action: 'register_node',
      node: { nodeId, name: nodeId, kind: 'api', description, capabilities: OBSERVE, metadata, location: null },
    });

    // The evidence boundary belongs to the posture command, but two of its classes —
    // the means to attack a system, and where the key material lives — have no
    // reading anywhere in a coordination ledger. Without this, a node description is
    // the way around the boundary.
    const weaponised = await register('hostile-a', 'Hardening validated by running sqlmap against the search endpoint.');
    assert.equal(weaponised.status, 422);
    assert.match(weaponised.body.detail, /offensive-capability/);

    const keyPath = await register('hostile-b', 'TLS terminates here; the certificate lives beside id_rsa on the host.');
    assert.equal(keyPath.status, 422);
    assert.match(keyPath.body.detail, /key-material-location/);

    const inMetadata = await register('hostile-c', 'A node with hostile metadata.', { domain: 'platform', runbook: 'restore from backup.pem' });
    assert.equal(inMetadata.status, 422);
    assert.match(inMetadata.body.detail, /key-material-location/);

    // Classes that do have a legitimate reading elsewhere stay scoped to posture: a
    // repository reference is exactly what node metadata is for.
    const ordinary = await register('payload-terminal', 'A fixture node that serves a published projection.', { domain: 'platform', repo: 'notationsystems/payload-terminal' });
    assert.equal(ordinary.status, 201);
  } finally {
    await h.close();
  }
});

test('SEC-010 the identity space is reachable from the contract, and is still not a resolver', async () => {
  const h = await harness();
  try {
    await h.command(h.tokens['operator:alice'], { actorId: 'operator:alice', ...h.node('payload-terminal', OBSERVE) });

    // Every node carries its canonical name on read. Derived, never stored: a name that
    // had to be written down could disagree with the id it names.
    const snapshot = await h.call('GET', '/v1/snapshot', { token: h.tokens['operator:alice'] });
    const node = snapshot.body.nodes.find(entry => entry.nodeId === 'payload-terminal');
    assert.equal(node.uri, 'notation://node/notationsystems/payload-terminal');
    assert.equal(parseUri(node.uri).class, 'node');
    assert.throws(() => resolveUri(node.uri), /does not dereference/i, 'a name is not an address');

    // The family predicates are called from the request path with attacker-supplied
    // text. A predicate that throws turns a 422 into a 500 — the plane failing rather
    // than refusing — so they must be total over anything at all.
    for (const hostile of ['https://x/y', 'not a uri', '', 'notation://bogus/ns/x', '../../etc/passwd', null, 42, {}, []]) {
      assert.equal(isInformationIdentity(hostile), false, `isInformationIdentity(${JSON.stringify(hostile)}) must answer, not throw`);
      assert.equal(isAuthorityIdentity(hostile), false);
    }
    assert.equal(isInformationIdentity(uri.artifact('notationsystems', 'x')), true);
    assert.equal(isAuthorityIdentity(uri.key('notationsystems', 'k-1')), true);

    // Equality of identity is equality of string. An earlier nodeUri lowercased the id
    // and replaced everything outside the segment alphabet with a hyphen, so three ids
    // the plane accepts as distinct collapsed into one name. A name that two nodes can
    // share is worse than no name at all.
    const names = ['a:b', 'a/b', 'a-b', 'A-b'].map(id => nodeUri(id));
    assert.equal(new Set(names).size, names.length, 'distinct ids must not share a name');
    // And the space names the estate's own identifiers, which use `kind:name`.
    assert.equal(nodeUri('payload-terminal'), 'notation://node/notationsystems/payload-terminal');
    assert.equal(parseUri(uri.principal('notationsystems', 'operator:alice')).localId, 'operator:alice');
    // While every ambiguous or traversing form stays refused.
    for (const hostile of ['notation://node/ns/http://evil', 'notation://node/ns/..', 'notation://node/ns/x%2Fy', 'notation://node/ns//x', 'notation://node/ns/x?y', 'notation://node/ns/x#y']) {
      assert.throws(() => parseUri(hostile), /UriError|not a|may not/i, `${hostile} must be refused`);
    }

    // An id the plane accepts but the identity space cannot express gets no name, and the
    // snapshot still reads. A projection over an append-only history must be total: a
    // record cannot be withdrawn, so one that threw would take every later read with it.
    // The plane's identifier grammar allows 180 characters; an identity segment allows
    // 128. A node id between the two is legal here and unnameable there.
    const unnameable = `n${'x'.repeat(150)}`;
    const odd = await h.command(h.tokens['operator:alice'], {
      actorId: 'operator:alice',
      action: 'register_node',
      node: { nodeId: unnameable, name: 'long', kind: 'api', description: 'A node whose id is legal for the plane and too long for an identity segment.', capabilities: OBSERVE, metadata: {}, location: null },
    });
    assert.equal(odd.status, 201, 'the plane accepts the id');
    const readBack = await h.call('GET', '/v1/snapshot', { token: h.tokens['operator:alice'] });
    assert.equal(readBack.status, 200, 'and the snapshot still reads');
    assert.equal(readBack.body.nodes.find(entry => entry.nodeId === unnameable).uri, null, 'with no name rather than a mangled one');

    // A resolved coordination record carries its decision name, so the substrate chain's
    // terminal stage — the one stage this plane actually writes — is addressable.
    const requested = await h.command(h.tokens['agent:planner'], {
      actorId: 'agent:planner', action: 'request_capability', coordinationId: 'coord:uri-1',
      requesterNodeId: 'payload-terminal', targetNodeId: 'payload-terminal', capabilityId: 'example.read',
      requestedMode: 'observe', purpose: 'Confirm a decision is addressable in the identity space.',
    });
    assert.equal(requested.status, 201);
    const record = requested.body.snapshot.coordination.find(entry => entry.coordinationId === 'coord:uri-1');
    assert.equal(record.uri, 'notation://decision/notationsystems/coord:uri-1');
    assert.equal(parseUri(record.uri).class, 'decision');
    assert.equal(record.dispatch, 'not_dispatched');

    // The published contract has always said an evidence reference may be a notation://
    // identity. It is now true, and it admits a name from a closed space rather than an
    // arbitrary string that happens to contain slashes.
    const attest = evidenceRef => h.command(h.tokens['attestor:ci'], {
      actorId: 'attestor:ci', action: 'record_security_posture', nodeId: 'payload-terminal',
      attestedAt: new Date().toISOString(), method: 'automated_scan',
      signals: [{ dimension: 'audit_integrity', state: 'strong', evidenceRef }],
    });
    assert.equal((await attest(uri.artifact('notationsystems', 'comtrade-2026-08-27', 'v2'))).status, 201);
    assert.equal((await attest(uri.observation('notationsystems', 'probe-4471'))).status, 201);
    assert.equal((await attest(uri.proof('notationsystems', 'sp1-run-4471'))).status, 201);
    assert.equal((await attest(`sha256:${'b'.repeat(64)}`)).status, 201);

    for (const rejected of [
      'https://scanner.example/report/17',
      'notation://evil.example/a/b',          // not a class in the space
      '../../etc/passwd',
      `notation://artifact/notationsystems/${'a'.repeat(300)}`, // a name, not a payload
      // Authority identities are refused: naming a key or an operator as the evidence
      // for a posture signal would say the key *is* the finding, and would put an
      // authority identifier into a record agents read and browsers render.
      uri.principal('notationsystems', 'operator-1'),
      uri.key('notationsystems', 'k-1a2b3c'),
      uri.agent('notationsystems', 'planner'),
      uri.deployment('notationsystems', 'prod-1'),
    ]) {
      const refused = await attest(rejected);
      assert.equal(refused.status, 422, `${rejected} must be refused`);
      assert.match(refused.body.detail, /evidenceRef/);
    }
  } finally {
    await h.close();
  }
});

test('SEC-CONTRACT the published contract names every code the plane can emit', async () => {
  const { readContract } = await import('../src/openapi.js');
  const { codes, text, responses } = await readContract();

  // Every `new ControlPlaneError(status, 'CODE', …)` and every literal `error:` the
  // server writes, read from the whole source tree. A hand-listed set of files is the
  // same drift this test exists to catch: the first draft of it omitted
  // security/headers.js and therefore missed ORIGIN_NOT_ALLOWED.
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const walk = async dir => {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...await walk(full));
      else if (entry.name.endsWith('.js')) found.push(full);
    }
    return found;
  };
  const files = await walk(srcDir);
  assert.ok(files.length >= 15, 'the walk found the source tree');
  const sources = await Promise.all(files.map(file => readFile(file, 'utf8')));
  const emitted = new Set();
  for (const source of sources) {
    for (const [, code] of source.matchAll(/ControlPlaneError\(\s*\d{3},\s*'([A-Z_]+)'/g)) emitted.add(code);
    for (const [, code] of source.matchAll(/error:\s*'([A-Z_]+)'/g)) emitted.add(code);
  }
  // The helpers in errors.js mint these without a literal status at the call site.
  for (const code of ['CONTROL_PLANE_COMMAND_INVALID', 'CONTROL_PLANE_UNAUTHORIZED', 'CONTROL_PLANE_FORBIDDEN']) emitted.add(code);

  const undocumented = [...emitted].filter(code => !codes.includes(code)).sort();
  assert.deepEqual(undocumented, [], `codes the plane emits and the contract does not name: ${undocumented.join(', ')}`);
  // And nothing documented that the plane cannot produce, so the list stays a fact.
  const unreachable = codes.filter(code => !emitted.has(code)).sort();
  assert.deepEqual(unreachable, [], `codes the contract names and the plane never emits: ${unreachable.join(', ')}`);

  // "Approval is not execution" is the company's central invariant, and until now it
  // lived only in prose: a client reading the contract could not see it.
  assert.match(text, /const: not_dispatched/);
  assert.match(text, /The plane authorises; it never dispatches\./);

  // Every route the server answers is documented with the statuses it can return.
  assert.deepEqual(Object.keys(responses).sort(), ['/health', '/v1/commands', '/v1/events', '/v1/security/status', '/v1/snapshot']);
  assert.ok(responses['/v1/commands'].post.includes('500'), 'even the internal error is documented, since its text is fixed');
});

test('SEC-CONTRACT the routes the server answers are exactly the routes it publishes', async () => {
  const { readContract } = await import('../src/openapi.js');
  const { paths } = await readContract();
  const h = await harness();
  try {
    for (const route of paths) {
      if (route === '/health') {
        assert.equal((await h.call('GET', route)).status, 200);
        continue;
      }
      if (route === '/v1/commands') continue; // exercised throughout this suite
      const unauthenticated = await h.call('GET', route);
      assert.equal(unauthenticated.status, 401, `${route} must exist and require a credential`);
      assert.equal(unauthenticated.body.error, 'CONTROL_PLANE_UNAUTHORIZED');
    }
    // And a route it does not publish is refused by name rather than guessed at.
    const missing = await h.call('GET', '/v1/nope', { token: h.tokens['operator:alice'] });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'ROUTE_NOT_FOUND');
  } finally {
    await h.close();
  }
});

test('SEC-CONFIG every variable the plane reads is documented, and nothing else is', async () => {
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  const documented = new Set(example.split('\n').filter(line => /^[A-Z]/.test(line)).map(line => line.split('=')[0]));

  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const walk = async dir => {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...await walk(full));
      else if (entry.name.endsWith('.js')) found.push(full);
    }
    return found;
  };
  const sources = await Promise.all((await walk(srcDir)).map(file => readFile(file, 'utf8')));
  const read = new Set(sources.flatMap(source => [...source.matchAll(/(?:env|environment|process\.env)\.([A-Z_]+)/g)].map(m => m[1])));

  // An example that documents five of twenty-one variables and omits every security
  // control is not an example, it is a trap: an operator who configures from it gets a
  // plane with no credential registry, no signing key protection and no rate limits, and
  // nothing tells them.
  assert.deepEqual([...read].filter(v => !documented.has(v)).sort(), [], 'variables the plane reads and the example does not document');
  assert.deepEqual([...documented].filter(v => !read.has(v)).sort(), [], 'variables the example documents and the plane never reads');
  assert.ok(read.size >= 20);
});

test('SEC-PRODUCER the producer holds itself to the boundary it says it holds itself to', async () => {
  const { assertProducerOutputIsEvidence } = await import('../../security/attest.mjs');

  // The header of attest.mjs claims every signal is "re-checked against the same refusal
  // boundary the server enforces". It used to check two of eight rules — the dimension
  // with `in`, and the summary — so a producer could emit an unknown field, a coverage
  // of 5, a state outside the enum, an authority identity as evidence, or an inherited
  // property name as a dimension, and find out only at the server.
  const refused = [
    [{ dimension: 'toString', state: 'strong' }, 'an inherited property name'],
    [{ dimension: 'identity', state: 'brilliant' }, 'a state outside the enum'],
    [{ dimension: 'identity', state: 'strong', coverage: 5 }, 'a coverage out of range'],
    [{ dimension: 'identity', state: 'strong', vibes: 1 }, 'an unknown field'],
    [{ dimension: 'identity', state: 'strong', evidenceRef: 'notation://key/notationsystems/k-1' }, 'an authority identity as evidence'],
    [{ dimension: 'identity', state: 'strong', summary: 'x'.repeat(400) }, 'a summary over the cap'],
    // secret-scan:allow a fixture the evidence boundary must refuse
    [{ dimension: 'exposure', state: 'weak', summary: 'Reachable on 10.4.2.7 and db.internal:5432.' }, 'network topology'],
  ];
  for (const [signal, why] of refused) {
    assert.throws(() => assertProducerOutputIsEvidence([signal]), /Refusing to attest/, `${why} must be refused by the producer`);
  }
  assert.doesNotThrow(() => assertProducerOutputIsEvidence([{ dimension: 'identity', state: 'strong', coverage: 1, summary: 'Every credential is bound to one actor identity.' }]));
});

test('SEC-PRODUCER the authorization signal measures something other than itself', async () => {
  const { SUPPORTED_ACTIONS } = await import('../src/validation.js');
  const { ACTION_PERMISSIONS } = await import('../src/security/policy.js');

  // The signal used to read the permission table and grade the permission table, with
  // coverage hard-coded to 1 and the 'unknown' branch unreachable. It now compares two
  // independent lists, so an action the parser accepts and the table does not map — an
  // action nobody has to hold anything to invoke — is a failing signal rather than
  // invisible.
  const parsed = [...SUPPORTED_ACTIONS];
  assert.ok(parsed.length >= 6);
  assert.deepEqual(parsed.filter(action => !Object.hasOwn(ACTION_PERMISSIONS, action)), [], 'every parsed action requires a named permission');
  assert.deepEqual(Object.keys(ACTION_PERMISSIONS).filter(action => !parsed.includes(action)), [], 'and every mapped permission names an action the parser accepts');

  // The declared list is the switch, not a second thing to keep in step by hand.
  const source = await readFile(new URL('../src/validation.js', import.meta.url), 'utf8');
  const cases = [...source.matchAll(/^ {4}case '([a-z_]+)':/gm)].map(m => m[1]).sort();
  assert.deepEqual(cases, [...parsed].sort());
});

test('SEC-042 a journal\'s signing key lives beside the journal, not beside whoever opened it', async () => {
  // How this was found: seeding from the repository root and then starting the server
  // from control-plane/ produced JOURNAL_CORRUPT on every read. The journal path was
  // explicit; the key store path was `data/keystore.json` resolved against the working
  // directory, so the seed signed the chain with a key it wrote to <root>/data and the
  // server created a different key in control-plane/data and could verify nothing.
  // Following the documented commands was enough to reach the plane's most severe state.
  const root = await mkdtemp(join(tmpdir(), 'notations-keystore-'));
  const journal = join(root, 'plane', 'control-plane.jsonl');
  const elsewhere = await mkdtemp(join(tmpdir(), 'notations-cwd-'));
  const previous = process.cwd();

  try {
    // The key store is derived from the journal, so where the writer stands is irrelevant.
    assert.equal(defaultKeystorePath(journal), join(root, 'plane', 'keystore.json'));

    process.chdir(elsewhere);
    const seeded = await ControlPlane.fromEnvironment(journal, {});
    await seeded.command({
      requestId: 'register:keystore-fixture', actorId: 'operator:local', submittedAt: new Date().toISOString(), expectedRevision: null,
      action: 'register_node',
      node: { nodeId: 'keystore-fixture', name: 'Fixture', kind: 'api', description: 'A fixture node.', capabilities: OBSERVE, metadata: {}, location: null },
    });

    // Nothing was written where the writer happened to be standing. A key store is
    // CRYPTOGRAPHIC_SECRET material; it does not get scattered by a chdir.
    assert.deepEqual((await readdir(elsewhere)).filter(f => f !== 'node_modules'), []);
    assert.ok((await readdir(join(root, 'plane'))).includes('keystore.json'));

    // A second reader, opened from a third directory, verifies the chain the first wrote.
    process.chdir(root);
    const reader = await ControlPlane.fromEnvironment(journal, {});
    const snapshot = await reader.snapshot();
    assert.equal(snapshot.nodes.length, 1);
    assert.equal(snapshot.nodes[0].nodeId, 'keystore-fixture');
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test('API-000 every response carries a proof root or states its limitations', async () => {
  // The invariant of docs/API_PLANES.md, asserted on the wire rather than on the catalog's
  // description of the wire. A response that is neither a referenced read nor a stated
  // observation is the dangerous shape: authoritative to read, impossible to verify, and
  // silent about which. Every route, every status the plane can reach from a request.
  const h = await harness();
  try {
    const token = h.tokens['operator:alice'];
    await h.command(token, { actorId: 'operator:alice', ...h.node('api-zero-fixture', OBSERVE) });

    const responses = [
      ['GET /health (unauthenticated)', await h.call('GET', '/health')],
      ['GET /v1/snapshot', await h.call('GET', '/v1/snapshot', { token })],
      ['GET /v1/events', await h.call('GET', '/v1/events', { token })],
      ['GET /v1/security/status', await h.call('GET', '/v1/security/status', { token })],
      ['GET /v1/snapshot (no credential)', await h.call('GET', '/v1/snapshot')],
      ['GET /v1/snapshot (bad credential)', await h.call('GET', '/v1/snapshot', { token: 'nsk_not.a-real-credential' })],
      ['GET /v1/events (bad cursor)', await h.call('GET', '/v1/events?after=nope', { token })],
      ['GET /nope', await h.call('GET', '/nope', { token })],
      ['POST /v1/commands (invalid)', await h.call('POST', '/v1/commands', { token, body: { action: 'not_an_action' } })],
      ['POST /v1/commands (accepted)', await h.command(token, { actorId: 'operator:alice', action: 'record_observation', nodeId: 'api-zero-fixture', health: 'healthy', observedAt: new Date().toISOString(), source: 'operator', detail: 'Responding.' })],
    ];

    for (const [what, res] of responses) {
      assert.equal(checkApiZero(res.body), null, `${what} (${res.status}): ${checkApiZero(res.body)}`);
    }

    // The two shapes, in the two places they belong. A read of the journal names the
    // revision it was folded at; liveness names what it does not cover.
    const snapshot = responses.find(([what]) => what === 'GET /v1/snapshot')[1].body;
    assert.equal(snapshot.apiResponse, 'referenced');
    assert.equal(snapshot.proofRoot.revision, snapshot.revision);
    assert.equal(snapshot.reference, `notation://state/notationsystems/control-plane@${snapshot.revision}`);
    assert.equal(snapshot.proofRoot.chain, 'hash-linked');
    assert.equal(snapshot.proofRoot.signing, 'active');

    const health = responses[0][1].body;
    assert.equal(health.apiResponse, 'operational_observation');
    assert.ok(health.observation.limitations.some(l => /this process only, not the estate/.test(l)));
    // Liveness is unauthenticated, so it must not become an oracle: no revision, no
    // record count, nothing about held state — and the limitation says so out loud.
    assert.equal(health.reference, undefined);
    assert.equal(health.proofRoot, undefined);
    assert.ok(!JSON.stringify(health).includes(snapshot.revision));

    // A refusal makes no claim about canonical state, and says that rather than nothing.
    const refused = responses.find(([what]) => what === 'GET /nope')[1].body;
    assert.equal(refused.apiResponse, 'operational_observation');
    assert.ok(refused.observation.limitations.some(l => /makes no claim about canonical state/.test(l)));
  } finally {
    await h.close();
  }
});

test('API-000 a body that satisfies neither shape is refused rather than served', async () => {
  // Projection must be total: a malformed body is a defect in the plane, and the plane
  // must not answer with it, but it must also not fail in a way that bricks a route. The
  // check refuses to serve it and returns an honest observation about the refusal.
  assert.equal(checkApiZero({ status: 'ok' }), 'a response must declare apiResponse as "referenced" or "operational_observation"; this one declares undefined');
  assert.match(checkApiZero({ apiResponse: 'referenced' }), /must carry a canonical reference/);
  assert.match(checkApiZero({ apiResponse: 'referenced', reference: 'x' }), /must carry a proof root/);
  assert.match(checkApiZero({ apiResponse: 'operational_observation' }), /must carry an observation block/);
  assert.match(checkApiZero({ apiResponse: 'operational_observation', observation: { observedAt: 'now', limitations: [] } }), /must state what it does not cover/);

  // An observation with no limitations is refused at construction, not silently emptied:
  // an observation without its limits is indistinguishable from a claim about the estate.
  assert.throws(() => observed({ status: 'ok' }, []), /at least one limitation/);
  assert.throws(() => observed({ status: 'ok' }, undefined), /at least one limitation/);
});

test('TWIN-001 the state at any cursor is served by the plane, referenced at that record', async () => {
  // A digital twin has a time axis, and it must be the plane's fold and not the client's:
  // a client replaying events itself would eventually disagree with the plane about what
  // they meant. So `?at=` is a read of a prefix, with one derivation, and its proof root is
  // the record hash the prefix ends at.
  const h = await harness();
  try {
    const token = h.tokens['operator:alice'];
    const first = await h.command(token, { actorId: 'operator:alice', ...h.node('twin-alpha', OBSERVE) });
    await h.command(token, { actorId: 'operator:alice', ...h.node('twin-beta', OBSERVE) });

    const now = await h.call('GET', '/v1/snapshot', { token });
    assert.deepEqual(now.body.nodes.map(n => n.nodeId).sort(), ['twin-alpha', 'twin-beta']);

    const then = await h.call('GET', `/v1/snapshot?at=${encodeURIComponent(first.body.event.eventId)}`, { token });
    assert.equal(then.status, 200);
    assert.deepEqual(then.body.nodes.map(n => n.nodeId), ['twin-alpha']);
    // Referenced at the cursor, not at the head: the root is the one the answer is true at.
    assert.equal(then.body.apiResponse, 'referenced');
    assert.equal(then.body.revision, first.body.event.recordHash);
    assert.equal(then.body.proofRoot.revision, first.body.event.recordHash);
    assert.equal(then.body.proofRoot.eventCursor, first.body.event.eventId);
    assert.equal(then.body.reference, `notation://state/notationsystems/control-plane@${first.body.event.recordHash}`);
    assert.notEqual(then.body.revision, now.body.revision);

    // A cursor the journal never held is refused with the same code a bad events cursor gets.
    const unknown = await h.call('GET', '/v1/snapshot?at=control-plane:not-a-record', { token });
    assert.equal(unknown.status, 409);
    assert.equal(unknown.body.error, 'CURSOR_UNKNOWN');
    assert.equal(unknown.body.apiResponse, 'operational_observation');
  } finally {
    await h.close();
  }
});
