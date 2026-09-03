# The API architecture: four planes, four roles, one invariant

An estate of thirty systems has no single API. It has a great many endpoints that
accumulated one at a time, each sensible where it was written, and no statement of which
of them a stranger may read, which a tenant may read, which admit a write, and which
exist only because a host needs to run the thing.

This document is that statement. It is not a plan for an API gateway; it is the rule that
decides, for any module in the estate, what its API is allowed to be — and it is
machine-readable, in [`ecosystem/api-planes.json`](../ecosystem/api-planes.json), so a
capability that violates it fails validation rather than review.

## The invariant

> **API-000.** Every API response either carries a canonical reference and a proof root,
> or says explicitly that it is an operational observation and states its limitations.

A response with neither is the dangerous shape. It reads as authoritative, it cannot be
verified, and nothing in it says which of the two it is. The reader has to know the
system to know how much to trust the answer, which is exactly the knowledge a stranger
does not have and a machine client never has.

The two kinds are not ends of a spectrum:

| Kind | What it is | What it must carry |
| --- | --- | --- |
| `referenced` | A read of held material, at a stated point in the history that holds it | A `notation://` canonical reference, and the proof root it was read at |
| `operational_observation` | One running process's account of itself, at a moment | When it was observed, and what it does **not** cover |

A snapshot folded from a signed journal is the first: it is a claim about canonical state,
and the revision it was folded at is the root against which the claim can be re-derived. A
liveness probe is the second: it is one process's opinion of itself, and saying so is what
stops it being read as the estate's state. The control plane's `/health` says
`"Reports this process only, not the estate"` for that reason, and the same sentence is
what makes it safe to serve unauthenticated.

## The four planes

Each plane is an audience and a promise, not a URL prefix.

| Plane | Carries | Public |
| --- | --- | --- |
| **Tenant Read API** | Corpus, projection, search, releases, timelines, proof navigation | Yes, tenant-bound |
| **Verification API** | Any supported `VerificationEnvelope`, closure, checks, Warrant Graph | Yes |
| **Governance API** | Coverage, source-policy windows, retention, readiness, preflight, replay, challenges | No |
| **Internal Ingestion / Operator API** | Signed federation packets and controlled operational actions | No |

Two rules bind them, and both are enforced in code rather than stated here alone:

- **Never public canonical CRUD.** A capability whose role mutates may not be served on a
  public plane. A write reaches canonical state through governance or the operator plane,
  or it does not reach it.
- **A readiness answer is never an authorization.** The Governance plane returns typed
  evidence and explicit non-authorization. "Preflight passed" says the checks ran and
  what they found; it does not say anyone may ship.

## The four roles

A role is what a module's API *affords*. It is a property of the module, and every module
has exactly one.

| Role | Meaning | Mutates | Default response |
| --- | --- | --- | --- |
| `public_read` | Publicly readable, bounded by tenant and authorization | No | `referenced` |
| `proof_verifiable` | Answers whether something verifies, and against what root; never mutates what it verifies | No | `referenced` |
| `governed_write` | Writable only through a governed pipeline — a submission a named gate admits or refuses | Yes | `referenced` |
| `host_infrastructure` | Host-only: exposes capability and status, never storage, credentials, provider control or raw internals | No | `operational_observation` |

`host_infrastructure` is the one that cannot return a reference, and the validator refuses
the combination: a module with no held material has no proof root to name, and a status
endpoint dressed as an authority is worse than an honest one.

## The thirteen module families

The mapping from module to role and plane. A capability declares its **family** and
nothing else; role, planes and response kind are derived from this table by
[`ecosystem/api.mjs`](../ecosystem/api.mjs). A family that changes its treatment changes
it once, and every capability in it moves.

| Family | Modules | API treatment | Role | Planes |
| --- | --- | --- | --- | --- |
| `kernel` | Kernel, canonical, registry, verification router | Universal reference resolution and proof verification; never direct mutation | `proof_verifiable` | Verification, Tenant Read |
| `persistence` | Journal, closure persistence, PostgreSQL repository | Internal persistence adapters; public API reads only through tenant-bound resolvers | `host_infrastructure` | Operator |
| `acquisition` | Source policy, acquisition, normalization, capture, **admission**, archive, retention | Read policy/receipt/retention status; writes only through governed ingestion | `governed_write` | Governance, Operator |
| `corpus` | Corpus build, profiles, identity mapping, diff, corpus release | Corpus catalog, build comparison, membership, provenance, time-bound reads | `public_read` | Tenant Read |
| `projection` | Lexical, vector, spatial, analytical, graph, coverage, index projections | Projection catalog plus bounded query endpoints with exact proof roots | `public_read` | Tenant Read |
| `agent` | Context packages, agent execution, authorized search | Tenant-bound tools; return references and authorization state, not unrestricted data | `public_read` | Tenant Read |
| `release` | Methodology, attestation, trusted signers, market release, activation | Release and trust-status endpoints; activation and signing stay operator-only | `proof_verifiable` | Tenant Read, Operator |
| `readiness` | Release preflight, production readiness | Governance/readiness APIs with typed evidence, exceptions, explicit non-authorization | `governed_write` | Governance |
| `operations` | Projection workers, checkpoints, telemetry, operational snapshots | Lag, replay state, bounded health and evidence — not provider control | `host_infrastructure` | Governance, Operator |
| `topology` | Ecosystem, apparatus, Control Plane, Security Constellation | Architecture/topology APIs with logical views and no raw security details | `public_read` | Tenant Read |
| `federation` | Federation, signatures, replay audit | Signed-packet ingestion, acknowledgements, replay reports, audit reads | `governed_write` | Operator, Governance |
| `adjudication` | Pattern adjudication, challenges, scientific harness, computation | Candidates, reviews, reproducibility, outcomes | `governed_write` | Governance |
| `infrastructure` | Object store, token auth, deployment bindings, HTTP/MCP runtime | Capability and status only; never storage or credential controls | `host_infrastructure` | Operator |

