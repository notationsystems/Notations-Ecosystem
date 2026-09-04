import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { available, literal, query, refuses, scalar } from '../pg.mjs';

/**
 * Tenant isolation, proved against a running database rather than asserted.
 *
 * Row security is the one control in this platform whose failure is silent: a schema with
 * `ENABLE ROW LEVEL SECURITY` on every table reports `rowsecurity = true` everywhere, has
 * policies that read correctly, and can still return every tenant's rows to the role most
 * likely to be querying it. Nothing in the schema says so. Only a query does.
 *
 * So these tests connect as the application role, set a tenant, and look.
 */
const RUN = available();

// Fail closed, not silent.
//
// These are the proofs that tenant isolation holds. When the database is unreachable they used to
// skip, and a skipped test reports as a passing job: the suite said "0 failed" while proving
// nothing, which is the same defect as a command that never ran. A proof that did not run is not a
// proof that passed.
//
// A developer without a database opts out explicitly. Everywhere else — CI included, where a
// service container guarantees one — an unreachable database is a failure.
const OPTIONAL = process.env.NOTATIONS_PLATFORM_TESTS_OPTIONAL === '1';
if (!RUN && !OPTIONAL) {
  throw new Error(
    'No database is reachable, so tenant isolation is unproven and this suite fails rather than skipping. '
    + 'Start PostgreSQL, set NOTATIONS_PLATFORM_DSN and run platform/migrate.mjs --reset. '
    + 'To run without one deliberately, set NOTATIONS_PLATFORM_TESTS_OPTIONAL=1 and accept that nothing here is proved.',
  );
}
const options = { skip: RUN ? false : 'no database reachable — explicitly opted out via NOTATIONS_PLATFORM_TESTS_OPTIONAL' };

/** Two tenants and one piece of evidence each, torn down and rebuilt per test file. */
function fixture() {
  const setup = query(`
    delete from canonical.audit_log;
    truncate app.tenant cascade;
    insert into app.tenant (slug, name) values ('acme', 'Acme'), ('globex', 'Globex')
    returning tenant_id, slug;`);
  const tenants = Object.fromEntries(setup.map(([id, slug]) => [slug, id]));
  for (const [slug, id] of Object.entries(tenants)) {
    query(`
      insert into evidence.object (tenant_id, zone, content_hash, byte_size, media_type, storage_uri,
        rights, retention_class, access_scope, source_system, retrieved_at)
      values (${literal(id)}, 'raw', 'sha256:${createHash('sha256').update(slug).digest('hex')}', 12, 'application/json',
        's3://raw/${slug}.json', 'public-domain', 'indefinite', 'internal', 'fixture', now());`);
    const objectId = scalar(`select object_id from evidence.object where tenant_id = ${literal(id)} limit 1`);
    query(`
      insert into canonical.entity (tenant_id, uri, entity_kind, valid_from, admitted_from)
      values (${literal(id)}, 'notation://entity/notationsystems/${slug}-port', 'facility', now(), ${literal(objectId)});`);
  }
  return tenants;
}

test('a tenant sees its own rows and no others', options, () => {
  const tenants = fixture();
  const acme = query('select uri from canonical.entity', { role: 'notations_app', tenant: tenants.acme });
  const globex = query('select uri from canonical.entity', { role: 'notations_app', tenant: tenants.globex });

  assert.deepEqual(acme.map(([uri]) => uri), ['notation://entity/notationsystems/acme-port']);
  assert.deepEqual(globex.map(([uri]) => uri), ['notation://entity/notationsystems/globex-port']);

  // Both rows exist. The isolation is the policy, not an empty table.
  assert.equal(scalar('select count(*) from canonical.entity'), '2');
});

test('a session that forgot to set a tenant sees nothing, not everything', options, () => {
  fixture();
  // `app.current_tenant()` returns null when the GUC is unset, and `tenant_id = null` is
  // null rather than true. The alternative — a policy written so an unset tenant matches
  // every row — is the shape that turns one missing middleware call into a full disclosure.
  const rows = query('select uri from canonical.entity', { role: 'notations_app' });
  assert.deepEqual(rows, []);
  assert.equal(scalar('select app.current_tenant() is null', { role: 'notations_app' }), 't');
});

