# Fabric sync manifests

One file per binding between a system of the estate and the data platform
(`notations-platform`), in the shape the control plane accepts as
`register_fabric_sync` (`notations.fabric-sync-manifest.v1`).

A manifest is a **contract, not an observation**. It says under which authority a system
participates in the canonical fabric — `evidence_source`, `canonical_state`,
`projection`, `derived_compute` — which identity classes it carries and in which physical
representations they land, with provenance and knowledge time required and not relaxable.
It does not say that bytes have moved. None have: the platform is real SQL and is not
deployed, and the dock draws these as declared bindings.

The authority is not a free choice. The plane checks it against the system's corpus role
(docs/CORPUS.md): a projection never binds as canonical state (COR-009, PLAT-004), a feed
supplies evidence only, a transform is derived compute, and a hold is canonical state only
when it owns a domain (COR-002). The nine here follow from the roles the catalog already
declares; a tenth that contradicted its role would be refused, which is the point.

```sh
node ecosystem/fabric.mjs --journal control-plane/data/control-plane.jsonl   # after the seed
```

There is deliberately no `--url`. Binding a system to canonical state is operator-local:
the plane refuses it over every plane, the admin role included (SEC-045).
