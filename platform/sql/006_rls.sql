-- 006 · Row-level security, and the two ways it silently does not apply.
--
-- ENABLE ROW LEVEL SECURITY is the half everyone writes. It is not sufficient, and the
-- ways it fails are quiet:
--
--   1. The table owner is exempt from its own policies unless the table also says FORCE.
--      A schema created by `notations_app` and queried by `notations_app` therefore has
--      row security that does nothing at all, while `pg_tables.rowsecurity` reports true.
--   2. A role holding the BYPASSRLS attribute skips every policy on every table. The
--      attribute is not visible in any table-level view, so a schema can be perfectly
--      policed and still leak because of one line in a CREATE ROLE somewhere else.
--   3. A superuser always bypasses. Migrations run as one; the application must not.
--
-- So: FORCE on every tenant table, NOBYPASSRLS asserted on every application role (001),
-- and `platform/check.mjs` verifies all three against the live database rather than
-- trusting that this file was applied.
--
-- https://www.postgresql.org/docs/current/ddl-rowsecurity.html

do $$
declare
  rec record;
begin
  for rec in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('canonical', 'evidence')
      and c.relkind = 'r'
      -- audit_log is handled below: its tenant_id is nullable by design, so the plain
      -- equality this loop writes would hide every untenanted row from everyone.
      and not (n.nspname = 'canonical' and c.relname = 'audit_log')
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      )
  loop
    execute format('alter table %I.%I enable row level security', rec.schema_name, rec.table_name);
    -- The half that is usually missing. Without it the owner reads every tenant.
    execute format('alter table %I.%I force row level security', rec.schema_name, rec.table_name);

    -- One policy, equality against the session's tenant. `app.current_tenant()` returns
    -- null when unset, and `tenant_id = null` is null rather than true — so a session that
    -- forgot to set the GUC sees nothing, instead of seeing everything.
    execute format('drop policy if exists tenant_isolation on %I.%I', rec.schema_name, rec.table_name);
    execute format(
      'create policy tenant_isolation on %I.%I using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant())',
      rec.schema_name, rec.table_name);
  end loop;
end $$;

-- audit_log has a nullable tenant_id: an authentication failure has an actor but not yet a
-- tenant. Its policy admits the tenant's own rows and the untenanted ones, and it is
-- written separately rather than folded into the loop so the difference is deliberate and
-- visible rather than an artefact of a null comparison.
alter table canonical.audit_log enable row level security;
alter table canonical.audit_log force row level security;
drop policy if exists tenant_isolation on canonical.audit_log;
create policy tenant_isolation on canonical.audit_log
  using (tenant_id = app.current_tenant() or tenant_id is null)
  with check (tenant_id = app.current_tenant() or tenant_id is null);

-- Grants. The application reads and writes canonical state; it holds no UPDATE or DELETE
-- on the append-only tables, so the triggers in 003 and 004 are the second line rather
-- than the only one. Two independent mechanisms, because a trigger can be disabled by the
-- table owner and a grant cannot be recovered by an application bug.
grant select, insert on all tables in schema canonical to notations_app;
grant select, insert on all tables in schema evidence to notations_app;
grant update (superseded_at) on canonical.entity, canonical.entity_alias, canonical.observation, canonical.assertion, canonical.relationship to notations_app;
grant update (revoked_at) on canonical.permission to notations_app;
grant update (published_at, attempts, last_error) on canonical.outbox to notations_app;
grant usage, select on all sequences in schema canonical to notations_app;

-- The projection builder reads canonical and evidence. It is granted nothing else on them,
-- which is how "no serving projection writes canonical truth" becomes a permission rather
-- than a convention: the grant to write simply does not exist.
grant select on all tables in schema canonical to notations_projection;
grant select on all tables in schema evidence to notations_projection;
grant select on all tables in schema canonical, evidence to notations_read;

-- New tables inherit the same shape, so a migration that forgets is caught by the checker
-- rather than by a leak.
alter default privileges in schema canonical grant select, insert on tables to notations_app;
alter default privileges in schema canonical grant select on tables to notations_projection, notations_read;
alter default privileges in schema evidence grant select, insert on tables to notations_app;
alter default privileges in schema evidence grant select on tables to notations_projection, notations_read;
