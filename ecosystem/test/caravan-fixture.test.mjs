import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = async (p) => JSON.parse(await readFile(path.join(here, '..', p), 'utf8'));

const truths = (root) => {
  const found = [];
  const walk = (node, at) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.class === 'string') found.push({ at, truth: node });
    for (const [k, v] of Object.entries(node)) walk(v, `${at}.${k}`);
  };
  walk(root, 'fixture');
  return found;
};

test('every value in the Caravan fixture carries a declared truth class', async () => {
  const [fixture, declared] = await Promise.all([read('caravan/fixtures.json'), read('truth-classes.json')]);
  const classes = new Set(Object.keys(declared.classes));
  const found = truths(fixture);
  assert.ok(found.length > 15, `expected a slice with substance, found ${found.length} classified values`);
  for (const { at, truth } of found) {
    assert.ok(classes.has(truth.class), `${at} carries "${truth.class}", which is not a declared class`);
  }
});

test('a success carries what its class requires, and a non-success carries no value', async () => {
  const fixture = await read('caravan/fixtures.json');
  for (const { at, truth } of truths(fixture)) {
    switch (truth.class) {
      case 'CANONICAL_PROOF':
      case 'VERIFIED_DERIVATION':
        assert.ok(truth.reference, `${at} is ${truth.class} with no canonical reference`);
        assert.ok(truth.proofRoot, `${at} is ${truth.class} with no proof root`);
        assert.notEqual(truth.value, undefined, `${at} is a success with no value`);
        break;
      case 'OPERATIONAL_OBSERVATION':
        assert.ok(truth.observedAt, `${at} is an observation with no observation time`);
        assert.ok(Array.isArray(truth.limitations) && truth.limitations.length, `${at} is an observation with no stated limitations, which is an unsupported claim`);
        break;
      default:
        // API-001: a typed non-success has nowhere to put a value, so a zero cannot be rendered for it.
        assert.equal(truth.value, undefined, `${at} is a non-success carrying a value`);
        assert.ok(truth.whyUnknown && truth.whyUnknown.trim(), `${at} is a non-success that does not say why it is unknown`);
    }
  }
});

test('the fixture exercises every typed non-success, because real data does', async () => {
  const fixture = await read('caravan/fixtures.json');
  const used = new Set(truths(fixture).map(({ truth }) => truth.class));
  for (const c of ['UNOBSERVED', 'UNRESOLVED', 'CONFLICTING', 'NOT_EVIDENCED']) {
    assert.ok(used.has(c), `the fixture never produces ${c}; a fixture with no unknowns teaches a shell to expect data that does not exist`);
  }
  assert.equal(used.size, 7, 'all seven classes should appear, so the shell is built against the whole vocabulary');
});

test('the fixture names the decided slice and still invents no traffic', async () => {
  const [fixture, lines] = await Promise.all([read('caravan/fixtures.json'), read('product-lines.json')]);
  const slice = lines.lines.caravan.v1_slice;
  // The slice is decided, so the fixture names it rather than pretending the question is open.
  assert.equal(fixture.slice.mode, slice.mode);
  assert.equal(fixture.slice.geography, slice.geography);
  // Deciding what the slice is about is not holding records for it, and the fixture says which.
  assert.equal(fixture.slice.evidence.truthClass, 'VERIFIED_DERIVATION');
  assert.equal(fixture.slice.shipment_records.truthClass, 'NOT_EVIDENCED');
  assert.match(fixture.why_no_corridor, /not the same as holding shipment records/i);
  // Every identifier stays visibly synthetic, so a screenshot cannot be mistaken for a reading.
  const ids = JSON.stringify(fixture).match(/"FIXTURE-[A-Z0-9-]+"/g) ?? [];
  assert.ok(ids.length > 10, 'the fixture should be built from visibly synthetic identifiers');
  assert.equal(/"id": "(?!FIXTURE-)/.test(JSON.stringify(fixture, null, 1)), false, 'every id must be visibly a fixture id');
});

test('the fixture hands the browser nothing it may never receive', async () => {
  const [fixture, declared] = await Promise.all([read('caravan/fixtures.json'), read('truth-classes.json')]);
  const text = JSON.stringify(fixture);
  // Shapes, not vocabulary: the fixture legitimately discusses evidence and terms.
  const forbidden = [
    ['key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['url-userinfo', /[a-z][a-z0-9+.-]*:\/\/[^/\s:@"]+:[^/\s@"]+@/i],
    ['private-address', /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}/],
    ['tenant-selector', /"tenant_?(?:id|selector)"/i],
    ['bearer-token', /\bBearer\s+(?![A-Z][A-Z0-9_]*\b)[A-Za-z0-9._~+/-]{16,}/],
  ];
  for (const [id, pattern] of forbidden) {
    assert.equal(pattern.test(text), false, `the fixture carries ${id}, which a browser must never receive`);
  }
  assert.ok(declared.frontend_boundary.may_never_receive.includes('tenant selectors'));
});

test('the fixture says it is a fixture, in the fixture', async () => {
  const fixture = await read('caravan/fixtures.json');
  assert.equal(fixture.status, 'fixture');
  assert.match(fixture.not_a_service, /not a deployed customer service/i);
  assert.match(fixture.frame.release.class, /NOT_EVIDENCED/, 'release identity is not built, so the frame must say so rather than showing an empty field');
});
