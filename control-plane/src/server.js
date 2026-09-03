import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { ControlPlane } from './control-plane.js';
import { ControlPlaneError } from './errors.js';
import { observePayloadTerminal } from './adapters/payload-terminal.js';
import { payloadTerminalProfile } from './profiles/payload-terminal.js';
import { notationDataFabricProfile } from './profiles/notation-data-fabric.js';
import { parseProfileApplication } from './validation.js';

const host = process.env.CONTROL_PLANE_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.CONTROL_PLANE_PORT || '8787', 10);
const journalPath = resolve(process.cwd(), process.env.CONTROL_PLANE_JOURNAL_PATH || 'data/control-plane.jsonl');
const allowedOrigins = new Set((process.env.CONTROL_PLANE_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
const MAX_BODY_BYTES = 256_000;
const controlPlane = ControlPlane.fromPath(journalPath);

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

function originHeaders(request) {
  const origin = request.headers.origin;
  if (!origin) return {};
  if (!allowedOrigins.has(origin)) throw new ControlPlaneError(403, 'ORIGIN_NOT_ALLOWED', `Origin ${origin} is not allowed to call the control plane.`, 'Add the visual dock origin to CONTROL_PLANE_ALLOWED_ORIGINS.');
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    vary: 'Origin',
  };
}

function requireAuthority(request) {
  const expected = process.env.NOTATIONS_CONTROL_PLANE_TOKEN;
  if (!expected?.trim()) throw new ControlPlaneError(503, 'CONTROL_PLANE_NOT_CONFIGURED', 'The control plane is fail-closed until NOTATIONS_CONTROL_PLANE_TOKEN is configured.', 'Set a dedicated deployment secret before exposing a private route.');
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new ControlPlaneError(401, 'CONTROL_PLANE_UNAUTHORIZED', 'A Bearer token is required.', 'Authenticate as an authorized operator or service.');
  const supplied = Buffer.from(header.slice('Bearer '.length));
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) throw new ControlPlaneError(401, 'CONTROL_PLANE_UNAUTHORIZED', 'The supplied authority is invalid.', 'Authenticate as an authorized operator or service.');
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

export function createControlPlaneServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        const snapshot = await controlPlane.snapshot();
        return json(response, 200, { status: 'operational', service: 'notations-ecosystem-control-plane', revision: snapshot.revision, nodes: snapshot.nodes.length });
      }

      const headers = originHeaders(request);
      if (request.method === 'OPTIONS' && (url.pathname === '/v1/snapshot' || url.pathname === '/v1/events' || url.pathname === '/v1/commands' || url.pathname === '/v1/profiles/payload-terminal' || url.pathname === '/v1/profiles/payload-terminal/apply' || url.pathname === '/v1/profiles/notation-data-fabric' || url.pathname === '/v1/adapters/payload-terminal/observe')) {
        response.writeHead(204, headers);
        return response.end();
      }
      requireAuthority(request);

      if (request.method === 'GET' && url.pathname === '/v1/snapshot') return json(response, 200, await controlPlane.snapshot(), { ...headers, 'cache-control': 'private, no-store' });
      if (request.method === 'GET' && url.pathname === '/v1/events') return json(response, 200, await controlPlane.events(url.searchParams.get('after') || undefined), { ...headers, 'cache-control': 'private, no-store' });
      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        const result = await controlPlane.command(await readJSON(request));
        return json(response, result.outcome === 'appended' ? 201 : 200, result, { ...headers, 'cache-control': 'private, no-store' });
      }
      if (request.method === 'GET' && url.pathname === '/v1/profiles/payload-terminal') return json(response, 200, payloadTerminalProfile(), { ...headers, 'cache-control': 'private, no-store' });
      if (request.method === 'GET' && url.pathname === '/v1/profiles/notation-data-fabric') return json(response, 200, notationDataFabricProfile(), { ...headers, 'cache-control': 'private, no-store' });
      if (request.method === 'POST' && url.pathname === '/v1/profiles/payload-terminal/apply') {
        const result = await controlPlane.applyProfile(await readJSON(request), payloadTerminalProfile());
        return json(response, result.outcome === 'appended' ? 201 : 200, result, { ...headers, 'cache-control': 'private, no-store' });
      }
      if (request.method === 'POST' && url.pathname === '/v1/adapters/payload-terminal/observe') {
        const envelope = parseProfileApplication(await readJSON(request));
        const observation = await observePayloadTerminal();
        const result = await controlPlane.command({
          requestId: envelope.requestId,
          actorId: envelope.actorId,
          submittedAt: envelope.submittedAt,
          expectedRevision: envelope.expectedRevision,
          action: 'record_observation',
          ...observation,
        });
        return json(response, result.outcome === 'appended' ? 201 : 200, { ...result, adapter: 'payload-terminal' }, { ...headers, 'cache-control': 'private, no-store' });
      }
      return json(response, 404, { error: 'ROUTE_NOT_FOUND', detail: 'This route is not part of the control-plane API.' }, headers);
    } catch (error) {
      if (error instanceof ControlPlaneError) return json(response, error.status, error.toJSON());
      console.error('[notations-control-plane] unexpected error', error);
      return json(response, 500, { error: 'CONTROL_PLANE_INTERNAL_ERROR', detail: 'The control plane could not complete this request.', remedy: 'Inspect the server log and preserve the journal before retrying.' });
    }
  });
}

const server = createControlPlaneServer();
server.listen(port, host, () => {
  console.error(`[notations-control-plane] listening on http://${host}:${port}; journal ${journalPath}`);
});
