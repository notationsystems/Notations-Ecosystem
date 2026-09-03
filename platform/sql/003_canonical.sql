-- 003 · Canonical state: entities, aliases, observations, assertions, relationships.
--
-- Bitemporal throughout, on two axes that are never merged:
--
--   valid_from / valid_to        event time — when the fact was true in the world
--   recorded_at / superseded_at  knowledge time — when this system learned it
--
-- Keeping them apart is what makes "what did we believe last Tuesday about March" a
-- question with an answer. Merging them makes a correction indistinguishable from a
-- change in the world, which is the failure this estate names as COR-004.
--
-- Every table here is append-only. A correction supersedes; it does not overwrite. That is
-- also what makes the outbox safe: an event that says "row X changed" can name the exact
-- row, because the old one is still there.

create domain canonical.notation_uri as text
  check (value ~ '^notation://[a-z]+/[a-z0-9][a-z0-9._:-]{0,127}/[a-z0-9][a-z0-9._:-]{0,127}(@[a-z0-9][a-z0-9._:-]{0,127})?$');

comment on domain canonical.notation_uri is
  'A name in the one canonical identity space (docs/SUBSTRATE.md). A name, never an address: nothing here dereferences one.';

create table canonical.entity (
  entity_id     uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references app.tenant(tenant_id),
  uri           canonical.notation_uri not null,
  entity_kind   text not null,
  valid_from    timestamptz not null,
  valid_to      timestamptz,
  recorded_at   timestamptz not null default now(),
  superseded_at timestamptz,
  recorded_by   text not null default app.current_actor(),
  -- The evidence this entity was admitted on. Not nullable: an entity with no admitting
  -- evidence is an entity somebody typed in.
  admitted_from uuid not null references evidence.object(object_id),
  attributes    jsonb not null default '{}'::jsonb,

  check (valid_to is null or valid_to > valid_from),
  check (superseded_at is null or superseded_at >= recorded_at)
);

comment on table canonical.entity is
  'A canonical entity, bitemporal and append-only. admitted_from names the evidence it entered on — COR-006, as a foreign key.';

-- One live row per identity per tenant. A second live row for the same URI would be two
-- canonical states of one thing, which is the single-owner invariant (COR-002) failing
-- inside one table rather than between two systems.
create unique index entity_one_live_per_uri
  on canonical.entity (tenant_id, uri) where superseded_at is null;
create index on canonical.entity (tenant_id, entity_kind, valid_from desc);

create table canonical.entity_alias (
  alias_id      uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references app.tenant(tenant_id),
  entity_id     uuid not null references canonical.entity(entity_id),
  alias         text not null,
  alias_scheme  text not null,
  confidence    numeric(4,3) check (confidence is null or confidence between 0 and 1),
  recorded_at   timestamptz not null default now(),
  superseded_at timestamptz,
  recorded_by   text not null default app.current_actor(),
  admitted_from uuid not null references evidence.object(object_id)
);

comment on table canonical.entity_alias is
  'A name something is also known by, in a stated scheme. Resolution is a claim with a confidence, never an identity.';

create unique index alias_one_live
  on canonical.entity_alias (tenant_id, alias_scheme, alias) where superseded_at is null;

-- An observation: a measured or perceived fact about an entity at a time.
create table canonical.observation (
  observation_id uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references app.tenant(tenant_id),
  entity_id      uuid not null references canonical.entity(entity_id),
  metric         text not null,
  value_numeric  numeric,
  value_text     text,
  value_json     jsonb,
  unit           text,

  -- The basis, carried with the value rather than looked up. A number whose basis has to
  -- be recovered from somewhere else is a number that will eventually be compared with one
  -- on a different basis.
  basis          text not null,
  value_kind     text not null check (value_kind in ('measured', 'reported', 'derived', 'modelled', 'asserted')),

  valid_from     timestamptz not null,
  valid_to       timestamptz,
  recorded_at    timestamptz not null default now(),
  superseded_at  timestamptz,
  recorded_by    text not null default app.current_actor(),
  admitted_from  uuid not null references evidence.object(object_id),

  -- Exactly one value column. A row carrying two is a row whose readers will disagree.
  check (num_nonnulls(value_numeric, value_text, value_json) = 1),
  check (unit is null or value_numeric is not null),
  check (valid_to is null or valid_to > valid_from)
);

