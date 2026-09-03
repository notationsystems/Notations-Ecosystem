#!/usr/bin/env node
/**
 * Platform conformance, checked against a live database.
 *
 * Not against the migration files. A migration written correctly and never applied, or
 * applied and then altered by hand, produces exactly the schema this check exists to
 * catch — and the difference is invisible in the repository.
 *
 * The invariants, and why each is here rather than assumed:
 *
 *   PLAT-001  Every tenant-scoped table has row security ENABLED **and FORCED**. Enabled
 *             alone exempts the table owner from its own policies while `rowsecurity`
 *             still reports true, so the usual check passes on a table that isolates
 *             nothing from the role most likely to query it.
 *   PLAT-002  No application role holds BYPASSRLS or SUPERUSER. Either skips every policy
 *             on every table, and neither appears in any table-level view — so a perfectly
 *             policed schema can leak because of one line in a CREATE ROLE elsewhere.
 *   PLAT-003  Every table with row security on has a policy. RLS on with no policy denies
 *             everything: safe, but it fails at runtime rather than at review.
 *   PLAT-004  No serving projection writes canonical truth. The projection role holds no
 *             INSERT, UPDATE, DELETE or TRUNCATE on canonical or evidence.
 *   PLAT-005  Canonical and evidence are append-only for the application: no DELETE, and
 *             UPDATE only on the columns that record supersession.
 *   PLAT-006  Every canonical fact is bitemporal — event time and knowledge time as
 *             separate columns, never merged.
 *   PLAT-007  Every evidence object carries content hash, rights, retention, access scope
 *             and source, all NOT NULL.
 *   PLAT-008  The transactional outbox exists, with a partial index on its backlog.
 *   PLAT-009  Evidence rows describe objects and never hold their bytes.
 *
 * Usage: node platform/check.mjs [--json]
 */
import { DEFAULT_DSN, available, query, scalar } from './pg.mjs';

const TENANT_SCHEMAS = ['canonical', 'evidence'];
const APP_ROLES = ['notations_app', 'notations_projection', 'notations_read'];
/** The only columns an append-only table may let the application update. */
const SUPERSESSION_COLUMNS = new Set(['superseded_at', 'revoked_at', 'published_at', 'attempts', 'last_error']);

const schemas = `'{${TENANT_SCHEMAS.join(',')}}'`;
const checks = [];
const check = (id, title, run) => checks.push({ id, title, run });

check('PLAT-001', 'row security is enabled and forced on every tenant table', () => {
  const rows = query(`
    select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(${schemas}) and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
    order by 1, 2`);
  return {
    checked: rows.length,
    failures: rows
      .filter(([, , enabled, forced]) => enabled !== 't' || forced !== 't')
      .map(([s, t, e, f]) => `${s}.${t}: enabled=${e === 't'} forced=${f === 't'}` +
        (e === 't' && f !== 't' ? ' — enabled without FORCE leaves the table owner exempt from its own policies' : '')),
  };
});

check('PLAT-002', 'no application role can bypass row security', () => {
  const rows = query(`select rolname, rolbypassrls, rolsuper from pg_roles where rolname = any('{${APP_ROLES.join(',')}}') order by 1`);
  const missing = APP_ROLES.filter((role) => !rows.some(([name]) => name === role));
  return {
    checked: rows.length,
    failures: [
      ...missing.map((role) => `${role}: role does not exist`),
      ...rows
        .filter(([, bypass, superuser]) => bypass === 't' || superuser === 't')
        .map(([name, bypass]) => `${name}: ${bypass === 't' ? 'BYPASSRLS' : 'SUPERUSER'} — skips every policy on every table, and shows up in no table-level view`),
    ],
  };
});

check('PLAT-003', 'every table with row security has a policy', () => {
  const rows = query(`
    select n.nspname, c.relname, (select count(*) from pg_policy p where p.polrelid = c.oid)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(${schemas}) and c.relkind = 'r' and c.relrowsecurity
    order by 1, 2`);
  return {
    checked: rows.length,
    failures: rows.filter(([, , count]) => Number(count) === 0)
      .map(([s, t]) => `${s}.${t}: row security on with no policy — denies everything, discovered at runtime rather than at review`),
  };
});

/** Table-level grants held by one role across the tenant schemas. */
function tableGrants(role, privileges) {
  return query(`
    select n.nspname, c.relname, a.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as a
    where n.nspname = any(${schemas}) and c.relkind = 'r'
      and a.grantee = '${role}'::regrole
      and a.privilege_type = any('{${privileges.join(',')}}')
    order by 1, 2, 3`);
}

