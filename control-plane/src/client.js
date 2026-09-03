/**
 * The HTTP client for the control plane, shared by every tool that writes to it.
 *
 * It exists mostly for one behaviour: a client that meets a rate limit must back off,
 * not fall over. The plane's command budget is a real security control — it bounds how
 * fast any identity can spend the ledger — and a legitimate bulk operation such as
 * seeding a catalog will meet it. Crashing there would create pressure to raise the
 * limit, which is the wrong direction. So the limit stays, and the client waits the
 * `Retry-After` the server names.
 *
 * Nothing else is retried. A revision conflict means the caller's view of history moved
 * and it must re-read rather than resubmit; an authorization failure means the answer
 * will not change by asking again.
 */

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export class ControlPlaneHttpError extends Error {
  constructor(status, body, requestId) {
    const detail = body?.detail ?? `HTTP ${status}`;
    super(requestId ? `command ${requestId} ${status}: ${detail}` : `${status}: ${detail}`);
    this.name = 'ControlPlaneHttpError';
    this.status = status;
    this.code = body?.error ?? `HTTP_${status}`;
    this.detail = detail;
    this.remedy = body?.remedy;
    this.body = body;
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export class HttpControlPlane {
  /**
   * @param {string} base
   * @param {string} token
   * @param {object} [options]
   * @param {number} [options.maxRetries] attempts after the first, for retryable statuses
   * @param {(message: string) => void} [options.log]
   */
  constructor(base, token, { maxRetries = 6, log = () => {}, fetchImpl = fetch, sleep = wait } = {}) {
    this.base = String(base).replace(/\/$/, '');
    this.token = token;
    this.maxRetries = maxRetries;
    this.log = log;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  #headers(json = false) {
    return { authorization: `Bearer ${this.token}`, accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}) };
  }

  async #request(path, init, { requestId } = {}) {
    let attempt = 0;
    for (;;) {
      const response = await this.fetchImpl(`${this.base}${path}`, init);
      if (response.ok) return response.json();

      let body = null;
      try { body = await response.json(); } catch { body = null; }

      if (!RETRYABLE_STATUS.has(response.status) || attempt >= this.maxRetries) {
        throw new ControlPlaneHttpError(response.status, body, requestId);
      }
      // Honour the server's own number when it gives one; it knows its budget.
      const named = Number(response.headers.get('retry-after') ?? body?.retryAfterSeconds ?? 0);
      const seconds = Number.isFinite(named) && named > 0 ? named : Math.min(30, 2 ** attempt);
      attempt += 1;
      this.log(`waiting ${seconds}s after ${body?.error ?? response.status} (attempt ${attempt}/${this.maxRetries})`);
      await this.sleep(seconds * 1000);
    }
  }

  async snapshot() {
    return this.#request('/v1/snapshot', { headers: this.#headers() });
  }

  async events(after, limit) {
    const query = new URLSearchParams();
    if (after) query.set('after', after);
    if (limit) query.set('limit', String(limit));
    const suffix = query.size ? `?${query}` : '';
    return this.#request(`/v1/events${suffix}`, { headers: this.#headers() });
  }

  async command(command) {
    return this.#request('/v1/commands', { method: 'POST', headers: this.#headers(true), body: JSON.stringify(command) }, { requestId: command?.requestId });
  }

  async securityStatus() {
    return this.#request('/v1/security/status', { headers: this.#headers() });
  }
}
