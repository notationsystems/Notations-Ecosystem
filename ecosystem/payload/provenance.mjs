/**
 * One row-level provenance shape for every extracted layer.
 *
 * The estate's central claim is that provenance travels with the value (COR-003) and
 * that knowledge time is recorded apart from event time (COR-004). Across the nine
 * layers extracted here that claim was true nine different ways: `earth-facilities`
 * carried `known_at`, `comtrade-flows` carried `captured_at`, `archive-coverage`
 * carried `first_capture`/`last_capture`, and five layers carried nothing but a
 * sentence. The upstream contract these are projected from is richer still —
 * `Provenance { source, knownAt, validFrom?, validTo?, evidence?, confidence? }` — and
 * the projection flattened it to one string in eight of nine cases.
 *
 * A discipline expressed five ways and dropped six times is not a discipline. This
 * module is the single spelling; extractors emit it, the manifest declares which of
 * its fields a layer's rows actually carry, and a test holds the two together.
 */

/** The fields a row may carry to describe where its values came from. */
export const ROW_PROVENANCE_FIELDS = Object.freeze([
  'provenance',   // what produced this row: a capture, a source system, or synthetic:demo
  'known_at',     // when the value became knowable — never the same as when it happened
  'valid_from',   // start of the period the value describes
  'valid_to',     // end of that period, when it is bounded
  'confidence',   // the source's own confidence, when it states one
  'evidence',     // an opaque reference back to the material; never a link
]);

/** `provenance` is the one field no row may omit: a value with no origin is a rumour. */
export const REQUIRED_ROW_PROVENANCE = 'provenance';

const present = value => value !== undefined && value !== null && value !== '';

/**
 * Project an upstream `Provenance` object onto the row shape, keeping every field the
 * source actually carried and inventing none. A field the source did not state is
 * absent rather than null-filled, so "we do not know" and "the source said nothing"
 * do not become the same answer downstream.
 *
 * @param {{source?: string, knownAt?: string, validFrom?: string, validTo?: string, confidence?: number, evidence?: string[]}} upstream
 * @param {{fallback?: string}} [options] `fallback` is used when the source names no origin at all
 */
export function rowProvenance(upstream, { fallback = null } = {}) {
  const p = upstream ?? {};
  const out = {};
  const origin = present(p.source) ? p.source : fallback;
  if (present(origin)) out.provenance = String(origin);
  if (present(p.knownAt)) out.known_at = String(p.knownAt);
  if (present(p.validFrom)) out.valid_from = String(p.validFrom);
  if (present(p.validTo)) out.valid_to = String(p.validTo);
  if (typeof p.confidence === 'number' && Number.isFinite(p.confidence)) out.confidence = p.confidence;
  if (Array.isArray(p.evidence) && p.evidence.length) out.evidence = p.evidence.join(' ');
  return out;
}

/** The provenance fields actually present on at least one row. */
export function observedProvenanceFields(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const field of ROW_PROVENANCE_FIELDS) if (present(row[field])) seen.add(field);
  }
  return ROW_PROVENANCE_FIELDS.filter(field => seen.has(field));
}

/**
 * Check a layer's rows against what its manifest entry declares.
 *
 * The declaration is what makes the current shortfall legible instead of silent: a
 * layer extracted before this shape existed declares the two fields it has, and a
 * regeneration that recovers `known_at` must update the declaration to say so.
 *
 * @returns {string[]} problems, empty when the rows and the declaration agree
 */
export function checkLayerProvenance(layer, rows) {
  const problems = [];
  if (!Array.isArray(rows) || !rows.length) return [`${layer.id}: no rows`];
  const declared = layer.provenance_fields;
  if (!Array.isArray(declared)) return [`${layer.id}: manifest declares no provenance_fields`];
  for (const field of declared) {
    if (!ROW_PROVENANCE_FIELDS.includes(field)) problems.push(`${layer.id}: "${field}" is not a row provenance field`);
  }
  if (!declared.includes(REQUIRED_ROW_PROVENANCE)) problems.push(`${layer.id}: every row must carry ${REQUIRED_ROW_PROVENANCE}`);

  const observed = observedProvenanceFields(rows);
  for (const field of declared) {
    if (!observed.includes(field)) problems.push(`${layer.id}: declares ${field} but no row carries it`);
  }
  for (const field of observed) {
    if (!declared.includes(field)) problems.push(`${layer.id}: rows carry ${field} but the manifest does not declare it`);
  }
  const missing = rows.filter(row => !present(row?.[REQUIRED_ROW_PROVENANCE])).length;
  if (missing) problems.push(`${layer.id}: ${missing} row(s) carry no ${REQUIRED_ROW_PROVENANCE}`);
  return problems;
}
