/**
 * Hand the operator a file. Client-side, from what the dock already holds.
 *
 * The one thing worth getting right: a downloaded snapshot is a copy of a referenced
 * response, so it keeps the reference and the proof root it was read at. Strip those and
 * the file becomes the shape API-000 refuses — authoritative to read, impossible to
 * verify, silent about which.
 */
export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: revoking synchronously races the click in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A filename that sorts by time and names the revision it was taken at. */
export function exportName(kind: string, revision: string | null): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `notations-${kind}-${stamp}-${(revision ?? 'unrevisioned').slice(0, 12)}.json`;
}
