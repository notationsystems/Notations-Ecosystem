#!/usr/bin/env node
/**
 * Operator tooling for control-plane credentials and keys.
 *
 *   node src/security/cli.js issue --principal operator:alice --roles operator,registrar
 *   node src/security/cli.js issue --principal monitor:payload --roles monitor --actors monitor:payload --nodes payload-terminal
 *   node src/security/cli.js list
 *   node src/security/cli.js disable --key-id k-1a2b3c
 *   node src/security/cli.js keys show
 *   node src/security/cli.js keys rotate
 *   node src/security/cli.js kek generate
 *
 * The credential secret is printed once, to stdout, and never stored: the registry
 * keeps a SHA-256 digest. If it is lost, issue another and disable the old one.
 */

import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { issueCredential, validatePrincipalRecord } from './identity.js';
import { ROLES } from './policy.js';
import { KeyStore } from './crypto/signing.js';
import { KeyEncryptionKey } from './crypto/envelope.js';
import { HashJournal, verifyRecords } from '../journal.js';
import { readAnchor, assertNotRolledBack } from './anchor.js';

const REGISTRY_SCHEMA = 'notations.control-plane.principals.v1';

function option(args, name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

function list(value) {
  return value ? value.split(',').map(entry => entry.trim()).filter(Boolean) : [];
}

async function loadRegistry(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed.schema !== REGISTRY_SCHEMA) throw new Error(`${path} has unsupported schema ${parsed.schema}.`);
    return parsed;
  } catch (error) {
    if (error && error.code === 'ENOENT') return { schema: REGISTRY_SCHEMA, principals: [] };
    throw error;
  }
}

async function saveRegistry(path, registry) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

const registryPath = () => resolve(process.env.CONTROL_PLANE_PRINCIPALS_FILE || 'data/principals.json');
const keystorePath = () => resolve(process.env.CONTROL_PLANE_KEYSTORE || 'data/keystore.json');
const kek = () => (process.env.CONTROL_PLANE_KEK ? KeyEncryptionKey.fromBase64('kek-primary', process.env.CONTROL_PLANE_KEK) : null);

async function cmdIssue(args) {
  const principalId = option(args, 'principal');
  if (!principalId) throw new Error('--principal is required, for example --principal operator:alice');
  const roles = list(option(args, 'roles', 'reader'));
  for (const role of roles) if (!(role in ROLES)) throw new Error(`Unknown role ${role}. Known roles: ${Object.keys(ROLES).join(', ')}`);
  const actors = list(option(args, 'actors')) ;
  const nodes = option(args, 'nodes') ? list(option(args, 'nodes')) : null;
  const expiresAt = option(args, 'expires', null);
  const kind = option(args, 'kind', 'service');

  const path = registryPath();
  const registry = await loadRegistry(path);
  const { token, record } = issueCredential({ principalId, kind, roles, actors: actors.length ? actors : [principalId], nodes, expiresAt });
  const problems = validatePrincipalRecord(record);
  if (problems.length) throw new Error(`Refusing to write an invalid principal: ${problems.join('; ')}`);
  registry.principals = registry.principals.filter(existing => existing.keyId !== record.keyId);
  registry.principals.push(record);
  await saveRegistry(path, registry);

  process.stdout.write([
    `Issued credential for ${principalId}`,
    `  registry : ${path}`,
    `  keyId    : ${record.keyId}`,
    `  roles    : ${roles.join(', ')}`,
    `  actors   : ${record.actors.join(', ')}`,
    `  nodes    : ${record.nodes ? record.nodes.join(', ') : 'unrestricted'}`,
    '',
    'Token (shown once — store it in your secret manager, never in the repository):',
    `  ${token}`,
    '',
  ].join('\n'));
}

async function cmdList() {
  const path = registryPath();
  const registry = await loadRegistry(path);
  if (!registry.principals.length) {
    process.stdout.write(`No principals in ${path}.\n`);
    return;
  }
  process.stdout.write(`${registry.principals.length} principal(s) in ${path}:\n`);
  for (const principal of registry.principals) {
    process.stdout.write(`  ${principal.disabled ? '[disabled] ' : ''}${principal.principalId}  keyId=${principal.keyId}  roles=${principal.roles.join('|')}  actors=${(principal.actors ?? []).join('|')}  nodes=${principal.nodes ? principal.nodes.join('|') : '*'}  expires=${principal.expiresAt ?? 'never'}\n`);
  }
}

async function cmdDisable(args) {
  const keyId = option(args, 'key-id');
  if (!keyId) throw new Error('--key-id is required.');
  const path = registryPath();
  const registry = await loadRegistry(path);
  const principal = registry.principals.find(entry => entry.keyId === keyId);
  if (!principal) throw new Error(`No principal with keyId ${keyId}.`);
  principal.disabled = true;
  await saveRegistry(path, registry);
  process.stdout.write(`Disabled ${principal.principalId} (keyId ${keyId}).\n`);
}

