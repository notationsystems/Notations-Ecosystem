#!/usr/bin/env node
/**
 * Corpus conformance: the catalog's answer to "is what this system holds worth anything?"
 *
 * docs/CORPUS.md defines ten invariants (COR-001..COR-010) and five roles. This module
 * turns a node's declaration into a grade, and it does so by derivation only: nothing
 * here reads a grade that someone wrote down. A catalog entry declares standing per
 * invariant with an evidence path; the grade is computed from those declarations and
 * from the role, and a node that never declares is graded `unknown` rather than passed
 * over.
 *
 * The rule that matters most is not the arithmetic. A node that owns a canonical state
 * but cannot show provenance, refusal or an admission boundary is graded `unsound`
 * regardless of how many other invariants it satisfies, because that combination is the
 * specific thing Notation Systems says it does not build.
 *
 * Usage: node ecosystem/corpus.mjs [--json]
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATALOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog');

/**
 * A loader of its own rather than validate.mjs's, so the dependency runs one way:
 * validate.mjs imports this module, and this module imports nothing of the catalog
 * tooling. A cycle between a validator and the thing it validates is the kind of
 * fragility that only shows up under a bundler.
 */
export async function loadCatalog(dir = CATALOG_DIR) {
  const files = (await readdir(dir)).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort();
  const entries = [];
  for (const file of files) entries.push({ file: path.join(dir, file), entry: JSON.parse(await readFile(path.join(dir, file), 'utf8')) });
  return entries;
}

/** The ten invariants, in the order docs/CORPUS.md states them. */
export const INVARIANTS = Object.freeze({
  'COR-001': 'Named holding: the system states what body of material it holds, with an extent.',
  'COR-002': 'Single owner: each canonical state has exactly one owning system.',
  'COR-003': 'Provenance travels with the value: every emitted value carries source and basis.',
  'COR-004': 'Knowledge time is separate from event time.',
  'COR-005': 'Typed refusal: an unanswerable question returns a named refusal and a remedy.',
  'COR-006': 'Admission by validation: the only door into canonical state is an explicit validation step.',
  'COR-007': 'Evidence before interpretation: raw material is content-addressed before it is parsed.',
  'COR-008': 'Integrity-bound history: what changed is hash-linked or signed.',
  'COR-009': 'Outward-only projection: a projection never writes back to the state it renders.',
  'COR-010': 'Declared refusal to hold: the system names what it must never hold or become.',
});

export const INVARIANT_IDS = Object.freeze(Object.keys(INVARIANTS));
export const STANDINGS = Object.freeze(['holds', 'fails', 'exempt', 'unknown']);

/**
 * Roles say what part a system plays in the program, and therefore which invariants
 * apply to it. `exempt` here is structural: a projection holds nothing to be provenant
 * about. It is not "has not got round to it", which is `fails`.
 */
export const ROLES = Object.freeze({
  hold: Object.freeze({ label: 'Owns a corpus or a canonical state', exempt: Object.freeze([]) }),
  feed: Object.freeze({ label: 'Supplies evidence into someone else\'s corpus', exempt: Object.freeze(['COR-002', 'COR-008', 'COR-009']) }),
  transform: Object.freeze({ label: 'Computes over a corpus and returns proposals', exempt: Object.freeze(['COR-001', 'COR-002', 'COR-007', 'COR-009']) }),
  project: Object.freeze({ label: 'Renders a corpus it does not own', exempt: Object.freeze(['COR-001', 'COR-002', 'COR-003', 'COR-004', 'COR-005', 'COR-006', 'COR-007']) }),
  coordinate: Object.freeze({ label: 'Records what exists and what was agreed between corpora', exempt: Object.freeze(['COR-002', 'COR-003', 'COR-004', 'COR-005', 'COR-006', 'COR-007']) }),
});

export const ROLE_IDS = Object.freeze(Object.keys(ROLES));

/** An `exempt` note may not be a promise. These readings are refused. */
const NOT_A_REASON = /\b(not (yet )?(implemented|built|done|started)|todo|tbd|later|planned|coming|future|no time|n\/?a)\b/i;

/**
 * The standing a node effectively has for each invariant: what it declared, else what
 * its role exempts, else unknown. A missing declaration is never silently favourable.
 */
export function effectiveStanding(entry) {
  const corpus = entry?.reference?.corpus ?? null;
  const declared = corpus?.standing ?? {};
  const roleExempt = new Set(ROLES[corpus?.role]?.exempt ?? []);
  const out = Object.create(null);
  for (const id of INVARIANT_IDS) {
    const own = Object.hasOwn(declared, id) ? declared[id] : null;
    if (own && STANDINGS.includes(own.standing)) {
      out[id] = { standing: own.standing, evidence: own.evidence ?? null, note: own.note ?? null, declared: true };
    } else {
      out[id] = { standing: roleExempt.has(id) ? 'exempt' : 'unknown', evidence: null, note: roleExempt.has(id) ? 'structural: the role does not admit this property' : null, declared: false };
    }
  }
  return out;
}

