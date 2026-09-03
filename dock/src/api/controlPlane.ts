import type { Command, CommandResult, ControlPlaneErrorBody, EventsResponse, HealthResponse, Snapshot } from '../model/types';

export interface Connection {
  /** Base URL of the control plane. `/cp` in development (Vite proxy), or an absolute origin for a deployed dock. */
  baseUrl: string;
  /** Bearer token. Never persisted beyond sessionStorage; never sent anywhere but baseUrl. */
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

const TOKEN_KEY = 'notations-dock.token';
const CONN_KEY = 'notations-dock.connection';

export function loadConnection(): Connection {
  const conn = { ...DEFAULT_CONNECTION };
  try {
    const saved = sessionStorage.getItem(CONN_KEY);
    if (saved) Object.assign(conn, JSON.parse(saved) as Partial<Connection>);
    conn.token = sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch { /* storage unavailable: run with defaults */ }
  return conn;
}

export function saveConnection(conn: Connection): void {
  try {
    sessionStorage.setItem(CONN_KEY, JSON.stringify({ baseUrl: conn.baseUrl, actorId: conn.actorId }));
    if (conn.token) sessionStorage.setItem(TOKEN_KEY, conn.token); else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

async function parseError(res: Response): Promise<ControlPlaneApiError> {
  let body: Partial<ControlPlaneErrorBody> = {};
  try { body = (await res.json()) as ControlPlaneErrorBody; } catch { /* non-JSON error */ }
  return new ControlPlaneApiError(res.status, body.error ?? `HTTP_${res.status}`, body.detail ?? res.statusText, body.remedy);
}

export class ControlPlaneClient {
  constructor(private readonly conn: Connection, private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  private url(path: string): string {
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

  async events(after?: string | null): Promise<EventsResponse> {
    const qs = after ? `?after=${encodeURIComponent(after)}` : '';
    const res = await this.fetchImpl(this.url(`/v1/events${qs}`), { headers: this.headers() });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as EventsResponse;
  }

  async command(cmd: Command): Promise<CommandResult> {
    const res = await this.fetchImpl(this.url('/v1/commands'), { method: 'POST', headers: this.headers(true), body: JSON.stringify(cmd) });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as CommandResult;
  }
}
