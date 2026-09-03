-- 007 · Rebuildable serving projections.
--
-- Every object here is droppable. That is the test of whether something belongs in this
-- schema: if losing it would lose information, it is not a projection, and it is in the
-- wrong place. Each carries the revision it was built from so a reader can tell how stale
-- it is without asking the builder.
--
-- The order the platform builds them in is deliberately unambitious:
--
--   graph      PostgreSQL recursive CTEs and materialized views. A graph database only
--              after a measured traversal limit, not before.
--   spatial    PostGIS. Declared here and installed where the extension exists; this
--              container has no PostGIS, so `platform/check.mjs` reports the tier as
--              declared-not-installed rather than pretending.
--   semantic   a versioned vector projection keyed to canonical ids. pgvector or Qdrant
--              chosen on measured latency, and neither is installed yet.
--   lexical    a separate search index only when PostgreSQL's own text search is measured
--              to be insufficient. pg_trgm is present and is the first answer.
--
-- None of them writes canonical truth, and the reason that holds is not this comment: the
-- projection role has no INSERT grant on `canonical` (006).

create table projection.build (
  build_id      uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references app.tenant(tenant_id),
  projection    text not null,
  -- The canonical revision this projection was built from. Without it a stale projection
  -- and a fresh one are indistinguishable, and a reader has no way to ask.
  built_from    text not null,
  built_at      timestamptz not null default now(),
  row_count     bigint not null check (row_count >= 0),
  duration_ms   integer not null check (duration_ms >= 0),
  -- Rebuildable means rebuildable: the command that reproduces it, recorded.
  rebuild_command text not null
);

comment on table projection.build is
  'What was built, from which canonical revision, and the command that rebuilds it. A projection whose provenance is unrecorded is one nobody can safely drop.';

create index on projection.build (tenant_id, projection, built_at desc);

-- Graph traversal, in PostgreSQL, until measurement says otherwise.
--
-- The depth bound is not a nicety. An unbounded recursive CTE over a cyclic graph does not
-- return, and "the API hung" is how a graph store gets bought without evidence.
create or replace function projection.reachable(
  from_entity uuid,
  kinds text[] default null,
  max_depth integer default 6
) returns table (entity_id uuid, depth integer, path uuid[])
language sql stable as $$
  with recursive walk as (
    select r.target_entity as entity_id, 1 as depth, array[r.source_entity, r.target_entity] as path
    from canonical.relationship r
    where r.source_entity = from_entity
      and r.superseded_at is null
      and (kinds is null or r.relation_kind = any(kinds))
    union all
    select r.target_entity, w.depth + 1, w.path || r.target_entity
    from walk w
    join canonical.relationship r on r.source_entity = w.entity_id
    where w.depth < max_depth
      and r.superseded_at is null
      and (kinds is null or r.relation_kind = any(kinds))
      -- Cycle guard. Without it this function is a way to hang the database from an API.
      and not r.target_entity = any(w.path)
  )
  -- DISTINCT ON keeps the shortest path to each entity. Aggregating the paths instead
  -- would nest the arrays, and a nested path is not a path.
  select distinct on (w.entity_id) w.entity_id, w.depth, w.path
  from walk w order by w.entity_id, w.depth
$$;

comment on function projection.reachable(uuid, text[], integer) is
  'Bounded graph traversal over live relationships. Depth-capped and cycle-guarded: a graph database is admitted on a measured traversal limit, not on the absence of one here.';

-- The analytical projection: current state per entity, as a materialized view. Cheap to
-- rebuild, and the thing most API reads actually want.
create materialized view projection.entity_current as
  select
    e.tenant_id,
    e.entity_id,
    e.uri,
    e.entity_kind,
    e.valid_from,
    e.attributes,
    e.admitted_from,
    (select count(*) from canonical.observation o
      where o.entity_id = e.entity_id and o.superseded_at is null) as live_observations,
    (select max(o.recorded_at) from canonical.observation o
      where o.entity_id = e.entity_id and o.superseded_at is null) as last_observed_at
  from canonical.entity e
  where e.superseded_at is null;

create unique index on projection.entity_current (entity_id);
create index on projection.entity_current (tenant_id, entity_kind);

comment on materialized view projection.entity_current is
  'Live entities with observation counts. A materialized view, so REFRESH MATERIALIZED VIEW CONCURRENTLY is the whole rebuild.';

grant select on all tables in schema projection to notations_read, notations_app;
grant select, insert, update, delete on projection.build to notations_projection;
grant select on projection.entity_current to notations_projection;