/**
 * Grade one node. Coverage rather than weakest-link: corpus properties are additive, so
 * "provenance but no knowledge time" is genuinely better than neither and an operator
 * needs to see which.
 */
export function gradeNode(entry) {
  const corpus = entry?.reference?.corpus ?? null;
  const standing = effectiveStanding(entry);
  const of = value => INVARIANT_IDS.filter(id => standing[id].standing === value);
  const holds = of('holds');
  const fails = of('fails');
  const exempt = of('exempt');
  const unknown = of('unknown');
  const applicable = INVARIANT_IDS.length - exempt.length;
  const coverage = applicable ? Math.round((holds.length / applicable) * 100) / 100 : null;

  // A canonical-state owner without provenance, refusal or an admission boundary is not
  // a low score; it is a different category, and it must read as one.
  const ownsState = standing['COR-002'].standing === 'holds' || (corpus?.owner_of ?? []).length > 0;
  const soundnessSet = ['COR-003', 'COR-005', 'COR-006'];
  const missingSoundness = soundnessSet.filter(id => standing[id].standing !== 'holds' && standing[id].standing !== 'exempt');

  let grade;
  if (!corpus) grade = 'undeclared';
  else if (unknown.length === applicable && applicable > 0) grade = 'unbuilt';
  else if (ownsState && missingSoundness.length) grade = 'unsound';
  else if (coverage === null) grade = 'n/a';
  else if (coverage === 1) grade = 'sound';
  else if (coverage >= 0.5) grade = 'developing';
  else grade = 'bare';

  return {
    nodeId: entry.nodeId,
    role: corpus?.role ?? null,
    holding: corpus?.holding ?? null,
    ownerOf: corpus?.owner_of ?? [],
    holds, fails, exempt, unknown,
    applicable,
    coverage,
    grade,
    missingSoundness: ownsState ? missingSoundness : [],
  };
}

/** Validate a node's corpus declaration. Returns { errors, warnings }. */
export function checkCorpus(entry) {
  const errors = [];
  const warnings = [];
  const corpus = entry?.reference?.corpus;
  if (corpus === undefined) {
    // An error rather than a warning, now that all thirty nodes declare. An ungraded
    // node is not a node with a low grade; it is a node the doctrine has never been
    // applied to, and one of those is enough to make the ecosystem-level figure
    // meaningless. Declaring `unknown` everywhere is always available, and is the
    // honest way to say "not assessed yet".
    errors.push('reference.corpus is missing: every node is graded against docs/CORPUS.md, including one that holds nothing');
    return { errors, warnings };
  }
  if (!corpus || typeof corpus !== 'object' || Array.isArray(corpus)) {
    errors.push('reference.corpus must be an object');
    return { errors, warnings };
  }
  for (const key of Object.keys(corpus)) {
    if (!['role', 'holding', 'owner_of', 'standing'].includes(key)) warnings.push(`reference.corpus: unknown field "${key}"`);
  }
  if (!ROLE_IDS.includes(corpus.role)) errors.push(`reference.corpus.role "${corpus.role}" is not one of ${ROLE_IDS.join(', ')}`);
  if (typeof corpus.holding !== 'string' || !corpus.holding.trim()) errors.push('reference.corpus.holding must name the body of material and its extent');
  else if (corpus.holding.length > 400) errors.push('reference.corpus.holding must be one sentence (≤ 400 chars)');
  if (corpus.owner_of !== undefined && !Array.isArray(corpus.owner_of)) errors.push('reference.corpus.owner_of must be an array of domain names');
  if ((corpus.owner_of ?? []).length && corpus.role !== 'hold') {
    errors.push(`reference.corpus: owner_of is set but role is "${corpus.role}"; only a hold owns canonical state`);
  }

  const standing = corpus.standing ?? {};
  if (typeof standing !== 'object' || Array.isArray(standing)) {
    errors.push('reference.corpus.standing must be an object keyed by invariant id');
    return { errors, warnings };
  }
  for (const [id, value] of Object.entries(standing)) {
    if (!INVARIANT_IDS.includes(id)) { errors.push(`reference.corpus.standing: "${id}" is not a corpus invariant`); continue; }
    if (!value || typeof value !== 'object') { errors.push(`${id}: must be an object with a standing`); continue; }
    for (const key of Object.keys(value)) if (!['standing', 'evidence', 'note'].includes(key)) warnings.push(`${id}: unknown field "${key}"`);
    if (!STANDINGS.includes(value.standing)) { errors.push(`${id}: standing "${value.standing}" is not one of ${STANDINGS.join(', ')}`); continue; }
    // `holds` is a claim about the system, so it carries the same burden as a capability.
    if (value.standing === 'holds' && !value.evidence) errors.push(`${id}: standing "holds" requires an evidence path`);
    // `exempt` must be structural, never a promise. "Not implemented yet" is `fails`.
    if (value.standing === 'exempt') {
      if (!value.note) errors.push(`${id}: standing "exempt" requires a note saying why the property does not apply`);
      else if (NOT_A_REASON.test(value.note)) errors.push(`${id}: "${value.note}" is a plan, not an exemption — declare "fails"`);
    }
    if (value.note && value.note.length > 400) warnings.push(`${id}: note is longer than 400 characters`);
  }

  const graded = gradeNode(entry);
  if (graded.role && graded.unknown.length && graded.grade !== 'unbuilt') {
    warnings.push(`ungraded invariants: ${graded.unknown.join(', ')} (counted against the node)`);
  }
  return { errors, warnings };
}

