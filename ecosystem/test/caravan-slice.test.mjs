import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REQUIREMENTS, deriveCorridor, readEstate, report, score } from '../caravan/slice.mjs';
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
  // The capture bears on the corridor, so that is a derivation now. What stays unevidenced is
  // narrower and truer: the parties.
  assert.equal(estate.corridorEvidence.truthClass, 'VERIFIED_DERIVATION');
  assert.equal(estate.partyEvidence.truthClass, 'NOT_EVIDENCED');
  assert.match(estate.partyEvidence.whyUnknown, /a counterparty is not a country/);
});

test('the instrument invents no candidates of its own', async () => {
  const { scored } = await report();
  assert.deepEqual(scored, [], 'with no candidates supplied, it scores none — it does not imagine corridors');
});

test('the corridor is derived from the estate’s real capture, not written by hand', async () => {
  const d = await deriveCorridor();
  assert.equal(d.truthClass, 'VERIFIED_DERIVATION');
  assert.match(d.basis, /comtrade-flows\.json/);
  // The capture is single-commodity, so the commodity was never an open choice.
  assert.equal(d.commodity.only, true);
  assert.equal(d.commodity.hs, '2603');
  assert.equal(d.reachesLatest ?? d.evidence.reachesLatest, true);
});

test('the chosen corridor is current, and leads the corridors that are', async () => {
  const d = await deriveCorridor();
  assert.equal(d.evidence.reachesLatest, true, 'a corridor whose evidence stops short cannot show an answer is current');
  assert.ok(d.evidence.corridorsReachingLatest < d.evidence.corridorsInCapture, 'currency is a real filter, not a formality');
  assert.ok(d.margin.valueRatio > 2, `the lead over ${d.margin.over} is ${d.margin.valueRatio}×; a narrow lead would not settle it`);
});

test('the derivation states what its evidence is not', async () => {
  const d = await deriveCorridor();
  assert.ok(d.limits.length >= 3);
  assert.match(d.limits.join(' '), /not shipment records/);
  assert.match(d.limits.join(' '), /no counterparty/);
});

test('the recorded slice is the derived slice, so the file cannot drift from the data', async () => {
  const [d, lines] = await Promise.all([
    deriveCorridor(),
    readFile(new URL('../product-lines.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  const slice = lines.lines.caravan.v1_slice;
  assert.equal(slice.mode, d.mode);
  assert.equal(slice.geography, d.geography);
  assert.ok(slice.corridor.startsWith(d.corridor.split(' · ')[0]), `${slice.corridor} does not name the derived corridor ${d.corridor}`);
  assert.equal(slice.decided_by, 'derivation');
});

test('a bounded slice is not a shippable one, and the file says which is which', async () => {
  const lines = JSON.parse(await readFile(new URL('../product-lines.json', import.meta.url), 'utf8'));
  const readiness = lines.lines.caravan.v1_slice.readiness;
  assert.ok(readiness.still_needed.length >= 3, 'what is missing is listed, not implied');
  assert.match(readiness.still_needed.join(' '), /counterparty/);
  // The corridor being decided must not be mistaken for the corridor being ready.
  assert.match(readiness.gate, /different questions/);
});
