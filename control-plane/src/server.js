import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlPlane } from './control-plane.js';
import { ControlPlaneError } from './errors.js';
import { HashJournal } from './journal.js';
import { SecurityLog, SECURITY_EVENTS, sourceKey } from './security/audit.js';
import { corsHeaders, securityHeaders } from './security/headers.js';
import { LOCAL_PRINCIPAL, PrincipalRegistry, VerificationCache, loadPrincipalsFile } from './security/identity.js';
import { PERMISSIONS, describePolicy, requirePermission } from './security/policy.js';
import { RateLimiter } from './security/ratelimit.js';
import { KeyStore } from './security/crypto/signing.js';
import { KeyEncryptionKey } from './security/crypto/envelope.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);
const MAX_BODY_BYTES = 256_000;
const MAX_URL_LENGTH = 2_048;

const boolean = (value, fallback = false) => (value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase()));
const integer = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function readConfig(env = process.env) {
  const host = env.CONTROL_PLANE_HOST || '127.0.0.1';
  return {
    host,
    port: integer(env.CONTROL_PLANE_PORT, 8787),
    journalPath: resolve(process.cwd(), env.CONTROL_PLANE_JOURNAL_PATH || 'data/control-plane.jsonl'),
    allowedOrigins: new Set((env.CONTROL_PLANE_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)),
    legacyToken: (env.NOTATIONS_CONTROL_PLANE_TOKEN || '').trim() || null,
    principalsFile: env.CONTROL_PLANE_PRINCIPALS_FILE || null,
    tls: env.CONTROL_PLANE_TLS_CERT && env.CONTROL_PLANE_TLS_KEY ? { cert: env.CONTROL_PLANE_TLS_CERT, key: env.CONTROL_PLANE_TLS_KEY } : null,
    trustProxyTls: boolean(env.CONTROL_PLANE_TRUST_PROXY_TLS),
    keystorePath: env.CONTROL_PLANE_KEYSTORE || resolve(process.cwd(), 'data/keystore.json'),
    kek: env.CONTROL_PLANE_KEK || null,
    signing: boolean(env.CONTROL_PLANE_SIGNING, true),
    requireSignatures: boolean(env.CONTROL_PLANE_REQUIRE_SIGNATURES),
    anchor: boolean(env.CONTROL_PLANE_ANCHOR, true),
    maxCommandAgeSeconds: integer(env.CONTROL_PLANE_MAX_COMMAND_AGE_S, 900),
    eventsLimit: integer(env.CONTROL_PLANE_EVENTS_LIMIT, 500),
    readPerMinute: integer(env.CONTROL_PLANE_READS_PER_MINUTE, 600),
    commandPerMinute: integer(env.CONTROL_PLANE_COMMANDS_PER_MINUTE, 60),
    authFailuresPerMinute: integer(env.CONTROL_PLANE_AUTH_FAILURES_PER_MINUTE, 10),
    lockoutSeconds: integer(env.CONTROL_PLANE_LOCKOUT_SECONDS, 300),
    debugSecurityLog: boolean(env.CONTROL_PLANE_DEBUG_SECURITY_LOG),
    isLoopback: LOOPBACK.has(host),
  };
}

/**
 * Transport policy, evaluated before the listener is created.
 *
 * Serving the control plane in plaintext to anything but the loopback interface is
 * refused. A deployment that terminates TLS at a proxy says so explicitly; there is
 * no configuration in which the plane quietly accepts unencrypted traffic from a
 * network it does not control.
 */
export function assertTransportPolicy(config) {
  if (config.isLoopback || config.tls || config.trustProxyTls) return { secure: Boolean(config.tls) || config.trustProxyTls, terminatedUpstream: !config.tls && config.trustProxyTls };
  throw new Error(
    `Refusing to serve plaintext HTTP on ${config.host}: that is not a loopback address. ` +
    'Set CONTROL_PLANE_TLS_CERT and CONTROL_PLANE_TLS_KEY to terminate TLS here, or set CONTROL_PLANE_TRUST_PROXY_TLS=1 if a trusted reverse proxy terminates TLS in front of this process.',
  );
}

