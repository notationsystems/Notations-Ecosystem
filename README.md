# Notations Ecosystem

The coordination layer of the Notations Universe: a private **control plane** that records what
each ecosystem node can do and what has been proposed and approved, a **catalog** of the real
nodes (Payload first, modelled deeply), and a **visual dock** that renders the universe as a
Kepler.gl map, a capability graph, an operator view, a coordination ledger and an event timeline.

```
control-plane/   append-only, hash-linked, signed coordination backend (OpenAPI contract)
ecosystem/       catalog of nodes + seed / sample / Payload adapter (layers, health probe)
dock/            the front end (Vite + React + Kepler.gl), consumes the control plane only
security/        repository secret scan and the posture evidence producer
docs/            threat model, invariants, substrate, design notes
```

## Two rules

**Approval is not execution.** The control plane stops at `approved / not_dispatched`; the dock
makes the four states unmistakable and never lights the last one:

```
observed → proposed → approved → dispatched
   ●          ●          ●        ○ (never, until a separate execution adapter exists)
```

**It knows what every system can do, and holds nothing that would let you do it.** The
plane records identities, capabilities, health and security posture. Credentials, key
material, vulnerability detail, network topology, offensive capability and links to raw
findings are refused at the command boundary — so compromising the visualiser yields a
dashboard, not an inventory and a key ring. See [SECURITY.md](SECURITY.md).

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

Credentials: issue one per principal rather than sharing a token — see
[SECURITY.md](SECURITY.md). Without a credential registry the plane falls back to
`NOTATIONS_CONTROL_PLANE_TOKEN`, which holds every role, and warns at boot.

Checks: `cd control-plane && npm test` (39, of which 37 are named security
invariants), `node ecosystem/validate.mjs` (30 nodes, 632 capabilities, 46 relations),
`node security/scan-secrets.mjs`, `cd ecosystem && npm test` (8),
`cd dock && npm run check && npm test && npm run build` (19).

Serving the dock: the build is static, but `frame-ancestors` and `X-Frame-Options`
cannot be delivered by a `<meta>` tag. `dock/public/_headers` carries them for
Cloudflare Pages and Netlify; behind nginx use:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://basemaps.cartocdn.com; font-src 'self' data:; connect-src 'self' https://basemaps.cartocdn.com; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" always;
add_header X-Frame-Options DENY always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy no-referrer always;
```

## Where things live

| Question | Answer |
| --- | --- |
| How healthy is each security control across the estate? | dock → **Security** lens (11 posture dimensions, weakest-link) |
| What can node X do, in which mode, with whose approval? | `ecosystem/catalog/<nodeId>.json` → seeded → `GET /v1/snapshot` |
| What is healthy / stale / waiting for approval / blocked? | dock → **Operator** lens |
| Where are Payload's facilities, corridors, chokepoints, trade flows, disruptions, archive coverage? | dock → **Map** lens (`ecosystem/payload/layers.json`) |
| What changed, why, who asked, was anything dispatched? | dock → **Timeline** / **Ledger** (journal events; every record `not_dispatched`) |
| How do I add a node or relation, record health, request or resolve a capability? | dock → **Console** (validated with the control plane's own validator) |
| How does Payload plug in? | `ecosystem/payload/README.md` (seed, probe, layer extractors) |
| Why is it modelled this way? | `docs/PAYLOAD_FIRST.md`, `ecosystem/UNIVERSE.md` |
| What is the security model, and what proves it? | [SECURITY.md](SECURITY.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/SECURITY_INVARIANTS.md](docs/SECURITY_INVARIANTS.md) |
| Where does this sit in the wider Notation substrate? | [docs/SUBSTRATE.md](docs/SUBSTRATE.md) |
