import assert from 'node:assert/strict';
import test from 'node:test';
import { INVARIANT_IDS, ROLES, checkCorpus, effectiveStanding, gradeEcosystem, gradeNode, loadCatalog } from '../corpus.mjs';

/** A minimal catalog entry carrying only what the corpus checks look at. */
const node = (corpus, nodeId = 'test-node') => ({ nodeId, reference: corpus === undefined ? {} : { corpus } });

const held = (evidence = 'src/x.ts') => ({ standing: 'holds', evidence });
const all = (ids, value) => Object.fromEntries(ids.map((id) => [id, value()]));

test('COR-DOCTRINE the ten invariants and five roles are the ones docs/CORPUS.md states', () => {
  assert.equal(INVARIANT_IDS.length, 10);
  assert.deepEqual(INVARIANT_IDS, ['COR-001', 'COR-002', 'COR-003', 'COR-004', 'COR-005', 'COR-006', 'COR-007', 'COR-008', 'COR-009', 'COR-010']);
  assert.deepEqual(Object.keys(ROLES), ['hold', 'feed', 'transform', 'project', 'coordinate']);
  // A hold is exempt from nothing: owning a corpus is the role every invariant is about.
  assert.deepEqual(ROLES.hold.exempt, []);
});

test('COR-GRADE an undeclared invariant counts against the node, never in its favour', () => {
  const partial = node({ role: 'hold', holding: 'A corpus.', standing: { 'COR-001': held() } });
  const standing = effectiveStanding(partial);
  assert.equal(standing['COR-001'].standing, 'holds');
  assert.equal(standing['COR-004'].standing, 'unknown', 'silence is not assent');
  const graded = gradeNode(partial);
  assert.equal(graded.applicable, 10);
  assert.equal(graded.coverage, 0.1);
});

test('COR-GRADE a role exempts structurally, and exemption is not failure', () => {
  const dock = node({ role: 'project', holding: 'Nothing: it renders the control plane snapshot.', standing: { 'COR-009': held('dock/src/api/controlPlane.ts'), 'COR-010': held('dock/README.md') } });
  const graded = gradeNode(dock);
  // A projection holds nothing to be provenant about, so seven invariants do not apply.
  assert.equal(graded.exempt.length, 7);
  assert.equal(graded.applicable, 3);
  assert.deepEqual(graded.unknown, ['COR-008']);
  assert.equal(graded.grade, 'developing');
});

test('COR-SOUND a canonical-state owner without provenance, refusal or admission is unsound', () => {
  const owner = node({
    role: 'hold',
    holding: 'A canonical state.',
    owner_of: ['physical-economy'],
    standing: {
      ...all(INVARIANT_IDS, held),
      'COR-005': { standing: 'fails', note: 'returns zero for an unknown figure' },
    },
  });
  const graded = gradeNode(owner);
  assert.equal(graded.grade, 'unsound', 'nine of ten is still a different category, not a high score');
  assert.deepEqual(graded.missingSoundness, ['COR-005']);
  // The same gap on a node that owns nothing is merely a low grade.
  const feeder = node({ role: 'feed', holding: 'Evidence.', standing: { 'COR-005': { standing: 'fails', note: 'no typed refusal' } } });
  assert.notEqual(gradeNode(feeder).grade, 'unsound');
});

test('COR-SOUND a fully declared owner grades sound', () => {
  const graded = gradeNode(node({ role: 'hold', holding: 'A canonical state.', owner_of: ['scientific'], standing: all(INVARIANT_IDS, held) }));
  assert.equal(graded.grade, 'sound');
  assert.equal(graded.coverage, 1);
});

test('COR-DECLARE a claim carries the same burden as a capability: holds needs evidence', () => {
  const { errors } = checkCorpus(node({ role: 'hold', holding: 'A corpus.', standing: { 'COR-003': { standing: 'holds' } } }));
  assert.ok(errors.some((e) => /COR-003.*requires an evidence path/.test(e)), errors.join('; '));
});

test('COR-DECLARE an exemption must be structural, and a plan is refused as one', () => {
  const promise = checkCorpus(node({ role: 'hold', holding: 'A corpus.', standing: { 'COR-007': { standing: 'exempt', note: 'not implemented yet' } } }));
  assert.ok(promise.errors.some((e) => /is a plan, not an exemption/.test(e)), promise.errors.join('; '));

  const structural = checkCorpus(node({ role: 'project', holding: 'Nothing.', standing: { 'COR-007': { standing: 'exempt', note: 'holds no raw material to capture' } } }));
  assert.deepEqual(structural.errors, []);

  const silent = checkCorpus(node({ role: 'hold', holding: 'A corpus.', standing: { 'COR-007': { standing: 'exempt' } } }));
  assert.ok(silent.errors.some((e) => /requires a note/.test(e)));
});

test('COR-DECLARE declaring a failure is legal and expected', () => {
  const { errors } = checkCorpus(node({ role: 'feed', holding: 'Documents.', standing: { 'COR-007': { standing: 'fails', note: 'parsed on the wire; no capture is kept' } } }));
  assert.deepEqual(errors, [], 'a catalog that could not record a failure would record only flattery');
});

test('COR-002 two nodes may not own the same canonical state', () => {
  const report = gradeEcosystem([
    { entry: node({ role: 'hold', holding: 'A.', owner_of: ['physical-economy'], standing: {} }, 'a') },
    { entry: node({ role: 'hold', holding: 'B.', owner_of: ['physical-economy'], standing: {} }, 'b') },
    { entry: node({ role: 'hold', holding: 'C.', owner_of: ['scientific'], standing: {} }, 'c') },
  ]);
  assert.deepEqual(report.contested, [{ domain: 'physical-economy', nodeIds: ['a', 'b'] }]);
});

test('COR-002 only a hold may own canonical state', () => {
  const { errors } = checkCorpus(node({ role: 'project', holding: 'A globe.', owner_of: ['physical-economy'], standing: {} }));
  assert.ok(errors.some((e) => /only a hold owns canonical state/.test(e)), errors.join('; '));
});

test('the catalog grades without contested ownership', async () => {
  const report = gradeEcosystem(await loadCatalog());
  assert.equal(report.nodes.length, 30);
  assert.deepEqual(report.contested, [], `contested canonical state: ${JSON.stringify(report.contested)}`);
});
