/**
 * Security observability.
 *
 * The journal is the record of what the ecosystem decided. This is the record of how
 * the control plane defended itself: authentication outcomes, authorization denials,
 * rate limiting, integrity verdicts, and configuration posture at boot.
 *
 * It is deliberately a separate channel from the journal. Security events are
 * high-volume, attacker-influenced, and must never be able to grow the authoritative
 * history or to be replayed into it.
 *
 * Nothing written here may contain credential material. Fields pass through
 * `logSafe`, principals are named by id, credentials are never named at all, and
 * remote addresses are truncated so a log copy is not a list of who talked to the
 * control plane from where.
 */

import { createHash } from 'node:crypto';
import { logSafe } from './text.js';
import { lookup, sealedTable } from './table.js';

export const SECURITY_EVENTS = sealedTable({
  BOOT: 'boot',
  AUTH_OK: 'auth.ok',
  AUTH_FAILED: 'auth.failed',
  AUTH_LOCKOUT: 'auth.lockout',
  FORBIDDEN: 'authz.denied',
  RATE_LIMITED: 'rate.limited',
  ORIGIN_REJECTED: 'origin.rejected',
  COMMAND_REFUSED: 'command.refused',
  COMMAND_ACCEPTED: 'command.accepted',
  INTEGRITY_FAILED: 'integrity.failed',
  INTEGRITY_VERIFIED: 'integrity.verified',
  POSTURE_REFUSED: 'posture.refused',
  CONFIG_WARNING: 'config.warning',
});

/** Severity is the operator's triage order, not a CVSS claim. */
const SEVERITY = sealedTable({
  [SECURITY_EVENTS.BOOT]: 'info',
  [SECURITY_EVENTS.AUTH_OK]: 'debug',
  [SECURITY_EVENTS.AUTH_FAILED]: 'warn',
  [SECURITY_EVENTS.AUTH_LOCKOUT]: 'high',
  [SECURITY_EVENTS.FORBIDDEN]: 'warn',
  [SECURITY_EVENTS.RATE_LIMITED]: 'warn',
  [SECURITY_EVENTS.ORIGIN_REJECTED]: 'warn',
  [SECURITY_EVENTS.COMMAND_REFUSED]: 'info',
  [SECURITY_EVENTS.COMMAND_ACCEPTED]: 'debug',
  [SECURITY_EVENTS.INTEGRITY_FAILED]: 'critical',
  [SECURITY_EVENTS.INTEGRITY_VERIFIED]: 'info',
  [SECURITY_EVENTS.POSTURE_REFUSED]: 'warn',
  [SECURITY_EVENTS.CONFIG_WARNING]: 'warn',
});

/**
 * A remote address reduced to a stable pseudonym: enough to correlate attempts from
 * one source, not enough to reconstruct who they were.
 */
export function sourceKey(remoteAddress, salt) {
  if (!remoteAddress) return 'unknown';
  return createHash('sha256').update(`${salt}|${remoteAddress}`).digest('hex').slice(0, 16);
}

export class SecurityLog {
  /**
   * @param {object} options
   * @param {(line: string) => void} [options.sink] where a formatted line goes; stderr by default
   * @param {number} [options.ring] how many recent events to keep in memory
   * @param {boolean} [options.debug] emit debug-severity events
   */
  constructor({ sink = line => process.stderr.write(`${line}\n`), ring = 500, debug = false, clock = () => new Date().toISOString() } = {}) {
    this.sink = sink;
    this.ringSize = ring;
    this.debug = debug;
    this.clock = clock;
    this.events = [];
    this.counts = new Map();
  }

  /**
   * @param {string} kind one of SECURITY_EVENTS
   * @param {Record<string, unknown>} fields non-sensitive context
   */
  record(kind, fields = {}) {
    const severity = lookup(SEVERITY, kind) ?? 'info';
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
    const event = { at: this.clock(), kind, severity };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      event[key] = typeof value === 'number' || typeof value === 'boolean' ? value : logSafe(value, 240);
    }
    if (this.events.length >= this.ringSize) this.events.shift();
    this.events.push(event);
    if (severity === 'debug' && !this.debug) return event;
    this.sink(JSON.stringify({ log: 'notations.control-plane.security.v1', ...event }));
    return event;
  }

  /** Recent events, newest last. Safe to expose to an operator principal. */
  recent(limit = 100) {
    return this.events.slice(-Math.max(1, Math.min(limit, this.ringSize)));
  }

  /** Counters only: the shape the security constellation consumes. */
  summary() {
    return Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}
