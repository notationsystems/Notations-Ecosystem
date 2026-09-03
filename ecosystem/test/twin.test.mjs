import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildInstance, embed } from '../twin/build.mjs';

// A word is not a secret: the catalog says "credential" in prose all over, and refusing that word
// would refuse the doctrine that describes the refusal. What may never be published is credential
// *material* and operator topology, so these match value shapes, not vocabulary.
const MATERIAL = [
  ['key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['url-userinfo', /[a-z][a-z0-9+.-]*:\/\/[^/\s:@"]+:[^/\s@"]+@/i],
  // A named environment variable is the placeholder, not the value: the catalog documents
  // "Bearer PAYLOAD_OPERATIONS_TOKEN" because that is what an operator must set, and publishing
  // the name of a variable publishes nothing.
  ['bearer-token', /\bBearer\s+(?![A-Z][A-Z0-9_]*\b)[A-Za-z0-9._~+/-]{16,}/],
  ['vendor-token', /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,})/],
  // Private address space is estate topology and must not be published. A loopback default is not:
  // it names no host, it is each project's own documented default, and the catalog already carries
  // it in public. Refusing loopback here would refuse the documentation, not a disclosure.
  ['private-address', /https?:\/\/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/i],
];

function embeddedFold(page) {
  const open = page.indexOf('id="twin-data"');
  assert.notEqual(open, -1, 'the page carries its fold in a data element');
  const body = page.slice(page.indexOf('>', open) + 1, page.indexOf('</script>', open));
  return JSON.parse(body.split('<\\/').join('</'));
}

test('the offline instance rebuilds, and rebuilds the same', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'twin-build-'));
  try {
    const a = await buildInstance(path.join(dir, 'a.html'));
    const b = await buildInstance(path.join(dir, 'b.html'));
    assert.equal(a.revision, b.revision, 'the same catalog and the same clock fold to the same head');
    assert.equal(
      await readFile(path.join(dir, 'a.html'), 'utf8'),
      await readFile(path.join(dir, 'b.html'), 'utf8'),
      'the built page is a function of the corpus, not of when it was built',
    );
    assert.equal(a.nodes, 31);
    assert.ok(a.events >= 90, `expected the whole journal, got ${a.events} records`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the published fold carries no credential material and no operator topology', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'twin-safe-'));
  try {
    await buildInstance(path.join(dir, 'p.html'));
    const fold = embeddedFold(await readFile(path.join(dir, 'p.html'), 'utf8'));
    const text = JSON.stringify(fold);
    for (const [id, pattern] of MATERIAL) {
      assert.equal(pattern.test(text), false, `the published fold carries ${id}`);
    }
    assert.equal(fold.snapshot.sample, true, 'the fold says on its face that it is a sample');
    assert.ok(fold.events.length >= 90);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the built page holds no control character an HTML parser would rewrite', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'twin-chars-'));
  try {
    await buildInstance(path.join(dir, 'p.html'));
    const page = await readFile(path.join(dir, 'p.html'), 'utf8');
    for (let i = 0; i < page.length; i += 1) {
      const code = page.charCodeAt(i);
      const ok = code >= 32 ? code !== 127 : code === 10 || code === 9;
      assert.ok(ok, `control character U+${code.toString(16).padStart(4, '0')} at offset ${i}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('embedded data cannot close the script element it sits in', () => {
  const hostile = { note: '</script><script>alert(1)</script>', sep: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c` };
  const embedded = embed(hostile);
  assert.equal(embedded.includes('</'), false, 'every closing sequence is escaped');
  assert.equal(embedded.includes(String.fromCharCode(0x2028)), false, 'a line separator is escaped, not emitted');
  assert.equal(embedded.includes(String.fromCharCode(0x2029)), false);
  assert.deepEqual(JSON.parse(embedded.split('<\\/').join('</')), hostile, 'escaping is lossless');
});
