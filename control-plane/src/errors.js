export class ControlPlaneError extends Error {
  constructor(status, code, detail, remedy) {
    super(detail);
    this.name = 'ControlPlaneError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.remedy = remedy;
  }

  toJSON() {
    return { error: this.code, detail: this.detail, remedy: this.remedy };
  }
}

export function invalid(detail, remedy = 'Use the published control-plane API contract.') {
  return new ControlPlaneError(422, 'CONTROL_PLANE_COMMAND_INVALID', detail, remedy);
}
