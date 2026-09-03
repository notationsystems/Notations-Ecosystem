#!/usr/bin/env node
/**
 * The security evidence producer.
 *
 * This is the thing that keeps the constellation honest. It runs real checks where
 * the systems actually are — dependency audits, key-store inspection, journal
 * verification, transport configuration, secret scanning — and then submits *only*
 * what the control plane is allowed to hold: a state, a coverage fraction, counts by
 * severity, and one sentence.
 *
 * The asymmetry is the point. The producer sees package names, versions, advisory
 * identifiers and file paths. The control plane never does. If someone compromises
 * the visualiser they get a dashboard of how healthy things are, not an inventory of
 * what to attack. Every signal is re-checked against the same refusal boundary the
 * server enforces before it is sent, so a careless summary fails here, loudly, rather
 * than being refused later in a way someone might be tempted to work around.
 *
 *   node security/attest.mjs --journal control-plane/data/control-plane.jsonl
 *   node security/attest.mjs --url http://127.0.0.1:8787 --token "$TOKEN" --node control-plane
 *   node security/attest.mjs --print            # show what would be sent, send nothing
 */

import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { MAX_SIGNALS_PER_ATTESTATION, POSTURE_DIMENSIONS, parseSignals } from '../control-plane/src/security/evidence.js';
import { HttpControlPlane } from '../control-plane/src/client.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const clamp = value => Math.max(0, Math.min(1, Math.round(value * 100) / 100));

/** Dependency risk: severity counts only. Package names and advisories stay here. */
async function dependencyRisk(packageDirectory) {
  const findings = { critical: 0, high: 0, medium: 0, low: 0 };
  let audited = false;
  try {
    const { stdout } = await run('npm', ['audit', '--json'], { cwd: packageDirectory, maxBuffer: 32 * 1024 * 1024 });
    const report = JSON.parse(stdout);
    const counts = report?.metadata?.vulnerabilities ?? {};
    findings.critical = counts.critical ?? 0;
    findings.high = counts.high ?? 0;
    findings.medium = counts.moderate ?? 0;
    findings.low = (counts.low ?? 0) + (counts.info ?? 0);
    audited = true;
  } catch (error) {
    // `npm audit` exits non-zero when it finds anything, and still prints the report.
    try {
      const report = JSON.parse(error.stdout ?? '{}');
      const counts = report?.metadata?.vulnerabilities ?? {};
      findings.critical = counts.critical ?? 0;
      findings.high = counts.high ?? 0;
      findings.medium = counts.moderate ?? 0;
      findings.low = (counts.low ?? 0) + (counts.info ?? 0);
      audited = Boolean(report?.metadata);
    } catch {
      audited = false;
    }
  }
  if (!audited) {
    return { dimension: 'dependency_risk', state: 'unknown', summary: 'No dependency audit could be run in this environment.' };
  }
  const state = findings.critical > 0 ? 'failing' : findings.high > 0 ? 'weak' : findings.medium > 0 ? 'adequate' : 'strong';
  return {
    dimension: 'dependency_risk',
    state,
    coverage: 1,
    findings,
    summary: `Dependency audit complete: ${findings.critical} critical, ${findings.high} high, ${findings.medium} medium, ${findings.low} low.`,
  };
}

/** Repository secret hygiene folds into identity posture. */
async function secretHygiene() {
  try {
    const { stdout } = await run('node', [path.join(ROOT, 'security/scan-secrets.mjs')], { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 });
    const exempted = Number(/(\d+) exempted/.exec(stdout)?.[1] ?? 0);
    return { clean: true, exempted };
  } catch (error) {
    const findings = Number(/(\d+) finding/.exec(error.stdout ?? '')?.[1] ?? 1);
    return { clean: findings === 0, findings };
  }
}

