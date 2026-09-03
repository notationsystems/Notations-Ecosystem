import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ControlPlaneError } from './errors.js';

const DOMAIN = 'notations.control-plane.record.v1';
const HASH = /^[a-f0-9]{64}$/;

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
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

export function verifyRecords(records) {
  let previousHash = null;
  const eventIds = new Set();
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object' || !record.event || typeof record.event !== 'object') return `record ${index + 1} is not a control-plane record`;
    const { event } = record;
    if (typeof event.eventId !== 'string' || !event.eventId || eventIds.has(event.eventId)) return `record ${index + 1} has an empty or duplicate event id`;
    if (typeof event.commandHash !== 'string' || !HASH.test(event.commandHash)) return `event ${event.eventId} has an invalid command hash`;
    if (typeof event.recordedAt !== 'string' || !Number.isFinite(Date.parse(event.recordedAt))) return `event ${event.eventId} has an invalid recordedAt`;
    if (record.previousHash !== previousHash) return `event ${event.eventId} does not extend the preceding hash`;
    if (typeof record.recordHash !== 'string' || record.recordHash !== recordHash(event, previousHash)) return `event ${event.eventId} has an invalid record hash`;
    eventIds.add(event.eventId);
    previousHash = record.recordHash;
  }
  return null;
}

export class HashJournal {
  constructor(filePath) {
    this.filePath = resolve(filePath);
    this.queue = Promise.resolve();
  }

  async read() {
    let body;
    try {
      body = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return Object.freeze([]);
      throw error;
    }
    if (!body) return Object.freeze([]);
    if (!body.endsWith('\n')) throw new ControlPlaneError(503, 'JOURNAL_CORRUPT', 'The control-plane journal ends with a partial record.', 'Restore a verified journal replica; do not truncate unknown history.');
    const records = [];
    for (const [index, line] of body.slice(0, -1).split('\n').entries()) {
      try {
        records.push(JSON.parse(line));
      } catch {
        throw new ControlPlaneError(503, 'JOURNAL_CORRUPT', `Journal line ${index + 1} is not valid JSON.`, 'Restore a verified journal replica; do not truncate unknown history.');
      }
    }
    const defect = verifyRecords(records);
    if (defect) throw new ControlPlaneError(503, 'JOURNAL_CORRUPT', defect, 'Restore a verified journal replica; do not rewrite an unverifiable history.');
    return freeze(records);
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
      const record = freeze({ event: freeze(event), previousHash: tail, recordHash: recordHash(event, tail) });
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
      return { outcome: 'appended', record };
    } finally {
      release();
    }
  }
}
