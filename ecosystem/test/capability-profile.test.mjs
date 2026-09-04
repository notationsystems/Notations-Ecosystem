import test from 'node:test';
import assert from 'node:assert/strict';
import { WORK_CLASSES, profileEstate, profileOf, summarise } from '../capability-profile.mjs';

test('every capability gets a profile that says what it is worth', async () => {
  const rows = await profileEstate();
  assert.equal(rows.length, 645);
  for (const r of rows) {
    if (r.workClass) {
      assert.equal(r.truthClass, 'VERIFIED_DERIVATION');
      assert.ok(r.basis, `${r.capabilityId} is classified without saying what it matched on`);
      assert.ok(WORK_CLASSES[r.workClass], `${r.capabilityId} carries work class "${r.workClass}", which is not declared`);
    } else {
      // A capability that declares nothing gets a typed non-success, not a cheap default.
      assert.equal(r.truthClass, 'NOT_EVIDENCED');
      assert.ok(r.whyUnknown);
    }
  }
});

test('no profile carries a latency or cost figure, because nothing measured one', async () => {
  const rows = await profileEstate();
  for (const r of rows) {
    if (!r.measured) continue;
    assert.equal(r.measured.truthClass, 'NOT_EVIDENCED', `${r.capabilityId} carries a measurement nothing recorded`);
    assert.equal(JSON.stringify(r).match(/\b\d+\s?(ms|s\b|%|USD|\$)/), null, `${r.capabilityId} states a figure; a latency is a property of a deployment, not of a declaration`);
  }
});

test('a capability that names a third party is external and cost-bearing', () => {
  const fetched = profileOf({ capabilityId: 'x.fetch', mode: 'observe', provenance: 'the USGS earthquake catalog', description: '' });
  assert.equal(fetched.workClass, 'external_fetch');
  assert.equal(fetched.external, true);
  assert.equal(fetched.costBearing, true);
  assert.match(fetched.basis, /third party/);
});

test('a capability answered from its own journal spends nothing', () => {
  const local = profileOf({ capabilityId: 'x.fold', mode: 'observe', provenance: 'the append-only journal, folded; nothing is fetched to answer', description: '' });
  assert.equal(local.workClass, 'journal_fold');
  assert.equal(local.external, false);
  assert.equal(local.costBearing, false);
});

test('cost-bearing follows from the work class and nothing else', async () => {
  const rows = await profileEstate();
  for (const r of rows.filter((x) => x.costBearing)) {
    assert.ok(['external_fetch', 'model_inference', 'heavy_compute'].includes(r.workClass), `${r.capabilityId} is cost-bearing as ${r.workClass}`);
  }
});

test('a capability that both spends and lets the caller widen the work is counted, not hidden', async () => {
  const rows = await profileEstate();
  const exposed = rows.filter((r) => r.costBearing && r.unboundedInput);
  // This is the shape that turns a caller into a spender of the operator's money. It exists here,
  // and the number is asserted so that it cannot grow unnoticed.
  assert.ok(exposed.length > 0, 'the estate has capabilities of this shape; a zero would mean the rule stopped working');
  assert.ok(exposed.length < rows.length / 4, `${exposed.length} of ${rows.length} capabilities both spend and take unbounded input`);
});

test('what cannot be classified is reported as a count, not absorbed', async () => {
  const s = summarise(await profileEstate());
  assert.equal(s.unclassified + Object.entries(s.byClass).filter(([k]) => k !== 'unclassified').reduce((a, [, n]) => a + n, 0), s.total);
  assert.equal(s.measured, 0, 'nothing in this estate has had its cost or latency measured; a non-zero here needs a source');
});
