export class ControlPlaneError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code stable machine code
   * @param {string} detail what happened, safe to return to the caller
   * @param {string} [remedy] what the caller should do instead
   * @param {Record<string, unknown>} [meta] non-sensitive extras (e.g. retryAfterSeconds)
   */
  constructor(status, code, detail, remedy, meta = {}) {
    super(detail);
    this.name = 'ControlPlaneError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.remedy = remedy;
    this.meta = meta;
  }

  toJSON() {
    return { error: this.code, detail: this.detail, remedy: this.remedy, ...this.meta };
  }
}

export function invalid(detail, remedy = 'Use the published control-plane API contract.') {
  return new ControlPlaneError(422, 'CONTROL_PLANE_COMMAND_INVALID', detail, remedy);
}
