# Payload first, then generalise

The control plane becomes credible by modelling one real ecosystem deeply. Payload is that
ecosystem. Everything below is expressed in the control plane's own vocabulary (nodes,
capabilities in `observe | propose | execute`, relations, observations, coordination), so the
next ecosystem plugs into the same model instead of forcing a redesign.

## 1. Live topology

Payload is not one node. It is a cluster of nodes with evidenced relations:

| Node | Kind | Role | What it is |
| --- | --- | --- | --- |
| `payload-terminal` | api | hold | The Next.js terminal and the canonical owner of the physical economy: freight, economy, OSINT, SDK ingest/stream. Its 12 MCP tools and its operations and CLI surfaces are capabilities on this node, not nodes of their own |
| `osiris-intel` | api | feed | The intel ontology engine (`/resolve`), OpenSanctions + Wikidata |
| `information-systems-archive` | information_library | hold | Vintage archive of unreconstructable captures (UN Comtrade), sha256 manifest |
| `payload-render-engine` | world_model | project | Payload Earth: the spatial projection (facilities, routes, flows, events) |
| `payload-ocr-agent` | reasoning_engine | feed | Document perception → observations (never canonical state) |
| `payload-corpus-graph` | information_library | hold | Planned: documents and freight evidence linked with provenance |
| `atlas-mcp` | api | feed | Candidate logistics-context index, operator-gated, inside the operator's perimeter |

Relations carry evidence paths and say whether they are confirmed by code or inferred.

An earlier draft of this document proposed separate `payload-mcp`, `payload-data-archive`,
`payload-operations` and `source-*` nodes. The catalog went a different way, and the
different way is better: a surface is not a system. The MCP server is a thin contract
layer over the terminal's own routes, so it is twelve capabilities with `surface: "mcp"`
on `payload-terminal`; operations are `ui.operations` and `cli.*` on the same node; the
archive is a real separate repository and is catalogued as `information-systems-archive`;
and an external data source is not a node with capabilities but a thing a node names, so
it lives in that node's `reference.external_services` — 112 of them across 21 nodes. A
node is something that can hold, feed, transform, project or coordinate
([CORPUS.md](CORPUS.md)); nothing else earns one.

The control plane this repository was merged with (`codex/control-plane-backend`) carried
exactly that earlier shape as a profile hardcoded into the plane — `payload-corpus`,
`payload-spatial-world`, `payload-mcp`, `payload-operations`, and four public sources as
nodes of their own. It is not seeded here, for the reason above and for one more: the
plane knows no estate. What that profile carried that the catalog lacked — a versioned
methodology naming the conclusions Payload refuses to draw — now lives where a
methodology belongs, in `payload-terminal`'s `reference.methodology` (§2a).

## 2. Capability-level controls

Each capability declares `mode` and `approval` (the control plane enforces `execute ⇒ operator`).
The catalog may add, per capability, `cost`, `latency`, `provenance`, `data_domain` and
`workflow`; these are catalog-only reference facts, never journal state. Coverage is
uneven and deliberately not filled in by guessing: `cost` and `latency` are measurements,
and a system that refuses to turn an unknown figure into a zero cannot annotate its own
capabilities with invented ones. Where a figure is stated it should carry its basis
("~3.7 ms native at N=2000"), and where it is not known the field is absent. Health is a
node-level observation (`healthy | degraded | offline | unknown`) recorded by the probe adapter
or an operator.

### 2a. Methodology

`payload-terminal` declares `reference.methodology`: `payload-methodology/0.1.0`, status
`research`, with its source classes, temporal semantics, how contradiction and uncertainty
are represented, known limitations, a changelog, and the five conclusions it refuses to
draw — supplier relationships from proximity alone, modeled capacity as reported capacity,
parent ownership as operational control, a missing observation as zero, and a research
capability as a production feature. The status is the honest one until validation evidence
says otherwise, and it is why the last exclusion exists. The name and status cross into the
snapshot as `metadata.methodology` and `metadata.methodology_status`, and every capability
of the terminal carries `methodologyVersion` derived from it; the text stays in the
catalog, where it can be read, and never in the plane, which knows no estate. The result
manifest a Payload answer should travel with is the plane's published contract,
`GET /v1/contracts/result-manifest`.

## 3. Event timeline

The journal is the timeline: `node_registered`, `relation_declared`, `observation_recorded`,
`coordination_requested`, `coordination_resolved`. Each record names the actor, the request
id, a command hash and the record hash that links it to the previous record. `dispatch` is a
field on every coordination record and it is always `not_dispatched`.

## 4. Spatial and temporal dock

Kepler.gl renders two families of data:

- the universe itself: located nodes as points, relations as arcs, from the snapshot;
- Payload's layers (`ecosystem/payload/layers.json`): facilities, chokepoints and constraints,
  routes by mode, multimodal flows, disruption events (time-enabled), UN Comtrade trade-flow
  arcs from captured vintages, archive coverage per reporter, submarine cables, nuclear
  facilities. Every row carries `provenance`; the manifest carries `real: true|false` per layer.

## 5. Operator view

"What is healthy, what is stale, what needs approval, what is blocked?" is the landing lens.
Staleness is derived from `lastObservedAt`; blocked means offline/degraded nodes that others
`depend_on` or receive context from, plus rejected intents.

## The states

```
observed   a node exists in the plane and has a health observation
proposed   someone requested a capability (status ready or approval_required)
approved   an operator resolved the request (approved) — dispatch: not_dispatched
dispatched never lit by anything the dock knows; an execution adapter is a separate boundary
```

## What generalises

The catalog format, the seed (idempotent by content digest), the probe pattern (observe a
health surface, record an observation), the layer manifest (rows in one declared
provenance shape plus a Kepler spec) and the dock lenses are all ecosystem-agnostic. The
next ecosystem adds catalog nodes, an `ecosystem/<name>/` adapter and, if it has
geography, a `layers.json` beside a `layers/` directory.

That sentence was aspirational until recently: `dock/scripts/sync-layers.mjs` named
`ecosystem/payload` in its source and the loader named `layers/payload/`, so a second
adapter would have been extracted, ignored by the sync and invisible on the map. The sync
discovers adapters now and writes an index of what it found; the dock reads the index,
loads each one, and namespaces datasets and Kepler layer ids by adapter so two ecosystems
may both have a layer called `facilities`.

What is still Payload-shaped is the extraction itself — `extract-earth.mjs` and
`extract-terminal.mjs` know those repositories' file layouts, as any adapter must. The
contract between an adapter and the dock is the manifest, and that is general.