/** Everything the plane needs to answer a request, assembled once at boot. */
export async function createRuntime(config = readConfig(), { securityLog = new SecurityLog({ debug: config.debugSecurityLog }) } = {}) {
  const transport = assertTransportPolicy(config);

  const registryRecords = [];
  if (config.principalsFile) {
    const loaded = await loadPrincipalsFile(config.principalsFile);
    if (loaded.missing) securityLog.record(SECURITY_EVENTS.CONFIG_WARNING, { detail: `principals file ${config.principalsFile} does not exist` });
    registryRecords.push(...loaded.principals);
  }
  const registry = new PrincipalRegistry(registryRecords, { legacyToken: config.legacyToken });
  for (const warning of registry.warnings) securityLog.record(SECURITY_EVENTS.CONFIG_WARNING, { detail: warning });
  if (registry.legacy) {
    securityLog.record(SECURITY_EVENTS.CONFIG_WARNING, {
      detail: 'NOTATIONS_CONTROL_PLANE_TOKEN is in use: one credential holds every role and may claim any actor identity, so the journal actor is not identity-bound. Issue per-principal credentials before production.',
    });
  }

  let keyStore = null;
  if (config.signing) {
    const kek = config.kek ? KeyEncryptionKey.fromBase64('kek-primary', config.kek) : null;
    keyStore = await KeyStore.load({ filePath: config.keystorePath, kek, create: true });
    for (const warning of keyStore.warnings) securityLog.record(SECURITY_EVENTS.CONFIG_WARNING, { detail: warning });
  }

  const journal = new HashJournal(config.journalPath, { keyStore, requireSignatures: config.requireSignatures, anchor: config.anchor });
  const controlPlane = new ControlPlane(journal, undefined, { maxCommandAgeSeconds: config.maxCommandAgeSeconds });
  const limiter = new RateLimiter(config);
  const verificationCache = new VerificationCache();
  // Source pseudonyms are salted per process: a log copy cannot be correlated back to
  // an address without the running process's salt.
  const sourceSalt = randomBytes(16).toString('hex');

  securityLog.record(SECURITY_EVENTS.BOOT, {
    host: config.host,
    transport: transport.secure ? (transport.terminatedUpstream ? 'tls-terminated-upstream' : 'tls') : 'plaintext-loopback',
    principals: registry.size,
    legacyCredential: Boolean(registry.legacy),
    signing: keyStore ? (keyStore.canSign() ? 'active' : 'verify-only') : 'disabled',
    requireSignatures: config.requireSignatures,
    rollbackAnchor: config.anchor,
    allowedOrigins: config.allowedOrigins.size,
  });

  return { config, transport, registry, keyStore, journal, controlPlane, limiter, verificationCache, securityLog, sourceSalt, startedAt: Date.now() };
}

function json(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), ...headers });
  response.end(payload);
}

async function readJSON(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ControlPlaneError(413, 'COMMAND_TOO_LARGE', 'A control-plane command may not exceed 256 KiB.', 'Store source artifacts outside the journal and submit only bounded metadata.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ControlPlaneError(400, 'COMMAND_NOT_JSON', 'The request body is not valid JSON.', 'Submit a JSON command matching the published OpenAPI contract.');
  }
}

