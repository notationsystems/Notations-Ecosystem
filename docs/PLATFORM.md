# The data platform: one canonical layer, several rebuildable ones

Notation Systems is not building a data lake, a graph database or an AI stack. It is
building a **provenance-first data platform**: one canonical state layer, and several
serving layers that can be dropped and rebuilt from it at any time.

```
Immutable artifacts
        ↓
Canonical State
        ↓
Versioned corpus builds
        ↓
Graph / spatial / semantic / analytical projections
        ↓
APIs, agents, products, and verification
```

Every arrow points one way. Nothing below canonical state writes upward into it, and that
is enforced as a database permission rather than as a convention ([PLAT-004](#invariants)).

The doctrine is machine-readable in [`ecosystem/platform.json`](../ecosystem/platform.json).
The canonical layer is real SQL in [`platform/sql/`](../platform/sql/), and its invariants
are checked against a **running database** by [`platform/check.mjs`](../platform/check.mjs)
— not against the migration files, because a migration written correctly and never applied
produces exactly the schema the check exists to catch.

## Build order

The order is deliberate. Each tier is admitted because the one before it produces the
evidence that justifies it — and the components that are *not* on this list are not on it
for the same reason.

### 1. Object storage — immutable evidence

S3-compatible storage for raw source files, images, PDFs, API captures, model outputs,
manifests and proofs. Four zones, and the distinction between them is the architecture:

| Zone | Meaning |
| --- | --- |
| `raw` | As it arrived, never edited |
| `quarantined` | Arrived but not admissible. Held, not deleted — deleting the thing you could not admit destroys the record of having tried, and a quarantined object must carry a typed reason |
| `canonical_export` | A fold of canonical state at a revision |
| `published_build` | A corpus build someone may cite |

Every object carries a content hash, rights, retention, access scope and source metadata,
and each is `NOT NULL` because each has a failure that only shows up later: no hash and it
cannot be verified; no rights and it cannot be published; no retention and it is kept
forever or deleted too early; no scope and the wrong reader gets it; no source and nobody
can say where it came from.

The database indexes objects and never holds them. There is no `bytea` column in the
evidence schema, and PLAT-009 refuses one: object bytes in the database land in every
backup, replica and `pg_dump` of it.

### 2. PostgreSQL + PostGIS — canonical operational truth

Entities, aliases, observations, assertions, relationships, permissions, audit logs and
the transactional outbox. Two properties matter more than the table list:

**Bitemporal, on two axes that never merge.** `valid_from / valid_to` is event time — when
the fact was true in the world. `recorded_at / superseded_at` is knowledge time — when this
system learned it. Kept apart, "what did we believe last Tuesday about March" has an
answer. Merged, a correction is indistinguishable from a change in the world, which the
corpus doctrine names as COR-004.

**Append-only.** A correction supersedes; it never overwrites. The application role holds
no `DELETE` and holds `UPDATE` only on the columns that record supersession — and a trigger
refuses the same things independently, because a trigger can be disabled by a table owner
and a grant cannot be recovered by an application bug.

**Tenant isolation is row-level security, and row-level security has two silent
failures.** This is the part of the platform most worth reading twice.

- `ENABLE ROW LEVEL SECURITY` exempts the **table owner** from its own policies. A table
  owned by the role that queries it has row security that does nothing, while
  `pg_tables.rowsecurity` reports `true` the whole time. Every tenant table here is also
  `FORCE ROW LEVEL SECURITY`, and `platform/test/rls.test.mjs` demonstrates the leak on a
  table without it before demonstrating the fix.
- A role with `BYPASSRLS` skips every policy on every table, and the attribute appears in
  no table-level view. A perfectly policed schema leaks because of one word in a `CREATE
  ROLE` somewhere else. All three application roles are `NOBYPASSRLS`, and the test proves
  a bypassing role sees both tenants.

The policy compares `tenant_id` to a session setting, and the setting returns `null` when
unset. `tenant_id = null` is null, not true — so a session that forgot to set a tenant sees
**nothing**, rather than everything. The alternative is the shape that turns one missing
middleware call into a full disclosure.

### 3. Outbox + durable workflows — controlled change

**Start with a PostgreSQL transactional outbox, not Kafka.** The outbox row commits in the
same transaction as the change it describes, so either both landed or neither did. A
broker is a second system, and "write the row, then publish" has a gap in the middle that
is eventually hit. The relay claims with `FOR UPDATE SKIP LOCKED` so two relays never
block or double-publish; consumers are idempotent on `outbox_id`. At-least-once, stated,
rather than exactly-once, which is not on offer.

Durable workflows — ingestion, review, compilation, release, challenge, proof jobs — belong
to Temporal, because a workflow that died at step seven of nine resumes at seven with its
execution state intact. Declared here; not yet run.

### 4. Lakehouse — historical analytical state

Canonical snapshots and large historical facts published as Parquet, with Apache Iceberg
tables, because Iceberg's snapshots, schema evolution and atomic metadata commits are what
make a corpus build reproducible and time travel possible.

**Deferred.** Admitted when a canonical snapshot export exceeds what PostgreSQL serves
analytically at acceptable cost — measured, not assumed.

### 5. Rebuildable serving projections

The test of whether something belongs in the `projection` schema: if losing it would lose
information, it is not a projection and it is in the wrong place. Every projection records
the canonical revision it was built from and the command that rebuilds it.

| Projection | First answer | The next thing is admitted when |
| --- | --- | --- |
| Spatial | PostGIS | — |
| Graph | PostgreSQL recursive CTEs, materialized views | A **measured** traversal limit that `projection.reachable()` — depth-capped and cycle-guarded — cannot meet. A graph database on the absence of a limit is how one gets bought without evidence |
| Semantic | A versioned vector projection keyed to canonical ids | There is a semantic query to measure; the choice between pgvector and Qdrant is a latency and scale measurement |
| Lexical | PostgreSQL text search, `pg_trgm` | Lexical needs measured to exceed it |

**No serving projection writes canonical truth.** The projection role has no `INSERT`,
`UPDATE`, `DELETE` or `TRUNCATE` on `canonical` or `evidence`. Not a policy — a policy can
be dropped by whoever owns the table — but the absence of a grant, which no application
bug can recover.

### 6. Trust and assurance

Kernel references and digests throughout: `canonical.notation_uri` is a domain, and
`evidence.content_hash` is checked to be a sha256. Corpus-build and result manifests, with
`projection.build` recording what was built from which revision. GitLab CI for code,
containers, deployment provenance and Harness runs. SP1 proofs for selected deterministic
computations — two catalog nodes already declare SP1 guests. OpenTelemetry for traces,
metrics and logs across ingestion, compilation, APIs and agents.

## The first production footprint

Deliberately lean:

```
GitLab CI/CD
  + managed PostgreSQL/PostGIS
  + S3-compatible object storage
  + application/API workers
  + PostgreSQL outbox
  + Temporal
  + OpenTelemetry collector/backend
```

Iceberg, vector search, graph infrastructure, streaming brokers, GPU workers and
Kubernetes are added when **workload evidence** demands them, and
[`platform.json`](../ecosystem/platform.json) records, for each, what that evidence is.
Kafka, Neo4j, Spark, a blockchain and a large Kubernetes estate are not where this starts.
The early advantage is canonical evidence, temporal state and reproducible corpus builds —
not infrastructure sprawl.

## Invariants

Checked live by `node platform/check.mjs`; proved by `node --test platform/test/`.

| Id | Invariant | Why it is checked rather than assumed |
| --- | --- | --- |
| PLAT-001 | Row security enabled **and forced** on every tenant table | Enabled alone exempts the table owner while `rowsecurity` reports true |
| PLAT-002 | No application role holds `BYPASSRLS` or `SUPERUSER` | Either skips every policy on every table, invisibly |
| PLAT-003 | Every table with row security has a policy | RLS on with no policy denies everything — at runtime, not at review |
| PLAT-004 | No serving projection writes canonical truth | Enforced as the absence of a grant |
| PLAT-005 | Canonical and evidence are append-only for the application | No `DELETE`; `UPDATE` only on supersession columns |
| PLAT-006 | Every canonical fact is bitemporal | Event time and knowledge time as separate columns |
| PLAT-007 | Every evidence object carries hash, rights, retention, scope and source | Each is a failure that only shows up later |
| PLAT-008 | The transactional outbox exists with a partial backlog index | The relay must not scan history to find the next batch |
| PLAT-009 | Evidence rows describe objects and never hold their bytes | Bytes in the database are bytes in every backup |

## Running it

```sh
# any PostgreSQL 16; the development image here has no PostGIS, and the checker says so
export NOTATIONS_PLATFORM_DSN='postgresql://postgres@/notations?host=/tmp/pgsock&port=5433'
node platform/migrate.mjs --reset     # apply platform/sql/*.sql, then check
node platform/check.mjs               # the nine invariants, against the live database
node --test platform/test/            # tenant isolation, proved; both RLS bypasses, demonstrated
```

Both the check and the tests skip with a stated reason when no database is reachable. They
never pass by default: a platform invariant that reports green without a database to check
is the dangerous shape API-000 refuses on the wire.
