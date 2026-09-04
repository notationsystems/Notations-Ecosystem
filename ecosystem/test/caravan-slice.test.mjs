import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIREMENTS, readEstate, report, score } from '../caravan/slice.mjs';
import { loadCatalog } from '../validate.mjs';

const complete = { name: 'a candidate', first_party_documents: true, counterparty_relationships: true, returnable_evidence: true, movement_events: true, bounded_extent: true };

test('the instrument refuses to score a candidate that does not state everything', () => {
  const partial = score({ name: 'half a case', first_party_documents: true });
  assert.equal(partial.truthClass, 'NOT_EVIDENCED');
  assert.equal(partial.missing.length, 4);
  assert.match(partial.whyUnknown, /partial evidence/);
});

test('a candidate holding all five is eligible, and says how many it holds', () => {
  const r = score(complete);
  assert.equal(r.truthClass, 'VERIFIED_DERIVATION');
  assert.equal(r.eligible, true);
  assert.equal(r.held.length, Object.keys(REQUIREMENTS).length);
});

test('the two the wedge rests on are not tradeable against the other three', () => {
  const noDocuments = score({ ...complete, first_party_documents: false });
  assert.equal(noDocuments.eligible, false);
  assert.match(noDocuments.why, /nothing to demonstrate lineage on/);

  const noParties = score({ ...complete, counterparty_relationships: false });
  assert.equal(noParties.eligible, false);
  assert.match(noParties.why, /party resolution is the wedge/);

  // Three of five is a majority, and still not eligible: the criterion is not a vote.
  const majority = score({ ...complete, first_party_documents: false, counterparty_relationships: false });
  assert.equal(majority.held.length, 3);
  assert.equal(majority.eligible, false);
});

test('the estate reports what it holds and refuses the corridor question', async () => {
  const estate = readEstate(await loadCatalog());
  assert.ok(estate.capabilities > 100, 'the Caravan nodes carry real capability depth');
  assert.ok(estate.documentCapabilities > 0);
  assert.ok(estate.milestoneCapabilities > 0);
  // The one thing the repository cannot know, said as a typed non-success rather than guessed.
  assert.equal(estate.corridorEvidence.truthClass, 'NOT_EVIDENCED');
  assert.match(estate.corridorEvidence.whyUnknown, /machinery, not traffic/);
});

test('the instrument invents no candidates of its own', async () => {
  const { scored } = await report();
  assert.deepEqual(scored, [], 'with no candidates supplied, it scores none — it does not imagine corridors');
});
