-- 002 · Evidence: the index of immutable objects, and the four zones they live in.
--
-- The bytes are in S3-compatible storage. These rows describe them, and describing is all
-- they do: there is no `content` column, and there will not be one. An object that lands
-- in the database stops being an object in a store and becomes a row that a backup, a
-- replica and a `pg_dump` all now carry.
--
-- Every object carries five things, and each is `not null` because each has a failure mode
-- that only shows up later: a content hash (or the object cannot be verified), rights (or
-- it cannot be published), retention (or it cannot be deleted, or is deleted too early),
-- an access scope (or the wrong reader gets it), and source metadata (or nobody can say
-- where it came from).

create type evidence.zone as enum ('raw', 'quarantined', 'canonical_export', 'published_build');

comment on type evidence.zone is
  'raw: as it arrived, never edited. quarantined: arrived but not admissible — held, not deleted, because deleting the thing you could not admit destroys the record of having tried. canonical_export: a fold of canonical state at a revision. published_build: a corpus build someone may cite.';

create type evidence.access_scope as enum ('public', 'internal', 'confidential', 'secret');

create table evidence.object (
  object_id      uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references app.tenant(tenant_id),
  zone           evidence.zone not null,

  -- Identity is the content, not the location. Two objects with the same bytes are the
  -- same object; the URI can change under it without the identity changing.
  content_hash   text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  byte_size      bigint not null check (byte_size >= 0),
  media_type     text not null,
  storage_uri    text not null,

  -- Rights: what may be done with it, and under whose terms. `unrecorded` is allowed and
  -- is not the same as `none`: it says nobody has established the terms yet, which is a
  -- gap someone can close rather than a permission someone can assume.
  rights         text not null,
  rights_holder  text,

  -- Retention: how long it must be kept, and what happens at the end. An object with no
  -- retention answer is an object that is either kept forever by accident or deleted by
  -- accident.
  retention_class text not null,
  retention_until timestamptz,
  legal_hold      boolean not null default false,

  access_scope   evidence.access_scope not null,

  -- Where it came from. `source_system` and `retrieved_at` are the two that make a capture
  -- re-fetchable or provably not; `source_metadata` carries the request that produced it.
  source_system  text not null,
  retrieved_at   timestamptz not null,
  source_metadata jsonb not null default '{}'::jsonb,

  -- Knowledge time for the object itself.
  recorded_at    timestamptz not null default now(),
  recorded_by    text not null default app.current_actor(),

  unique (tenant_id, content_hash, zone)
);

comment on table evidence.object is
  'One immutable object in the store. Rows describe objects; the bytes stay in S3-compatible storage. No content column exists, and adding one would put evidence into every backup and replica of this database.';

create index on evidence.object (tenant_id, zone, retrieved_at desc);
create index on evidence.object (tenant_id, content_hash);
create index on evidence.object (tenant_id, retention_until) where retention_until is not null;

-- Quarantine needs a reason. An object sitting in the quarantine zone with no stated
-- reason is indistinguishable from one that landed there by mistake.
create table evidence.quarantine_reason (
  object_id   uuid primary key references evidence.object(object_id),
  tenant_id   uuid not null references app.tenant(tenant_id),
  code        text not null,
  detail      text not null check (length(detail) between 10 and 2000),
  remedy      text not null check (length(remedy) between 10 and 2000),
  raised_at   timestamptz not null default now(),
  raised_by   text not null default app.current_actor()
);

comment on table evidence.quarantine_reason is
  'Why an object could not be admitted, and what would change that. A typed refusal (COR-005) at the storage boundary.';

-- An object may only be in the quarantine zone if it has a reason, and may only have a
-- reason if it is quarantined. Two halves of one fact, kept from disagreeing.
create or replace function evidence.assert_quarantine_consistent() returns trigger
  language plpgsql as $$
declare
  target_zone evidence.zone;
begin
  select zone into target_zone from evidence.object where object_id = new.object_id;
  if target_zone is distinct from 'quarantined' then
    raise exception 'object % is in zone %, so it may not carry a quarantine reason', new.object_id, target_zone
      using hint = 'Move the object to the quarantined zone, or remove the reason.';
  end if;
  return new;
end $$;

create trigger quarantine_consistent
  before insert or update on evidence.quarantine_reason
  for each row execute function evidence.assert_quarantine_consistent();

-- Immutability. An object row may be superseded by a new row; it is never edited and never
-- deleted. Retention is enforced by a policy that writes a tombstone, not by DELETE.
create or replace function evidence.refuse_mutation() returns trigger
  language plpgsql as $$
begin
  raise exception 'evidence.% is append-only: % is refused', tg_table_name, tg_op
    using hint = 'Insert a superseding row. Evidence that can be edited is not evidence.';
end $$;

create trigger object_append_only
  before update or delete on evidence.object
  for each row execute function evidence.refuse_mutation();
