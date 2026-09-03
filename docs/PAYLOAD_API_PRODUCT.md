# Payload OS — the bundle boundary

Payload OS is the shared layer beneath Caravan, Tradewind and Landshark. This document says what it
owns, what it refuses to become, and how to tell whether something belongs in it.

## What Payload OS is

The shared **operating, evidence, provenance, identity, corpus, release, policy, access and
verification** layer. Concretely, in this repository:

| Concern | Where it lives | Status |
| --- | --- | --- |
| Identity and coordination | `control-plane/` — append-only, hash-linked, Ed25519-signed journal | built |
| Canonical state and isolation | `platform/` — PostgreSQL with row-level security, nine invariants proved against a live database | built |
| Corpus doctrine and grading | `ecosystem/corpus.mjs`, [CORPUS.md](CORPUS.md) — ten invariants, five roles, four standings | built |
| API planes and response shape | `ecosystem/api-planes.json`, [API_PLANES.md](API_PLANES.md) — four roles, four planes, thirteen families | built |
| Truth classification | `ecosystem/truth-classes.json` — three successes, four typed non-successes | built |
| Spine types | `ecosystem/product-lines.json` — organization, site, commodity, product_lot, contract | declared |
| Release identity | Not yet built. A release-bound read is the shape every product API must take, and the frame is specified before it exists. | specified |

## What Payload OS is not

**It is not a fourth public API.** There is no Payload product surface, no Payload pricing, no
Payload customer. A reader who comes away thinking they can buy Payload has been shown the wrong
thing.

**It is not a place to put things that did not fit.** A concern belongs in the OS only if all three
lines need it and would otherwise each build their own. Identity resolution belongs here because a
party resolved twice is a party resolved wrong. Freight rates do not: they are Caravan's, and
putting them here would make the OS a fourth product by accretion.

**Its names are not offers.** `payload-*` node identifiers and the `Payload` corpus profile are
internal or legacy compatibility names — see
[NOTATION_SYSTEMS_ECOSYSTEM.md](../NOTATION_SYSTEMS_ECOSYSTEM.md).

## The test for belonging

A concern belongs in Payload OS when all three hold:

1. **All three lines need it.** Not two, and not "will need it eventually".
2. **Duplicating it breaks the join.** If each line building its own version would make the
   cross-line join unresolvable, it is spine.
3. **It carries no line's business meaning.** The OS owns that an organization is one thing; it does
   not own what a carrier's service level means.

The spine types pass all three. `commodity` is owned by Tradewind rather than the OS because it
carries market meaning, and `product_lot` by Caravan because it carries physical meaning — the OS
owns only the identity discipline that keeps them joinable.

## What the OS guarantees a product API

- **A checkable answer.** Every response carries a truth class; three of the seven are successes and
  four are typed non-successes that must survive to the screen.
- **A boundary that holds without trust.** Tenant isolation is enforced in the database, not in the
  application, and privileged roles are deliberately constrained rather than assumed benign.
- **An append-only record.** Coordination decisions are journalled and hash-linked; a decision has a
  record or it did not happen.
- **A refusal instead of a guess.** Where the corpus cannot answer, the API returns a typed
  non-success rather than a zero, a blank, or an inference.
