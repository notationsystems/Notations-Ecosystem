# Notations Ecosystem Control Plane

The control plane is the private coordination backend for the Notations
Universe. It connects ecosystem nodes—APIs, world models, information
libraries, reasoning engines, visual docks, and operator surfaces—without
making a map itself into an execution authority.

`Payload Terminal` is one future node in this graph, not this repository's
codebase. The frontend may live elsewhere in the repository and consume this
service through its OpenAPI contract.

## Guarantees

- An append-only, SHA-256 hash-linked journal records every change.
- Every write uses `expectedRevision`, preventing a stale dock or agent from
  silently overwriting newer state.
- Nodes declare capabilities as `observe`, `propose`, or `execute`.
- `execute` always waits for an explicit operator decision.
- Approval is **not** execution: every coordination record remains
  `dispatch: "not_dispatched"`. Execution adapters are a later, separate
  least-privilege boundary.
- The API rejects credential- and contact-shaped metadata keys. Provider
  credentials, source artifacts, and raw API request bodies do not enter the
  control-plane journal.

## Run locally

```sh
cd control-plane
cp .env.example .env
# Set NOTATIONS_CONTROL_PLANE_TOKEN in .env or your shell.
npm start
```

The process binds to `127.0.0.1:8787` by default. Its only unauthenticated
route is `GET /health`; graph and command endpoints require a Bearer token.

```sh
npm test
npm run check
```

## Dock integration

The visual dock reads:

- `GET /v1/snapshot` for the current node/edge graph, health, and intent state.
- `GET /v1/events?after=<eventCursor>` for incremental updates.

The complete contract is [openapi/control-plane.openapi.yaml](openapi/control-plane.openapi.yaml).
Render an approved coordination request as *approved, not dispatched*; it
would be unsafe to imply that a provider action has already happened.

## Payload: the first detailed twin

`GET /v1/profiles/payload-terminal` returns a versioned profile for Payload
Terminal: its corpus, spatial world model, MCP surface, operating surface, and
provenance-safe external information libraries. The response also gives the
dock's core/evidence layers and detail panels.

`POST /v1/profiles/payload-terminal/apply` materializes that profile as one
append-only event. The request has the small `ProfileApplication` envelope in
the OpenAPI contract; use the snapshot's `revision` as `expectedRevision`.
This is how the dock stays realistic: it displays declared Payload surfaces and
actual future health observations, rather than hand-authored visual fiction.

### Live Payload health

Set `PAYLOAD_TERMINAL_URL` to the one trusted Payload Terminal origin, then
call `POST /v1/adapters/payload-terminal/observe` with the same four-field
profile-application envelope. The adapter reads only `/api/health`, follows no
redirects, accepts no caller-supplied target, limits the response to 64 KiB,
and persists only a bounded `healthy`, `degraded`, or `offline` observation.
It does not forward the remote body, headers, credentials, or any other
Payload data into the control-plane journal.

## Internal Security Constellation

Security posture is an internal operation, not a product API and not a
security-control surface. `npm run profile:security` materializes the internal
Security Constellation: identity and authorization, cryptography/key lifecycle,
API exposure, software supply chain, resilience/backups, audit integrity,
incident state, and Control Plane integrity.

The internal collector records evidence with:

```sh
npm run security:attest -- path/to/signed-attestation.json
```

Each statement is verified against `NOTATIONS_SECURITY_ATTESTERS`, an allowlist
of Ed25519 **public** keys. The journal stores the signed, bounded statement;
the dock receives only category, posture status, freshness, signer identity,
and a short summary. It never receives private keys, credentials, raw
vulnerability findings, unrestricted network topology, or offensive tooling.

## Internal mining and indexing

The Control Plane can rebuild a disposable operational index from the
hash-linked journal it already processes:

```sh
npm run index:rebuild
npm run index:query -- payload
```

The index is intentionally narrower than Payload’s corpus. It mines declared
nodes, capabilities, relationships, current health, bounded security posture,
and the approval queue. It produces signals for unobserved or stale nodes,
critical security posture, missing attestations, and pending approvals. It does
not crawl upstream services, duplicate Payload records, index coordination
purpose text, or copy raw security evidence.
