/**
 * Lookup tables that are consulted with keys an attacker chooses.
 *
 * Every allowlist in this system answers the same question — "is this name one of
 * mine?" — and the obvious spelling of that question is wrong:
 *
 *   const TABLE = Object.freeze({ reader: [...], operator: [...] });
 *   'toString' in TABLE            // true
 *   TABLE['toString']              // a function, and truthy
 *
 * `Object.freeze` seals a table's own properties; it does not detach it from
 * `Object.prototype`. So a plain object literal is an allowlist that silently admits
 * a dozen names nobody put in it, and hands back a function rather than the entry the
 * caller expected. Downstream that becomes an unhandled exception rather than a
 * refusal — a 500 instead of a 422 — and, when the accepted name reaches an
 * append-only journal before anything trips over it, a record that can never be
 * projected again.
 *
 * A table built here has a null prototype and is frozen, and membership is asked with
 * `Object.hasOwn`. Both halves are kept deliberately: the null prototype makes the
 * defect impossible, and `isKnown`/`lookup` keep it impossible at call sites that are
 * later pointed at an ordinary object.
 */

/** Freeze `entries` into a table with no prototype chain to inherit names from. */
export function sealedTable(entries) {
  return Object.freeze(Object.assign(Object.create(null), entries));
}

/** Is `key` an own name of `table`? Non-strings are never members. */
export function isKnown(table, key) {
  return typeof key === 'string' && Object.hasOwn(table, key);
}

/** The entry `key` names, or `undefined` — never an inherited value. */
export function lookup(table, key) {
  return isKnown(table, key) ? table[key] : undefined;
}

/** An accumulator keyed by names from untrusted input: same rules, mutable. */
export function sealedKeys(keys, initial) {
  const out = Object.create(null);
  for (const key of keys) out[key] = initial(key);
  return out;
}
