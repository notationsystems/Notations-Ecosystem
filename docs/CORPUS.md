# The corpus doctrine

Notation Systems builds and operates **provenance-bearing computational corpora**. This
document says what that means precisely enough to check, so that a system either is one
or is not, and so that a system which is not can say which property it lacks.

It is the companion to [SECURITY_INVARIANTS.md](SECURITY_INVARIANTS.md), and takes the
same form on purpose: named invariants, each written so it can be checked rather than
believed. Security answers *can this be trusted to hold what it holds*. This answers
*is what it holds worth anything*.

## What a corpus is

[SUBSTRATE.md](SUBSTRATE.md) names the chain that matters:

```
Source → Artifact → Observation → Entity → Claim → Transformation → State → Decision
```

A **corpus** is a bounded, named body of material somewhere along that chain, together
with the machinery that answers questions from it. Not a database, not a dataset, not a
feed: a *holding* with an extent you can state and a boundary you can point at.

**Provenance-bearing** is the qualifier that does the work. A corpus is provenance-bearing
when every answer it gives can be walked back to the material it came from, and when it
refuses rather than fabricates at the point where that walk would break. The refusal is
not a failure mode of the corpus; it is the corpus working.

Both halves are load-bearing. A body of material with no answering machinery is an
archive. Answering machinery with no traceable holding is a guess with an API. Neither is
what this company builds.

## The invariants

Ten properties. Each is something a system has or does not have, and each can be checked
from that system's catalog entry and the evidence path it cites.

| Id | Invariant | Having it looks like | Not having it looks like |
| --- | --- | --- | --- |
| COR-001 | **Named holding.** The system states what body of material it holds, with an extent. | "UN Comtrade captures, HS 2603, reporters 152/604/360, vintages 2017–2022" | "trade data" |
| COR-002 | **Single owner.** Each canonical state has exactly one owning system; everything else observes, feeds, transforms or projects it. | One node per domain declares `hold`; the rest name it as their owner | Two systems that both believe they are authoritative, reconciled by hand |
| COR-003 | **Provenance travels with the value.** Every emitted value carries its source and its basis, in the same response, not in a footnote. | `{ value, source, basis, record_id }` per figure | A number whose origin is a README |
| COR-004 | **Knowledge time is separate from event time.** When something *became knowable* is recorded apart from when it *happened*. | `known_at` / `retrieved_at` / `asOf` alongside the period described | One timestamp, so "what did we know last Tuesday" is unanswerable |
| COR-005 | **Typed refusal.** An unanswerable question returns a named refusal and a remedy, never a zero, a coerced null, or a synthetic row presented as real. | `{ value: null, refusalType, remedy }` | `0`, `[]`, or a plausible interpolation |
| COR-006 | **Admission by validation.** The only door into canonical state is an explicit validation step. Perception, simulation and forecast enter as candidates. | `validate_candidate`, an evidence pool, a pending-observation inbox | A model writing directly into state |
| COR-007 | **Evidence before interpretation.** Raw material is captured and content-addressed before it is parsed, and the unreconstructable class is replicated. | A sha256 manifest, captures kept beside the parse | Parsing on the wire and keeping the result |
| COR-008 | **Integrity-bound history.** The record of what changed is hash-linked or signed, so history cannot be silently rewritten. | Hash-chained journals, signed records, a rollback anchor | A mutable table with an `updated_at` |
| COR-009 | **Outward-only projection.** A projection never writes back to the state it renders. | A globe, a dock, an SVG that hold nothing | A viewer with an edit button wired to the store |
| COR-010 | **Declared refusal to hold.** The system names what it must never hold or become, and enforces it. | "must never become a person-intelligence tool", gated in CI | Silence, and therefore drift |

### Why ten, and why these

Each one already appears somewhere in this estate as a property some system was built to
have. COR-003, COR-004 and COR-005 are Payload Terminal's discipline for commodity and
freight figures. COR-006 is the Scientific Transformer Engine's `validate_candidate`
seam. COR-007 is why the Information Systems Archive exists at all — UN Comtrade revises
in place and keeps no history, so a lost capture is a permanent loss of knowledge.
COR-008 is this repository's own journal. COR-009 is why Payload Earth must never become
a second state. COR-010 is the terminal's deleted person-intelligence routes.

The doctrine is not new law. It is the estate's existing practice, named once so that a
system can be held to it.

## Standing: four answers, not two

A node declares its standing against each invariant as one of four values. Two of them
are not failures, and keeping them distinct is what makes the instrument honest.

| Standing | Meaning |
| --- | --- |
| `holds` | The property is present, with an evidence path that shows where |
| `fails` | The property is absent and the node says so, by name |
| `exempt` | The property does not apply to this kind of system, with a stated reason |
| `unknown` | Not yet assessed. Counts against the node, never in its favour |

**`exempt` is not a hiding place.** It must carry a reason, and the reason must be
structural rather than circumstantial: a dock is exempt from COR-006 because it admits
nothing, not because admission has not been built yet. "Not built yet" is `fails`.

