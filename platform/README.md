# platform — the canonical layer, as SQL

The data platform of [docs/PLATFORM.md](../docs/PLATFORM.md), built in the order that
document states. What is here is the part that can be real without a cloud account: the
canonical PostgreSQL schema, its tenant isolation, its append-only discipline, its
transactional outbox, its first serving projections — and the checker that verifies all of
it against a running database rather than against these files.

```
sql/001_foundation.sql    schemas, roles (all NOBYPASSRLS), tenant context
sql/002_evidence.sql      the object index: four zones, five required attributes, no bytes
sql/003_canonical.sql     entities, aliases, observations, assertions, relationships — bitemporal, append-only
sql/004_governance.sql    permissions as rows; an audit log nobody can edit
sql/005_outbox.sql        the transactional outbox, SKIP LOCKED claim, idempotent mark
sql/006_rls.sql           row security ENABLED and FORCED; grants that make projections read-only
sql/007_projections.sql   build manifests, bounded graph traversal, a materialized current-state view
check.mjs                 nine invariants, checked live
migrate.mjs               apply in order, then check
test/rls.test.mjs         isolation proved; both RLS bypasses demonstrated
```

Zero runtime dependencies: the tooling shells out to `psql`, because a checker that needs
`npm install` before it can say whether row security is forced is one that will not be run
where it matters.

```sh
export NOTATIONS_PLATFORM_DSN='postgresql://postgres@/notations?host=/tmp/pgsock&port=5433'
node platform/migrate.mjs --reset
node platform/check.mjs
node --test platform/test/*.mjs
```

No database reachable → the check exits 2 with the DSN it tried, and the tests skip with
a reason. Nothing here passes by default.
