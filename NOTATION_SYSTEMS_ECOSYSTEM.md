# Notation Systems Ecosystem — architecture and terminology

Notation Systems builds and operates **provenance-bearing computational corpora**. This document
fixes the names. Everything else in the repository is written against them.

## The hierarchy

```text
Notation Systems Ecosystem
  └── Payload OS
        ├── Caravan API      — move physical goods
        ├── Tradewind API    — price and risk
        └── Landshark API    — land as a legal and development object
```

Three levels, and the middle one is not a product.

**Payload OS** is the shared operating, evidence, provenance, identity, corpus, release, policy,
access and verification layer beneath all three APIs. It is **not a fourth public API**. It is never
offered, priced or documented as a surface of its own. What it owns is the spine — the canonical
types all three lines must agree on — and the machinery that makes any answer checkable.

**Caravan, Tradewind and Landshark** are the three product APIs. They are a real partition:
logistics operations, market state and land state are different object worlds that share only a few
keys. The partition, the spine, the cross-line join and the build order are declared in
[`ecosystem/product-lines.json`](ecosystem/product-lines.json) and explained in
[`docs/PRODUCT_LINES.md`](docs/PRODUCT_LINES.md). They are checked by `node
ecosystem/product-lines.mjs`, not asserted.

## Names that are not products

`payload-*` node identifiers — `payload-terminal`, `payload-corpus-graph`, `payload-ocr-agent`,
`payload-render-engine` — and the `Payload` corpus profile are **internal or legacy compatibility
identifiers**. The prefix records where the code came from, not what is sold. A `payload-*` node
implements the Caravan line or the OS beneath it.

The Caravan line was called PAYLOAD before Payload was raised to name the OS. Nothing in a customer-
facing surface may present `payload-*` as a separate product offer.

## The vocabulary

| Term | Means |
| --- | --- |
| **Corpus** | A bounded, named holding somewhere on the substrate chain, with the machinery to answer from it. Ten invariants in [docs/CORPUS.md](docs/CORPUS.md). |
| **Provenance-bearing** | Every answer walks back to the material it came from, and the corpus refuses where it cannot. |
| **Spine type** | A canonical type all three lines share, with exactly one owner: `organization`, `site`, `commodity`, `product_lot`, `contract`. |
| **Truth class** | What a response is worth: three successes and four typed non-successes. Declared in [`ecosystem/truth-classes.json`](ecosystem/truth-classes.json). |
| **Plane** | Who may reach an API and in what shape: tenant read, verification, governance, internal operator. [docs/API_PLANES.md](docs/API_PLANES.md). |
| **Corpus role** | What a node does with state: hold, feed, transform, project, coordinate. |
| **Fabric authority** | What a binding may bind as: evidence source, canonical state, projection, derived compute. |
| **Release** | The build identity an answer was produced under. A consequential view names it. |

## The substrate chain

```text
Source → Artifact → Observation → Entity → Claim → Transformation → State → Decision
```

Every corpus sits somewhere on this chain and says where. [docs/SUBSTRATE.md](docs/SUBSTRATE.md).

## Where to read next

| Question | Document |
| --- | --- |
| What is the bundle, and what is its boundary? | [docs/PAYLOAD_API_PRODUCT.md](docs/PAYLOAD_API_PRODUCT.md) |
| What is the first customer-facing API? | [docs/CARAVAN_API_PRODUCT.md](docs/CARAVAN_API_PRODUCT.md) |
| What may be called, by whom, in what shape? | [docs/API_SURFACE.md](docs/API_SURFACE.md) |
| What may a frontend draw, and what must it never imply? | [docs/CONTROL_PLANE_UNIVERSE.md](docs/CONTROL_PLANE_UNIVERSE.md) |
| What is built, and what is only defined? | [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) |
| How should an agent work in this repository? | [AGENTS.md](AGENTS.md) |
