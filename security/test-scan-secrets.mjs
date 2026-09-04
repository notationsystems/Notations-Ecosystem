import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanFile } from './scan-secrets.mjs';

// The scanner is the control behind SEC-004 and it had no test of its own behaviour: it ran in CI
// and reported clean, which is exactly what a broken scanner also does.
const inTemp = async (name, body, fn) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scan-'));
  const file = path.join(dir, name);
  await writeFile(file, body);
  try { return await fn(file); } finally { await rm(dir, { recursive: true, force: true }); }
};

test('SEC-004: the scanner finds credential material', async () => {
  const planted = [
    ['aws.txt', 'const k = "AKIA' + 'IOSFODNN7EXAMPLE";'],
    ['gh.txt', 'token: ghp_' + 'a'.repeat(36)],
    // secret-scan:allow — planted material, so that a scanner which finds nothing fails this test.
    ['key.pem', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----\n'],
    // secret-scan:allow — planted material; the host and password are invented.
    ['url.txt', 'https://admin:hunter2@db.internal.example/notations'],
  ];
  for (const [name, body] of planted) {
    const found = await inTemp(name, body, scanFile);
    const real = found.filter((f) => !f.allowed);
    assert.ok(real.length > 0, `${name}: the scanner reported nothing; a scanner that finds nothing is indistinguishable from a clean repository`);
  }
});

test('SEC-004: a committed environment file is a finding on its own', async () => {
  const found = await inTemp('.env', 'API_TOKEN=abc123\n', scanFile);
  assert.ok(found.some((f) => f.rule === 'committed-env-file'));
  const example = await inTemp('.env.example', 'API_TOKEN=\n', scanFile);
  assert.equal(example.some((f) => f.rule === 'committed-env-file'), false, 'an example file is the shape that is meant to be committed');
});

test('SEC-004: an exemption must be written next to the thing it exempts', async () => {
  // secret-scan:allow — the fixture body is the subject of this test, not a credential.
  const body = 'const fake = "https://user:pass@example.com"; // secret-scan:allow test fixture\n';
  const found = await inTemp('fixture.js', body, scanFile);
  assert.ok(found.every((f) => f.allowed), 'an in-place marker exempts the line it sits on');
  // secret-scan:allow — the unmarked twin of the line above, which must still be a finding.
  const unmarked = await inTemp('fixture.js', 'const fake = "https://user:pass@example.com";\n', scanFile);
  assert.ok(unmarked.some((f) => !f.allowed), 'without the marker the same line is a finding, so the exemption is the marker and not the path');
});

test('SEC-004: ordinary code is not a finding, or the scanner would be ignored', async () => {
  const found = await inTemp('ok.js', 'export const label = "password field";\nconst x = process.env.API_TOKEN;\n', scanFile);
  assert.deepEqual(found.filter((f) => !f.allowed && !f.warning), []);
});
