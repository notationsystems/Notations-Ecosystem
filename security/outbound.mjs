// The outbound request policy.
//
// The estate reaches third parties: 92 catalogued capabilities answer by fetching something. Every
// one of those is a place where a hostname the operator did not choose, or chose carelessly, can
// point at infrastructure the operator did not mean to expose — the cloud metadata service most of
// all, which hands out credentials to anything that can make an HTTP request from inside.
//
// The control is not "validate the URL". A hostname is not an address, and the check that matters is
// on the address the socket will actually connect to. So this resolves first, refuses every address
// outside public unicast space, and then connects *only* to the addresses it verified — closing the
// window in which a name that resolved publicly during the check resolves privately during the
// connection.
//
// Zero dependencies, for the same reason the platform checker has none: a control that needs an
// install before it can run is one that will not run where it matters.
import { lookup as dnsLookup } from 'node:dns';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';

export class OutboundRefusal extends Error {
  constructor(code, message, remedy) {
    super(message);
    this.name = 'OutboundRefusal';
    this.code = code;
    this.remedy = remedy;
  }
}

/** Address categories that are never a third party, whatever the hostname says. */
export const CATEGORIES = Object.freeze({
  loopback: 'the host itself',
  private: 'RFC1918 private address space',
  link_local: 'link-local, which includes the cloud metadata service',
  cgnat: 'carrier-grade NAT space',
  unique_local: 'IPv6 unique-local address space',
  multicast: 'multicast, which is not a unicast peer',
  reserved: 'reserved or unspecified address space',
  public: 'public unicast',
});

const v4 = (ip) => ip.split('.').map(Number);

/** Which category an address falls in. IPv4-mapped IPv6 is unwrapped first, because ::ffff:10.0.0.1 is private. */
export function classify(address) {
  let ip = String(address).trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) ip = mapped[1];

  if (net.isIPv4(ip)) {
    const [a, b] = v4(ip);
    if (a === 127) return 'loopback';
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 169 && b === 254) return 'link_local';
    if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
    if (a >= 224 && a <= 239) return 'multicast';
    if (a === 0 || a >= 240) return 'reserved';
    if (a === 192 && b === 0) return 'reserved';       // 192.0.0.0/24 and 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return 'reserved';
    return 'public';
  }
  if (net.isIPv6(ip)) {
    if (ip === '::1') return 'loopback';
    if (ip === '::') return 'reserved';
    if (/^f[cd]/.test(ip)) return 'unique_local';
    if (/^fe[89ab]/.test(ip)) return 'link_local';
    if (/^ff/.test(ip)) return 'multicast';
    return 'public';
  }
  // Not an address at all. Fail closed: an unparseable address is not a permitted one.
  return 'reserved';
}

export const DEFAULT_POLICY = Object.freeze({
  /** Only these schemes. file:, data:, gopher: and friends are not outbound HTTP. */
  schemes: ['https:'],
  /** Loopback is allowed only where a profile says so — a local development or single-host deployment. */
  allowLoopback: false,
  /** A URL that carries credentials sends them to whatever answers. */
  allowCredentials: false,
  /** A redirect is a second request to an address nothing checked. */
  followRedirects: false,
  maxBytes: 64 * 1024,
  timeoutMs: 5_000,
  /** When set, the host must match one of these exactly. The strongest form of the control. */
  allowHosts: null,
});

/** A URL's hostname keeps the brackets around an IPv6 literal; an address does not. */
export const bareHost = (hostname) => {
  const h = String(hostname);
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
};

/** Every address a hostname resolves to, using the platform resolver unless one is injected. */
export function resolveAll(hostname, resolver = null) {
  const host = bareHost(hostname);
  // An IPv6 literal is already an address. Sending it to DNS would classify nothing and, with a
  // resolver present, could classify the wrong thing.
  if (net.isIP(host)) return Promise.resolve([host]);
  if (resolver) return Promise.resolve(resolver(hostname));
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(new OutboundRefusal('OUTBOUND_UNRESOLVABLE', `${host} did not resolve.`, 'A host that cannot be resolved cannot be verified, and is refused rather than attempted.'));
      else resolve(addresses.map((a) => a.address));
    });
  });
}

