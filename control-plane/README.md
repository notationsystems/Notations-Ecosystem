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