/** Identity posture, from the credential registry's shape rather than its contents. */
async function identityPosture(environment) {
  const legacy = Boolean((environment.NOTATIONS_CONTROL_PLANE_TOKEN ?? '').trim());
  let bound = 0;
  let unbound = 0;
  const registryPath = environment.CONTROL_PLANE_PRINCIPALS_FILE;
  if (registryPath) {
    try {
      const registry = JSON.parse(await readFile(registryPath, 'utf8'));
      for (const principal of registry.principals ?? []) {
        if ((principal.actors ?? []).includes('*')) unbound += 1; else bound += 1;
      }
    } catch {
      // An unreadable registry is reported as unknown coverage, never guessed at.
    }
  }
  const total = bound + unbound + (legacy ? 1 : 0);
  const hygiene = await secretHygiene();
  const findings = { critical: hygiene.clean ? 0 : (hygiene.findings ?? 1), high: legacy ? 1 : 0, medium: unbound, low: 0 };
  const state = !hygiene.clean ? 'failing' : legacy ? 'weak' : total === 0 ? 'unknown' : unbound > 0 ? 'adequate' : 'strong';
  return {
    dimension: 'identity',
    state,
    coverage: total ? clamp(bound / total) : 0,
    findings,
    summary: total
      ? `${bound} of ${total} credentials are bound to a single actor identity${legacy ? '; a shared deployment token is still in use' : ''}.`
      : 'No credential registry is configured for this deployment.',
  };
}

/**
 * Authorization coverage: how many of the plane's state-changing actions the enforcement
 * table actually covers.
 *
 * This used to read ACTION_PERMISSIONS and grade ACTION_PERMISSIONS — `actions.length ?
 * 'strong' : 'unknown'` over a frozen literal of six entries, with coverage hard-coded
 * to 1. The 'unknown' branch was unreachable and the signal could only ever say
 * 'strong', which is a decoration rather than a measurement: an action added to
 * validation.js and forgotten in the permission table would have left it saying 'strong'
 * while the gap it exists to find sat open.
 *
 * It compares two independent lists now: the actions the validator will parse, and the
 * actions the policy table will authorise. Coverage is the fraction, and a gap is
 * `failing` because an action with no permission mapping is an action nobody has to hold
 * anything to invoke.
 */
async function authorizationPosture() {
  const [{ ACTION_PERMISSIONS, ROLES }, { SUPPORTED_ACTIONS }] = await Promise.all([
    import('../control-plane/src/security/policy.js'),
    import('../control-plane/src/validation.js'),
  ]);
  const parsed = [...SUPPORTED_ACTIONS];
  const authorized = parsed.filter(action => Object.hasOwn(ACTION_PERMISSIONS, action));
  const orphaned = Object.keys(ACTION_PERMISSIONS).filter(action => !parsed.includes(action));
  const coverage = parsed.length ? clamp(authorized.length / parsed.length) : 0;
  const gaps = parsed.length - authorized.length;
  const state = !parsed.length ? 'unknown' : gaps > 0 ? 'failing' : orphaned.length ? 'adequate' : 'strong';
  return {
    dimension: 'authorization',
    state,
    coverage,
    findings: { critical: gaps, high: 0, medium: orphaned.length, low: 0 },
    summary: gaps > 0
      ? `${gaps} of ${parsed.length} parsed actions have no permission mapping and would be authorised by default.`
      : `${authorized.length} parsed actions each require a named permission across ${Object.keys(ROLES).length} roles, with separation of duties on approval.`,
  };
}

/**
 * Incident state.
 *
 * `incident` is one of the eleven constellation dimensions and nothing in this estate
 * ever produced it, so its tile read `unknown` forever and an operator could not tell
 * "no incidents" from "nobody is looking". The producer can answer the second half
 * honestly from what it does see: the plane's own security log counts authentication
 * failures, lockouts, authorization denials and integrity failures since boot.
 *
 * It is deliberately narrow, and says so. A real incident process is a human one; this
 * reports whether the process that would notice is running, and what it has counted.
 */
function incidentPosture(securityEvents) {
  if (!securityEvents) {
    return { dimension: 'incident', state: 'unknown', coverage: 0, summary: 'No incident record is reachable from this producer; the tile is unmeasured, not clear.' };
  }
  const integrity = securityEvents['integrity.failed'] ?? 0;
  const lockouts = securityEvents['auth.lockout'] ?? 0;
  const denials = securityEvents['authz.denied'] ?? 0;
  const state = integrity > 0 ? 'failing' : lockouts > 0 ? 'weak' : denials > 0 ? 'adequate' : 'strong';
  return {
    dimension: 'incident',
    state,
    coverage: 0.4,
    findings: { critical: integrity, high: lockouts, medium: denials, low: 0 },
    summary: `Since boot: ${integrity} integrity failures, ${lockouts} lockouts, ${denials} authorization denials. Coverage is partial: this counts what the plane observed, not what an incident process concluded.`,
  };
}

