/**
 * A psql wrapper, so the platform tooling carries no runtime dependency.
 *
 * The rest of this repository runs on Node with nothing installed, and the same rule
 * applies here: a checker that needs `npm install` before it can tell you whether row
 * security is forced is a checker that will not be run in the place it matters.
 */
import { execFileSync } from 'node:child_process';

/**
 * ASCII unit separator, written as a code point rather than as a literal.
 *
 * No identifier, timestamp or comment in this schema contains one, so it separates columns
 * without the ambiguity a comma or a pipe would carry. Spelled `fromCharCode` because a
 * raw control character in a source file is invisible in every diff that matters — and
 * this repository's own validator refuses them in text for the same reason.
 */
const FIELD = String.fromCharCode(31);

export const DEFAULT_DSN = process.env.NOTATIONS_PLATFORM_DSN
  ?? `postgresql://${process.env.PGUSER ?? 'postgres'}@/${process.env.PGDATABASE ?? 'notations'}?host=${process.env.PGHOST ?? '/tmp/pgsock'}&port=${process.env.PGPORT ?? '5433'}`;

export function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * Rows, as arrays of column strings.
 *
 * `role`, `tenant` and `actor` are set in the same session as the query, which is the only
 * way to exercise a policy: row security is evaluated against the session, so a check that
 * connects as a superuser and reasons about what a tenant *would* see is checking nothing.
 */
export function query(sql, { dsn = DEFAULT_DSN, role = null, tenant = null, actor = null } = {}) {
  const preamble = [
    tenant === null ? '' : `select set_config('app.tenant_id', ${literal(tenant)}, false);`,
    actor === null ? '' : `select set_config('app.actor_id', ${literal(actor)}, false);`,
    // Last, because SET ROLE may drop the privilege needed to set the GUCs above.
    role ? `set role ${role};` : '',
  ].filter(Boolean).join('\n');
  // -q suppresses command tags (`INSERT 0 1`, `SET`, `COMMIT`), which would otherwise
  // arrive as rows and be read as data — the first version of this helper handed a test
  // the string 'INSERT 0 2' as a tenant id.
  const out = execFileSync('psql', [dsn, '-tAXq', '-F', FIELD, '-v', 'ON_ERROR_STOP=1', '-c', `${preamble}\n${sql}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(FIELD))
    // set_config in the preamble returns the value it set; drop those rows so the caller
    // sees only the result of its own statement.
    .filter((row) => !(row.length === 1 && (row[0] === '' || row[0] === String(tenant) || row[0] === String(actor))));
}

/** One scalar, or null when the query returned no row. */
export function scalar(sql, options) {
  const rows = query(sql, options);
  return rows.length ? rows[0][0] : null;
}

/**
 * Run SQL expecting it to be refused, and return the refusal text.
 *
 * Returns null when the statement *succeeded*, which is the failure case: a test that
 * proves an isolation boundary has to be able to say "this was allowed when it should not
 * have been", and an exception-swallowing helper cannot.
 */
export function refuses(sql, options = {}) {
  try {
    query(sql, options);
    return null;
  } catch (error) {
    return String(error.stderr ?? error.message);
  }
}

export function available(dsn = DEFAULT_DSN) {
  try {
    execFileSync('psql', [dsn, '-tAX', '-c', 'select 1'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