/** Resolve the caller, or throw. Failures feed the lockout counter for this source. */
function authenticate(runtime, request, source) {
  const { registry, limiter, verificationCache, securityLog } = runtime;
  limiter.assertNotLockedOut(source);
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    limiter.recordAuthFailure(source);
    securityLog.record(SECURITY_EVENTS.AUTH_FAILED, { source, reason: 'missing bearer credential' });
    throw new ControlPlaneError(401, 'CONTROL_PLANE_UNAUTHORIZED', 'A Bearer token is required.', 'Authenticate as an authorized operator or service.');
  }
  const token = header.slice('Bearer '.length).trim();
  const cached = verificationCache.get(token);
  // A cache hit still re-checks disabled and expiry: the cache saves the digest
  // comparison, never the authorization decision.
  if (cached) return registry.revalidate(cached.principalId);
  try {
    const principal = registry.verify(token);
    verificationCache.set(token, principal);
    securityLog.record(SECURITY_EVENTS.AUTH_OK, { source, principal: principal.principalId });
    return principal;
  } catch (error) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      const verdict = limiter.recordAuthFailure(source);
      securityLog.record(verdict.lockedOut ? SECURITY_EVENTS.AUTH_LOCKOUT : SECURITY_EVENTS.AUTH_FAILED, { source, reason: error.code });
    }
    throw error;
  }
}

export function createControlPlaneServer(runtime) {
  const { config, transport, controlPlane, limiter, securityLog, sourceSalt, registry, keyStore, journal } = runtime;
  const baseHeaders = securityHeaders({ transportIsSecure: transport.secure });

  const handler = async (request, response) => {
    let headers = { ...baseHeaders };
    const source = sourceKey(request.socket?.remoteAddress, sourceSalt);
    try {
      if ((request.url ?? '').length > MAX_URL_LENGTH) throw new ControlPlaneError(414, 'REQUEST_URI_TOO_LONG', 'The request URI is too long.', 'Use the documented query parameters.');
      let url;
      try {
        url = new URL(request.url || '/', 'http://control-plane.invalid');
      } catch {
        throw new ControlPlaneError(400, 'REQUEST_INVALID', 'The request line could not be parsed.', 'Send a well-formed HTTP request.');
      }

      headers = { ...headers, ...corsHeaders(request.headers.origin, config.allowedOrigins) };

      if (request.method === 'OPTIONS') {
        response.writeHead(204, headers);
        return response.end();
      }

      /**
       * Liveness is unauthenticated by design, and therefore says nothing about
       * state: an anonymous caller learns that the process is up, not how much
       * history it holds or what its current revision is. Both would be an oracle.
       */
      if (request.method === 'GET' && url.pathname === '/health') {
        limiter.chargeRead(`health:${source}`);
        return json(response, 200, { status: 'operational', service: 'notations-ecosystem-control-plane', uptimeSeconds: Math.round((Date.now() - runtime.startedAt) / 1000) }, headers);
      }

      const principal = authenticate(runtime, request, source);
      const identity = principal.principalId;

      if (request.method === 'GET' && url.pathname === '/v1/snapshot') {
        limiter.chargeRead(identity);
        requirePermission(principal, PERMISSIONS.SNAPSHOT_READ);
        return json(response, 200, await controlPlane.snapshot(), headers);
      }

      if (request.method === 'GET' && url.pathname === '/v1/events') {
        limiter.chargeRead(identity);
        requirePermission(principal, PERMISSIONS.EVENTS_READ);
        const requested = integer(url.searchParams.get('limit'), config.eventsLimit);
        const limit = Math.max(1, Math.min(requested, config.eventsLimit));
        return json(response, 200, await controlPlane.events(url.searchParams.get('after') || undefined, { limit }), headers);
      }

      if (request.method === 'GET' && url.pathname === '/v1/security/status') {
        limiter.chargeRead(identity);
        requirePermission(principal, PERMISSIONS.SECURITY_STATUS_READ);
        return json(response, 200, securityStatus(runtime, principal), headers);
      }

      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        limiter.chargeCommand(identity);
        const body = await readJSON(request);
        try {
          const result = await controlPlane.command(body, { principal });
          securityLog.record(SECURITY_EVENTS.COMMAND_ACCEPTED, { source, principal: identity, kind: result.event.kind, outcome: result.outcome });
          return json(response, 201, result, headers);
        } catch (error) {
          if (error instanceof ControlPlaneError) {
            const kind = error.status === 403 ? SECURITY_EVENTS.FORBIDDEN : SECURITY_EVENTS.COMMAND_REFUSED;
            securityLog.record(kind, { source, principal: identity, code: error.code, detail: error.detail });
          }
          throw error;
        }
      }

      return json(response, 404, { error: 'ROUTE_NOT_FOUND', detail: 'This route is not part of the control-plane API.' }, headers);
    } catch (error) {
      if (error instanceof ControlPlaneError) {
        if (error.status === 429) securityLog.record(SECURITY_EVENTS.RATE_LIMITED, { source, code: error.code });
        if (error.code === 'ORIGIN_NOT_ALLOWED') securityLog.record(SECURITY_EVENTS.ORIGIN_REJECTED, { source, origin: request.headers.origin });
        if (error.code === 'JOURNAL_CORRUPT' || error.code === 'JOURNAL_ROLLBACK') securityLog.record(SECURITY_EVENTS.INTEGRITY_FAILED, { source, code: error.code, detail: error.detail });
        const extra = error.meta?.retryAfterSeconds ? { 'retry-after': String(error.meta.retryAfterSeconds) } : {};
        return json(response, error.status, error.toJSON(), { ...headers, ...extra });
      }
      // Never return an internal error's text: it is the one place a stack trace or a
      // path could reach an unauthenticated caller.
      console.error('[notations-control-plane] unexpected error', error);
      return json(response, 500, { error: 'CONTROL_PLANE_INTERNAL_ERROR', detail: 'The control plane could not complete this request.', remedy: 'Inspect the server log and preserve the journal before retrying.' }, headers);
    }
  };

  const server = transport.secure && config.tls
    ? createHttpsServer({ cert: config.tls.certPem, key: config.tls.keyPem, minVersion: 'TLSv1.2', honorCipherOrder: true }, handler)
    : createHttpServer(handler);

  // Slowloris and header-flood bounds. Defaults in Node are generous for a public
  // listener and this one is deliberately not.
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 0;
  return server;
}