The distinction matters most for the two node types that hold no domain material:

- A **projection** (the dock, Payload Earth, the OSIRIS dashboard) is exempt from
  COR-001 through COR-007, because it holds nothing to be provenant about. It is bound
  absolutely by COR-009, and a projection that fails COR-009 is not a weak corpus — it is
  a second, unowned canonical state, which is worse than having no projection at all.
- A **coordinator** (this control plane) is exempt from COR-003 through COR-006 for
  domain values, because it holds none. It is bound by COR-008 and COR-010, and it is
  bound by COR-001: a coordinator that cannot say what it records is not coordinating.

## The grade

A node's grade is derived, never asserted:

```
applicable = 10 − exempt
held       = count(holds)
coverage   = held / applicable          (a node with no applicable invariants is `n/a`)
```

Coverage rather than weakest-link, deliberately. The security constellation uses
weakest-link because one broken control compromises the rest; corpus properties are
additive — a corpus with provenance but no knowledge time is genuinely better than one
with neither, and a grading rule that reports both as "failing" tells an operator
nothing about where to work.

One hard rule overrides coverage:

> A node that declares `holds` for **COR-002** — it owns a canonical state — and `fails`
> or `unknown` for any of **COR-003**, **COR-005** or **COR-006** is graded **`unsound`**,
> whatever its coverage.

A canonical-state owner without provenance, without refusal, or without an admission
boundary is precisely the thing this company says it does not build. That is not a low
score; it is a different category, and it should read as one.

## Roles

`kind` (`api`, `world_model`, `information_library`, `reasoning_engine`, `visual_dock`,
`operator_surface`) describes a system's **shape**. It does not say what part the system
plays in the program. That is its **role**, and there are five:

| Role | What it does | Bound by | Exempt from |
| --- | --- | --- | --- |
| `hold` | Owns a corpus or a canonical state | all ten | — |
| `feed` | Supplies evidence into someone else's corpus | 001, 003, 004, 005, 007, 010 | 002, 008, 009 |
| `transform` | Computes over a corpus and returns proposals, never measurements | 003, 005, 006, 010 | 001, 002, 007, 009 |
| `project` | Renders a corpus it does not own | 009, 010 | 001–007 |
| `coordinate` | Records what exists and what was agreed between corpora | 001, 008, 009, 010 | 002–007 |

Role and kind are orthogonal: the same shape can play different parts. `payload-render-engine`
is a `world_model` by shape and a `project` by role, and the tension between those two words
is exactly the risk the catalog should make visible — a world model that projects must never
start holding.

Role lives in the catalog's `reference` block, not in `metadata`. Metadata crosses into
the control-plane journal, and a role is a judgement about a system rather than a bounded
fact about it; the journal records what is, and the catalog records what we say about it.
The derived *grade* is a different matter — see below.

## Where the declaration lives

```jsonc
// ecosystem/catalog/<nodeId>.json
"reference": {
  "corpus": {
    "role": "hold",
    "holding": "One sentence naming the body of material and its extent.",
    "owner_of": ["physical-economy"],        // domains whose canonical state this node owns
    "standing": {
      "COR-003": { "standing": "holds",  "evidence": "src/lib/economy/basis.ts", "note": "every figure carries source, basis and known_at" },
      "COR-007": { "standing": "fails",  "evidence": "docs/ARCHITECTURE.md",     "note": "captures are parsed on the wire; no manifest yet" },
      "COR-009": { "standing": "exempt", "note": "holds no state to write back to" }
    }
  }
}
```

Rules, enforced by `ecosystem/validate.mjs`:

- every applicable invariant appears; an omitted one is graded `unknown`, never skipped;
- `holds` requires an `evidence` path, exactly as `capabilities[].evidence` does;
- `exempt` requires a `note`, and the note may not be "not implemented";
- `fails` is legal, expected, and never a validation error. A catalog that cannot record
  a failure would record only flattery.

### What crosses into the journal

The declaration is catalog-only, like `reference` generally: it is a judgement with
evidence paths, and evidence paths are exactly the kind of pointer the control plane
refuses (see [DATA_CLASSIFICATION.md](DATA_CLASSIFICATION.md)). What crosses is the
*derived* result, as bounded metadata:

```json
"metadata": { "corpus_role": "hold", "corpus_coverage": 0.8, "corpus_grade": "sound" }
```

Two flat strings and a finite number, derived by the seed from the declaration rather
than written by hand — so an operator sees standing in the live snapshot without the
dock ever reading the catalog, and no evidence path leaves the repository.

## Recording an empty system

Four catalog nodes are empty repositories. Grading them requires care in both directions:
scoring them zero is accurate but useless, and exempting them is flattery.

An empty node declares `role` (what it is *for*) and `unknown` for every applicable
invariant, and its grade is `unbuilt` rather than a coverage figure. `unbuilt` is a
statement about the repository, not about the design — and the moment the repository has
content, the same declaration must be filled in or the grade regresses to `0/n`, which is
the correct and uncomfortable answer.