async function cmdKeys(args) {
  const sub = args[0] ?? 'show';
  const store = await KeyStore.load({ filePath: keystorePath(), kek: kek(), create: sub === 'rotate' });
  if (sub === 'show') {
    process.stdout.write(`${JSON.stringify(store.describe(), null, 2)}\n`);
    for (const warning of store.warnings) process.stderr.write(`warning: ${warning}\n`);
    return;
  }
  if (sub === 'rotate') {
    const result = await store.rotate({ atRecord: Number.parseInt(option(args, 'at-record', '0'), 10) });
    process.stdout.write(`Rotated signing key: retired ${result.retired ?? 'none'}, active ${result.active}.\nRecords signed by the retired key continue to verify.\n`);
    return;
  }
  throw new Error(`Unknown keys subcommand ${sub}. Use "show" or "rotate".`);
}

function cmdKek(args) {
  const sub = args[0] ?? 'generate';
  if (sub !== 'generate') throw new Error(`Unknown kek subcommand ${sub}.`);
  process.stdout.write([
    'Generated a key encryption key. Store it in your secret manager and export it as',
    'CONTROL_PLANE_KEK; it wraps the journal signing key at rest.',
    '',
    `  CONTROL_PLANE_KEK=${randomBytes(32).toString('base64')}`,
    '',
  ].join('\n'));
}

/**
 * Verify a journal offline.
 *
 * After an integrity alarm the operator needs to answer "is this replica sound?"
 * without starting a server against it — starting one would append to a history that
 * may be wrong. This reads, verifies and reports, and writes nothing.
 */
async function cmdVerify(args) {
  const journalPath = resolve(args[0] ?? process.env.CONTROL_PLANE_JOURNAL_PATH ?? 'data/control-plane.jsonl');
  let keyStore = null;
  try {
    keyStore = await KeyStore.load({ filePath: keystorePath(), kek: kek(), create: false });
  } catch (error) {
    process.stderr.write(`warning: key store unavailable (${error.message}); signatures cannot be checked\n`);
  }
  const journal = new HashJournal(journalPath, { keyStore, anchor: false });

  let records;
  try {
    records = await journal.read();
  } catch (error) {
    process.stdout.write(`FAILED  ${journalPath}\n  ${error.detail ?? error.message}\n  ${error.remedy ?? ''}\n`);
    process.exitCode = 1;
    return;
  }

  const defect = verifyRecords(records, { keyStore, requireSignatures: false });
  const signed = records.filter(record => record.signature).length;
  const anchor = await readAnchor(journalPath);
  let rollback = null;
  try {
    assertNotRolledBack(records, anchor);
  } catch (error) {
    rollback = error.detail;
  }

  const kinds = new Map();
  for (const { event } of records) kinds.set(event.kind, (kinds.get(event.kind) ?? 0) + 1);

  process.stdout.write([
    `journal   ${journalPath}`,
    `records   ${records.length}`,
    `chain     ${defect ? `BROKEN — ${defect}` : 'verifies'}`,
    `signed    ${signed}/${records.length}${keyStore ? '' : ' (unchecked: no key store)'}`,
    `anchor    ${anchor ? `length ${anchor.length}, head ${String(anchor.head).slice(0, 12)}…` : 'absent'}`,
    `rollback  ${rollback ? `DETECTED — ${rollback}` : anchor ? 'none' : 'not checkable without an anchor'}`,
    `events    ${[...kinds.entries()].sort().map(([kind, count]) => `${kind}=${count}`).join(' ') || 'none'}`,
    '',
  ].join('\n'));

  if (defect || rollback) {
    process.stdout.write('This journal is NOT sound. Restore from a verified replica; do not append to it.\n');
    process.exitCode = 1;
  }
}

const USAGE = `notations control-plane security tool

  issue    --principal <id> [--roles a,b] [--actors a,b] [--nodes a,b] [--expires <iso>] [--kind human|service|agent]
  list
  disable  --key-id <keyId>
  keys     show | rotate [--at-record <n>]
  kek      generate
  verify   [journal path]      verify a journal offline: chain, signatures, rollback anchor

Environment:
  CONTROL_PLANE_PRINCIPALS_FILE  credential registry (default data/principals.json)
  CONTROL_PLANE_KEYSTORE         signing key store   (default data/keystore.json)
  CONTROL_PLANE_KEK              base64 key encryption key that wraps the signing key
`;

export async function run(argv) {
  const [command, ...args] = argv;
  switch (command) {
    case 'issue': return cmdIssue(args);
    case 'list': return cmdList();
    case 'disable': return cmdDisable(args);
    case 'keys': return cmdKeys(args);
    case 'kek': return cmdKek(args);
    case 'verify': return cmdVerify(args);
    default:
      process.stdout.write(USAGE);
      if (command && command !== 'help' && command !== '--help') process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('cli.js')) {
  run(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
