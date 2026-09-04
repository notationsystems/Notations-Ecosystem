// The instrument for Caravan's one open decision.
//
// LINE-007 warns until mode, corridor and geography are named, and I will not name them: the
// decision is the operator's, and a guess would commit the estate to sources it cannot licence.
// What is not the operator's is the analysis, and that had been left undone.
//
// The criterion is already written into product-lines.json: choose a corridor where the operator
// already holds first-party documents and counterparty relationships, so resolution and lineage can
// be demonstrated on material the estate can lawfully return. This scores candidates against what
// the catalog actually declares, and refuses to score what it cannot see.
import { loadCatalog } from '../validate.mjs';
import { profileOf } from '../capability-profile.mjs';

/** What a corridor needs before Caravan can demonstrate anything on it. */
export const REQUIREMENTS = Object.freeze({
  first_party_documents: 'The operator already holds documents for this traffic, so extraction and lineage run on material it owns.',
  counterparty_relationships: 'The parties are ones the operator can resolve, because it already transacts with them.',
  returnable_evidence: 'What the corpus holds can lawfully be returned in an answer, rather than only informing one.',
  movement_events: 'Milestones exist to be recorded, from a source whose terms permit the derived state to be served.',
  bounded_extent: 'The slice has an extent that can be stated and a boundary that can be pointed at.',
});

/**
 * The evidence the estate can offer about a candidate, drawn from the catalog rather than assumed.
 * Every field is a truth: what the catalog does not say, this does not answer.
 */
export function readEstate(entries) {
  const caravanNodes = ['payload-terminal', 'payload-corpus-graph', 'payload-ocr-agent', 'payload-render-engine', 'atlas-mcp'];
  const nodes = entries.filter(({ entry }) => caravanNodes.includes(entry.nodeId)).map(({ entry }) => entry);
  const capabilities = nodes.flatMap((n) => (n.capabilities ?? []).map((c) => ({ nodeId: n.nodeId, ...c, profile: profileOf(c) })));

  const firstParty = capabilities.filter((c) => /operator|first[- ]party|own|journal|ledger|corpus/i.test(c.provenance ?? ''));
  const external = capabilities.filter((c) => c.profile.external);
  const documents = capabilities.filter((c) => /document|OCR|artifact|extraction|rate sheet|tender|notice/i.test(`${c.label} ${c.description}`));
  const milestones = capabilities.filter((c) => /milestone|tracking|operations journal|assignment|dispatch|outcome/i.test(`${c.label} ${c.description}`));

  return {
    nodes: nodes.map((n) => n.nodeId),
    capabilities: capabilities.length,
    firstPartyCapabilities: firstParty.length,
    externalCapabilities: external.length,
    documentCapabilities: documents.length,
    milestoneCapabilities: milestones.length,
    // The estate can say what machinery exists. It cannot say which corridor the operator trades on.
    corridorEvidence: {
      truthClass: 'NOT_EVIDENCED',
      whyUnknown: 'The catalog describes machinery, not traffic. Nothing in this repository records which lanes the operator actually moves goods on, who its counterparties are, or which documents it holds — so no corridor can be scored from here.',
    },
  };
}

/**
 * Score a candidate the operator supplies. This does not invent candidates: it takes what the
 * operator knows and turns it into the same shape the estate reasons in, so the decision is made
 * against the written criterion rather than against a feeling.
 */
export function score(candidate) {
  const missing = Object.keys(REQUIREMENTS).filter((k) => candidate[k] === undefined);
  if (missing.length) {
    return {
      candidate: candidate.name ?? 'unnamed',
      truthClass: 'NOT_EVIDENCED',
      whyUnknown: `The candidate does not state: ${missing.join(', ')}. A corridor scored on partial evidence is a corridor chosen on partial evidence.`,
      missing,
    };
  }
  const held = Object.keys(REQUIREMENTS).filter((k) => candidate[k] === true);
  const absent = Object.keys(REQUIREMENTS).filter((k) => candidate[k] === false);
  return {
    candidate: candidate.name ?? 'unnamed',
    truthClass: 'VERIFIED_DERIVATION',
    held,
    absent,
    // The criterion is not a majority vote: first-party documents and resolvable counterparties are
    // what the whole wedge rests on, so a candidate without them cannot be first however it scores.
    eligible: candidate.first_party_documents === true && candidate.counterparty_relationships === true,
    why: candidate.first_party_documents !== true
      ? 'Without documents the operator already holds, there is nothing to demonstrate lineage on.'
      : candidate.counterparty_relationships !== true
        ? 'Without resolvable counterparties, party resolution cannot be shown, and party resolution is the wedge.'
        : `Holds ${held.length} of ${Object.keys(REQUIREMENTS).length} requirements.`,
  };
}

export async function report(candidates = []) {
  const entries = await loadCatalog();
  const estate = readEstate(entries);
  return { estate, scored: candidates.map(score), requirements: REQUIREMENTS };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { estate } = await report();
  console.log('What the estate can say about Caravan\'s readiness:\n');
  console.log(`  nodes                      ${estate.nodes.join(', ')}`);
  console.log(`  capabilities               ${estate.capabilities}`);
  console.log(`  answered from own material ${estate.firstPartyCapabilities}`);
  console.log(`  reach a third party        ${estate.externalCapabilities}`);
  console.log(`  document handling          ${estate.documentCapabilities}`);
  console.log(`  movement events            ${estate.milestoneCapabilities}`);
  console.log('\nWhat it cannot say:\n');
  console.log(`  corridor  NOT_EVIDENCED — ${estate.corridorEvidence.whyUnknown}`);
  console.log('\nThe decision needs five things stated per candidate:\n');
  for (const [k, v] of Object.entries(REQUIREMENTS)) console.log(`  ${k.padEnd(28)} ${v}`);
  console.log('\nSupply candidates to score() and the instrument answers against the written criterion.');
  console.log('It will not answer without all five: a corridor scored on partial evidence is a corridor chosen on partial evidence.');
}
