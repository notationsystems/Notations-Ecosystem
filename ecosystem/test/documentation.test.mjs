import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../validate.mjs';

/**
 * Every number the documentation states about this repository, checked against the thing
 * that produces it.
 *
 * The estate already refuses a derivation written down beside what it derives —
 * `capability_count` said twelve while the file carried fourteen. Prose has the same
 * failure mode and no validator: README.md said the ecosystem suite had 36 tests when it
 * had 43, and UNIVERSE.md said 632 capabilities when the catalog had 634. Both were true
 * when written, which is exactly the problem: nothing ever asked again.
 *
 * A figure that appears in a document and nowhere else is a claim nobody can check. This
 * file is where those claims get checked, so a stale document is a failing test rather
 * than a confident sentence.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

/** Every `name` this markdown states as a count, so a claim can be looked up by subject. */
function claims(prose, patterns) {
  const found = {};
  for (const [name, pattern] of Object.entries(patterns)) {
    const match = prose.match(pattern);
    assert.ok(match, `no longer states ${name} — if the claim was removed, remove it here too`);
    found[name] = Number(match[1]);
  }
  return found;
}

test('the catalog figures the documents state are the catalog as it is', async () => {
  const entries = await loadCatalog();
  const capabilities = entries.reduce((n, { entry }) => n + entry.capabilities.length, 0);
  const relations = entries.reduce((n, { entry }) => n + (entry.relations ?? []).length, 0);
  const services = entries.reduce((n, { entry }) => n + (entry.reference?.external_services ?? []).length, 0);
  const withServices = entries.filter(({ entry }) => (entry.reference?.external_services ?? []).length).length;

  const readme = await read('README.md');
  assert.deepEqual(claims(readme, {
    nodes: /validate\.mjs` \((\d+) nodes/,
    capabilities: /\((?:\d+) nodes, (\d+) capabilities/,
    relations: /\((?:\d+) nodes, (?:\d+) capabilities, (\d+) relations/,
  }), { nodes: entries.length, capabilities, relations });

  // The two closed vocabularies, and how much of the estate reaches outside itself.
  const format = await read('ecosystem/CATALOG_FORMAT.md');
  const surfaces = JSON.parse(await read('ecosystem/surfaces.json'));
  const domains = JSON.parse(await read('ecosystem/data-domains.json'));
  assert.deepEqual(claims(format, {
    surfaces: /surfaces\.json\) \((\d+) surfaces\)/,
    subjects: /data-domains\.json\) \((\d+) subjects\)/,
    services: /which (\d+) nodes use for/,
    serviceCount: /use for (\d+) services/,
  }), {
    surfaces: Object.keys(surfaces.surfaces).length,
    subjects: Object.keys(domains.subjects).length,
    services: withServices,
    serviceCount: services,
  });

  const payloadFirst = await read('docs/PAYLOAD_FIRST.md');
  const first = claims(payloadFirst, { services: /— (\d+) of them across/, nodes: /of them across (\d+) nodes/ });
  assert.deepEqual(first, { services, nodes: withServices });

  // payload-terminal's own shape, stated in two documents that must agree with the file.
  const terminal = entries.find(({ entry }) => entry.nodeId === 'payload-terminal').entry;
  const mcpTools = terminal.capabilities.filter((c) => /^mcp\./.test(c.capabilityId) && !/^mcp\.transport\./.test(c.capabilityId)).length;
  assert.equal(claims(payloadFirst, { tools: /Its (\d+) MCP tools/ }).tools, mcpTools);
  assert.equal(claims(await read('control-plane/README.md'), { capabilities: /catalogued with (\d+) capabilities/ }).capabilities, terminal.capabilities.length);
});

test('the test counts the documents quote are the suites as they are', async () => {
  // A README that undercounts its own suite is telling a contributor the checks are
  // smaller than they are, which is the direction that makes people skip them.
  const count = async (dir, pattern) => {
    const files = (await readdir(path.join(root, dir))).filter((f) => pattern.test(f));
    let total = 0;
    for (const f of files) {
      const source = await readFile(path.join(root, dir, f), 'utf8');
      total += [...source.matchAll(/^\s*(?:test|it)\(/gm)].length;
    }
    return total;
  };
  const suites = {
    'control-plane': await count('control-plane/test', /\.test\.js$/),
    ecosystem: await count('ecosystem/test', /\.test\.mjs$/),
    dock: await count('dock/test', /\.test\.ts$/),
  };

  const readme = await read('README.md');
  const quoted = claims(readme, {
    'control-plane': /control-plane && npm test` \((\d+), of which/,
    ecosystem: /cd ecosystem && npm test` \((\d+)\)/,
    dock: /npm run build` \((\d+)\)/,
  });
  assert.deepEqual(quoted, suites);

  const security = await read('SECURITY.md');
  assert.equal(claims(security, { tests: /npm test\s+# (\d+) tests covering/ }).tests, suites['control-plane']);
});

test('the named security invariants are numbered without a gap, and counted honestly', async () => {
  const invariants = await read('docs/SECURITY_INVARIANTS.md');
  const ids = [...invariants.matchAll(/^\| (SEC-\d{3}) \|/gm)].map((m) => m[1]);

  // A gap in the numbering is a row someone deleted; a duplicate is a row someone pasted.
  // Either way an invariant that is cited elsewhere by id would silently stop existing.
  assert.equal(new Set(ids).size, ids.length, 'a SEC id is listed twice');
  ids.forEach((id, index) => assert.equal(id, `SEC-${String(index + 1).padStart(3, '0')}`));

  const stated = Number((await read('SECURITY.md')).match(/covering (\d+) named invariants/)[1]);
  assert.equal(stated, ids.length);
  assert.equal(Number((await read('README.md')).match(/of which (\d+) are named security/)[1]), ids.length);
});

test('the dock renders what its README says it renders', async () => {
  const readme = await read('dock/README.md');

  // Lenses: one row in the table per lens component, and no lens that ships unlisted.
  const lenses = (await readdir(path.join(root, 'dock/src/lenses'))).filter((f) => /Lens\.tsx$/.test(f)).map((f) => f.replace('Lens.tsx', '').toLowerCase());
  // Skipping the `| Lens | Shows |` header, which matches the same shape as its rows.
  const rows = [...readme.matchAll(/^\| ([A-Z][a-z]+) \| /gm)].map((m) => m[1].toLowerCase()).filter((name) => name !== 'lens');
  assert.deepEqual(rows.slice().sort(), lenses.slice().sort());

  // The Payload rows drawn on the map, counted from the layer files rather than believed.
  const dir = path.join(root, 'ecosystem/payload/layers');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'meta.json');
  let rowCount = 0;
  for (const f of files) {
    const parsed = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
    rowCount += Array.isArray(parsed) ? parsed.length : (parsed.features?.length ?? parsed.rows?.length ?? 0);
  }
  const manifest = JSON.parse(await read('ecosystem/payload/layers.json'));
  assert.equal(Number(readme.match(/the (\w+) Payload layers/)[1] === 'nine' ? 9 : NaN), manifest.layers.length);
  assert.equal(Number(readme.match(/— (\d+) rows/)[1]), rowCount);

  // The posture dimensions the security lens promises are the ones the plane accepts.
  const { POSTURE_DIMENSIONS } = await import('../../control-plane/src/security/evidence.js');
  assert.equal(Number(readme.match(/the constellation: (\d+) posture dimensions/)[1]), Object.keys(POSTURE_DIMENSIONS).length);
});
