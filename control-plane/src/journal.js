import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ControlPlaneError } from './errors.js';
import { assertNotRolledBack, readAnchor, writeAnchor } from './security/anchor.js';

const DOMAIN = 'notations.control-plane.record.v1';
const HASH = /^[a-f0-9]{64}$/;

/**
 * Canonicalization is bounded. The command digest canonicalizes a caller-supplied
 * object; without a depth limit a deeply nested body exhausts the stack, which is a
 * denial of service reachable by anyone who can submit a command. Validation refuses
 * such bodies earlier — this bound is the second line, so no future caller of
 * `digest` can reintroduce the defect.
 */
const MAX_CANONICAL_DEPTH = 64;

export function canonicalize(value, depth = 0) {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new ControlPlaneError(422, 'CONTROL_PLANE_COMMAND_INVALID', `A control-plane value may not nest more than ${MAX_CANONICAL_DEPTH} levels deep.`, 'Submit bounded metadata; the contract is shallow by design.');
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(entry => canonicalize(entry, depth + 1));
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child, depth + 1)]));
}

export function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function recordHash(event, previousHash) {
  return createHash('sha256').update(`${DOMAIN}|${previousHash ?? 'GENESIS'}|${JSON.stringify(canonicalize(event))}`).digest('hex');
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) freeze(value[key]);
  }
  return value;
}

/**
 * Verify the chain. The hash chain proves each record extends the one before it; a
 * key store, when configured, additionally proves who wrote them.
 *
 * @param {Array} records
 * @param {object} [options]
 * @param {import('./security/crypto/signing.js').KeyStore|null} [options.keyStore]
 * @param {boolean} [options.requireSignatures] refuse records that carry no signature
 * @returns {string|null} a defect description, or null when the chain verifies
 */
/**
 * The complete set of fields a journal record may carry.
 *
 * The record hash commits to the event and to the preceding hash; the signature
 * commits to the record hash. Neither commits to *the rest of the line*. So a field
 * nobody declared — a note, a second actor, an annotation — could be appended to an
 * otherwise perfectly verifying signed record by anyone able to write the file, and
 * would then be served verbatim from `/v1/events` to operators and to the dock, with
 * the chain reporting the history as intact. The shape is therefore closed: a record
 * that carries anything else is a defect, exactly like a broken hash.
 */
const RECORD_FIELDS = new Set(['event', 'previousHash', 'recordHash', 'signature']);

export function verifyRecords(records, { keyStore = null, requireSignatures = false } = {}) {
  if (requireSignatures && !keyStore) {
    return 'this control plane requires signatures but has no key store to verify them with';
  }
  let previousHash = null;
  const eventIds = new Set();
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object' || !record.event || typeof record.event !== 'object') return `record ${index + 1} is not a control-plane record`;
    for (const field of Object.keys(record)) {
      if (!RECORD_FIELDS.has(field)) return `record ${index + 1} carries the field ${field}, which is covered by neither the record hash nor its signature`;
    }
    const { event } = record;
    if (typeof event.eventId !== 'string' || !event.eventId || eventIds.has(event.eventId)) return `record ${index + 1} has an empty or duplicate event id`;
    if (typeof event.commandHash !== 'string' || !HASH.test(event.commandHash)) return `event ${event.eventId} has an invalid command hash`;
    if (typeof event.recordedAt !== 'string' || !Number.isFinite(Date.parse(event.recordedAt))) return `event ${event.eventId} has an invalid recordedAt`;
    if (record.previousHash !== previousHash) return `event ${event.eventId} does not extend the preceding hash`;
    if (typeof record.recordHash !== 'string' || record.recordHash !== recordHash(event, previousHash)) return `event ${event.eventId} has an invalid record hash`;
    if (keyStore) {
      if (record.signature) {
        const verdict = keyStore.verify(record.recordHash, record.signature, { index });
        if (!verdict.ok) return `event ${event.eventId} ${verdict.reason}`;
      } else if (requireSignatures) {
        return `event ${event.eventId} is unsigned and this control plane requires signatures`;
      }
    }
    eventIds.add(event.eventId);
    previousHash = record.recordHash;
  }
  return null;
}

export class HashJournal {
  /**
   * @param {string} filePath
   * @param {object} [options]
   * @param {import('./security/crypto/signing.js').KeyStore|null} [options.keyStore] signs appends, verifies reads
   * @param {boolean} [options.requireSignatures]
   * @param {boolean} [options.anchor] maintain a rollback anchor beside the journal
   */
  constructor(filePath, { keyStore = null, requireSignatures = false, anchor = true } = {}) {
    if (requireSignatures && !keyStore) {
      // A requirement that cannot be checked is worse than no requirement: the status
      // surface would report signatures as mandatory while every unsigned record was
      // accepted. Refuse the combination at construction rather than report a control
      // that is not running.
      throw new Error('Signature enforcement was requested without a key store. Enable signing (CONTROL_PLANE_SIGNING=1) or stop requiring signatures.');
    }
    this.filePath = resolve(filePath);
    this.queue = Promise.resolve();
    this.keyStore = keyStore;
    this.requireSignatures = requireSignatures;
    this.anchorEnabled = anchor;
    /**
     * Verified reads are cached against the file's identity and size. Re-reading and
     * re-hashing the entire history on every request is an amplification vector: an
     * unauthenticated liveness probe would otherwise cost O(history) work per call.
     */
    this.cache = null;
    this.stats = { reads: 0, cacheHits: 0, verifications: 0, appends: 0 };
  }