test('a tenant cannot write a row belonging to another', options, () => {
  const tenants = fixture();
  const objectId = scalar(`select object_id from evidence.object where tenant_id = ${literal(tenants.globex)} limit 1`);
  const error = refuses(`
    insert into canonical.entity (tenant_id, uri, entity_kind, valid_from, admitted_from)
    values (${literal(tenants.globex)}, 'notation://entity/notationsystems/smuggled', 'facility', now(), ${literal(objectId)})`,
  { role: 'notations_app', tenant: tenants.acme });

  // WITH CHECK, not just USING. A policy with only USING lets a tenant insert rows it can
  // then never see — which is worse than refusing, because the write appears to succeed.
  assert.ok(error, 'a cross-tenant insert was accepted');
  assert.match(error, /row-level security policy/);
});

test('ENABLE without FORCE leaves the table owner reading every tenant', options, () => {
  // The failure this platform's PLAT-001 exists to catch, demonstrated rather than
  // described. A table owned by the role that queries it, with row security enabled and a
  // correct policy, returns every row to that owner — and `pg_tables.rowsecurity` says
  // true the whole time.
  query(`
    drop table if exists canonical.leaky_demo;
    create table canonical.leaky_demo (tenant_id uuid not null, note text not null);
    alter table canonical.leaky_demo owner to notations_app;
    alter table canonical.leaky_demo enable row level security;
    create policy tenant_isolation on canonical.leaky_demo
      using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
    insert into canonical.leaky_demo values (gen_random_uuid(), 'acme'), (gen_random_uuid(), 'globex');`);

  assert.equal(scalar(`select relrowsecurity from pg_class where oid = 'canonical.leaky_demo'::regclass`), 't',
    'row security reports enabled');

  const asOwner = query('select note from canonical.leaky_demo order by note', { role: 'notations_app' });
  assert.deepEqual(asOwner.map(([note]) => note), ['acme', 'globex'],
    'the owner should see both rows while the table lacks FORCE — if this fails, PostgreSQL changed and the invariant needs rereading');

  // One statement closes it.
  query('alter table canonical.leaky_demo force row level security;');
  assert.deepEqual(query('select note from canonical.leaky_demo', { role: 'notations_app' }), []);

  query('drop table canonical.leaky_demo;');
});

test('BYPASSRLS defeats every policy, and no application role has it', options, () => {
  // The second silent failure: an attribute on a role, invisible in every table-level
  // view, that skips row security everywhere. A schema can be perfectly policed and leak
  // because of one word in a CREATE ROLE.
  query(`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'demo_bypass') then create role demo_bypass nologin; end if;
    end $$;
    alter role demo_bypass bypassrls;
    grant usage on schema canonical, app to demo_bypass;
    grant select on canonical.entity to demo_bypass;`);

  const tenants = fixture();
  const seen = query('select count(*) from canonical.entity', { role: 'demo_bypass', tenant: tenants.acme });
  assert.equal(seen[0][0], '2', 'BYPASSRLS should see both tenants');

  query('drop owned by demo_bypass; drop role demo_bypass;');

  // And the three roles the platform actually uses do not have it.
  const bypassers = query(`
    select rolname from pg_roles
    where rolname in ('notations_app', 'notations_projection', 'notations_read')
      and (rolbypassrls or rolsuper)`);
  assert.deepEqual(bypassers, []);
});

test('a serving projection cannot write canonical truth', options, () => {
  const tenants = fixture();
  const objectId = scalar(`select object_id from evidence.object where tenant_id = ${literal(tenants.acme)} limit 1`);

  // Not by policy — by the absence of a grant. A policy can be dropped by whoever owns the
  // table; a privilege the role never held cannot be recovered by an application bug.
  const error = refuses(`
    insert into canonical.entity (tenant_id, uri, entity_kind, valid_from, admitted_from)
    values (${literal(tenants.acme)}, 'notation://entity/notationsystems/from-projection', 'facility', now(), ${literal(objectId)})`,
  { role: 'notations_projection', tenant: tenants.acme });

  assert.ok(error, 'the projection role wrote canonical state');
  assert.match(error, /permission denied/);

  // It reads what it needs, so the refusal is a boundary rather than a lockout.
  assert.equal(query('select count(*) from canonical.entity', { role: 'notations_projection', tenant: tenants.acme })[0][0], '1');
});

