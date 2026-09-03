/**
 * Rollback resistance.
 *
 * A hash chain proves that the records you are holding are internally consistent. It
 * does not prove that they are *all* of them: truncate the file after record N and
 * the remaining prefix is a perfectly valid chain. An attacker who can write the
 * journal can therefore erase an approval, a rejection, or an entire node's history
 * and leave nothing anomalous behind.
 *
 * The anchor is the smallest thing that closes this: after every append the control
 * plane records the journal's length and head hash beside it. On every read, a
 * journal shorter than the anchor, or one whose record at the anchored position does
 * not match, is refused as tampered rather than served as truth.
 *
 * The anchor is not a substitute for durable off-host replication — an attacker who
 * can rewrite both files can rewrite both consistently. It converts silent history
 * loss into a loud, specific failure, and it is written atomically so a crash cannot
 * leave a half-anchor that looks like tampering.
 */

import { readFile, rename, writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ControlPlaneError } from '../errors.js';

export const ANCHOR_SCHEMA = 'notations.control-plane.anchor.v1';

export function anchorPathFor(journalPath) {
  return `${journalPath}.anchor`;
}

export async function readAnchor(journalPath) {
  try {
    const parsed = JSON.parse(await readFile(anchorPathFor(journalPath), 'utf8'));
    if (parsed?.schema !== ANCHOR_SCHEMA) return null;
    if (!Number.isInteger(parsed.length) || parsed.length < 0) return null;
    if (parsed.length > 0 && typeof parsed.head !== 'string') return null;
    return parsed;
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    return null;
  }
}

/** Write the anchor atomically: a temporary file plus a rename, never a partial write. */
export async function writeAnchor(journalPath, { length, head, signature = null, now = () => new Date().toISOString() }) {
  const target = anchorPathFor(journalPath);
  const temporary = `${target}.${process.pid}.tmp`;
  const body = { schema: ANCHOR_SCHEMA, length, head, updatedAt: now(), signature };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return body;
}

/**
 * Compare a loaded journal against its anchor.
 *
 * @param {Array} records verified records, in order
 * @param {object|null} anchor
 * @throws {ControlPlaneError} 503 JOURNAL_ROLLBACK when history has been shortened or rewritten
 */
export function assertNotRolledBack(records, anchor) {
  if (!anchor) return { checked: false };
  if (records.length < anchor.length) {
    throw new ControlPlaneError(
      503,
      'JOURNAL_ROLLBACK',
      `The journal holds ${records.length} records but was anchored at ${anchor.length}: history has been shortened.`,
      'Restore the journal from a verified replica. Do not append to a shortened history; the missing records may contain approvals or rejections.',
    );
  }
  if (anchor.length > 0) {
    const anchored = records[anchor.length - 1];
    if (!anchored || anchored.recordHash !== anchor.head) {
      throw new ControlPlaneError(
        503,
        'JOURNAL_ROLLBACK',
        `The record at anchored position ${anchor.length} does not match the anchored head: history has been rewritten.`,
        'Restore the journal from a verified replica and investigate write access to the journal file.',
      );
    }
  }
  return { checked: true, anchoredLength: anchor.length, currentLength: records.length };
}
