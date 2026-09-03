import type { Command, CommandResult, ControlPlaneErrorBody, EventsResponse, HealthResponse, Snapshot } from '../model/types';

export interface Connection {
  /** Base URL of the control plane. `/cp` in development (Vite proxy), or an absolute origin for a deployed dock. */
  baseUrl: string;
  /** Bearer token. Held in memory only, never written to browser storage, and never sent anywhere but an allowlisted baseUrl. */
  token: string;
  /** Identifier the dock signs its commands with (control-plane actorId). */
  actorId: string;
}

export class ControlPlaneApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly detail: string, public readonly remedy?: string) {
    super(detail);
    this.name = 'ControlPlaneApiError';
  }
}

export const DEFAULT_CONNECTION: Connection = {
  baseUrl: (import.meta.env?.VITE_CONTROL_PLANE_URL as string | undefined) ?? '/cp',
  token: '',
  actorId: 'operator:dock',
};

const CONN_KEY = 'notations-dock.connection';
const LEGACY_TOKEN_KEY = 'notations-dock.token';

/**
 * The credential lives in memory for the lifetime of the page and nowhere else.
 *
 * `sessionStorage` survives a reload, which is convenient, and is readable by any
 * script that reaches this origin, which is the whole risk. A control-plane
 * credential can register nodes and approve execution intents; trading a re-typed
 * token for that exposure is not a trade worth making. Non-secret preferences (base
 * URL, actor id) are still persisted, because they are not secret.
 */
let inMemoryToken = '';

export function loadConnection(): Connection {
  const conn = { ...DEFAULT_CONNECTION };
  try {
    const saved = sessionStorage.getItem(CONN_KEY);
    if (saved) Object.assign(conn, JSON.parse(saved) as Partial<Connection>);
    // Clear anything a previous build of the dock may have left behind.
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch { /* storage unavailable: run with defaults */ }
  conn.token = inMemoryToken;
  return conn;
}

export function saveConnection(conn: Connection): void {
  inMemoryToken = conn.token;
  try {
    sessionStorage.setItem(CONN_KEY, JSON.stringify({ baseUrl: conn.baseUrl, actorId: conn.actorId }));
  } catch { /* ignore */ }
}

export function forgetToken(): void {
  inMemoryToken = '';
}

/**
 * Where the dock is willing to send a credential.
 *
 * The base URL is an editable field, so it is also the easiest way to talk an
 * operator into posting their token to somewhere else. A same-origin path or the
 * origin this build was configured with are allowed; anything else is refused with
 * the reason, rather than quietly attempted.
 */
export function checkBaseUrl(baseUrl: string): { ok: true } | { ok: false; reason: string } {
  const value = baseUrl.trim();
  if (!value) return { ok: false, reason: 'A base URL is required.' };
  if (value.startsWith('/')) return { ok: true };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'That is not a valid URL or same-origin path.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `The ${parsed.protocol} scheme is not a control plane.` };
  }
  // A loopback control plane is the documented development setup and is reachable
  // only from this machine, so it is allowed whether or not a browser origin exists.
  if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]') return { ok: true };
  const configured = (import.meta.env?.VITE_CONTROL_PLANE_URL as string | undefined) ?? '';
  const allowed = new Set<string>();
  if (configured && !configured.startsWith('/')) {
    try { allowed.add(new URL(configured).origin); } catch { /* misconfigured build */ }
  }
  if (typeof location !== 'undefined') allowed.add(location.origin);
  if (allowed.has(parsed.origin)) return { ok: true };
  return {
    ok: false,
    reason: `The dock will not send a credential to ${parsed.origin}. Allowed: a same-origin path, this origin, loopback, or the origin this build was configured with.`,
  };
}

async function parseError(res: Response): Promise<ControlPlaneApiError> {
  let body: Partial<ControlPlaneErrorBody> = {};
  try { body = (await res.json()) as ControlPlaneErrorBody; } catch { /* non-JSON error */ }
  return new ControlPlaneApiError(res.status, body.error ?? `HTTP_${res.status}`, body.detail ?? res.statusText, body.remedy);
}

export class ControlPlaneClient {
  constructor(private readonly conn: Connection, private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  private url(path: string): string {
    const verdict = checkBaseUrl(this.conn.baseUrl);
    if (!verdict.ok) throw new ControlPlaneApiError(0, 'DOCK_BASE_URL_REFUSED', verdict.reason, 'Point the dock at its own origin or a loopback control plane.');
    const base = this.conn.baseUrl.replace(/\/$/, '');
    return `${base}${path}`;
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json' };
    if (this.conn.token) h.authorization = `Bearer ${this.conn.token}`;
    if (json) h['content-type'] = 'application/json';
    return h;
  }

  async health(): Promise<HealthResponse> {
    const res = await this.fetchImpl(this.url('/health'), { headers: { accept: 'application/json' } });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as HealthResponse;
  }

  async snapshot(): Promise<Snapshot> {
    const res = await this.fetchImpl(this.url('/v1/snapshot'), { headers: this.headers() });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as Snapshot;
  }

  async events(after?: string | null, options: { limit?: number } = {}): Promise<EventsResponse> {
    const params = new URLSearchParams();
    if (after) params.set('after', after);
    if (options.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    const res = await this.fetchImpl(this.url(`/v1/events${qs ? `?${qs}` : ''}`), { headers: this.headers() });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as EventsResponse;
  }

  /**
   * Every record after `after`, following the server's pagination.
   *
   * `GET /v1/events` caps a page and says so with `truncated` and `nextCursor`. Reading
   * one page and stopping drops the rest silently, which is the failure this estate
   * refuses everywhere else: a timeline that is missing records without saying so is
   * worse than one that says it could not fetch them.
   */
  async allEvents(after?: string | null, { pages = 20 } = {}): Promise<EventsResponse> {
    let page = await this.events(after);
    const events = [...page.events];
    let fetched = 1;
    while (page.truncated && page.nextCursor && fetched < pages) {
      page = await this.events(page.nextCursor);
      events.push(...page.events);
      fetched += 1;
    }
    return { ...page, events, truncated: Boolean(page.truncated), nextCursor: page.nextCursor ?? null };
  }

  async command(cmd: Command): Promise<CommandResult> {
    const res = await this.fetchImpl(this.url('/v1/commands'), { method: 'POST', headers: this.headers(true), body: JSON.stringify(cmd) });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as CommandResult;
  }
}
