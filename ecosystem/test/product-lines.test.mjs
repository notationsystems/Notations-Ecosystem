import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProductLines, loadProductLines, report } from '../product-lines.mjs';

const clone = (doc) => JSON.parse(JSON.stringify(doc));
const only = (result, invariant) => result.errors.filter((e) => e.startsWith(`${invariant}:`));

test('the partition holds as written', async () => {
  const { errors, warnings, building } = await report();
  assert.deepEqual(errors, [], 'the declared partition must satisfy every LINE invariant');
  assert.equal(building, 'caravan', 'PAYLOAD is the line being built');
  // The one open decision is surfaced, not hidden and not invented.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^LINE-007: caravan is building with an unbounded v1/);
});

test('LINE-001 refuses a second owner for a spine type', async () => {
  const doc = clone(await loadProductLines());
  doc.lines.caravan.spine.owns.push('commodity');
  const r = checkProductLines(doc);
  assert.ok(only(r, 'LINE-001').some((e) => /claims to own "commodity", but the spine gives it to tradewind/.test(e)));
});

test('LINE-001 refuses an owner that owns nothing it was given', async () => {
  const doc = clone(await loadProductLines());
  doc.lines.landshark.spine.owns = doc.lines.landshark.spine.owns.filter((t) => t !== 'site');
  const r = checkProductLines(doc);
  assert.ok(only(r, 'LINE-001').some((e) => /gives "site" to landshark, but landshark does not claim it/.test(e)));
});

test('LINE-002 refuses a line that carries another line\'s key without declaring the reference', async () => {
  const doc = clone(await loadProductLines());
  doc.lines.caravan.spine.references = doc.lines.caravan.spine.references.filter((t) => t !== 'site');
  const r = checkProductLines(doc);
  assert.ok(only(r, 'LINE-002').some((e) => /caravan carries a key of "site" .* does not declare it as a reference/.test(e)));
});

test('LINE-002 refuses a reference shape that cannot be resolved', async () => {
  const doc = clone(await loadProductLines());
  doc.spine.types.commodity.reference_shape = ['display_name'];
  const r = checkProductLines(doc);
  assert.ok(only(r, 'LINE-002').some((e) => /carries none of its keys/.test(e)));
});

test('LINE-003 refuses a line that does not say what it is not', async () => {
  const doc = clone(await loadProductLines());
  doc.lines.tradewind.not_the_job = ['no trucks'];
  const r = checkProductLines(doc);
  assert.ok(only(r, 'LINE-003').some((e) => /at least two non-goals/.test(e)));
});

test('LINE-004 refuses a line that does not name the incumbent layer it declines', async () => {
  const doc = clone(await loadProductLines());
  delete doc.lines.landshark.incumbents.layer_not_cloned;
  const r = checkProductLines(doc);
  assert.equal(only(r, 'LINE-004').length, 1);
});

test('LINE-005 refuses a join whose key is not on the target class', async () => {
  const doc = clone(await loadProductLines());
  doc.class_keys.landshark.parcel = ['parcel_id'];
  const r = checkProductLines(doc);
  assert.ok(only(r, 'LINE-005').some((e) => /joins on "site_id", which landshark.parcel does not carry/.test(e)));
});

test('LINE-005 refuses a join that never leaves one line', async () => {
  const doc = clone(await loadProductLines());
  doc.join.path[1].to = { line: 'caravan', class: 'node' };
  const r = checkProductLines(doc);
  assert.ok(r.warnings.some((w) => /does not cross a line/.test(w)));
});

test('LINE-006 refuses two lines building at once', async () => {
  const doc = clone(await loadProductLines());
  doc.lines.tradewind.stage = 'building';
  const r = checkProductLines(doc);
  assert.ok(only(r, 'LINE-006').some((e) => /caravan and tradewind are both building/.test(e)));
});

test('LINE-008 refuses a source admitted without a rights profile', async () => {
  const doc = clone(await loadProductLines());
  delete doc.lines.caravan.source_classes[0].rights;
  const r = checkProductLines(doc);
  assert.equal(only(r, 'LINE-008').length, 2, 'both the profile and its reason are required');
});

test('LINE-009 refuses a venue adapter with no tie to an owned object', async () => {
  const doc = clone(await loadProductLines());
  const venue = doc.lines.tradewind.source_classes.find((s) => s.kind === 'venue_adapter');
  delete venue.admission_rule;
  const r = checkProductLines(doc);
  assert.ok(only(r, 'LINE-009').some((e) => /must state the tie to an object this line already owns/.test(e)));
});

test('LINE-010 refuses a data subject outside the closed vocabulary', async () => {
  const doc = clone(await loadProductLines());
  doc.lines.caravan.data_subjects.push('truck-vibes');
  const r = checkProductLines(doc, { subjects: new Set(['shipments']) });
  assert.ok(only(r, 'LINE-010').some((e) => /"truck-vibes", which is not in the closed vocabulary/.test(e)));
});

test('a line may not be implemented by a node another line already implements', async () => {
  const doc = clone(await loadProductLines());
  doc.lines.tradewind.implemented_by = ['payload-terminal'];
  const r = checkProductLines(doc, { catalogNodeIds: new Set(['payload-terminal', 'payload-corpus-graph', 'payload-ocr-agent', 'payload-render-engine', 'atlas-mcp']) });
  assert.ok(r.errors.some((e) => /claimed as an implementation by both caravan and tradewind/.test(e)));
});

test('the sequence begins with the spine and every step names its gate', async () => {
  const doc = clone(await loadProductLines());
  assert.match(doc.sequence.steps[0].what, /spine/i);
  doc.sequence.steps[0].what = 'Build the PAYLOAD corridor.';
  const r = checkProductLines(doc);
  assert.ok(r.errors.some((e) => /the first step must be the shared spine/.test(e)));
});
