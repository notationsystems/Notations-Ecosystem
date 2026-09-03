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

Implemented in `control-plane/src/identity/uri.js`, with seventeen classes in two
families:

**Information** — `source`, `artifact`, `observation`, `claim`, `entity`, `dataset`,
`model`, `state`, `transform`, `computation`, `proof`, `node`

**Authority** — `principal`, `agent`, `key`, `deployment`, `verification`

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
assertClass(candidate, 'entity')   // throws if it is a principal, a key, an agent…
resolve(anything)                  // always throws: this layer is not a resolver
```

## How the pieces here map onto the substrate

| Substrate layer | In this repository | Note |
| --- | --- | --- |
| Canonical identity | `control-plane/src/identity/uri.js` | The naming scheme, enforced |
| Coordination ledger | `control-plane/` | Append-only, hash-linked, signed, anchored |
| Projection | `dock/` | Reads snapshots and events; holds no store of its own |
| Catalog of nodes | `ecosystem/catalog/` | 30 systems, seeded into the ledger |
| Spatial representation | `ecosystem/payload/layers/` | Projections for the map lens, provenance per row |
| Evidence about the estate's security | `security/attest.mjs` → posture | Counts and states; the material stays at the source |

The Evidence Lake, State Stores, Compute Stores and Representation Plane live in the
systems the catalog describes — Payload Terminal, the Scientific Transformer Engine, the
Data Acquisition Channel, the corpus graphs. This repository names them and coordinates
between them.

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