/** The estate's domains. A domain nobody owns is where a second owner appears unnoticed. */
export const ESTATE_DOMAINS = Object.freeze(['physical-economy', 'intelligence', 'scientific', 'built-environment', 'perception-3d', 'geospatial', 'archive', 'platform']);

/** Ecosystem-level figures. Owners are checked for the single-owner invariant itself. */
export function gradeEcosystem(entries) {
  const nodes = entries.map(({ entry }) => gradeNode(entry));
  const owners = new Map();
  for (const node of nodes) for (const domain of node.ownerOf) {
    if (!owners.has(domain)) owners.set(domain, []);
    owners.get(domain).push(node.nodeId);
  }
  const contested = [...owners].filter(([, ids]) => ids.length > 1).map(([domain, ids]) => ({ domain, nodeIds: ids }));
  // COR-002 says at most one owner. It does not say every domain has one, and the
  // domains that have none are exactly where a second owner turns up unannounced —
  // as the Notation Physical Commerce ledger did, inside a node declared `feed`.
  const unowned = ESTATE_DOMAINS.filter(domain => !owners.has(domain));
  const byGrade = {};
  for (const node of nodes) byGrade[node.grade] = (byGrade[node.grade] ?? 0) + 1;
  const graded = nodes.filter(n => typeof n.coverage === 'number');
  return {
    nodes,
    byGrade,
    byRole: ROLE_IDS.reduce((acc, role) => ({ ...acc, [role]: nodes.filter(n => n.role === role).length }), {}),
    owners: Object.fromEntries(owners),
    contested,
    unowned,
    meanCoverage: graded.length ? Math.round((graded.reduce((sum, n) => sum + n.coverage, 0) / graded.length) * 100) / 100 : null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = await loadCatalog();
  const report = gradeEcosystem(entries);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const pad = (value, width) => String(value ?? '').padEnd(width);
    process.stdout.write(`${pad('nodeId', 38)}${pad('role', 12)}${pad('grade', 12)}${pad('cov', 7)}holds/applicable   fails\n`);
    for (const node of [...report.nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId))) {
      process.stdout.write(`${pad(node.nodeId, 38)}${pad(node.role ?? '—', 12)}${pad(node.grade, 12)}${pad(node.coverage ?? '—', 7)}${pad(`${node.holds.length}/${node.applicable}`, 19)}${node.fails.join(' ')}\n`);
    }
    process.stdout.write(`\nby grade: ${Object.entries(report.byGrade).map(([g, n]) => `${g}=${n}`).join('  ')}\n`);
    process.stdout.write(`by role:  ${Object.entries(report.byRole).map(([r, n]) => `${r}=${n}`).join('  ')}\n`);
    process.stdout.write(`mean coverage across graded nodes: ${report.meanCoverage ?? 'n/a'}\n`);
    if (report.contested.length) {
      for (const { domain, nodeIds } of report.contested) process.stdout.write(`COR-002 violated: ${domain} is claimed by ${nodeIds.join(' and ')}\n`);
    }
    if (report.unowned.length) {
      process.stdout.write(`no declared canonical-state owner: ${report.unowned.join(', ')}\n`);
    }
    const declaredFailures = report.nodes.flatMap(node => node.fails.map(id => `${node.nodeId} ${id}`));
    if (declaredFailures.length) process.stdout.write(`declared failures (${declaredFailures.length}): ${declaredFailures.join(', ')}\n`);
  }
  process.exit(report.contested.length ? 1 : 0);
}
