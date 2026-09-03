# Payload adapter (v0)

Payload is the first ecosystem modelled deeply in the control plane. This directory is the
adapter between Payload's repositories and the Notations control plane:

| Piece | What it does | Run |
| --- | --- | --- |
| `../catalog/payload-*.json`, `../catalog/source-*.json`, `../catalog/osiris-intel.json` | Payload's topology as control-plane nodes: terminal API, MCP tools, intel layer, vintage archive, operations workflows, data sources | `node ecosystem/validate.mjs` |
| `../seed.mjs` | Registers nodes and relations through `POST /v1/commands` with `expectedRevision`; idempotent | `node ecosystem/seed.mjs --journal control-plane/data/control-plane.jsonl` |
| `probe.mjs` | Observes `PAYLOAD_URL/api/health` and `OSIRIS_INTEL_URL/health`, records `record_observation` (source `health_check`) | `PAYLOAD_URL=http://localhost:3000 node ecosystem/payload/probe.mjs --journal … --loop 60` |
| `extract-earth.mjs` | Payload Earth world → `layers/earth-*.json` (facilities, chokepoints, routes, flows, events), provenance per row | `PAYLOAD_EARTH_DIR=… node --experimental-strip-types ecosystem/payload/extract-earth.mjs` |
| `extract-terminal.mjs` | Payload Terminal captures → `layers/comtrade-flows.json`, `archive-coverage.json`, `submarine-cables.json`, `nuclear-facilities.json` | `PAYLOAD_TERMINAL_DIR=… PAYLOAD_EARTH_DIR=… node ecosystem/payload/extract-terminal.mjs` |
| `layers.json` | Layer manifest the dock's Kepler lens renders (groups, Kepler layer specs, provenance, `real` flag) | — |

Nothing here dispatches anything. The layers are projections for the dock; the journal only
ever receives node registrations, relations and health observations.
