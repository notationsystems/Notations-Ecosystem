# Notations Ecosystem

The coordination layer of the Notations Universe: a private **control plane** that records what
each ecosystem node can do and what has been proposed and approved, a **catalog** of the real
nodes (Payload first, modelled deeply), and a **visual dock** that renders the universe as a
Kepler.gl map, a capability graph, an operator view, a coordination ledger and an event timeline.

```
control-plane/   append-only, hash-linked coordination backend (OpenAPI contract)
ecosystem/       catalog of nodes + seed / sample / Payload adapter (layers, health probe)
dock/            the front end (Vite + React + Kepler.gl), consumes the control plane only
docs/            design notes
```

## The one rule

**Approval is not execution.** The control plane stops at `approved / not_dispatched`; the dock
makes the four states unmistakable and never lights the last one:

```
observed → proposed → approved → dispatched
   ●          ●          ●        ○ (never, until a separate execution adapter exists)
```

## Run it

```sh
# 1. control plane (loopback :8787, fail-closed until the token is set)
cd control-plane && cp .env.example .env && export NOTATIONS_CONTROL_PLANE_TOKEN=dev-token && npm start

# 2. seed the catalog into the journal (in another shell; no HTTP needed)
node ecosystem/seed.mjs --journal control-plane/data/control-plane.jsonl
#    …or through the API:  node ecosystem/seed.mjs --url http://127.0.0.1:8787 --token dev-token

# 3. optional: observe Payload's health into the plane
PAYLOAD_URL=http://localhost:3000 node ecosystem/payload/probe.mjs --url http://127.0.0.1:8787 --token dev-token --loop 60

# 4. the dock (proxies /cp → :8787; paste the token in the rail, or leave it empty for the sample snapshot)
cd dock && npm install && npm run dev
```

Checks: `cd control-plane && npm test`, `cd ecosystem && npm test`, `cd dock && npm run check && npm test && npm run build`.

## Where things live

| Question | Answer |
| --- | --- |
| What can node X do, in which mode, with whose approval? | `ecosystem/catalog/<nodeId>.json` → seeded → `GET /v1/snapshot` |
| What is healthy / stale / waiting for approval / blocked? | dock → **Operator** lens |
| Where are Payload's facilities, corridors, chokepoints, trade flows, disruptions, archive coverage? | dock → **Map** lens (`ecosystem/payload/layers.json`) |
| What changed, why, who asked, was anything dispatched? | dock → **Timeline** / **Ledger** (journal events; every record `not_dispatched`) |
| How do I add a node or relation, record health, request or resolve a capability? | dock → **Console** (validated with the control plane's own validator) |
| How does Payload plug in? | `ecosystem/payload/README.md` (seed, probe, layer extractors) |
| Why is it modelled this way? | `docs/PAYLOAD_FIRST.md`, `ecosystem/UNIVERSE.md` |
