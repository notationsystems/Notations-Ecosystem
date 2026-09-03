# Notations Ecosystem Control Plane

The control plane is the private coordination backend for the Notations
Universe. It connects ecosystem nodes—APIs, world models, information
libraries, reasoning engines, visual docks, and operator surfaces—without
making a map itself into an execution authority.

`Payload Terminal` is a node in this graph, not this repository's codebase: it
is catalogued with 59 capabilities and is the canonical owner of the physical
economy ([CORPUS.md](../docs/CORPUS.md)). The plane records what it can do; it
holds none of what it holds. The dock lives in `dock/` and consumes this
service through its OpenAPI contract.

## Guarantees

- An append-only, SHA-256 hash-linked, Ed25519-signed journal records every change.
- Every write uses `expectedRevision`, preventing a stale dock or agent from
  silently overwriting newer state. A retry is recognised by its command hash,
  never by its receipt time: the same command twice is `200 duplicate`, the same
  request id with different content is `409 EVENT_ID_CONFLICT`.
- Nodes declare capabilities as `observe`, `propose`, or `execute`, and may
  declare a `maturity` (`production`, `beta`, `experimental`, `research`,
  `planned`). Undeclared stays undeclared: the plane knows no estate and writes
  no maturity onto code it has never seen.
- `execute` always waits for an explicit operator decision.
- Approval is **not** execution: every coordination record remains
  `dispatch: "not_dispatched"`. Execution adapters are a later, separate
  least-privilege boundary.
- The API rejects credential- and contact-shaped metadata keys. Provider
  credentials, source artifacts, and raw API request bodies do not enter the
  control-plane journal.
- Every response carries a canonical reference and a proof root, or says it is
  an operational observation and what it does not cover (API-000).

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

- `GET /v1/snapshot` for the current node/edge graph, health, posture, fabric
  syncs and intent state; `GET /v1/snapshot?at=<eventId>` for the same as it
  stood at any journal record (the twin's time axis).
- `GET /v1/events?after=<eventCursor>` for incremental updates.
- `GET /v1/index` for what needs attention — unobserved, stale, failing,
  unattested, unbound, awaiting approval — built by the plane so there is one
  derivation of "stale" rather than one per client.

The complete contract is [openapi/control-plane.openapi.yaml](openapi/control-plane.openapi.yaml).
Render an approved coordination request as *approved, not dispatched*; it
would be unsafe to imply that a provider action has already happened.

## Independent security attesters

A posture attestation submitted over the wire is authenticated: the principal
held `security.attest`, and the actor it recorded is bound to its credential.
That makes the statement the plane's to vouch for. A collector may instead sign
the statement with its own Ed25519 key, and then the statement is the
collector's: anyone holding the public key can check it against the journal
without trusting the plane at all.

```sh
node src/security/cli.js attester generate --id collector:ci --out ~/keys/collector-ci.pem
# prints the one line to add to the plane's environment — the public half:
#   NOTATIONS_SECURITY_ATTESTERS='{"collector:ci":"<base64url x>"}'
node ../security/attest.mjs --journal data/control-plane.jsonl --signer collector:ci --key ~/keys/collector-ci.pem
```

The plane verifies before it writes and records who vouched as
`security.signer`; unsigned posture is still accepted, and the snapshot then
carries `signer: null`. The plane holds public halves only, so it can verify a
collector and can never impersonate one. `GET /v1/security/status` reports how
many collectors it can verify, never their keys.

## The fabric: which systems bind to canonical state

The plane is not the substrate ([SUBSTRATE.md](../docs/SUBSTRATE.md)); it
records which systems participate in the canonical fabric, under which
authority. A fabric sync manifest names a system node, its identity, the
platform node it binds to, a mode, an authority (`evidence_source`,
`canonical_state`, `projection`, `derived_compute`), the identity classes it
carries and the physical representations it lands in — and never a provider
URL, a record, a document, a credential or an object byte. Provenance and
knowledge time are required and cannot be relaxed by a manifest.

The authority is checked against the system's corpus role: a projection never
binds as canonical state (COR-009, PLAT-004), a feed supplies evidence only, a
transform returns derived state, and only a hold that owns a domain — or the
coordination journal itself — is canonical state. The anchor must declare the
layer it provides in `metadata.fabric_layers`.

`register_fabric_sync` is **operator-local**: run at the host against the
journal, and refused over every plane with `ACTION_OPERATOR_LOCAL`, the admin
role included. The manifests and the tool live in the ecosystem directory:

```sh
node ../ecosystem/fabric.mjs --journal data/control-plane.jsonl
```

## The operational index

```sh
npm run index:rebuild                    # data/control-plane-index.json, beside the journal
npm run index:query -- payload           # every word must match; --kind --health --posture --maturity filter
```

The index is a projection: discard it and rebuild it, never reconcile it. It
mines declared topology, health, bounded posture, maturity, corpus grade and
fabric binding, and produces signals for unobserved and stale nodes, failing
or unsigned posture, systems not yet bound to the fabric, and the approval
queue. It never indexes coordination purpose text or signature bytes, so a
broad search cannot surface them. `GET /v1/index` serves the same projection
over the wire, as an operational observation.

## Contracts

`GET /v1/contracts/result-manifest` publishes the JSON Schema for
`notations.result-manifest.v1`: the sidecar every corpus answer should carry —
corpus build, methodology version, knowledge time, the canonical identities of
the entities, assertions and evidence used, the transforms run, uncertainty,
contradictions and verification state. It is COR-003 and COR-004 made
machine-readable. The plane validates manifests it is shown and holds no
result.

## One journal

This plane was merged with a second implementation of itself
(`codex/control-plane-backend`). Records that plane wrote — `profile_applied`,
`security_attested`, `fabric_sync_registered` — fold here: profiles as nodes and
relations, per-category attestations onto the constellation's dimensions with
their signer, fabric syncs as syncs. A journal either plane wrote is one journal.