check('PLAT-004', 'no serving projection writes canonical truth', () => {
  const rows = tableGrants('notations_projection', ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']);
  return {
    checked: 1,
    failures: rows.map(([s, t, priv]) => `notations_projection holds ${priv} on ${s}.${t} — a projection that can write is not a projection`),
  };
});

check('PLAT-005', 'canonical and evidence are append-only for the application', () => {
  const wide = tableGrants('notations_app', ['UPDATE', 'DELETE', 'TRUNCATE']);
  const columnGrants = query(`
    select n.nspname, c.relname, att.attname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral aclexplode(att.attacl) as a
    where n.nspname = any(${schemas}) and att.attacl is not null
      and a.grantee = 'notations_app'::regrole and a.privilege_type = 'UPDATE'
    order by 1, 2, 3`);
  return {
    checked: columnGrants.length,
    failures: [
      ...wide.map(([s, t, priv]) => priv === 'UPDATE'
        ? `notations_app holds table-wide UPDATE on ${s}.${t} — history can be rewritten in place`
        : `notations_app holds ${priv} on ${s}.${t} — canonical state that can be deleted is not canonical`),
      ...columnGrants
        .filter(([, , column]) => !SUPERSESSION_COLUMNS.has(column))
        .map(([s, t, column]) => `notations_app may UPDATE ${s}.${t}.${column}, which records no supersession`),
    ],
  };
});

check('PLAT-006', 'every canonical fact is bitemporal', () => {
  // entity_alias carries knowledge time only: an alias is true of a name, not of an
  // interval, so an event-time pair on it would be a column nobody could fill honestly.
  const eventTimeRequired = { entity: true, entity_alias: false, observation: true, assertion: true, relationship: true };
  const rows = query(`
    select c.relname, array_agg(a.attname order by a.attname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'canonical' and c.relkind = 'r' and c.relname = any('{${Object.keys(eventTimeRequired).join(',')}}')
    group by 1 order by 1`);
  const failures = [];
  for (const [table, columns] of rows) {
    const has = new Set(columns.replace(/[{}]/g, '').split(','));
    const knowledge = ['recorded_at', 'superseded_at'].filter((c) => !has.has(c));
    if (knowledge.length) failures.push(`canonical.${table}: no knowledge time (${knowledge.join(', ')})`);
    if (eventTimeRequired[table]) {
      const event = ['valid_from', 'valid_to'].filter((c) => !has.has(c));
      if (event.length) failures.push(`canonical.${table}: no event time (${event.join(', ')}) — a correction would be indistinguishable from a change in the world`);
    }
  }
  const missing = Object.keys(eventTimeRequired).filter((t) => !rows.some(([name]) => name === t));
  failures.push(...missing.map((t) => `canonical.${t} does not exist`));
  return { checked: rows.length, failures };
});

check('PLAT-007', 'every evidence object carries hash, rights, retention, scope and source', () => {
  const required = ['zone', 'content_hash', 'rights', 'retention_class', 'access_scope', 'source_system', 'retrieved_at'];
  const rows = query(`
    select a.attname, a.attnotnull
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'evidence' and c.relname = 'object' order by a.attnum`);
  const notNull = new Map(rows.map(([name, flag]) => [name, flag === 't']));
  return {
    checked: required.length,
    failures: required.flatMap((column) => {
      if (!notNull.has(column)) return [`evidence.object.${column} does not exist`];
      return notNull.get(column) ? [] : [`evidence.object.${column} is nullable — an object without it cannot be verified, published, retained or attributed`];
    }),
  };
});

check('PLAT-008', 'the transactional outbox exists with a partial backlog index', () => {
  const exists = scalar(`select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'canonical' and c.relname = 'outbox'`);
  if (!exists) {
    return { checked: 1, failures: ['canonical.outbox does not exist — a change event written outside the transaction that caused it is eventually lost'] };
  }
  const partial = query(`
    select i.relname
    from pg_index x join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'canonical' and t.relname = 'outbox' and x.indpred is not null`);
  return {
    checked: 1,
    failures: partial.length ? [] : ['canonical.outbox has no partial index on its backlog — the relay scans all of history to find the next batch'],
  };
});

check('PLAT-009', 'evidence rows describe objects and never hold their bytes', () => {
  const rows = query(`
    select c.relname, a.attname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'evidence' and c.relkind = 'r' and format_type(a.atttypid, a.atttypmod) = 'bytea'
    order by 1, 2`);
  return {
    checked: 1,
    failures: rows.map(([t, column]) => `evidence.${t}.${column} is bytea — object bytes in the database land in every backup, replica and pg_dump of it`),
  };
});

export function runChecks() {
  return checks.map(({ id, title, run }) => {
    try {
      const { checked, failures } = run();
      return { id, title, checked, failures, ok: failures.length === 0 };
    } catch (error) {
      const first = String(error.stderr ?? error.message).trim().split('\n').find(Boolean) ?? 'unknown error';
      return { id, title, checked: 0, failures: [`check could not run: ${first}`], ok: false };
    }
  });
}

async function main() {
  const json = process.argv.includes('--json');
  if (!available()) {
    const detail = `no database reachable at ${DEFAULT_DSN}`;
    if (json) console.log(JSON.stringify({ reachable: false, detail }, null, 2));
    else console.error(`platform: ${detail}\nStart one and apply platform/sql/*.sql, or set NOTATIONS_PLATFORM_DSN.`);
    process.exit(2);
  }

  const results = runChecks();
  if (json) {
    console.log(JSON.stringify({ reachable: true, results }, null, 2));
  } else {
    for (const result of results) {
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.id}  ${result.title}${result.checked ? ` (${result.checked} checked)` : ''}`);
      for (const failure of result.failures) console.log(`       ${failure}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} platform invariants hold.`);
  }
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('check.mjs')) await main();
