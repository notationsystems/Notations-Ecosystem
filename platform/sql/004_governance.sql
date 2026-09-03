-- 004 · Permissions and audit.
--
-- Permissions are rows rather than roles because the grant is per tenant and per subject,
-- and a role per (tenant × subject) is a role explosion nobody can audit. The database
-- roles stay three; who may do what within a tenant lives here.

create table canonical.permission (
  permission_id uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references app.tenant(tenant_id),
  principal_id  text not null,
  action        text not null check (action in ('read', 'propose', 'admit', 'release', 'administer')),
  subject_kind  text not null,
  subject_id    text,
  granted_at    timestamptz not null default now(),
  granted_by    text not null default app.current_actor(),
  revoked_at    timestamptz,
  -- A grant says why. A permission nobody can explain is a permission nobody will revoke.
  reason        text not null check (length(reason) between 10 and 1000)
);

comment on table canonical.permission is
  'Per-tenant, per-subject grants. Database roles stay at three; who may do what inside a tenant is data, and revocation is a timestamp rather than a deletion.';

create unique index permission_one_live
  on canonical.permission (tenant_id, principal_id, action, subject_kind, coalesce(subject_id, ''))
  where revoked_at is null;

-- The audit log. Append-only by trigger and by permission: the application role may insert
-- and select, and holds no update or delete grant at all.
create table canonical.audit_log (
  audit_id     bigserial primary key,
  tenant_id    uuid references app.tenant(tenant_id),
  occurred_at  timestamptz not null default now(),
  actor_id     text not null default app.current_actor(),
  action       text not null,
  subject      text not null,
  outcome      text not null check (outcome in ('accepted', 'refused', 'failed')),
  detail       jsonb not null default '{}'::jsonb,
  -- The database session that did it, so a row can be tied to a connection in the logs.
  db_role      text not null default current_user,
  db_backend   integer not null default pg_backend_pid()
);

comment on table canonical.audit_log is
  'Every privileged action and every refusal. A refusal is logged as loudly as an acceptance — a log that records only successes is a log that cannot show an attack.';

create index on canonical.audit_log (tenant_id, occurred_at desc);
create index on canonical.audit_log (actor_id, occurred_at desc);

create or replace function canonical.refuse_audit_mutation() returns trigger
  language plpgsql as $$
begin
  raise exception 'canonical.audit_log is append-only: % is refused', tg_op
    using hint = 'An audit log that can be edited is not an audit log.';
end $$;

create trigger audit_append_only
  before update or delete on canonical.audit_log
  for each row execute function canonical.refuse_audit_mutation();
