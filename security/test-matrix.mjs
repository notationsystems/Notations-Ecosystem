import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(path.join(root, p), 'utf8');
const exists = async (p) => { try { await access(path.join(root, p)); return true; } catch { return false; } };
const matrix = JSON.parse(await read('security/matrix.json'));
const workflow = await read('.github/workflows/ci.yml');

test('every row names an implementation that exists', async () => {
  for (const row of matrix.rows) {
    assert.ok(await exists(row.implementation), `${row.threat}: ${row.implementation} does not exist`);
  }
});

test('every row that claims a test names one that exists', async () => {
  for (const row of matrix.rows.filter((r) => r.test)) {
    assert.ok(await exists(row.test), `${row.threat}: ${row.test} does not exist`);
  }
});

test('a row with no test states its residual risk honestly', () => {
  for (const row of matrix.rows.filter((r) => !r.test)) {
    assert.ok(row.residual_note, `${row.threat} has no test and no note saying what that leaves open`);
    assert.notEqual(row.residual, 'low', `${row.threat} claims low residual risk with nothing checking it`);
  }
});

// The two rows that used to say "enforced by review". A control nobody checks is a convention.
test('every CI action is pinned by commit, not by a tag', () => {
  const uses = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map(([, u]) => u);
  assert.ok(uses.length > 0);
  for (const u of uses) {
    assert.match(u, /@[0-9a-f]{40}$/, `${u} is pinned by a tag, and a tag can be repointed at new code by whoever controls the action`);
  }
});

test('every dependency install in CI refuses install scripts', () => {
  const installs = [...workflow.matchAll(/npm (ci|install)[^\n]*/g)].map(([m]) => m);
  assert.ok(installs.length > 0, 'the workflow installs something');
  for (const line of installs) {
    assert.match(line, /--ignore-scripts/, `"${line.trim()}" runs install scripts, which execute with the runner's full access before any test does`);
  }
});

test('the workflow token is least privilege and is not left in the checkout', () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/, 'the workflow token should be contents:read');
  const checkouts = (workflow.match(/uses: actions\/checkout@/g) ?? []).length;
  const guarded = (workflow.match(/persist-credentials: false/g) ?? []).length;
  assert.equal(guarded, checkouts, 'every checkout must drop the token, or it stays in .git/config for the whole job');
});

test('the checks the estate documents are the checks CI runs', async () => {
  // A check that exists and runs nowhere is a check that will rot.
  for (const cmd of ['security/scan-secrets.mjs', 'security/audit-gate.mjs', 'security/test-outbound.mjs', 'ecosystem/product-lines.mjs', 'platform/migrate.mjs']) {
    assert.ok(workflow.includes(cmd), `${cmd} is not run by CI`);
  }
  // And the platform proofs must be invoked in a form node can actually run.
  assert.equal(/node --test platform\/test\/(\s|$)/.test(workflow), false, 'node cannot run a directory that way');
});
