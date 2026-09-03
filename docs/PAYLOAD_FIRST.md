# Payload first, then generalise

The control plane becomes credible by modelling one real ecosystem deeply. Payload is that
ecosystem. Everything below is expressed in the control plane's own vocabulary (nodes,
capabilities in `observe | propose | execute`, relations, observations, coordination), so the
next ecosystem plugs into the same model instead of forcing a redesign.

## 1. Live topology

Payload is not one node. It is a cluster of nodes with evidenced relations:

| Node | Kind | What it is |
| --- | --- | --- |
| `payload-terminal` | api | The Next.js terminal: freight, economy, OSINT, SDK ingest/stream, GitHub webhook |
| `payload-mcp` | api | The 12 MCP tools, a thin contract layer over the terminal's HTTP routes (stdio) |
| `osiris-intel` | api | The intel ontology engine (`/resolve`), OpenSanctions + Wikidata |
| `payload-data-archive` | information_library | Vintage archive of unreconstructable captures (UN Comtrade), sha256 manifest |
| `payload-operations` | operator_surface | Runbook workflows: deploy, smoke, sweep, daily chain, archive manifest |
| `payload-render-engine` | world_model | Payload Earth: the spatial projection (facilities, routes, flows, events) |
| `payload-ocr-agent` | reasoning_engine | Document perception → observations (never canonical state) |
| `source-*` | information_library | Every external data source the terminal pulls from, with coverage and freshness |

Relations carry evidence paths and say whether they are confirmed by code or inferred.

## 2. Capability-level controls

Each capability declares `mode` and `approval` (the control plane enforces `execute ⇒ operator`).
The catalog adds, per capability, `cost`, `latency`, `provenance`, `data_domain` and `workflow`;
these are reference facts the dock shows in the inspector, never journal state. Health is a
node-level observation (`healthy | degraded | offline | unknown`) recorded by the probe adapter
or an operator.

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
health surface, record an observation), the layer manifest (rows with provenance + a Kepler
spec) and the dock lenses are all ecosystem-agnostic. The next ecosystem adds catalog nodes, an
`ecosystem/<name>/` adapter and, if it has geography, a `layers.json`.
