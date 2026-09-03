-- 005 · The transactional outbox.
--
-- Not Kafka. A row written in the same transaction as the state change it describes, which
-- is the whole property: either both landed or neither did. A broker cannot give that,
-- because a broker is a second system and "write to the database, then publish" has a gap
-- in the middle that eventually gets hit.
--
-- A relay reads unpublished rows in order and publishes them. If the relay dies mid-batch
-- it re-reads and republishes; consumers are idempotent on `outbox_id`. At-least-once,
-- which is the honest guarantee, rather than exactly-once, which is not available.

create table canonical.outbox (
  outbox_id     bigserial primary key,
  tenant_id     uuid not null references app.tenant(tenant_id),
  occurred_at   timestamptz not null default now(),
  aggregate     text not null,
  aggregate_id  uuid not null,
  event_type    text not null,
  payload       jsonb not null,
  -- Written in the same transaction as the change. Read by the relay, never by a consumer.
  published_at  timestamptz,
  attempts      integer not null default 0,
  last_error    text,
  -- What the payload is a claim about, so a consumer can verify rather than trust.
  proof_root    text
);

comment on table canonical.outbox is
  'Change events, written in the same transaction as the change. The relay publishes and marks; a consumer is idempotent on outbox_id. At-least-once, stated rather than implied.';

-- The relay's only index. Partial, so it stays the size of the backlog rather than the
-- size of history — an outbox that has published ten million rows should not carry an
-- index of ten million rows to find the next three.
create index outbox_unpublished
  on canonical.outbox (outbox_id) where published_at is null;

create index on canonical.outbox (tenant_id, aggregate, aggregate_id, occurred_at desc);

-- The relay claims a batch with FOR UPDATE SKIP LOCKED so two relays can run without
-- either blocking or double-publishing within a batch.
create or replace function canonical.claim_outbox(batch_size integer default 100)
  returns setof canonical.outbox
  language sql volatile
  as $$
    select * from canonical.outbox
    where published_at is null
    order by outbox_id
    limit batch_size
    for update skip locked
  $$;

comment on function canonical.claim_outbox(integer) is
  'Claim a batch for publication. SKIP LOCKED so a second relay takes different rows rather than waiting behind the first.';

create or replace function canonical.mark_published(ids bigint[]) returns integer
  language sql volatile
  as $$
    with marked as (
      update canonical.outbox set published_at = now()
      where outbox_id = any(ids) and published_at is null
      returning 1
    ) select count(*)::integer from marked
  $$;
