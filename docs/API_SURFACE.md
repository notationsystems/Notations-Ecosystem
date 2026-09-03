# API surface — what may be called, by whom, in what shape

This is the authorized surface. It restates
[`ecosystem/api-planes.json`](../ecosystem/api-planes.json) and
[`ecosystem/truth-classes.json`](../ecosystem/truth-classes.json) as the frontend must read them,
and adds nothing that is not in one of those two files.

## Four planes

| Plane | Who reaches it | What it may do |
| --- | --- | --- |
| **tenant_read** | A tenant's own client, browser included | Read what that tenant may see, release-bound |
| **verification** | Anyone holding a reference | Check a proof root against the chain that carries it |
| **governance** | Internal readers | Read verified architecture, capability, readiness, security and lineage state |
| **internal_operator** | Host operators, at the host | Everything that changes state |

**A browser may call the first three. It may never call the fourth.**

There is no public canonical CRUD. Writes go through a governed command boundary on the operator
plane, never from a derived representation or a frontend.

## Four roles

Every capability plays one: `public_read`, `proof_verifiable`, `governed_write`,
`host_infrastructure`. The role and plane are **derived** from the capability's family — thirteen
families in `api-planes.json` — rather than written per capability, so a family that changes its
treatment changes it once.

## API-000 — the response shape

> Every API response either carries a canonical reference and a proof root, or says explicitly that
> it is an operational observation and states its limitations.

A response with neither is the dangerous shape: it reads as authoritative, cannot be verified, and
nothing in it says which.

## API-001 — the seven truth classes

API-000 refined into a closed set. Three successes:

| Class | Means | A view must show |
| --- | --- | --- |
| `CANONICAL_PROOF` | Canonical state, checkable against its proof root | reference, proof root, valid time, knowledge time, release |
| `VERIFIED_DERIVATION` | Derived, with the derivation open to inspection | the above, plus the derivation path |
| `OPERATIONAL_OBSERVATION` | One process's opinion of itself at a moment | observed at, limitations, source |

And four typed non-successes, which exist because they are the ones that get lost:

| Class | Means | Never render as |
| --- | --- | --- |
| `UNOBSERVED` | Nothing has looked | zero, empty, healthy, a dash that reads as none |
| `UNRESOLVED` | Identity did not resolve to one subject | one identity with a confidence adornment |
| `CONFLICTING` | Evidenced answers disagree | the most recent, most common or highest-scoring one |
| `NOT_EVIDENCED` | No admitted evidence bears on it | a negative finding |

> **API-001.** A frontend renders the truth class it was given. It never upgrades a class, never
> substitutes a value for a typed non-success, and never styles an observation as a verified fact.

Checked by `dock/test/truth.test.ts` against the declaration, and enforced in the type: a
non-success carries no `value` field, so there is nowhere to put a zero.

## The proof root

A stable provenance and caching key. It proves **what was recorded**, not that what was recorded is
true. A frontend that presents it as evidence of empirical truth has misread it.

## What the browser is never given

Raw evidence, private keys, credentials, tenant selectors, host or network topology, protected
resolvers, deployment controls.

A provenance drill-down requests a **separately authorized bounded view**. It is never derived from
an artifact id or a digest alone — holding a digest is not authorization to read what it digests.

## Cross-line views

A view spanning two APIs is labelled a **governed mapping**. It must not merge identities, suggest
causal or commercial authority, or infer market price from movement, delivery from market data, or
land entitlement from either. The one declared join is in
[PRODUCT_LINES.md](PRODUCT_LINES.md), and its keys are checked rather than drawn.
