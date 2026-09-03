# Three APIs, one spine

Notation Systems builds three APIs. This document says what each one is, what each one is
deliberately not, and what keeps them one company rather than three. It takes the same form as
[CORPUS.md](CORPUS.md) and [SECURITY_INVARIANTS.md](SECURITY_INVARIANTS.md) on purpose: named
invariants, each written so it can be checked rather than believed.

The machine-readable partition is [`ecosystem/product-lines.json`](../ecosystem/product-lines.json).
`node ecosystem/product-lines.mjs` checks it. `ecosystem/test/product-lines.test.mjs` checks that the
checker refuses each way it can be broken.

## The partition

| API | Object classes | Job | Not the job |
| --- | --- | --- | --- |
| **PAYLOAD** | shipment, load, container, voyage, party, node, milestone | Move physical goods | The price of copper; the zoning of a lot |
| **TRADEWIND** | instrument, contract, curve, print, position, event market | Price and risk | Track a truck |
| **LANDSHARK** | parcel, zone, survey, plan, entitlement, listing/lease | Land as a legal and development object | Clash detection in Revit |

This is a real partition. Logistics operations, market state and land state share only a few keys.
Forcing them into one schema produces a bad API. Two earlier readings were wrong and are corrected
here: LANDSHARK is land administration and the development process, not AEC tooling — engineers are
users of survey and plan objects, not the BIM customer; and PAYLOAD is physical execution only, with
price separated out into TRADEWIND rather than carried alongside dispatch.

## The spine

Keep these canonical types across all three lines, or the OS is three products:

| Type | Owner | What the others hold |
| --- | --- | --- |
| `organization` | NotationOS | A reference. All three lines meet the same counterparties, and a party resolved twice is a party resolved wrong. |
| `site` | LANDSHARK | A reference. LANDSHARK owns the legal geometry; PAYLOAD's facility and node are its own classes pointing at a `site_id`. |
| `commodity` | TRADEWIND | A reference. TRADEWIND owns market identity — what a price is a price of. |
| `product_lot` | PAYLOAD | A reference. The physical lot that moves, with its HS classification, referencing the commodity it instantiates. |
| `contract` | NotationOS, typed per line | A reference. Charter and purchase to PAYLOAD, derivative to TRADEWIND, lease to LANDSHARK — typed, never one blob. |

## The join

The join is the entire argument for one company:

```
TRADEWIND contract  --commodity_id-->  PAYLOAD voyage  --site_id-->  LANDSHARK parcel
     (derivative)      via product_lot                    via node        (receiving)
```

A metals contract prices a commodity; a lot of that commodity rides a voyage; that voyage discharges
at a node standing on a parcel. **If this does not resolve in v1 schemas, three companies were
built.** LINE-005 checks that each hop's key is actually carried by both ends, against the declared
class keys — not against a diagram.

## What each line does not clone

Each of these markets already has vendors at the coverage layer. A line that does not say which
fight it is declining will start it by accident.

**PAYLOAD.** The incumbent layer is TMS vendors, rate benchmarks (Xeneta, Freightos), visibility
networks (project44, FourKites), AIS position vendors (Kpler) and carrier EDI. We do not start as
visibility-for-everyone. We start as resolved parties, nodes and milestones with lineage on one
corridor: an answer that walks back to the document or event it came from, and refuses when it
cannot.

**TRADEWIND.** The incumbent layer is Bloomberg, Refinitiv and exchange market data for listed
derivatives; Kpler, Argus and Platts for physical commodity assessments; venue and tick vendors for
prediction markets. Prediction markets already have tick vendors — listing them beside CME copper
does not make one product. They are a **third source class** under this line (venue, contract, print,
with a rights profile per venue), admitted only where the event resolves against an object the
estate already owns: a disruption on a corridor PAYLOAD holds, a rate decision that prices an
instrument TRADEWIND holds, an outage on a commodity in the spine. Not a Polymarket clone, and not a
general prediction API — that is a different firm.

**LANDSHARK.** The incumbent layer is national parcel, zoning and ownership coverage (Regrid,
LightBox, ATTOM, Precisely) and listings (MLS, CoStar). We lose a coverage fight. We win on **time,
documents and decisions**: official plan against zoning by-law against survey against application
against issued permit against listing, each dated and each walked back to its instrument. That is an
entitlement corpus, not a parcel API. Buy, sell and lease attach to the parcel corpus as dated
observations; this is not a listings portal.

## The order of the build

Three APIs is the product map. It is not the year-one build.

1. **NotationOS releases the spine** — organization, site, commodity, product_lot, contract.
   *Gate:* all three lines resolve the same organization and the same commodity.
2. **One PAYLOAD slice** — one mode, one corridor, licensed events, resolved parties and nodes,
   lineage on every milestone.
   *Gate:* an answer on that corridor walks back to its document or event, and refuses where it
   cannot.
3. **TRADEWIND only on instruments that touch that slice** — the freight derivatives on that
   corridor, or the commodity that rides those ships.
   *Gate:* the contract-to-voyage hop resolves against real objects.
4. **LANDSHARK on parcels in the same geography** — origins, destinations and development sites.
   *Gate:* the voyage-to-parcel hop resolves against real objects.

LINE-006 enforces the shape of this: exactly one line carries `stage: building` at a time. Three
lines building in parallel spends the year on venue and vendor connectors and ships no spine.

## The one open decision

PAYLOAD is `building` and its v1 slice is not yet bounded: **mode, corridor and geography are all
`to_decide`.** LINE-007 warns on exactly this, and will keep warning until the three are named. It is
recorded as an open decision rather than guessed, because it is the decision that determines which
sources can be licensed, which counterparties can be resolved, and which parcels LANDSHARK later
inherits. The criterion is written into the file: choose a corridor where the operator already holds
first-party documents and counterparty relationships, so resolution and lineage can be demonstrated
on material the estate can lawfully return.

## The invariants

| ID | Statement |
| --- | --- |
| LINE-001 | Every spine type has exactly one canonical owner. One line defines it; the others reference it. |
| LINE-002 | A reference is a pointer, not a copy — the owner's identifier and display fields, never the fields that would let a non-owner answer as though it owned the type. |
| LINE-003 | Every line states, in its own file, what it is not. |
| LINE-004 | Every line names the incumbent layer it does not clone, and the layer on which it competes. |
| LINE-005 | The cross-line join resolves in v1 schemas: every hop names its classes and a key both ends carry. |
| LINE-006 | Exactly one line is building at a time. |
| LINE-007 | A building line names a bounded v1 slice — mode, corridor, geography — before it ships. |
| LINE-008 | Every source class carries a rights profile; unread redistribution terms are marked `unverified`, never assumed. |
| LINE-009 | An optional venue adapter is admitted only when its events tie to an object the line already owns. |
| LINE-010 | A line's data subjects come from the closed vocabulary in `data-domains.json`. |

## Where the estate stands against it today

`node ecosystem/product-lines.mjs` reports it. PAYLOAD is implemented by five catalogued nodes
(payload-terminal, payload-corpus-graph, payload-ocr-agent, payload-render-engine, atlas-mcp).
TRADEWIND and LANDSHARK have **no implementing node** — they are defined, not built. The nodes near
them are recorded as adjacent rather than as implementations: pythia-oracle-engine and osiris-intel
sit near TRADEWIND, and the building-information corpora and geoagent sit near LANDSHARK without
being it, since LANDSHARK is land administration rather than BIM.