/**
 * Check a URL against the policy and resolve it to verified addresses.
 * Returns the parsed URL and every address the connection is allowed to use.
 */
export async function checkUrl(raw, policy = {}, resolver = null) {
  const p = { ...DEFAULT_POLICY, ...policy };
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new OutboundRefusal('OUTBOUND_NOT_A_URL', 'The target is not an absolute URL.', 'Outbound targets are configured as absolute URLs, never assembled from a request.');
  }
  const schemes = p.allowLoopback ? [...new Set([...p.schemes, 'http:'])] : p.schemes;
  if (!schemes.includes(url.protocol)) {
    throw new OutboundRefusal('OUTBOUND_SCHEME_REFUSED', `Scheme ${url.protocol} is not an allowed outbound scheme.`, `Allowed: ${schemes.join(', ')}. file:, data: and gopher: are not outbound HTTP and are never allowed.`);
  }
  if (!p.allowCredentials && (url.username || url.password)) {
    throw new OutboundRefusal('OUTBOUND_CREDENTIALS_IN_URL', 'The target carries credentials in the URL.', 'A credential in a URL is sent to whatever answers, including a redirect target. Pass credentials as headers from a secret store.');
  }
  if (p.allowHosts && !p.allowHosts.includes(url.hostname)) {
    throw new OutboundRefusal('OUTBOUND_HOST_NOT_ALLOWED', `${url.hostname} is not on the outbound allowlist.`, 'High-security components declare the hosts they may reach; anything else is refused.');
  }

  const addresses = await resolveAll(url.hostname, resolver);
  if (!addresses.length) {
    throw new OutboundRefusal('OUTBOUND_UNRESOLVABLE', `${url.hostname} resolved to no address.`, 'A host with no address cannot be verified.');
  }
  // Every address, not the first: a name that resolves to one public and one private address is a
  // rebinding attempt, and taking the public one would be taking the attacker's better half.
  for (const address of addresses) {
    const category = classify(address);
    const permitted = category === 'public' || (category === 'loopback' && p.allowLoopback);
    if (!permitted) {
      throw new OutboundRefusal(
        'OUTBOUND_ADDRESS_REFUSED',
        `${url.hostname} resolves to ${address}, which is ${CATEGORIES[category]}.`,
        category === 'link_local'
          ? 'The link-local range carries the cloud metadata service. A request that reaches it can read instance credentials, so it is refused at the address, not at the name.'
          : 'Outbound requests reach public unicast addresses only. An internal target is reached through an explicit internal client, not through the outbound path.',
      );
    }
  }
  return { url, addresses, policy: p };
}

/**
 * Fetch under the policy. The connection is pinned to the addresses that were verified, so a name
 * that resolves differently a moment later cannot move the socket.
 */
export async function outboundFetch(raw, policy = {}, resolver = null) {
  const { url, addresses, policy: p } = await checkUrl(raw, policy, resolver);
  const agentFor = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = agentFor.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { host: url.host, accept: 'application/json, text/plain;q=0.8' },
        timeout: p.timeoutMs,
        // The whole point: the socket may only go to an address this policy already verified.
        lookup: (hostname, options, cb) => {
          const family = net.isIPv6(addresses[0]) ? 6 : 4;
          if (options && options.all) cb(null, addresses.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 })));
          else cb(null, addresses[0], family);
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.destroy();
          if (!p.followRedirects) {
            reject(new OutboundRefusal('OUTBOUND_REDIRECT_REFUSED', `${url.href} answered ${res.statusCode}, a redirect.`, 'A redirect is a second request to an address nothing checked. Configure the final target instead.'));
            return;
          }
        }
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > p.maxBytes) {
            res.destroy();
            reject(new OutboundRefusal('OUTBOUND_BODY_TOO_LARGE', `The response exceeded ${p.maxBytes} bytes.`, 'An unbounded read from a third party is a memory exhaustion the third party controls.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), addresses }));
      },
    );
    req.on('timeout', () => { req.destroy(new OutboundRefusal('OUTBOUND_TIMEOUT', `No answer within ${p.timeoutMs} ms.`, 'A third party that does not answer must not hold a request open.')); });
    req.on('error', reject);
    req.end();
  });
}