function transportPosture(environment) {
  const host = environment.CONTROL_PLANE_HOST || '127.0.0.1';
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host);
  const tls = Boolean(environment.CONTROL_PLANE_TLS_CERT && environment.CONTROL_PLANE_TLS_KEY);
  const proxy = ['1', 'true', 'yes', 'on'].includes(String(environment.CONTROL_PLANE_TRUST_PROXY_TLS ?? '').toLowerCase());
  const state = tls ? 'strong' : proxy ? 'adequate' : loopback ? 'adequate' : 'failing';
  return {
    dimension: 'encryption_in_transit',
    state,
    coverage: tls || proxy ? 1 : 0,
    summary: tls ? 'TLS terminates at the control plane.' : proxy ? 'TLS terminates at a trusted proxy in front of the control plane.' : 'The control plane serves loopback traffic only.',
  };
}

async function keyLifecyclePosture(environment) {
  const keystorePath = environment.CONTROL_PLANE_KEYSTORE || path.join(ROOT, 'control-plane/data/keystore.json');
  const wrapped = Boolean(environment.CONTROL_PLANE_KEK);
  try {
    const store = JSON.parse(await readFile(keystorePath, 'utf8'));
    const keys = store.keys ?? [];
    const active = keys.find(key => key.keyId === store.activeKeyId);
    const ageDays = active?.createdAt ? Math.floor((Date.now() - Date.parse(active.createdAt)) / 86_400_000) : null;
    const plaintext = keys.some(key => key.privateKey?.protection === 'plaintext');
    const state = plaintext ? 'failing' : ageDays !== null && ageDays > 365 ? 'weak' : ageDays !== null && ageDays > 180 ? 'adequate' : 'strong';
    return [
      {
        dimension: 'key_lifecycle',
        state,
        coverage: 1,
        findings: { critical: plaintext ? 1 : 0, high: 0, medium: ageDays !== null && ageDays > 180 ? 1 : 0, low: 0 },
        summary: `${keys.length} signing key(s), ${keys.filter(key => key.retiredAt).length} retired; active key is ${ageDays ?? 'of unknown'} days old and is ${plaintext ? 'stored in plaintext' : 'envelope-encrypted at rest'}.`,
      },
      {
        dimension: 'encryption_at_rest',
        state: wrapped ? 'strong' : 'weak',
        coverage: wrapped ? 1 : 0,
        summary: wrapped ? 'Signing key material is wrapped by a key encryption key held outside the repository.' : 'No key encryption key is configured; signing key material is not wrapped at rest.',
      },
    ];
  } catch {
    return [
      { dimension: 'key_lifecycle', state: 'unknown', summary: 'No signing key store is present for this deployment.' },
      { dimension: 'encryption_at_rest', state: wrapped ? 'adequate' : 'unknown', summary: wrapped ? 'A key encryption key is configured.' : 'No key encryption key is configured.' },
    ];
  }
}

/**
 * Where this deployment's journal is, by the same rule every other tool uses.
 *
 * The producer runs beside the plane it describes, so it must read the plane's own
 * configuration rather than a path that was true for the repository layout.
 */
function resolveJournalPath(environment = process.env) {
  return environment.CONTROL_PLANE_JOURNAL_PATH
    ? path.resolve(environment.CONTROL_PLANE_JOURNAL_PATH)
    : path.join(ROOT, 'control-plane/data/control-plane.jsonl');
}

/** Audit integrity: verify the chain itself, and report only the verdict. */
async function auditIntegrityPosture(journalPath) {
  try {
    // "No journal here" and "a journal with nothing in it" are different answers, and
    // the dimension that reports on the ledger's own integrity is the last one that
    // should confuse them: a deployment whose journal this producer cannot find would
    // otherwise attest `unknown` and look merely un-instrumented.
    try {
      await stat(journalPath);
    } catch {
      return { dimension: 'audit_integrity', state: 'unknown', coverage: 0, summary: 'No journal was found at the configured path, so chain integrity could not be evaluated here.' };
    }
    const { HashJournal } = await import('../control-plane/src/journal.js');
    const { KeyStore } = await import('../control-plane/src/security/crypto/signing.js');
    const keystorePath = process.env.CONTROL_PLANE_KEYSTORE || path.join(ROOT, 'control-plane/data/keystore.json');
    let keyStore = null;
    try {
      keyStore = await KeyStore.load({ filePath: keystorePath, kek: null, create: false });
    } catch {
      keyStore = null;
    }
    const journal = new HashJournal(journalPath, { keyStore, anchor: true });
    const records = await journal.read();
    const signed = records.filter(record => record.signature).length;
    let anchored = false;
    try {
      await stat(`${journalPath}.anchor`);
      anchored = true;
    } catch {
      anchored = false;
    }
    const state = records.length === 0 ? 'unknown' : anchored && signed === records.length ? 'strong' : signed > 0 ? 'adequate' : 'weak';
    return {
      dimension: 'audit_integrity',
      state,
      coverage: records.length ? clamp(signed / records.length) : 0,
      summary: `${records.length} records verify as an unbroken hash chain; ${signed} carry signatures and the head is ${anchored ? 'anchored against rollback' : 'not anchored'}.`,
    };
  } catch (error) {
    return { dimension: 'audit_integrity', state: 'failing', coverage: 0, summary: `The journal did not verify: ${String(error.code ?? 'verification failed')}.` };
  }
}

