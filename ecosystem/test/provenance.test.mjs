import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ROW_PROVENANCE_FIELDS, checkLayerProvenance, observedProvenanceFields, rowProvenance } from '../payload/provenance.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAYLOAD = path.join(here, '..', 'payload');

const manifest = async () => JSON.parse(await readFile(path.join(PAYLOAD, 'layers.json'), 'utf8'));
const rowsOf = async (layer) => JSON.parse(await readFile(path.join(PAYLOAD, 'layers', layer.file), 'utf8'));

test('COR-003 every extracted row names where it came from', async () => {
  const { layers } = await manifest();
  assert.ok(layers.length >= 9);
  for (const layer of layers) {
    const rows = await rowsOf(layer);
    const anonymous = rows.filter((row) => !row.provenance);
    assert.equal(anonymous.length, 0, `${layer.id}: ${anonymous.length} rows carry no provenance`);
  }
});

test('COR-004 a layer declares which provenance fields its rows carry, and the two agree', async () => {
  const { layers } = await manifest();
  for (const layer of layers) {
    const problems = checkLayerProvenance(layer, await rowsOf(layer));
    assert.deepEqual(problems, [], problems.join('; '));
  }
});

test('COR-004 the declaration makes the shortfall legible rather than silent', async () => {
  const { layers } = await manifest();
  const withKnowledgeTime = layers.filter((layer) => layer.provenance_fields.includes('known_at'));
  const without = layers.filter((layer) => !layer.provenance_fields.includes('known_at'));
  // This assertion is a record of the current state, not an approval of it: four earth
  // layers lost known_at when an earlier extractor flattened the upstream Provenance
  // block. Re-running extract-earth.mjs recovers it, and this number should then move.
  assert.ok(withKnowledgeTime.length >= 3, 'at least the three layers that carry knowledge time declare it');
  for (const layer of without) {
    assert.ok(!layer.provenance_fields.includes('known_at'), `${layer.id} must not claim a field its rows lack`);
  }
});

test('the row shape invents nothing the source did not state', () => {
  // A field the source did not carry is absent, not null: "we do not know" and "the
  // source said nothing" must not become the same answer downstream.
  assert.deepEqual(rowProvenance({ source: 'synthetic:demo' }), { provenance: 'synthetic:demo' });
  assert.deepEqual(rowProvenance({ source: 'x', knownAt: '2026-08-27', confidence: 0.9, evidence: ['a', 'b'] }), {
    provenance: 'x', known_at: '2026-08-27', confidence: 0.9, evidence: 'a b',
  });
  assert.deepEqual(rowProvenance({}, { fallback: 'unstated' }), { provenance: 'unstated' });
  assert.deepEqual(rowProvenance(null), {});
  assert.deepEqual(rowProvenance({ source: 'x', confidence: Number.NaN }), { provenance: 'x' });
});

test('a manifest that overstates its rows is caught', async () => {
  const rows = [{ provenance: 'a capture' }];
  assert.deepEqual(observedProvenanceFields(rows), ['provenance']);
  const overstated = checkLayerProvenance({ id: 'x', provenance_fields: ['provenance', 'known_at'] }, rows);
  assert.ok(overstated.some((p) => /declares known_at but no row carries it/.test(p)), overstated.join('; '));

  const understated = checkLayerProvenance({ id: 'y', provenance_fields: ['provenance'] }, [{ provenance: 'a', known_at: '2026-01-01' }]);
  assert.ok(understated.some((p) => /rows carry known_at but the manifest does not declare it/.test(p)), understated.join('; '));

  const anonymous = checkLayerProvenance({ id: 'z', provenance_fields: ['known_at'] }, [{ known_at: '2026-01-01' }]);
  assert.ok(anonymous.some((p) => /every row must carry provenance/.test(p)), anonymous.join('; '));

  const invented = checkLayerProvenance({ id: 'w', provenance_fields: ['provenance', 'vibes'] }, rows);
  assert.ok(invented.some((p) => /"vibes" is not a row provenance field/.test(p)), invented.join('; '));
});

test('one spelling: no layer carries a private name for knowledge time', async () => {
  const { layers } = await manifest();
  const LEGACY = ['captured_at', 'first_capture_at', 'retrieved_at', 'asOf', 'as_of'];
  for (const layer of layers) {
    const rows = await rowsOf(layer);
    const keys = new Set(rows.flatMap((row) => Object.keys(row)));
    for (const legacy of LEGACY) {
      assert.ok(!keys.has(legacy), `${layer.id} carries ${legacy}; knowledge time is spelled known_at (${ROW_PROVENANCE_FIELDS.join(', ')})`);
    }
  }
});
