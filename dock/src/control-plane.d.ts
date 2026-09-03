// The dock shares the control plane's validator so a command is rejected in the browser
// for exactly the reasons the server would reject it.
declare module '@control-plane/validation.js' {
  export function parseCommand(input: unknown): Record<string, unknown> & { action: string };
}
declare module '@control-plane/errors.js' {
  export class ControlPlaneError extends Error {
    status: number; code: string; detail: string; remedy?: string;
    toJSON(): { error: string; detail: string; remedy?: string };
  }
}
