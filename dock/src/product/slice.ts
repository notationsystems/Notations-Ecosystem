import { TRUTH, isUnknown, type Truth, type TruthClass } from '../model/truth';
import type { CaravanSlice } from './types';

/**
 * Reading a slice for what it could not answer.
 *
 * The shell derives its exception list from the data rather than trusting the response's own
 * digest. A digest is a convenience; if a response omits an unknown from it, the unknown still
 * reaches the screen. That is the difference between a surface that reports exceptions and one
 * that reports the exceptions someone remembered to list.
 */

export interface Unanswered {
  /** Where in the slice it sits, as a path a reader can follow. */
  path: string;
  truthClass: TruthClass;
  whyUnknown: string;
  detail?: readonly string[];
}

const isTruth = (v: unknown): v is Truth<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { class?: unknown }).class === 'string'
  && (TRUTH as Record<string, unknown>)[(v as { class: string }).class] !== undefined;

/** Every typed non-success in the slice, in the order it appears. */
export function unanswered(slice: CaravanSlice): Unanswered[] {
  const found: Unanswered[] = [];
  const walk = (node: unknown, path: string) => {
    if (isTruth(node)) {
      if (isUnknown(node)) found.push({ path, truthClass: node.class, whyUnknown: node.whyUnknown, detail: node.detail });
      return; // a truth is a leaf; its own fields are not separate subjects
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (typeof node === 'object' && node !== null) {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk({ frame: slice.frame, parties: slice.parties, shipments: slice.shipments, voyages: slice.voyages }, '');
  return found;
}

/**
 * The evidence state of the slice. Deliberately not a score: a reader is told how many subjects
 * carry an answer and how many do not, and nothing is averaged into a number that hides which.
 */
export function coverage(slice: CaravanSlice): { answered: number; unanswered: number; total: number; byClass: Record<string, number> } {
  const un = unanswered(slice);
  const total = countTruths(slice);
  const byClass: Record<string, number> = {};
  for (const u of un) byClass[u.truthClass] = (byClass[u.truthClass] ?? 0) + 1;
  return { answered: total - un.length, unanswered: un.length, total, byClass };
}

function countTruths(slice: CaravanSlice): number {
  let n = 0;
  const walk = (node: unknown) => {
    if (isTruth(node)) { n += 1; return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object' && node !== null) Object.values(node).forEach(walk);
  };
  walk({ frame: slice.frame, parties: slice.parties, shipments: slice.shipments, voyages: slice.voyages });
  return n;
}

/** Whether the response's own digest named everything the data actually could not answer. */
export function digestIsComplete(slice: CaravanSlice): boolean {
  return unanswered(slice).length <= slice.exceptions.length;
}
