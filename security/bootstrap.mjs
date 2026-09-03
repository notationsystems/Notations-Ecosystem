#!/usr/bin/env node
/**
 * Stand up a correctly-configured control plane.
 *
 * The secure configuration is several moving parts — a key encryption key, a signing
 * key store, one credential per principal, TLS or an acknowledged terminator — and a
 * deployment that gets one of them wrong usually still starts. This makes the whole
 * thing one command, and prints the environment that reproduces it.
 *
 *   node security/bootstrap.mjs --dir ./deploy
 *   node security/bootstrap.mjs --dir ./deploy --print-env > deploy/.env
 *
 * It never overwrites an existing key store or credential registry: re-running is safe
 * and additive. Secrets are printed once, to stdout, and are not written anywhere but
 * the files that must hold them (the registry holds digests only).
 */

import { mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueCredential } from '../control-plane/src/security/identity.js';
import { KeyStore } from '../control-plane/src/security/crypto/signing.js';
import { KeyEncryptionKey } from '../control-plane/src/security/crypto/envelope.js';

const REGISTRY_SCHEMA = 'notations.control-plane.principals.v1';

/** The principals a working deployment needs, each with the least privilege that does its job. */
/**
 * Principal ids match the default actor of the tool that uses them, so the documented
 * path works with no flags. Actor binding refuses a mismatch — correctly — and a
 * bootstrap whose names disagree with its own tooling fails on first use.
 */
export const DEFAULT_PRINCIPALS = [
  { principalId: 'operator:primary', kind: 'human', roles: ['operator', 'registrar', 'requester'], purpose: 'Registers nodes and proposes intents.' },
  { principalId: 'operator:second', kind: 'human', roles: ['operator'], purpose: 'The second approver. Separation of duties needs two actors.' },
  { principalId: 'seed:ecosystem-catalog', kind: 'service', roles: ['registrar'], purpose: 'Seeds the catalog (the default actor of ecosystem/seed.mjs).' },
  { principalId: 'monitor:payload-probe', kind: 'service', roles: ['monitor'], purpose: 'Records health (the default actor of ecosystem/payload/probe.mjs).' },
  { principalId: 'attestor:local', kind: 'service', roles: ['attestor'], purpose: 'Submits posture evidence (the default actor of security/attest.mjs).' },
  { principalId: 'agent:planner', kind: 'agent', roles: ['requester'], purpose: 'A reasoning engine: may propose an intent, never approve one.' },
  { principalId: 'dock:reader', kind: 'service', roles: ['reader'], purpose: 'The dock, when it only needs to read.' },
];

const exists = async file => access(file).then(() => true).catch(() => false);

export async function bootstrap({ directory, principals = DEFAULT_PRINCIPALS, log = () => {} }) {
  await mkdir(directory, { recursive: true });
  const registryPath = path.join(directory, 'principals.json');
  const keystorePath = path.join(directory, 'keystore.json');
  const journalPath = path.join(directory, 'control-plane.jsonl');

  // 1. A key encryption key, so the signing key is never at rest in plaintext.
  //
  // Only ever minted alongside a new key store. Printing a fresh key on a re-run
  // would hand the operator a value that cannot open the key store they already
  // have — the configuration would look right and fail closed at boot.
  const keystoreExists = await exists(keystorePath);
  let kek = null;
  let keystoreCreated = false;
  if (keystoreExists) {
    log(`key store already exists at ${keystorePath}; keeping it, and its existing key encryption key`);
  } else {
    kek = randomBytes(32).toString('base64');
    await KeyStore.load({ filePath: keystorePath, kek: KeyEncryptionKey.fromBase64('kek-primary', kek), create: true });
    keystoreCreated = true;
    log('created an Ed25519 signing key, envelope-encrypted at rest');
    log('generated a key encryption key (printed once; store it in your secret manager)');
  }

  // 3. One credential per principal, least privilege each.
  const registry = (await exists(registryPath))
    ? JSON.parse(await readFile(registryPath, 'utf8'))
    : { schema: REGISTRY_SCHEMA, principals: [] };
  const issued = [];
  for (const principal of principals) {
    if (registry.principals.some(existing => existing.principalId === principal.principalId && !existing.disabled)) {
      log(`credential for ${principal.principalId} already exists; skipping`);
      continue;
    }
    const { token, record } = issueCredential({ principalId: principal.principalId, kind: principal.kind, roles: principal.roles, actors: [principal.principalId] });
    registry.principals.push(record);
    issued.push({ ...principal, token, keyId: record.keyId });
  }
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  await chmod(registryPath, 0o600).catch(() => undefined);

  return { directory, registryPath, keystorePath, journalPath, kek, issued, keystoreCreated };
}

