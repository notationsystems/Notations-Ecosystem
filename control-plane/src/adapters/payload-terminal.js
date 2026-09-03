import { ControlPlaneError } from '../errors.js';

const MAX_RESPONSE_BYTES = 64 * 1024;

function configuredURL(value) {
  if (!value?.trim()) {
    throw new ControlPlaneError(503, 'PAYLOAD_ADAPTER_NOT_CONFIGURED', 'PAYLOAD_TERMINAL_URL is not configured.', 'Set the trusted Payload Terminal base URL in the control-plane deployment environment.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ControlPlaneError(503, 'PAYLOAD_ADAPTER_NOT_CONFIGURED', 'PAYLOAD_TERMINAL_URL is not an absolute URL.', 'Configure an absolute HTTPS URL, or a loopback URL for local development.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ControlPlaneError(503, 'PAYLOAD_ADAPTER_NOT_CONFIGURED', 'PAYLOAD_TERMINAL_URL must not contain credentials, a query string, or a fragment.', 'Configure only the trusted service origin.');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !loopback) {
    throw new ControlPlaneError(503, 'PAYLOAD_ADAPTER_NOT_CONFIGURED', 'Payload Terminal must use HTTPS outside loopback development.', 'Configure a TLS-protected Payload Terminal origin.');
  }
  return url;
}

function timeoutMilliseconds(value) {
  const parsed = Number.parseInt(value || '5000', 10);
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 15_000 ? parsed : 5_000;
}

async function boundedJSON(response) {
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_RESPONSE_BYTES) throw new Error('health response exceeded 64 KiB');
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new Error('health response was not JSON');
  }
}

function healthDetail(body, httpStatus) {
  const platform = typeof body?.platform === 'string' ? body.platform.slice(0, 80) : 'Payload Terminal';
  const version = typeof body?.version === 'string' ? body.version.slice(0, 80) : 'version not reported';
  return `${platform} reported ${body?.status === 'operational' ? 'operational' : 'non-operational'} at HTTP ${httpStatus}; ${version}.`;
}

/**
 * Probe one configured, trusted service origin. The adapter never accepts a
 * URL from a request and returns only a small health observation, never the
 * remote response body or headers.
 */
export async function observePayloadTerminal(environment = process.env, fetcher = fetch, clock = () => new Date().toISOString()) {
  const origin = configuredURL(environment.PAYLOAD_TERMINAL_URL);
  const endpoint = new URL('/api/health', origin);
  const signal = AbortSignal.timeout(timeoutMilliseconds(environment.PAYLOAD_TERMINAL_TIMEOUT_MS));
  try {
    const response = await fetcher(endpoint, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal });
    const body = await boundedJSON(response);
    const healthy = response.ok && body?.status === 'operational';
    return Object.freeze({
      nodeId: 'payload-terminal',
      health: healthy ? 'healthy' : 'degraded',
      observedAt: clock(),
      source: 'health_check',
      detail: healthDetail(body, response.status),
    });
  } catch (error) {
    if (error instanceof ControlPlaneError) throw error;
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return Object.freeze({
      nodeId: 'payload-terminal',
      health: 'offline',
      observedAt: clock(),
      source: 'health_check',
      detail: timeout ? 'Payload Terminal health probe timed out.' : 'Payload Terminal health probe could not reach a valid health response.',
    });
  }
}
