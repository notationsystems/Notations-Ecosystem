# The Notation substrate, and where this repository sits in it

Notation Systems is not heading for one master database. It is heading for a substrate
with **one canonical identity space and many physical representations**: raw artifacts,
normalized entities, graphs, spatial data, time series, vectors, simulation states and
proofs, each in the store that suits it, all addressable by the same names.

```
                        NOTATION SYSTEMS
                              │
                        Nodes / Universe            ← projection and navigation
                              │
              ┌───────────────┴───────────────┐
              │  Canonical Knowledge Plane    │
              │  + Provenance / Identity      │
              └───────────────┬───────────────┘
                              │
                    Canonical Data Fabric
                              │
        ┌─────────────────────┼─────────────────────┐
   Evidence Lake         State Stores          Compute Stores
   raw artifacts         entities              simulations
   documents             observations          embeddings
   datasets              claims                derived states
   feeds                 provenance            model outputs
        └─────────────────────┼─────────────────────┘
                              │
                      Representation Plane
                Graph / Spatial / Vector / SQL / RDF
                              │
                     Retrieval + Reasoning
                              │
                 Agents / APIs / Models / Apps
```

The chain that matters is not the storage choice:

```
Source → Artifact → Observation → Entity → Claim → Transformation → State → Decision
```

Every stage of that chain has a class in the identity space, `Decision` included: this
plane is the system that holds decisions, and a chain whose last stage could not be named
would end in the one place the estate actually writes to. A resolved coordination record
is `notation://decision/notationsystems/<coordinationId>`, and it is a name like any
other here — the plane still dereferences nothing.

## What this repository is

**This repository is not the substrate.** It is the coordination layer above it: a
control plane that records which systems exist, what they can do, how healthy they are,
and what has been proposed and approved between them.

That distinction is load-bearing, and it is a security property as much as an
architectural one:

> **Nodes must never become the database.**

A projection that accumulated the material it displays would become the single most
valuable target in the estate — one compromise yielding the artifacts, the credentials
to fetch more, and a map of where everything is. So the control plane holds identities
and bounded facts, and nothing else. It has no resolver, no provider credentials, and no
network capability to fetch what it names. `identity/uri.js` exports `resolve()` purely
to throw, so the absence is explicit and testable rather than an omission someone later
"fixes" with a `fetch`.

## The identity space

```
notation://<class>/<namespace>/<local-id>[@<version>]
```

Implemented in `control-plane/src/identity/uri.js`, with eighteen classes in two
families:

**Information** — `source`, `artifact`, `observation`, `claim`, `entity`, `dataset`,
`model`, `state`, `transform`, `computation`, `proof`, `decision`, `node`

**Authority** — `principal`, `agent`, `key`, `deployment`, `verification`

One word is worth pinning down, because it appears twice and reads like two things.
`observation` in this space is "a measured or perceived fact about an entity at a time".
The plane's `record_observation` command records the health of a node. Those are the same
class applied to different subjects — a node is an entity, and its health at a moment is
a fact about it — not two meanings of one word. What the plane does *not* record is the
substrate's other sense of the word: an observation about a facility, a shipment or a
polymer belongs to the system that owns that domain's state, and reaches the plane only
as a count in a posture signal or not at all.

Keeping the families apart is the point. The security mandate requires that evidence,
canonical-state, execution, user, service, agent, cryptographic, deployment and
verification identities never collapse into one identifier or trust domain. A single
untyped id space would let an agent identity be spelled like a key identity; here
`assertClass` refuses it, and `sameClass` makes the distinction checkable.

The grammar is strict by construction: no percent-encoding, no query, no fragment, no
relative segments, no empty segments, a bounded length. Anything that could produce two
spellings of one identity is refused rather than normalised, so **equality of identity is
equality of string**.

```js
uri.entity('notationsystems', 'port-of-montreal')
uri.artifact('notationsystems', 'comtrade-2026-08-27', 'v2')
uri.proof('notationsystems', 'sp1-run-4471')
uri.decision('notationsystems', 'coord-4471')   // the chain's terminal stage, addressable
assertClass(candidate, 'entity')   // throws if it is a principal, a key, an agent…
resolve(anything)                  // always throws: this layer is not a resolver
```

## How the pieces here map onto the substrate

| Substrate layer | In this repository | Note |
| --- | --- | --- |
| Canonical identity | `control-plane/src/identity/uri.js` | The naming scheme, enforced. Every snapshot node carries its derived `uri`, every coordination record its `decision` name, and a posture `evidenceRef` accepts an information-family identity — so the space is on the wire, not only in this document |
| Coordination ledger | `control-plane/` | Append-only, hash-linked, signed, anchored |
| Projection | `dock/` | Reads snapshots and events; holds no store of its own |
| Catalog of nodes | `ecosystem/catalog/` | 30 systems, seeded into the ledger |
| Spatial representation | `ecosystem/payload/layers/` | Projections for the map lens, provenance per row |
| Evidence about the estate's security | `security/attest.mjs` → posture | Counts and states; the material stays at the source, and a collector may sign the statement with its own key so the plane's word is not the only word |
| The platform beneath | `platform/sql/`, catalogued as `notations-platform` | One repository, one system: the canonical layer, evidence index, outbox and projections as a node of the universe, so the fabric has an anchor a binding can name |
| Fabric bindings | `ecosystem/fabric/*.json` → `register_fabric_sync` → `snapshot.fabric` | Contracts, not observations: which system participates under which authority, checked against its corpus role — a projection never binds as canonical state. Operator-local; the plane refuses it over every plane |

The Evidence Lake, State Stores, Compute Stores and Representation Plane live in the
systems the catalog describes — Payload Terminal, the Scientific Transformer Engine, the
Data Acquisition Channel, the corpus graphs. This repository names them and coordinates
between them.

## What the substrate runs on

The storage and compute beneath these layers is specified in [PLATFORM.md](PLATFORM.md):
one canonical PostgreSQL layer with bitemporal, append-only, tenant-isolated state; an
object store indexed but never mirrored into the database; a transactional outbox rather
than a broker; and serving projections that are rebuildable by definition and hold no write
grant on canonical truth. Its canonical schema is real SQL in `platform/sql/`, and its nine
invariants are checked against a running database rather than against the files.

## Where this goes next

The natural evolution is from a coordination ledger toward a versioned world-state
system, where an entity is not a row but a state over time:

```
X(t+1) = F(X(t), O(t), E(t))
```

with `X` canonical state, `O` observations, `E` evidence, and `F` an explicit,
reproducible transition. The control plane already records the shape of this: nodes
declare capabilities, observations update health, and every transition is an event in an
append-only chain that can be replayed. Extending the same discipline to canonical
entity state is a continuation of the existing model, not a redesign of it.

Two invariants should survive that evolution:

1. **One canonical identity space, many physical representations.** Storage can change
   underneath a `notation://` name without the name changing.
2. **The projection is never the database.** Whatever Nodes grows into, it navigates the
   substrate under the substrate's own authorization — it does not accumulate it.
