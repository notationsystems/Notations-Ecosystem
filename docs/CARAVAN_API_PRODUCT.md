# Caravan API — the first wedge

Caravan is the first customer-facing API. This document says what it is, what bounds it, and what
the migration from the `payload-*` names does and does not change.

## The job

**Move physical goods.** Object classes: `shipment`, `load`, `container`, `voyage`, `party`, `node`,
`milestone`, plus the spine type `product_lot` it owns.

## Not the job

- **The price of copper.** That is Tradewind's object; Caravan holds a `commodity_id` reference, not
  a curve.
- **The zoning of a lot.** That is Landshark's object; Caravan holds a `site_id` reference, not a
  by-law.
- **Visibility for everyone, on every mode, everywhere.** That is the incumbent layer.

## The layer it does not clone

TMS vendors, rate benchmarks (Xeneta, Freightos), visibility networks (project44, FourKites), AIS
position vendors (Kpler), carrier EDI. Caravan does not start as visibility-for-everyone, because
that is a coverage fight against networks that already have the coverage.

**Where it competes:** resolved parties, nodes and milestones with lineage on one corridor. An
answer that walks back to the document or event it came from, and refuses when it cannot.

## The v1 slice

One mode, one corridor, one geography, licensed events.

**These three are not yet decided.** `mode`, `corridor` and `geography` are `to_decide` in
[`ecosystem/product-lines.json`](../ecosystem/product-lines.json), and LINE-007 warns on every run of
`node ecosystem/product-lines.mjs` until they are named. This is recorded as an open decision rather
than guessed, because it determines which sources can be licensed, which counterparties can be
resolved, and which parcels Landshark later inherits.

The criterion is written into the file: **choose a corridor where the operator already holds
first-party documents and counterparty relationships**, so resolution and lineage can be
demonstrated against material the estate can lawfully return.

## The migration boundary

Caravan was called PAYLOAD. The rename raised Payload to name the OS beneath all three lines.

**What changes:** product naming, navigation, customer-facing copy, and the line identifier
`caravan` in the partition file.

**What does not change:** the catalogued node identifiers. `payload-terminal`,
`payload-corpus-graph`, `payload-ocr-agent` and `payload-render-engine` keep their names, because a
node identifier is a stable reference in an append-only journal and renaming it would break every
record that already points at it. The prefix is a **legacy compatibility identifier**, recorded as
such in `bundle.legacy_identifiers`.

**The rule that follows:** a `payload-*` identifier may appear in internal tooling, the catalog, and
the control-plane journal. It may never appear in a customer-facing surface as a product name, and a
frontend must not present it as a separate offer.

## What Caravan is implemented by today

Five catalogued nodes: `payload-terminal`, `payload-corpus-graph`, `payload-ocr-agent`,
`payload-render-engine`, `atlas-mcp`. These are reference implementations and internal services.

**None of them is a deployed customer service.** The distinction between reference implementation,
verified release candidate, and deployed customer service must be preserved in UI copy, fixtures and
demos — see [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).