comment on table canonical.observation is
  'A measured or perceived fact about an entity at a time. Carries its own basis and value kind: a modelled value never reads as a measured one.';

create index on canonical.observation (tenant_id, entity_id, metric, valid_from desc);
create index on canonical.observation (tenant_id, metric, valid_from desc) where superseded_at is null;

-- An assertion: a claim, with the observations that support it. Distinct from an
-- observation because "the port is congested" is not a measurement, and a system that
-- files them in one table can no longer tell a reader which it is holding.
create table canonical.assertion (
  assertion_id   uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references app.tenant(tenant_id),
  subject_uri    canonical.notation_uri not null,
  claim          text not null check (length(claim) between 3 and 4000),
  stance         text not null check (stance in ('supported', 'partially_supported', 'unsupported', 'contested', 'refused')),
  -- The observations cited. An assertion with no support is an opinion, and the array
  -- being empty is allowed only when the stance says so.
  supported_by   uuid[] not null default '{}',
  valid_from     timestamptz not null,
  valid_to       timestamptz,
  recorded_at    timestamptz not null default now(),
  superseded_at  timestamptz,
  recorded_by    text not null default app.current_actor(),

  check (stance in ('unsupported', 'refused') or cardinality(supported_by) > 0)
);

comment on table canonical.assertion is
  'A claim about a subject, with the observations that support it. A supported assertion must cite something; an unsupported one says so.';

create index on canonical.assertion (tenant_id, subject_uri, valid_from desc);

create table canonical.relationship (
  relationship_id uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references app.tenant(tenant_id),
  source_entity   uuid not null references canonical.entity(entity_id),
  target_entity   uuid not null references canonical.entity(entity_id),
  relation_kind   text not null,
  attributes      jsonb not null default '{}'::jsonb,
  valid_from      timestamptz not null,
  valid_to        timestamptz,
  recorded_at     timestamptz not null default now(),
  superseded_at   timestamptz,
  recorded_by     text not null default app.current_actor(),
  admitted_from   uuid not null references evidence.object(object_id),

  check (source_entity <> target_entity),
  check (valid_to is null or valid_to > valid_from)
);

comment on table canonical.relationship is
  'A typed, bitemporal edge between two entities. The graph lives here; a graph database, if one is ever needed, projects from it.';

create index on canonical.relationship (tenant_id, source_entity, relation_kind) where superseded_at is null;
create index on canonical.relationship (tenant_id, target_entity, relation_kind) where superseded_at is null;

-- Append-only, enforced.
--
-- The one permitted update is setting `superseded_at` on a row that has not been
-- superseded: that is how a correction lands. Everything else — editing a value, moving a
-- valid_from, deleting a row — is refused, so history cannot be quietly rewritten by an
-- application bug or a hurried operator.
create or replace function canonical.enforce_append_only() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'canonical.% is append-only: DELETE is refused', tg_table_name
      using hint = 'Supersede the row by setting superseded_at. Canonical state that can be deleted is not canonical.';
  end if;
  if old.superseded_at is not null then
    raise exception 'canonical.% row % was already superseded at %', tg_table_name, old.*, old.superseded_at
      using hint = 'A superseded row is history. Insert a new row instead.';
  end if;
  if to_jsonb(new) - 'superseded_at' <> to_jsonb(old) - 'superseded_at' then
    raise exception 'canonical.% is append-only: only superseded_at may be set', tg_table_name
      using hint = 'Insert a superseding row carrying the corrected values, then set superseded_at on this one.';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['entity', 'entity_alias', 'observation', 'assertion', 'relationship'] loop
    execute format(
      'create trigger %I_append_only before update or delete on canonical.%I for each row execute function canonical.enforce_append_only()',
      t, t);
  end loop;
end $$;
