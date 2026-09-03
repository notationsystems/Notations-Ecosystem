/**
 * Abuse resistance: rate limiting and authentication lockout.
 *
 * Two distinct budgets, because they answer different questions:
 *
 *   A token bucket per identity bounds how fast an authenticated caller may spend
 *   the control plane's work — reads are cheap, commands are not, so they draw on
 *   separate buckets.
 *
 *   A failure counter per source bounds credential guessing. It is keyed on the
 *   remote address rather than the credential, because the credential is exactly
 *   what an attacker is varying.
 *
 * Both are in-process and therefore per-instance: the control plane is a single
 * writer by design. A multi-instance deployment terminates at a shared edge and
 * should carry the same limits there; that is stated in the deployment notes rather
 * than pretended away here.
 */

import { ControlPlaneError } from '../errors.js';

export class TokenBucket {
  constructor({ capacity, refillPerSecond }) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
    this.updatedAt = 0;
  }

  /** @returns {{allowed: boolean, retryAfterSeconds: number}} */
  take(now, cost = 1) {
    if (this.updatedAt === 0) this.updatedAt = now;
    const elapsedSeconds = Math.max(0, (now - this.updatedAt) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.updatedAt = now;
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const deficit = cost - this.tokens;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(deficit / this.refillPerSecond)) };
  }
}

/**
 * A bounded map of buckets. The bound matters: an unbounded keyspace keyed on
 * attacker-controlled input is itself a memory-exhaustion vector.
 */
class BucketMap {
  constructor({ capacity, refillPerSecond, maxKeys = 4096 }) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.maxKeys = maxKeys;
    this.buckets = new Map();
  }

  take(key, now, cost = 1) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) {
        // Evict the least recently updated bucket rather than growing without bound.
        let oldestKey = null;
        let oldestAt = Infinity;
        for (const [candidate, entry] of this.buckets) {
          if (entry.updatedAt < oldestAt) {
            oldestAt = entry.updatedAt;
            oldestKey = candidate;
          }
        }
        if (oldestKey !== null) this.buckets.delete(oldestKey);
      }
      bucket = new TokenBucket({ capacity: this.capacity, refillPerSecond: this.refillPerSecond });
      this.buckets.set(key, bucket);
    }
    return bucket.take(now, cost);
  }

  get size() {
    return this.buckets.size;
  }
}

export class RateLimiter {
  /**
   * @param {object} options
   * @param {number} options.readPerMinute      sustained read requests per identity
   * @param {number} options.commandPerMinute   sustained commands per identity
   * @param {number} options.authFailuresPerMinute failed credential attempts per source
   * @param {number} options.lockoutSeconds     how long a source is locked after exhausting them
   */
  constructor({ readPerMinute = 600, commandPerMinute = 60, authFailuresPerMinute = 10, lockoutSeconds = 300 } = {}) {
    this.reads = new BucketMap({ capacity: readPerMinute, refillPerSecond: readPerMinute / 60 });
    this.commands = new BucketMap({ capacity: commandPerMinute, refillPerSecond: commandPerMinute / 60 });
    this.authFailures = new BucketMap({ capacity: authFailuresPerMinute, refillPerSecond: authFailuresPerMinute / 60, maxKeys: 8192 });
    this.lockoutSeconds = lockoutSeconds;
    this.lockedUntil = new Map();
    this.counters = { readsLimited: 0, commandsLimited: 0, authLockouts: 0 };
  }

  #limit(map, key, now, counter) {
    const verdict = map.take(key, now);
    if (!verdict.allowed) {
      this.counters[counter] += 1;
      throw new ControlPlaneError(429, 'CONTROL_PLANE_RATE_LIMITED', 'This identity has exceeded its request budget.', `Retry after ${verdict.retryAfterSeconds} seconds, or request a higher budget for this principal.`, { retryAfterSeconds: verdict.retryAfterSeconds });
    }
    return verdict;
  }

  /** Charge a read to an identity's budget. */
  chargeRead(identity, now = Date.now()) {
    return this.#limit(this.reads, identity, now, 'readsLimited');
  }

  /** Charge a state-changing command to an identity's budget. */
  chargeCommand(identity, now = Date.now()) {
    return this.#limit(this.commands, identity, now, 'commandsLimited');
  }

  /** Refuse early if this source is locked out for credential guessing. */
  assertNotLockedOut(source, now = Date.now()) {
    const until = this.lockedUntil.get(source);
    if (until === undefined) return;
    if (until <= now) {
      this.lockedUntil.delete(source);
      return;
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((until - now) / 1000));
    throw new ControlPlaneError(429, 'CONTROL_PLANE_LOCKED_OUT', 'Too many failed authentication attempts from this source.', `Retry after ${retryAfterSeconds} seconds.`, { retryAfterSeconds });
  }

  /** Record a failed credential attempt; locks the source out once the budget is spent. */
  recordAuthFailure(source, now = Date.now()) {
    const verdict = this.authFailures.take(source, now);
    if (!verdict.allowed) {
      this.lockedUntil.set(source, now + this.lockoutSeconds * 1000);
      this.counters.authLockouts += 1;
      return { lockedOut: true };
    }
    return { lockedOut: false };
  }

  /** Non-sensitive counters for the security status surface. */
  status() {
    return {
      ...this.counters,
      trackedIdentities: this.reads.size + this.commands.size,
      lockedSources: this.lockedUntil.size,
    };
  }
}
