# Project context — what is built, and what is only defined

Read this before believing any surface. The gap between what is specified and what runs is the most
common thing a frontend accidentally lies about.

## The bundle

```text
Notation Systems Ecosystem → Payload OS → { Caravan API, Tradewind API, Landshark API }
```

Payload OS is the shared layer, not a fourth API. See
[NOTATION_SYSTEMS_ECOSYSTEM.md](NOTATION_SYSTEMS_ECOSYSTEM.md).

## Status, honestly

| Thing | Status | Evidence |
| --- | --- | --- |
| Control plane (identity, journal, coordination) | **built** | `control-plane/`, 59 tests, 46 named security invariants |
| Data platform (canonical state, tenant isolation) | **built** | `platform/`, 9 invariants and 9 proofs against a live PostgreSQL |
| Ecosystem catalog | **built** | 31 nodes, 645 capabilities, 46 relations, 9 fabric bindings |
| Corpus doctrine and grading | **built** | `ecosystem/corpus.mjs`, all nodes graded |
| API planes | **built** | `ecosystem/api-planes.json`, enforced on the wire |
| Truth classes | **built** | `ecosystem/truth-classes.json`, mirrored and tested in the dock |
| Visual dock | **built** | `dock/`, ten lenses on the Control Plane surface |
| Caravan product shell | **built over a fixture** | `dock/src/product/`, reading `ecosystem/caravan/fixtures.json` |
| Tradewind / Landshark shells | **built as typed mapping views** | shape and the declared join only; no data surface, because neither line has a source |
| Offline twin instance | **built** | `ecosystem/twin/`, reproducible byte for byte |
| Product-line partition | **declared, checked** | `ecosystem/product-lines.json`, ten LINE invariants |
| **Caravan API** | **building** — no bounded v1 slice yet | five implementing nodes, all reference implementations |
| **Tradewind API** | **defined, not built** | zero implementing nodes |
| **Landshark API** | **defined, not built** | zero implementing nodes |
| Release identity and release-bound reads | **specified, not built** | the frame is in `truth-classes.json`; nothing issues a release yet |

## What this means for a frontend

- **No deployed customer service exists.** Every node in the catalog is a reference implementation or
  an internal service. UI copy must not imply otherwise.
- **Tradewind and Landshark shells are shells.** Design them as compatible product surfaces and typed
  mapping views. Do not present them as live or comprehensive until their own source, release, rights
  and customer-service evidence exists.
- **Release-bound reads are not available yet.** A view that shows a release field today is showing a
  frame with nothing in it. Show the field as `NOT_EVIDENCED` rather than blank, or leave the frame
  out until the field can be filled.
- **The Caravan v1 slice is undecided.** Mode, corridor and geography are `to_decide`. A demo that
  picks one has invented it.

## The surfaces, and what each reads

| Surface | Reads | Standing |
| --- | --- | --- |
| Control Plane | governance reads from a live plane, or the sample snapshot | internal |
| Caravan | `ecosystem/caravan/fixtures.json` — a shape fixture on synthetic identifiers | reference implementation |
| Tradewind | nothing; the Caravan slice supplies the mapping counts only | not built |
| Landshark | nothing; the Caravan slice supplies the mapping counts only | not built |

Each product surface is linkable: `?surface=caravan`. An unrecognised value opens the Control Plane
rather than a product, so a bad link never lands a reader on a customer surface they did not ask for.

## The one open decision

Caravan's v1 slice. `node ecosystem/product-lines.mjs` warns until mode, corridor and geography are
named. The criterion is in [docs/CARAVAN_API_PRODUCT.md](docs/CARAVAN_API_PRODUCT.md).

## Checks

```
cd control-plane && npm test                      # 59, of which 46 are named security invariants
node ecosystem/validate.mjs                        # 31 nodes, 645 capabilities, 46 relations
node ecosystem/corpus.mjs
node ecosystem/product-lines.mjs                   # ten LINE invariants
node security/scan-secrets.mjs
cd ecosystem && npm test
cd dock && npm run check && npm test && npm run build
node platform/migrate.mjs --reset && node --test platform/test/   # needs a live PostgreSQL
```
