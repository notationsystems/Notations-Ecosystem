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

The v1 slice is **Peru → China, HS2603 — copper ores and concentrates**, maritime bulk, Pacific.

It was derived, not chosen. `ecosystem/payload/layers/comtrade-flows.json` is the estate's only real
trade capture (UN Comtrade, `known_at` 2026-08-27, bitemporal, provenance per row). It is *entirely*
HS2603, so the commodity was never open. Ranking its 54 corridors by currency first and magnitude
second leaves one answer: Peru → China is among the 20 that reach the latest vintage (2022), and
leads them at $16.1 B and 9.04 Mt — 7.6× the runner-up. The mode follows from the cargo and the
endpoints: 9 Mt of ore across the Pacific has no land option.

`node ecosystem/caravan/slice.mjs` recomputes it, and a test fails if the recorded slice ever drifts
from the derivation.

**What that evidence is not.** Annual national trade statistics, not shipment records. It names no
counterparty, no vessel and no milestone. It bounds the slice; it does not make the slice shippable.
Those are two different questions, and only the first is now answered:

| Requirement | Standing |
| --- | --- |
| returnable evidence | held — the capture is already served with its provenance and vintage |
| bounded extent | held — corridor, commodity and vintage window are stated and checkable |
| first-party documents | **needed** — shipment-level documents on this corridor |
| counterparty relationships | **needed** — national statistics name countries; a counterparty is not a country |
| movement events | **needed** — milestones from a source whose terms permit serving the derived state |

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