/**
 * The control plane's own posture, as evidence rather than material: counts, states
 * and configuration verdicts. It names no credential, no key, no address, and no
 * journal content.
 */
export function securityStatus(runtime, principal) {
  const { config, transport, registry, keyStore, journal, limiter, securityLog } = runtime;
  const unbound = registry.describe().filter(entry => entry.actors.includes('*')).length;
  return {
    schema: 'notations.control-plane.security-status.v1',
    generatedAt: new Date().toISOString(),
    principal: principal.principalId,
    identity: {
      principals: registry.size,
      legacyCredentialInUse: Boolean(registry.legacy),
      unboundActorPrincipals: unbound,
      state: registry.legacy || unbound > 0 ? 'weak' : 'strong',
    },
    authorization: describePolicy(),
    transport: {
      state: transport.secure ? 'strong' : config.isLoopback ? 'adequate' : 'failing',
      mode: transport.secure ? (transport.terminatedUpstream ? 'tls-terminated-upstream' : 'tls') : 'plaintext-loopback',
      allowedOrigins: config.allowedOrigins.size,
    },
    keyLifecycle: keyStore ? keyStore.describe() : { algorithm: null, state: 'disabled' },
    auditIntegrity: journal.integrity(),
    abuse: limiter.status(),
    events: securityLog.summary(),
    recent: principal.permissions.has(PERMISSIONS.SECURITY_STATUS_READ) ? securityLog.recent(50) : [],
  };
}

async function main() {
  const config = readConfig();
  if (config.tls) {
    config.tls.certPem = await readFile(config.tls.cert, 'utf8');
    config.tls.keyPem = await readFile(config.tls.key, 'utf8');
  }
  const runtime = await createRuntime(config);
  const server = createControlPlaneServer(runtime);
  server.listen(config.port, config.host, () => {
    const scheme = runtime.transport.secure && config.tls ? 'https' : 'http';
    console.error(`[notations-control-plane] listening on ${scheme}://${config.host}:${config.port}; journal ${config.journalPath}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(`[notations-control-plane] refusing to start: ${error.message}`);
    process.exit(1);
  });
}

export { LOCAL_PRINCIPAL };