test('canonical state is append-only: corrections supersede, they do not overwrite', options, () => {
  const tenants = fixture();
  const entityId = scalar(`select entity_id from canonical.entity where tenant_id = ${literal(tenants.acme)}`,
    { role: 'notations_app', tenant: tenants.acme });

  const edited = refuses(`update canonical.entity set entity_kind = 'vessel' where entity_id = ${literal(entityId)}`,
    { role: 'notations_app', tenant: tenants.acme });
  assert.ok(edited, 'a canonical value was edited in place');

  const deleted = refuses(`delete from canonical.entity where entity_id = ${literal(entityId)}`,
    { role: 'notations_app', tenant: tenants.acme });
  assert.ok(deleted, 'a canonical row was deleted');
  assert.match(deleted, /permission denied|append-only/);

  // The permitted correction: supersede the old row, insert the new one. Both are visible
  // afterwards, which is what makes "what did we believe last Tuesday" answerable.
  const objectId = scalar(`select object_id from evidence.object where tenant_id = ${literal(tenants.acme)} limit 1`);
  query(`
    update canonical.entity set superseded_at = now() where entity_id = ${literal(entityId)};
    insert into canonical.entity (tenant_id, uri, entity_kind, valid_from, admitted_from)
    values (${literal(tenants.acme)}, 'notation://entity/notationsystems/acme-port', 'vessel', now(), ${literal(objectId)});`,
  { role: 'notations_app', tenant: tenants.acme });

  const rows = query('select entity_kind, superseded_at is null as live from canonical.entity order by entity_kind',
    { role: 'notations_app', tenant: tenants.acme });
  assert.deepEqual(rows, [['facility', 'f'], ['vessel', 't']]);
});

test('the outbox commits with the change it describes, and the relay claims a batch', options, () => {
  const tenants = fixture();
  const objectId = scalar(`select object_id from evidence.object where tenant_id = ${literal(tenants.acme)} limit 1`);

  // One transaction, both rows. The property a broker cannot give: "write the row, then
  // publish" has a gap in the middle, and the gap is eventually hit.
  query(`
    begin;
    insert into canonical.entity (tenant_id, uri, entity_kind, valid_from, admitted_from)
      values (${literal(tenants.acme)}, 'notation://entity/notationsystems/acme-berth', 'facility', now(), ${literal(objectId)});
    insert into canonical.outbox (tenant_id, aggregate, aggregate_id, event_type, payload)
      select ${literal(tenants.acme)}, 'entity', entity_id, 'entity.registered', jsonb_build_object('uri', uri)
      from canonical.entity where uri = 'notation://entity/notationsystems/acme-berth';
    commit;`, { role: 'notations_app', tenant: tenants.acme });

  const backlog = query('select event_type from canonical.outbox where published_at is null',
    { role: 'notations_app', tenant: tenants.acme });
  assert.deepEqual(backlog.map(([kind]) => kind), ['entity.registered']);

  // The relay claims, publishes, marks. Marking is idempotent: a second mark of the same
  // ids reports zero, so a relay that crashed after publishing does not double-count.
  const claimed = query('select outbox_id from canonical.claim_outbox(10)', { role: 'notations_app', tenant: tenants.acme });
  assert.equal(claimed.length, 1);
  const ids = `'{${claimed.map(([id]) => id).join(',')}}'`;
  assert.equal(scalar(`select canonical.mark_published(${ids})`, { role: 'notations_app', tenant: tenants.acme }), '1');
  assert.equal(scalar(`select canonical.mark_published(${ids})`, { role: 'notations_app', tenant: tenants.acme }), '0');
  assert.deepEqual(query('select 1 from canonical.outbox where published_at is null', { role: 'notations_app', tenant: tenants.acme }), []);
});

test('evidence is append-only and a quarantined object must say why', options, () => {
  const tenants = fixture();
  const objectId = scalar(`select object_id from evidence.object where tenant_id = ${literal(tenants.acme)} limit 1`);

  assert.ok(refuses(`update evidence.object set rights = 'all-rights-reserved' where object_id = ${literal(objectId)}`,
    { role: 'notations_app', tenant: tenants.acme }), 'evidence was edited');

  // A reason on an object that is not quarantined is refused: the zone and the reason are
  // two halves of one fact, and a record that lets them disagree records neither.
  const mismatched = refuses(`
    insert into evidence.quarantine_reason (object_id, tenant_id, code, detail, remedy)
    values (${literal(objectId)}, ${literal(tenants.acme)}, 'UNPARSEABLE',
      'The capture is truncated at 4 KiB and the JSON does not close.',
      'Re-fetch with a longer read timeout and re-submit.')`,
  { role: 'notations_app', tenant: tenants.acme });
  assert.ok(mismatched);
  assert.match(mismatched, /may not carry a quarantine reason/);
});
