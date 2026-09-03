-- 001 · Foundation: schemas, roles and the tenant context every policy reads.
--
-- Three schemas, and the separation is the architecture rather than tidiness:
--
--   canonical   the one operational truth. Entities, observations, assertions,
--               relationships, bitemporal state. Written only through governed paths.
--   evidence    the index of immutable objects in the store. Rows describe objects;
--               the bytes live in S3-compatible storage and never in the database.
--   projection  rebuildable serving state. Graph, spatial, semantic, analytical.
--               Droppable and reconstructible from canonical at any time.
--
-- A projection role holds no write grant on `canonical`, which is how "no serving
-- projection writes canonical truth" stops being a convention and becomes a permission.

create schema if not exists canonical;
create schema if not exists evidence;
create schema if not exists projection;
create schema if not exists app;

comment on schema canonical is 'The one canonical state layer. Bitemporal, append-only, tenant-isolated.';
comment on schema evidence is 'Index of immutable objects held in the object store. Rows describe; bytes live in S3.';
comment on schema projection is 'Rebuildable serving projections. Never a source of truth, never a writer of one.';
comment on schema app is 'Session context and helper functions the row-security policies read.';

create extension if not exists pgcrypto;

-- The tenant a session is acting for.
--
-- Read from a GUC rather than from the connection role, so one pooled connection can
-- serve many tenants without one role per tenant. `true` in current_setting means "return
-- null if unset" — and null is the safe answer: every policy below compares equality, so
-- an unset tenant matches no row rather than every row.
create or replace function app.current_tenant() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

comment on function app.current_tenant() is
  'The tenant this session acts for, from the app.tenant_id GUC. Null when unset, which matches no row.';

-- Who is acting. Recorded on every audit row and every canonical write.
create or replace function app.current_actor() returns text
  language sql stable
  as $$ select coalesce(nullif(current_setting('app.actor_id', true), ''), session_user) $$;

comment on function app.current_actor() is
  'The actor this session acts as. Falls back to session_user so a write is never unattributed.';

-- Roles.
--
-- `notations_app` is the application: it reads and writes canonical state through the
-- governed paths, and it is NOBYPASSRLS so that row security is not optional for it.
-- `notations_projection` builds serving state: it reads canonical and writes only
-- projection. `notations_read` is a reader.
--
-- NOBYPASSRLS is stated explicitly on every one of them. A role with BYPASSRLS sees every
-- tenant's rows regardless of policy, and the attribute is inherited by nothing and
-- checked by nobody — so the isolation would hold until someone granted a role that has
-- it, and then fail silently.
do $$
begin
  if not exists (select from pg_roles where rolname = 'notations_app') then
    create role notations_app nologin nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'notations_projection') then
    create role notations_projection nologin nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'notations_read') then
    create role notations_read nologin nobypassrls;
  end if;
end $$;

alter role notations_app nobypassrls;
alter role notations_projection nobypassrls;
alter role notations_read nobypassrls;

grant usage on schema canonical, evidence, projection, app to notations_app, notations_projection, notations_read;

-- The tenant registry itself. Not tenant-scoped: it is the list of tenants.
create table if not exists app.tenant (
  tenant_id   uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,62}$'),
  name        text not null,
  created_at  timestamptz not null default now()
);

grant select on app.tenant to notations_app, notations_projection, notations_read;
