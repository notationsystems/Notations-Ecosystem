/**
 * A minimal reader for the published contract.
 *
 * The contract had drifted a long way from the code — 25 stable error codes with three
 * named, no error schema, untyped snapshot arrays, and `dispatch: "not_dispatched"`, the
 * one field that carries "approval is not execution", nowhere in the machine-readable
 * document at all. Documents drift because nothing checks them, so this exists to let a
 * test check this one.
 *
 * It is not a YAML parser. It reads the two things a test needs — the declared error
 * codes and the response statuses per path — with a line scanner, because adding a YAML
 * dependency to a control plane with zero runtime dependencies would be a worse trade
 * than a forty-line reader.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OPENAPI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'openapi', 'control-plane.openapi.yaml');

export async function readContract(file = OPENAPI_PATH) {
  const text = await readFile(file, 'utf8');
  const lines = text.split('\n');

  const codes = [];
  let inEnum = false;
  for (const line of lines) {
    if (/^\s{4}ErrorCode:/.test(line)) { inEnum = false; continue; }
    if (/^\s{6}enum:/.test(line)) { inEnum = true; continue; }
    if (inEnum) {
      const item = /^\s{8}- ([A-Z_]+)$/.exec(line);
      if (item) { codes.push(item[1]); continue; }
      inEnum = false;
    }
  }

  /** path -> method -> [status] */
  const responses = {};
  let currentPath = null;
  let currentMethod = null;
  let inResponses = false;
  for (const line of lines) {
    const p = /^  (\/\S*):$/.exec(line);
    if (p) { currentPath = p[1]; currentMethod = null; inResponses = false; continue; }
    if (!currentPath) continue;
    const m = /^    (get|post|put|patch|delete):$/.exec(line);
    if (m) { currentMethod = m[1]; inResponses = false; continue; }
    if (/^      responses:$/.test(line)) { inResponses = true; continue; }
    if (inResponses) {
      const status = /^        '(\d{3})':$/.exec(line);
      if (status) {
        responses[currentPath] ??= {};
        responses[currentPath][currentMethod] ??= [];
        responses[currentPath][currentMethod].push(status[1]);
        continue;
      }
      if (/^      \S/.test(line)) inResponses = false;
    }
  }

  return { text, codes, responses, paths: Object.keys(responses) };
}