async function backupPosture(environment) {
  const replica = environment.CONTROL_PLANE_JOURNAL_REPLICA;
  if (!replica) {
    return { dimension: 'backup', state: 'unknown', coverage: 0, summary: 'No off-host journal replica is configured, so recoverability is unverified.' };
  }
  try {
    const info = await stat(replica);
    const ageHours = Math.floor((Date.now() - info.mtimeMs) / 3_600_000);
    const state = ageHours <= 24 ? 'strong' : ageHours <= 168 ? 'adequate' : 'weak';
    return { dimension: 'backup', state, coverage: 1, summary: `A journal replica exists and was last written ${ageHours} hours ago.` };
  } catch {
    return { dimension: 'backup', state: 'failing', coverage: 0, summary: 'A journal replica is configured but is not readable.' };
  }
}

/** Exposure: how much of the ecosystem is reachable, as a count. Never which, or where. */
async function exposurePosture() {
  try {
    const directory = path.join(ROOT, 'ecosystem/catalog');
    const files = (await readdir(directory)).filter(file => file.endsWith('.json'));
    let deployed = 0;
    let localOnly = 0;
    let unknown = 0;
    for (const file of files) {
      const entry = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      const exposure = entry.metadata?.exposure ?? 'unknown';
      if (exposure === 'deployed' || exposure === 'external') deployed += 1;
      else if (exposure === 'unknown') unknown += 1;
      else localOnly += 1;
    }
    const total = files.length;
    return {
      dimension: 'exposure',
      state: unknown > total / 2 ? 'weak' : deployed === 0 ? 'strong' : 'adequate',
      coverage: total ? clamp((total - unknown) / total) : 0,
      findings: { critical: 0, high: 0, medium: unknown, low: 0 },
      summary: `${total} catalogued systems: ${deployed} externally reachable, ${localOnly} local or library-only, ${unknown} with undeclared exposure.`,
    };
  } catch {
    return { dimension: 'exposure', state: 'unknown', summary: 'The ecosystem catalog could not be read.' };
  }
}

