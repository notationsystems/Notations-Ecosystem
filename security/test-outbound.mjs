import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CATEGORIES, OutboundRefusal, checkUrl, classify, outboundFetch } from './outbound.mjs';

const refusal = async (fn, code) => {
  await assert.rejects(fn, (e) => {
    assert.ok(e instanceof OutboundRefusal, `expected a refusal, got ${e?.name}: ${e?.message}`);
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    assert.ok(e.remedy, 'a refusal states what to do instead');
    return true;
  });
};

test('SEC-050: the cloud metadata service is refused at the address', async () => {
  // The single most valuable SSRF target: it hands instance credentials to anything inside.
  await refusal(() => checkUrl('https://169.254.169.254/latest/meta-data/'), 'OUTBOUND_ADDRESS_REFUSED');
  // And by name, when a name points at it — which is how it is actually reached.
  await refusal(() => checkUrl('https://metadata.example', {}, () => ['169.254.169.254']), 'OUTBOUND_ADDRESS_REFUSED');
});

test('SEC-050: every non-public range is refused', async () => {
  for (const [address, category] of [['10.0.0.5', 'private'], ['172.20.1.1', 'private'], ['192.168.0.9', 'private'], ['100.64.0.1', 'cgnat'], ['127.0.0.1', 'loopback'], ['[::1]', 'loopback'], ['[fd00::1]', 'unique_local'], ['[fe80::1]', 'link_local'], ['224.0.0.1', 'multicast'], ['0.0.0.0', 'reserved']]) {
    await refusal(() => checkUrl(`https://${address}/x`), 'OUTBOUND_ADDRESS_REFUSED');
    assert.ok(CATEGORIES[category], `${category} should be a named category`);
  }
});

test('SEC-050: an IPv4-mapped IPv6 address does not smuggle a private target past the check', async () => {
  assert.equal(classify('::ffff:169.254.169.254'), 'link_local');
  await refusal(() => checkUrl('https://host.example', {}, () => ['::ffff:10.0.0.1']), 'OUTBOUND_ADDRESS_REFUSED');
});

test('SEC-050: a name resolving to both a public and a private address is refused, not partly accepted', async () => {
  // The rebinding shape. Taking the public answer would be taking the attacker's better half.
  await refusal(() => checkUrl('https://split.example', {}, () => ['93.184.216.34', '10.1.2.3']), 'OUTBOUND_ADDRESS_REFUSED');
});

test('SEC-050: only http(s) is outbound, and only https unless loopback is profiled', async () => {
  for (const url of ['file:///etc/passwd', 'gopher://x/1', 'data:text/plain,x', 'ftp://x/y']) {
    await refusal(() => checkUrl(url), 'OUTBOUND_SCHEME_REFUSED');
  }
  await refusal(() => checkUrl('http://93.184.216.34/x'), 'OUTBOUND_SCHEME_REFUSED');
  // A local profile admits http and loopback together, and nothing else.
  const ok = await checkUrl('http://127.0.0.1/x', { allowLoopback: true });
  assert.equal(ok.url.hostname, '127.0.0.1');
  await refusal(() => checkUrl('http://10.0.0.1/x', { allowLoopback: true }), 'OUTBOUND_ADDRESS_REFUSED');
});

test('SEC-050: a credential in the URL is refused before anything is sent', async () => {
  // secret-scan:allow — the credential this refuses is the test's subject, and it is not real.
  await refusal(() => checkUrl('https://user:secret@example.com/x', {}, () => ['93.184.216.34']), 'OUTBOUND_CREDENTIALS_IN_URL');
});

test('SEC-050: an allowlist, where one is set, is the whole permitted world', async () => {
  const resolver = () => ['93.184.216.34'];
  await refusal(() => checkUrl('https://elsewhere.example/x', { allowHosts: ['api.example'] }, resolver), 'OUTBOUND_HOST_NOT_ALLOWED');
  const ok = await checkUrl('https://api.example/x', { allowHosts: ['api.example'] }, resolver);
  assert.equal(ok.url.hostname, 'api.example');
});

test('SEC-050: an unresolvable host is refused rather than attempted', async () => {
  await refusal(() => checkUrl('https://nothing.example/x', {}, () => []), 'OUTBOUND_UNRESOLVABLE');
});

// The live half: a real server, reached under the policy, proving the bounds are enforced on the
// wire and not only in the parser.
const serve = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

test('SEC-050: a redirect is refused rather than followed', async () => {
  const { server, port } = await serve((req, res) => { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); });
  try {
    await refusal(() => outboundFetch(`http://127.0.0.1:${port}/go`, { allowLoopback: true }), 'OUTBOUND_REDIRECT_REFUSED');
  } finally { server.close(); }
});

test('SEC-050: an oversized body is cut off rather than read', async () => {
  const { server, port } = await serve((req, res) => { res.writeHead(200); res.end('x'.repeat(200_000)); });
  try {
    await refusal(() => outboundFetch(`http://127.0.0.1:${port}/big`, { allowLoopback: true, maxBytes: 1024 }), 'OUTBOUND_BODY_TOO_LARGE');
  } finally { server.close(); }
});

test('SEC-050: a permitted request still works, so the control is a gate and not a wall', async () => {
  const { server, port } = await serve((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  try {
    const r = await outboundFetch(`http://127.0.0.1:${port}/health`, { allowLoopback: true });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body).ok, true);
    assert.deepEqual(r.addresses, ['127.0.0.1'], 'the answer records which address was actually reached');
  } finally { server.close(); }
});

test('SEC-050: the socket goes to the verified address, not to whatever the name resolves to next', async () => {
  // Rebinding in practice: the name verifies as public, then flips. The pinned lookup means the
  // connection still goes to the address that was checked, so the flip reaches nothing.
  const { server, port } = await serve((req, res) => { res.writeHead(200); res.end('pinned'); });
  try {
    let call = 0;
    const flipping = () => (call++ === 0 ? ['127.0.0.1'] : ['10.0.0.1']);
    const r = await outboundFetch(`http://rebind.example:${port}/x`, { allowLoopback: true }, flipping);
    assert.equal(r.body, 'pinned');
    assert.deepEqual(r.addresses, ['127.0.0.1']);
    assert.equal(call, 1, 'the address is resolved once, verified, and then pinned for the connection');
  } finally { server.close(); }
});

test('SEC-050: an IPv6 literal is classified, not sent to a resolver', async () => {
  // A URL keeps the brackets on an IPv6 host. Treating that as a name sends a literal address to
  // DNS, where a resolver decides what it means — which is the opposite of checking the address.
  let asked = false;
  await refusal(() => checkUrl('https://[::1]/x', {}, () => { asked = true; return ['93.184.216.34']; }), 'OUTBOUND_ADDRESS_REFUSED');
  assert.equal(asked, false, 'a literal address must never reach the resolver');
  await refusal(() => checkUrl('https://[fd00::1]/x', {}, () => { asked = true; return ['93.184.216.34']; }), 'OUTBOUND_ADDRESS_REFUSED');
  assert.equal(asked, false);
});
