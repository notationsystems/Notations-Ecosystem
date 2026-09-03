#!/usr/bin/env node
/**
 * Apply platform/sql/*.sql in order, then check the result.
 *
 *   node platform/migrate.mjs                 # apply, then run platform/check.mjs
 *   node platform/migrate.mjs --reset         # drop the platform schemas first
 *   NOTATIONS_PLATFORM_DSN=postgresql://… node platform/migrate.mjs
 *
 * Migrations run as whoever the DSN authenticates — a superuser or the schema owner. The
 * application never runs them: it holds no DDL, which is part of why PLAT-002 can hold.
 * Every file is idempotent enough to re-run; `--reset` is for a clean start, not for
 * production, where dropping the canonical schema is the one thing this platform exists
 * to make unnecessary.
 */
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DSN, available } from './pg.mjs';
import { runChecks } from './check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(here, 'sql');

if (!available()) {
  console.error(`platform: no database reachable at ${DEFAULT_DSN}`);
  process.exit(2);
}

if (process.argv.includes('--reset')) {
  execFileSync('psql', [DEFAULT_DSN, '-q', '-v', 'ON_ERROR_STOP=1', '-c',
    'drop schema if exists projection cascade; drop schema if exists canonical cascade; drop schema if exists evidence cascade; drop schema if exists app cascade;'],
  { stdio: 'inherit' });
  console.log('reset: platform schemas dropped');
}

const files = (await readdir(sqlDir)).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
for (const file of files) {
  execFileSync('psql', [DEFAULT_DSN, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(sqlDir, file)], { stdio: ['ignore', 'inherit', 'inherit'] });
  console.log(`applied ${file}`);
}

const results = runChecks();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}  ${r.title}`);
for (const r of failed) for (const f of r.failures) console.log(`       ${f}`);
console.log(`\n${results.length - failed.length}/${results.length} platform invariants hold after migration.`);
process.exit(failed.length ? 1 : 0);