async function controlPlaneIntegrityPosture() {
  try {
    await run('npm', ['test'], { cwd: path.join(ROOT, 'control-plane'), maxBuffer: 16 * 1024 * 1024 });
    return { dimension: 'control_plane_integrity', state: 'strong', coverage: 1, summary: 'The control plane security invariant suite passes in this environment.' };
  } catch (error) {
    const failed = Number(/# fail (\d+)/.exec(error.stdout ?? '')?.[1] ?? 1);
    return {
      dimension: 'control_plane_integrity',
      state: failed > 0 ? 'failing' : 'unknown',
      coverage: 1,
      findings: { critical: failed, high: 0, medium: 0, low: 0 },
      summary: `${failed} control-plane invariant test(s) do not pass in this environment.`,
    };
  }
}

/**
 * Re-check every signal against the boundary before it is sent. A producer that
 * leaks material should fail here, where the person running it sees why.
 */
export function assertProducerOutputIsEvidence(signals) {
  // The server's own parser, not a re-implementation of two of its rules.
  //
  // This used to check the dimension with `in POSTURE_DIMENSIONS` and run
  // detectRefusedMaterial over the summary, and the comment at the top of this file
  // claimed it was "the same refusal boundary the server enforces". It was two of eight:
  // it did not refuse an unknown field, an out-of-range coverage, a state outside the
  // enum, a malformed expiresAt, an evidenceRef that is not an information identity, a
  // summary over 280 characters, or a signal count over the cap — and `in` admitted
  // every inherited property name.
  //
  // Running parseSignals means a careless producer fails here, loudly, at the moment it
  // is written, rather than at a boundary someone might be tempted to work around.
  try {
    parseSignals(signals);
  } catch (error) {
    throw new Error(`Refusing to attest: ${error.detail ?? error.message}${error.remedy ? ` ${error.remedy}` : ''}`);
  }
  return signals;
}

export async function collectPosture({ environment = process.env, journalPath, packageDirectory = path.join(ROOT, 'control-plane'), skipTests = false, securityEvents = null } = {}) {
  const signals = [
    await identityPosture(environment),
    await authorizationPosture(),
    transportPosture(environment),
    ...(await keyLifecyclePosture(environment)),
    await dependencyRisk(packageDirectory),
    await exposurePosture(),
    await auditIntegrityPosture(journalPath ?? resolveJournalPath(environment)),
    await backupPosture(environment),
    // Reachable only from a process that holds the plane's security log, which this
    // producer deliberately is not — an attestor credential does not carry
    // security.status.read, and widening it to make one tile prettier would be the wrong
    // trade. Passing null makes the tile say "unmeasured, not clear", which is the honest
    // answer and the one the dimension previously could not give at all.
    incidentPosture(securityEvents),
    ...(skipTests ? [] : [await controlPlaneIntegrityPosture()]),
  ];
  return assertProducerOutputIsEvidence(signals);
}

export async function attest(plane, { nodeId, actorId = 'attestor:local', signals, method = 'automated_scan', now = () => new Date().toISOString() }) {
  const snapshot = await plane.snapshot();
  if (!snapshot.nodes.some(node => node.nodeId === nodeId)) {
    throw new Error(`Node ${nodeId} is not registered in the control plane; seed the catalog before attesting.`);
  }
  // One attestation, never several.
  //
  // This used to split the constellation into batches of twelve and send one command per
  // batch, on the reasoning that batching beats silent truncation. It is worse than
  // truncation: the plane replaces a node's posture wholesale on each
  // record_security_posture — `posture.set(event.posture.nodeId, event.posture)` — so
  // every batch but the last was overwritten by the next, and the constellation showed
  // the tail of the producer's output while the journal recorded all of it. Nothing said
  // so. An attestation is one statement about a node at one time; splitting it makes two
  // statements, and the second wins.
  //
  // So: refuse, loudly, naming the cap and the count. A producer that cannot say
  // everything says nothing and reports why, which is the same trade every other refusal
  // in this estate makes.
  if (signals.length > MAX_SIGNALS_PER_ATTESTATION) {
    throw new Error(
      `This producer emitted ${signals.length} signals and one attestation carries at most ${MAX_SIGNALS_PER_ATTESTATION}. ` +
      'Posture is replaced wholesale per node, so sending them in batches would record all of them and show only the last. ' +
      'Narrow the producer, or attest the extra dimensions against a different node.',
    );
  }
  const result = await plane.command({
    requestId: `attest:${nodeId}:${now()}`,
    actorId,
    submittedAt: now(),
    expectedRevision: snapshot.revision,
    action: 'record_security_posture',
    nodeId,
    attestedAt: now(),
    method,
    signals,
  });
  return { signals: signals.length, revision: result.snapshot.revision };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const nodeId = option('node') ?? 'control-plane';
  const journalPath = option('journal') ? path.resolve(option('journal')) : undefined;
  const signals = await collectPosture({ journalPath, skipTests: args.includes('--skip-tests') });

  if (args.includes('--print') || (!option('url') && !journalPath)) {
    process.stdout.write(`${JSON.stringify({ nodeId, method: 'automated_scan', signals }, null, 2)}\n`);
    if (!option('url') && !journalPath) process.stderr.write('\nNothing was submitted. Pass --journal <path> or --url <base> --token <token> to record this attestation.\n');
    return;
  }

  let plane;
  if (option('url')) {
    const token = option('token') ?? process.env.NOTATIONS_CONTROL_PLANE_TOKEN;
    if (!token) throw new Error('--token or NOTATIONS_CONTROL_PLANE_TOKEN is required with --url');
    plane = new HttpControlPlane(option('url'), token, { log: (m) => process.stderr.write(`  ${m}\n`) });
  } else {
    const { ControlPlane } = await import('../control-plane/src/control-plane.js');
    plane = await ControlPlane.fromEnvironment(journalPath);
  }
  const result = await attest(plane, { nodeId, actorId: option('actor') ?? 'attestor:local', signals });
  process.stdout.write(`Attested ${result.signals} signals for ${nodeId} in one attestation; revision ${result.revision}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
