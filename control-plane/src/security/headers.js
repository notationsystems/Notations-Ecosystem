/**
 * Response headers and cross-origin policy.
 *
 * The control plane serves JSON to machines and to one browser application. It never
 * serves HTML, so its content security policy can be the strictest one there is:
 * nothing may be loaded, framed, or executed from an API response, which removes
 * the whole class of attacks that turn a JSON endpoint into a script source.
 */

import { ControlPlaneError } from '../errors.js';

const ORIGIN = /^https?:\/\/[A-Za-z0-9._-]+(?::\d{1,5})?$/;

/**
 * Applied to every response, including errors. `no-store` matters: control-plane
 * responses describe authorization state and must not sit in a shared cache.
 */
export function securityHeaders({ transportIsSecure = false, hstsSeconds = 31_536_000 } = {}) {
  const headers = {
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
    'cache-control': 'no-store, no-transform',
    'pragma': 'no-cache',
    'x-robots-tag': 'noindex, nofollow',
  };
  if (transportIsSecure) headers['strict-transport-security'] = `max-age=${hstsSeconds}; includeSubDomains`;
  return headers;
}

export function isValidOrigin(origin) {
  return typeof origin === 'string' && origin.length <= 255 && ORIGIN.test(origin);
}

/**
 * Cross-origin headers for an allowlisted browser origin.
 *
 * Credentials are never allowed: the dock authenticates with a bearer header, not a
 * cookie, so `Access-Control-Allow-Credentials` would grant ambient authority
 * without adding a capability. `Vary: Origin` is always returned — including for
 * requests with no `Origin` — so a cache can never serve one origin's response to
 * another.
 */
export function corsHeaders(origin, allowedOrigins) {
  if (!origin) return { vary: 'Origin' };
  if (!isValidOrigin(origin)) {
    throw new ControlPlaneError(403, 'ORIGIN_NOT_ALLOWED', 'The Origin header is not a well-formed origin.', 'Call the control plane from a browser origin, or omit the header for server-to-server calls.');
  }
  if (!allowedOrigins.has(origin)) {
    throw new ControlPlaneError(403, 'ORIGIN_NOT_ALLOWED', `Origin ${origin} is not allowed to call the control plane.`, 'Add the visual dock origin to CONTROL_PLANE_ALLOWED_ORIGINS.');
  }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}
