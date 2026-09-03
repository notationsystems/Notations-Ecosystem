# Control Plane Universe — the frontend visual contract

The Control Plane surface is an internal, safe visual view of verified architecture, capability,
readiness, security and lineage state. This document is the contract a frontend is held to when it
draws it. It applies to `dock/` and to the offline instance in `ecosystem/twin/`.

## What it draws from

**Governance read endpoints only.** No operator plane, no writes, no signing, no acquisition.

## It is logical, not geographic

The universe is a **logical topology**. Orbits, rings, arcs and positions encode declared structure —
domain, corpus role, registration order, evidence coverage — and nothing about where anything is.

- **Never add coordinates that were not supplied.** A position invented to make a layout work is a
  claim about the world.
- **Never present a logical layout as geography.** The offline instance says so on its face:
  *nothing here is a place and none of this is telemetry*.
- **A geographic map requires separately authorized WGS84 spatial data.** The dock's Map lens is the
  only geographic surface, and it renders only nodes that carry a real location; unlocated nodes are
  reported separately so the map never invents a position.

## Motion is not telemetry

The offline instance runs the estate as a Keplerian solar system. Every orbital element is read off
the corpus — axis from the domain ring, eccentricity from corpus coverage, period from Kepler's
third law — and the motion is that law applied to declared facts.

**It is never a measurement.** A frontend that animates state must say what the animation encodes,
and must not let movement imply liveness that no observation supports.

## Non-success states are the point

The four typed non-successes must survive to the screen. In this estate that means, concretely:

- A node with no observation is drawn as **unobserved**, not as healthy and not as a zero. The
  instance counts them out loud: *26 of 31 bodies have never been observed or attested*.
- An unsigned attestation is drawn as **the principal's word**, not as verified.
- A declared-but-unsynced fabric binding is drawn as **declared, not synced**.
- A coordination request awaiting a decision is drawn as **deciding**, never as approved.

An exception-first surface is the honest shape: what needs attention is the first thing shown, and
a clean count is a claim that has to be earned.

## Deltas

Show **chronological verified transitions only.** A missing snapshot is a gap. Do not synthesize the
state between two records, and do not interpolate a value across a period nothing observed.

The time axis scrubs the journal record by record; each position is a real fold of a real prefix,
and the instance re-folds it rather than trusting a precomputed frame.

## Action affordances

Proportional to authority. **Read, compare, filter, inspect** are appropriate. Commands that change
corpus, rights, release or infrastructure state are not.

Where a surface composes a command, it **drafts and holds** it: it runs the plane's own validation,
shows the refusal when the plane would refuse, and never dispatches. The offline instance refuses
`register_fabric_sync` on every plane including admin, because binding a fabric node is
operator-local — a refusal enforced on the principal, not on the route.

## Deletion

There is none. The journal is append-only; `retire` is a state, not an erasure. A frontend must not
offer a delete affordance that the substrate cannot honour.

## Copy

Preserve the distinction between **reference implementation**, **verified release candidate**, and
**deployed customer service** — in UI copy, in fixtures, and in demos. A sample fold is labelled a
sample fold. An offline instance says it is offline.