function environmentBlock(result) {
  return [
    result.kek
      ? `CONTROL_PLANE_KEK=${result.kek}`
      : '# CONTROL_PLANE_KEK=  <- reuse the key encryption key this key store was created with;\n#                       a new one cannot open it, and the plane will refuse to start.',
    `CONTROL_PLANE_KEYSTORE=${result.keystorePath}`,
    `CONTROL_PLANE_PRINCIPALS_FILE=${result.registryPath}`,
    `CONTROL_PLANE_JOURNAL_PATH=${result.journalPath}`,
    'CONTROL_PLANE_REQUIRE_SIGNATURES=1',
    'CONTROL_PLANE_HOST=127.0.0.1',
    'CONTROL_PLANE_PORT=8787',
    '# Off loopback, set these two, or CONTROL_PLANE_TRUST_PROXY_TLS=1 behind a terminator:',
    '# CONTROL_PLANE_TLS_CERT=/path/cert.pem',
    '# CONTROL_PLANE_TLS_KEY=/path/key.pem',
    '# The dock origin, if a browser will call the API:',
    '# CONTROL_PLANE_ALLOWED_ORIGINS=https://dock.example',
    '# An off-host journal replica, so backup posture stops reporting unknown:',
    '# CONTROL_PLANE_JOURNAL_REPLICA=/mnt/replica/control-plane.jsonl',
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const directory = path.resolve(option('dir') ?? 'deploy');
  const printEnvOnly = args.includes('--print-env');

  const result = await bootstrap({ directory, log: message => { if (!printEnvOnly) process.stderr.write(`  ${message}\n`); } });

  if (printEnvOnly) {
    process.stdout.write(`${environmentBlock(result)}\n`);
    process.stderr.write('\nCredentials were issued but their secrets are NOT in this output. Re-run without --print-env to see them, or issue new ones.\n');
    return;
  }

  process.stdout.write('\nEnvironment (write this to your secret manager, not to the repository):\n\n');
  process.stdout.write(`${environmentBlock(result)}\n`);

  if (result.issued.length) {
    process.stdout.write('\nCredentials (each secret is shown once and is not recoverable):\n\n');
    for (const principal of result.issued) {
      process.stdout.write(`  ${principal.principalId}  [${principal.roles.join(', ')}]  keyId=${principal.keyId}\n`);
      process.stdout.write(`    ${principal.purpose}\n`);
      process.stdout.write(`    ${principal.token}\n\n`);
    }
  }

  process.stdout.write([
    'Next:',
    '  1. Export the environment above, then:  cd control-plane && npm start',
    '  2. Seed the catalog:                     node ecosystem/seed.mjs --url http://127.0.0.1:8787 --token "$SEED_TOKEN"',
    '  3. Attest posture:                       node security/attest.mjs --url http://127.0.0.1:8787 --token "$ATTESTOR_TOKEN"',
    '     (each tool records the actor its principal is named for; pass --actor to use another)',
    '  4. Open the dock:                        cd dock && npm run dev',
    '',
    'Approval needs two actors: operator:primary proposes or registers, operator:second approves.',
    'A single operator cannot approve an intent it proposed.',
    '',
  ].join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