  #cacheKeyFrom(fileStat) {
    return `${fileStat.ino}:${fileStat.size}:${fileStat.mtimeMs}`;
  }

  async read() {
    this.stats.reads += 1;
    let fileStat = null;
    try {
      fileStat = await stat(this.filePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }

    if (fileStat) {
      const cacheKey = this.#cacheKeyFrom(fileStat);
      if (this.cache && this.cache.key === cacheKey) {
        this.stats.cacheHits += 1;
        return this.cache.records;
      }
    } else if (this.cache && this.cache.key === 'absent') {
      this.stats.cacheHits += 1;
      return this.cache.records;
    }

    let body;
    try {
      body = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        const empty = Object.freeze([]);
        await this.#assertAnchor(empty);
        this.cache = { key: 'absent', records: empty };
        return empty;
      }
      throw error;
    }
    if (!body) {
      const empty = Object.freeze([]);
      await this.#assertAnchor(empty);
      this.cache = { key: fileStat ? this.#cacheKeyFrom(fileStat) : 'absent', records: empty };
      return empty;
    }
    if (!body.endsWith('\n')) throw new ControlPlaneError(503, 'JOURNAL_CORRUPT', 'The control-plane journal ends with a partial record.', 'Restore a verified journal replica; do not truncate unknown history.');
    const records = [];
    for (const [index, line] of body.slice(0, -1).split('\n').entries()) {
      try {
        records.push(JSON.parse(line));
      } catch {
        throw new ControlPlaneError(503, 'JOURNAL_CORRUPT', `Journal line ${index + 1} is not valid JSON.`, 'Restore a verified journal replica; do not truncate unknown history.');
      }
    }
    this.stats.verifications += 1;
    const defect = verifyRecords(records, { keyStore: this.keyStore, requireSignatures: this.requireSignatures });
    if (defect) throw new ControlPlaneError(503, 'JOURNAL_CORRUPT', defect, 'Restore a verified journal replica; do not rewrite an unverifiable history.');
    const frozen = freeze(records);
    await this.#assertAnchor(frozen);
    this.cache = { key: fileStat ? this.#cacheKeyFrom(fileStat) : 'absent', records: frozen };
    return frozen;
  }

  /** Refuse a journal that has been shortened or rewritten beneath us. */
  async #assertAnchor(records) {
    if (!this.anchorEnabled) return;
    const anchor = await readAnchor(this.filePath);
    assertNotRolledBack(records, anchor);
  }

  async append(event, expectedRevision) {
    const previous = this.queue;
    let release;
    this.queue = new Promise(resolveQueue => { release = resolveQueue; });
    await previous.catch(() => undefined);
    try {
      const records = [...await this.read()];
      const duplicate = records.find(record => record.event.eventId === event.eventId);
      if (duplicate) {
        if (JSON.stringify(canonicalize(duplicate.event)) === JSON.stringify(canonicalize(event))) return { outcome: 'duplicate', record: duplicate };
        throw new ControlPlaneError(409, 'EVENT_ID_CONFLICT', `Event id ${event.eventId} already identifies different content.`, 'Retry the original command or choose a new request id.');
      }
      const tail = records.length ? records[records.length - 1].recordHash : null;
      if (tail !== expectedRevision) throw new ControlPlaneError(409, 'REVISION_CONFLICT', 'The control-plane journal changed after the caller read its snapshot.', 'Refresh the snapshot and submit the command with its current revision.');
      const hash = recordHash(event, tail);
      const signature = this.keyStore?.canSign() ? this.keyStore.sign(hash) : null;
      const record = freeze(signature ? { event: freeze(event), previousHash: tail, recordHash: hash, signature } : { event: freeze(event), previousHash: tail, recordHash: hash });
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
      this.stats.appends += 1;
      // The anchor is advanced only after the record is durable, so a crash between
      // the two leaves an anchor that is behind the journal, never ahead of it.
      if (this.anchorEnabled) await writeAnchor(this.filePath, { length: records.length + 1, head: hash });
      this.cache = null;
      return { outcome: 'appended', record };
    } finally {
      release();
    }
  }

  /** Non-sensitive integrity facts, for the security status surface. */
  integrity() {
    return {
      signing: this.keyStore ? (this.keyStore.canSign() ? 'active' : 'verify-only') : 'disabled',
      requireSignatures: this.requireSignatures,
      rollbackAnchor: this.anchorEnabled,
      ...this.stats,
    };
  }
}