Each family also records what it may **never** do, and those are the entries that carry
the weight: `persistence` may never expose a public route into the store; `projection` may
never write back to what it projects; `adjudication` may never present a computation
result as a measurement; `infrastructure` may never return a credential.

## How this relates to the corpus doctrine

[CORPUS.md](CORPUS.md) asks whether what a system holds is worth anything. This asks who
may reach it and in what shape. They meet in three places, and the overlap is deliberate:

- **COR-009, outward-only projection**, is the `projection` family's `never`. One is
  graded per node, the other refused per capability.
- **COR-006, admission by validation**, is what `governed_write` means at the API
  boundary: the gate the corpus doctrine requires is the same gate the architecture says
  a write must pass.
- **COR-003, provenance travels with the value**, is API-000's first branch. A referenced
  response carries the reference and the root; a value with neither is exactly the
  unprovenanced value COR-003 refuses.

## Three things the table did not settle, and what encoding it decided

Writing this down as a checkable rule rather than a diagram forced three answers. Each was
found by the validator refusing a capability, not by reading the table again.

**Admission is a write, so it is not `corpus`.** The `corpus` row lists *admission* among
its modules while its treatment sentence is entirely read-shaped — catalog, comparison,
membership, provenance, time-bound reads. Four capabilities declared `corpus` and executed:
`canonical.validate_candidate`, `runtime.feedback_loop.submit`, `commerce.cli.commit`,
`assess_pool`. They are the door into canonical state, which is `acquisition`'s
"writes only through governed ingestion" and COR-006's explicit validation step, said twice.
Admission moved; the corpus family stayed read-only.

**Activation is not an endpoint.** The `release` row pairs read and write the same way:
"Release and trust-status endpoints" is the API, and "activation and signing stay
operator-only" is not an API at all. That needed a fourth thing beside role and plane —
an **exposure**. A capability is either served on its family's planes, or it is
`operator_local`: an action a person triggers, off every plane. Twenty-four capabilities
in the estate are in that set, and it is the set worth being able to list: key rotation,
credential issue, site activation, Docker runtime, model switching. Two obligations keep
it from becoming an escape hatch — an operator approves, and it may not be reached over
`mcp`, `agent-tool` or `webhook`. A person decides; an agent does not get to.

**Some deployed surfaces the architecture would not serve.** The estate runs mirrors it
did not write, and two of TrustGraph's MCP tools write platform configuration: reachable
by any agent holding the endpoint, with no operator between the request and the effect.
`infrastructure` forbids control surfaces and `operator_local` cannot hold them, because a
model can call an MCP tool. Forcing a family that fits would make the architecture
describe a system nobody runs; refusing to place them would leave the write paths
uncounted. So a capability may declare **`api_deviation`** — a sentence saying what does
not fit and why it is served anyway. The catalog already records corpus failures this way,
for the same reason: a record that cannot express a failure records only flattery.

## Where the estate stands

`node ecosystem/api.mjs` reports it, and these are today's figures:

| | |
| --- | --- |
| Capabilities placed | 628 of 634 — the six unplaced are the empty repositories' placeholders, which serve nothing |
| By role | 300 `public_read`, 240 `governed_write`, 48 `proof_verifiable`, 40 `host_infrastructure` |
| By response kind | 584 `referenced`, 44 `operational_observation` |
| Off every plane | 24, all operator-triggered |
| Declared deviations | 2, both config mutation over MCP on one mirror |
| **Mutating capabilities on a public plane** | **0** |

First-party nodes declare a family per capability. An upstream mirror declares one default
at the node and overrides where a capability differs: how this estate exposes someone
else's system is the estate's decision to make, but fifty-three per-capability judgements
about a repository nobody here reads would be manufacture rather than description.

## What is enforced, and where

- `ecosystem/validate.mjs` refuses an unknown family, a mutating capability on a public
  plane, a `host_infrastructure` capability claiming a reference, and an `execute`
  capability in a family whose role does not mutate.
- `node ecosystem/api.mjs` reports the estate's whole surface — by role, by plane, by
  response kind, by family — and **exits non-zero if any mutating capability reaches a
  public plane**.
- The control plane implements API-000 on its own responses, and it is **SEC-043**. Every
  body leaves through one `json()` helper that asserts the invariant on the way out, so a
  response satisfying neither shape is refused rather than served — projection stays
  total, and the failure surfaces as an honest refusal instead of a bricked route. A test
  walks every route and every status the plane can reach from a request:

  | Route | Shape | Carries |
  | --- | --- | --- |
  | `GET /health` | observation | Nothing about held state, and it says so — that sentence is what makes it safe unauthenticated |
  | `GET /v1/snapshot` | referenced | `notation://state/notationsystems/control-plane@<revision>`, and a root naming the chain, its signing state and its anchor |
  | `GET /v1/events` | referenced | The same, plus the cursor the page was read at |
  | `GET /v1/security/status` | observation | This process's configuration and counters, and three limitations including that they reset on restart |
  | `POST /v1/commands` | referenced | The record hash the write landed at, so a caller can point at exactly the history their command produced |
  | Every refusal | observation | That it makes no claim about canonical state, and that nothing was written |

  An unsigned chain is still hash-linked and still a root, so `proofRoot` names the chain
  and the signing state separately — reading "verified" over both is the conflation the
  field exists to prevent. The dock shows it under the revision: `proof root ·
  hash-linked, signed, anchored`.
