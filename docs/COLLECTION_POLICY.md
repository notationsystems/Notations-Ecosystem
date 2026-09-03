# What Notation Systems collects, and what it refuses

The estate says, in a dozen places, that no system of it may become a person-intelligence
tool. Until now that sentence was enforced in exactly one repository — Payload Terminal
deleted the username, breach, phone and scanning routes and gates every route in CI — and
stated as prose everywhere else. A policy held by one system is that system's policy. This
document makes it the company's, and `ecosystem/validate.mjs` checks it.

## The rule

**No first-party system resolves, profiles or accumulates natural persons.** Not as a
feature, not as a side effect kept "just in case", and not by forwarding the question to
something that will answer it.

The reason is the same one behind the evidence boundary and the substrate rule that Nodes
must never become the database: a corpus of people is the one holding whose compromise
cannot be undone by rotating a key or restoring a replica. Provenance-bearing corpora
about commodities, freight, buildings and polymers are the business. Corpora about people
are not, and the distance between the two is one commit unless something refuses.

## Three standings, declared per node

`metadata.person_data` says where a system sits. It is required on every catalog node.

| Standing | Meaning |
| --- | --- |
| `refused` | The system holds no person data and has no path to any. Most of the estate. |
| `incidental` | Person data can arrive inside material collected for another purpose — a name on a bill of lading, a registrant in a WHOIS record, a face in a public camera — and is neither sought nor indexed by it. |
| `serves` | The system answers questions *about people*. Only an `upstream-mirror` may declare this without also declaring an exception. |

`incidental` is not a loophole. It is an admission that a freight document has a signature
on it, and it carries an obligation: such data may not become a query key. A system that
lets you search *by* the person has crossed into `serves`, whatever it says.

## Exceptions are declared, not discovered

A first-party node that declares `serves` must also declare `person_data_exception`
saying what it serves and what would end it. The validator refuses the standing without
the reason, so an exception is a sentence someone wrote and can be asked about, rather
than a route someone finds.

Two nodes are in that position today, both descended from the same upstream:

- **`osiris-intel`** serves `intel.resolve.person` and returns RIPE abuse contacts as
  person nodes. It is the ontology service Payload Terminal calls, so the terminal's own
  CI gate is routed around by its dependency: the terminal forwards `type=person` to it.
- **`osiris-dashboard`** keeps the full upstream person-targeting surface — username,
  phone, leaks, GitHub — that Payload Terminal removed when it forked the same code.

Both are recorded as COR-010 failures in the catalog, which is the corpus doctrine and
this policy agreeing about the same fact from two directions.

## Where it is visible

The standing crosses into the snapshot as node metadata, so an operator sees it without
reading thirty catalog files: the dock's **Corpus** lens filters the estate by standing
and counts the nodes that serve, and the inspector shows a serving node's exception in
full. That is deliberate — an exception nobody can see is indistinguishable from one
nobody wrote. What does not cross is anything the standing is *about*: the plane records
that a node answers questions about people, never an answer.

## What this does not cover

Contact details of *counterparties* — a carrier's dispatcher, a supplier's account
manager — are commercial records about a role, held by the systems that do the commerce,
and they are `incidental` here. They are still person data under any privacy regime that
applies, and this document is a collection policy, not a legal analysis. The control plane
itself refuses contact-shaped metadata keys outright
([DATA_CLASSIFICATION.md](DATA_CLASSIFICATION.md)), so none of it reaches the coordination
ledger either way.
