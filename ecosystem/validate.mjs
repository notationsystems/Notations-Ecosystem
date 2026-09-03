#!/usr/bin/env node
// Validate ecosystem/catalog/*.json with the control plane's own validator.
// Usage: node ecosystem/validate.mjs [file ...]   (default: every catalog file)
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommand } from '../control-plane/src/validation.js';
import { checkCorpus, gradeNode } from './corpus.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_DIR = path.join(here, 'catalog');
const RELATION_KINDS = new Set(['supplies_context_to', 'coordinates', 'visualizes', 'governs', 'depends_on']);
const DOMAINS = new Set(['physical-economy', 'intelligence', 'scientific', 'built-environment', 'perception-3d', 'geospatial', 'archive', 'platform']);
const MATURITIES = new Set(['empty', 'prototype', 'v0', 'active', 'archived', 'upstream-mirror', 'external']);
/** What disclosing this resource would cost. */
const RESOURCE_CLASSES = new Set(['public', 'internal', 'sensitive']);
/** What losing it would cost, which is a different question and often the harder one. */
const RESOURCE_DURABILITY = new Set(['reconstructable', 'refetchable_at_risk', 'unreconstructable']);
/** Where a system sits against the collection policy (docs/COLLECTION_POLICY.md). */
const PERSON_DATA = new Set(['refused', 'incidental', 'serves']);

/**
 * What an environment variable *is*. The catalog used to call all of them `secrets_env`,
 * which put a TCP port, a filesystem path, an AWS region and a mailbox password in one
 * list of ninety names. Two things followed. An operator reading it could not tell which
 * entries create a standing grant, and the word "secret" stopped carrying information —
 * `scientific-compute-layer` had already written a note apologising that `STE_REPO` "is
 * a path, not a secret", which is a manifest arguing with its own schema.
 */
const ENV_KINDS = new Set(['credential', 'configuration']);
/** A name that reads as a credential is treated as one; the kind may not be used to duck that. */
const CREDENTIAL_SHAPED = /(^|_)(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|CREDENTIALS|PASSWD|APIKEY)$|PASSWORD|SECRET/;
const ENV_FIELDS = new Set(['name', 'kind', 'purpose', 'client_exposed', 'unused']);
const CAPABILITY_EXTRA = new Set(['surface', 'method', 'path', 'evidence', 'side_effects', 'cost', 'latency', 'provenance', 'data_domain', 'workflow']);

/**
 * The closed vocabulary a capability's `data_domain` must use.
 *
 * Left open it produced 84 values for 158 annotations — three spellings of RGB-D, two of
 * gaussian-splat, `seismic` beside `seismic-events`. A coordination layer whose systems
 * name the same subject differently cannot answer a question that spans them, which is
 * the whole reason it exists. Aliases are recorded so the migration is legible; they are
 * not accepted going in.
 */
const DATA_DOMAINS = JSON.parse(await readFile(path.join(here, 'data-domains.json'), 'utf8'));
const DATA_DOMAIN_SUBJECTS = new Set(Object.keys(DATA_DOMAINS.subjects));
const DATA_DOMAIN_ALIASES = new Map(
  Object.entries(DATA_DOMAINS.subjects).flatMap(([subject, entry]) => (entry.aliases ?? []).map((a) => [a, subject])),
);

/** How a capability is reached. Closed for the same reason: 28 spellings for 19 kinds. */
const SURFACES = JSON.parse(await readFile(path.join(here, 'surfaces.json'), 'utf8'));
const SURFACE_NAMES = new Set(Object.keys(SURFACES.surfaces));
const SURFACE_ALIASES = new Map(
  Object.entries(SURFACES.surfaces).flatMap(([name, entry]) => (entry.aliases ?? []).map((a) => [a, name])),
);

/** Refuse an unknown value, and name the canonical spelling when one is recorded. */
function checkVocabulary(errors, capabilityId, field, value, { names, aliases, file, noun, remedy }) {
  if (value === undefined || names.has(value)) return;
  const canonical = aliases.get(value);
  errors.push(canonical
    ? `capability ${capabilityId}: ${field} "${value}" is a recorded spelling of "${canonical}"; use the ${noun}`
    : `capability ${capabilityId}: ${field} "${value}" is not a ${noun} in ecosystem/${file} — ${remedy}`);
}

const DATA_DOMAIN_VOCABULARY = { names: DATA_DOMAIN_SUBJECTS, aliases: DATA_DOMAIN_ALIASES, file: 'data-domains.json', noun: 'subject', remedy: 'add it there, with the estate domain it belongs to, before using it' };
const SURFACE_VOCABULARY = { names: SURFACE_NAMES, aliases: SURFACE_ALIASES, file: 'surfaces.json', noun: 'surface', remedy: 'add it there, with what it means, before using it' };
const NOW = '2026-01-01T00:00:00.000Z';

/**
 * Strip catalog-only fields and produce the control plane's node object.
 *
 * The corpus declaration itself stays in the catalog: it carries evidence paths, and a
 * path into a repository is exactly the kind of pointer the journal refuses. What
 * crosses is the derived result — a role, a grade and a coverage fraction — so an
 * operator sees a node's standing in the live snapshot without the dock ever reading
 * this directory, and without an evidence path leaving it. Derived here rather than
 * declared, so a grade can never be written down more flatteringly than it is earned.
 */
export function toNode(entry) {
  const capabilities = (entry.capabilities ?? []).map((c) => ({
    capabilityId: c.capabilityId, label: c.label, description: c.description, mode: c.mode, approval: c.approval,
  }));
  const location = entry.location ? { longitude: entry.location.longitude, latitude: entry.location.latitude } : null;
  return { nodeId: entry.nodeId, name: entry.name, kind: entry.kind, description: entry.description, capabilities, metadata: withCorpusMetadata(entry), location };
}

/** The derived corpus fields, added to a node's metadata for the journal. */
export function withCorpusMetadata(entry) {
  const metadata = { ...(entry.metadata ?? {}) };
  if (!entry.reference?.corpus) return metadata;
  const graded = gradeNode(entry);
  const subjects = subjectsOf(entry);
  if (subjects) metadata.data_domains = subjects;
  const surfaces = surfacesOf(entry);
  if (surfaces) metadata.surfaces = surfaces;
  metadata.corpus_role = graded.role;
  metadata.corpus_grade = graded.grade;
  if (typeof graded.coverage === 'number') metadata.corpus_coverage = graded.coverage;
  // The denominator travels with the fraction: `sound` on three invariants and `sound` on
  // ten are the same word and not the same claim.
  metadata.corpus_applicable = graded.applicable;
  if (graded.fails.length) metadata.corpus_fails = graded.fails.join(' ');
  // Without this a node with no declared failures is indistinguishable from one that
  // holds everything, and "not assessed" would read as "passed".
  if (graded.unknown.length) metadata.corpus_unknown = graded.unknown.join(' ');
  // Holding a corpus and owning a domain's canonical state are different things, and
  // the difference is COR-002: eight nodes hold, three own. Collapsing them would make
  // the single-owner invariant unreadable from the snapshot.
  if (graded.ownerOf.length) metadata.corpus_owner_of = graded.ownerOf.join(' ');
  return metadata;
}

/**
 * The distinct values of one closed-vocabulary capability field, as one bounded string.
 *
 * A capability carries fifteen fields in the catalog and five in the journal, and that
 * asymmetry is deliberate: `evidence` and `path` are pointers into another system,
 * `cost`, `latency` and `provenance` are measurements about it, and none of them belong
 * in a coordination ledger. But two of the ten are drawn from closed vocabularies of
 * bounded values, and dropping *those* costs the plane the questions it exists to answer.
 * So the set crosses, per node, while the per-capability annotation stays here.
 */
function vocabularyOf(entry, field, maximum) {
  const values = [...new Set((entry.capabilities ?? []).map((c) => c[field]).filter(Boolean))].sort();
  let joined = values.join(' ');
  // Truncate on a whole value, never mid-word: a half-spelled subject is a wrong one.
  while (joined.length > maximum && values.length) {
    values.pop();
    joined = values.join(' ');
  }
  return joined;
}

/**
 * The distinct data-domain subjects a node's capabilities touch — "which systems touch
 * trade-flows?", answerable from a snapshot alone.
 */
export function subjectsOf(entry, maximum = 480) {
  return vocabularyOf(entry, 'data_domain', maximum);
}

/**
 * The distinct surfaces a node's capabilities are reached through — "which systems
 * expose an MCP tool?", the other half of the same question.
 *
 * A surface is a kind, not an address: `mcp_tool`, `http_get`, `cli`. It says how a
 * system is spoken to, never where it lives, so it crosses the boundary that a URL,
 * a port or an internal hostname would not.
 */
export function surfacesOf(entry, maximum = 240) {
  return vocabularyOf(entry, 'surface', maximum);
}

export function toRegisterCommand(entry, expectedRevision = null, actorId = 'seed:ecosystem-catalog', submittedAt = NOW) {
  return { requestId: `register:${entry.nodeId}`, actorId, submittedAt, expectedRevision, action: 'register_node', node: toNode(entry) };
}

export function toRelationCommands(entry, expectedRevision = null, actorId = 'seed:ecosystem-catalog', submittedAt = NOW) {
  return (entry.relations ?? []).map((r) => ({
    requestId: `relation:${r.relationId}`, actorId, submittedAt, expectedRevision, action: 'declare_relation',
    relationId: r.relationId, sourceNodeId: entry.nodeId, targetNodeId: r.targetNodeId, kind: r.kind, description: r.description,
  }));
}

/** Returns { errors: string[], warnings: string[] } for one catalog entry. `known` = set of catalog node ids. */
export function checkEntry(entry, file, known = new Set()) {
  const errors = [];
  const warnings = [];
  const expected = path.basename(file, '.json');
  if (entry.nodeId !== expected) errors.push(`nodeId "${entry.nodeId}" must match file name "${expected}"`);
  try { parseCommand(toRegisterCommand(entry)); } catch (e) { errors.push(`register_node: ${e.detail ?? e.message}`); }
  for (const cmd of toRelationCommands(entry)) {
    try { parseCommand(cmd); } catch (e) { errors.push(`relation ${cmd.relationId}: ${e.detail ?? e.message}`); }
    if (!RELATION_KINDS.has(cmd.kind)) errors.push(`relation ${cmd.relationId}: kind "${cmd.kind}" is not allowed`);
    if (cmd.targetNodeId === entry.nodeId) errors.push(`relation ${cmd.relationId}: self-relation`);
    if (known.size && !known.has(cmd.targetNodeId)) warnings.push(`relation ${cmd.relationId}: target "${cmd.targetNodeId}" is not in the catalog`);
  }
  const ids = new Set();
  for (const r of entry.relations ?? []) { if (ids.has(r.relationId)) errors.push(`duplicate relationId ${r.relationId}`); ids.add(r.relationId); }
  for (const c of entry.capabilities ?? []) {
    for (const k of Object.keys(c)) if (!['capabilityId', 'label', 'description', 'mode', 'approval'].includes(k) && !CAPABILITY_EXTRA.has(k)) warnings.push(`capability ${c.capabilityId}: unknown field "${k}"`);
    if (!c.evidence) warnings.push(`capability ${c.capabilityId}: no evidence path`);
    checkVocabulary(errors, c.capabilityId, 'data_domain', c.data_domain, DATA_DOMAIN_VOCABULARY);
    checkVocabulary(errors, c.capabilityId, 'surface', c.surface, SURFACE_VOCABULARY);
  }
  const md = entry.metadata ?? {};
  if (!DOMAINS.has(md.domain)) errors.push(`metadata.domain "${md.domain}" is not one of ${[...DOMAINS].join(', ')}`);
  if (md.maturity !== undefined && !MATURITIES.has(md.maturity)) errors.push(`metadata.maturity "${md.maturity}" is not allowed`);
  if (!md.repo) warnings.push('metadata.repo is missing');
  // Mirroring someone else's code without recording whose, and under what terms, is the
  // one provenance question this catalog is uniquely able to answer about itself.
  // `unrecorded` is a legal answer and a visible one; an absent field reads as "not
  // applicable", and for a mirror it never is.
  if (md.maturity === 'upstream-mirror') {
    if (!md.upstream) errors.push('an upstream-mirror must name its metadata.upstream');
    if (!md.license) errors.push('an upstream-mirror must state metadata.license, or "unrecorded" to name the gap');
    else if (md.license === 'unrecorded') warnings.push('metadata.license is "unrecorded": the mirror\'s terms are unknown');
  } else if (md.upstream) {
    // `upstream` used to carry two different relationships: "this repository is a copy of
    // X", which is ongoing and carries X's licence, and "this descends from X", which is
    // ancestry and does not. Six first-party nodes recorded the second under the first,
    // so a reader could not tell a mirror from a fork. Lineage is `derived_from`.
    errors.push(`metadata.upstream is set but maturity is "${md.maturity}"; a node that mirrors another repository is an upstream-mirror, and a node that descends from one records metadata.derived_from`);
  }
  if (entry.location && typeof entry.location.label !== 'string') warnings.push('location has no label');
  for (const k of Object.keys(entry)) if (!['nodeId', 'name', 'kind', 'description', 'capabilities', 'metadata', 'location', 'relations', 'reference'].includes(k)) warnings.push(`unknown top-level field "${k}"`);
  // The collection policy is the company's, not one repository's. It was enforced in
  // Payload Terminal's CI and stated as prose everywhere else, which made it that
  // system's policy; declaring it per node makes it the estate's and makes an exception
  // a sentence someone wrote rather than a route someone finds.
  if (!PERSON_DATA.has(md.person_data)) {
    errors.push(`metadata.person_data "${md.person_data}" is not one of ${[...PERSON_DATA].join(', ')} — see docs/COLLECTION_POLICY.md`);
  } else if (md.person_data === 'serves' && md.maturity !== 'upstream-mirror' && !md.person_data_exception) {
    errors.push('metadata.person_data is "serves" on a first-party node: declare metadata.person_data_exception saying what it serves and what would end it');
  }
  // A count of things that are right there in the same object is a derivation written
  // down, and a derivation written down drifts silently — `control-plane` said 12 while
  // declaring 14. Nothing that can be counted from the file may also be asserted in it.
  for (const [field, count, how] of [
    ['capability_count', (entry.capabilities ?? []).length, 'capabilities.length'],
    ['mcp_tool_count', (entry.capabilities ?? []).filter((c) => /^mcp\./.test(c.capabilityId) && !/^mcp\.transport\./.test(c.capabilityId)).length, 'the mcp.* capabilities that are not transports'],
    ['mcp_tools', (entry.capabilities ?? []).filter((c) => /^mcp\./.test(c.capabilityId) && !/^mcp\.transport\./.test(c.capabilityId)).length, 'the mcp.* capabilities that are not transports'],
  ]) {
    if (md[field] !== undefined) {
      errors.push(`metadata.${field} is derived, not declared: it is ${how} (${count} here). A written copy can only ever go stale`);
    }
  }

  if (md.person_data_exception && md.person_data !== 'serves') {
    errors.push('metadata.person_data_exception is set but person_data is not "serves"');
  }

  // Disclosure and durability are different questions, and one enum could answer only
  // one. `unreconstructable` was a value of the disclosure enum, so a public capture that
  // cannot be refetched had to give up saying it was public in order to say it was
  // irreplaceable — and that pair is exactly the class the archive exists for.
  for (const resource of (entry.reference ?? {}).resources ?? []) {
    if (resource.classification !== undefined && !RESOURCE_CLASSES.has(resource.classification)) {
      errors.push(`resource ${resource.name}: classification "${resource.classification}" is not one of ${[...RESOURCE_CLASSES].join(', ')}${resource.classification === 'unreconstructable' ? ' — that is a durability, not a disclosure' : ''}`);
    }
    if (resource.durability !== undefined && !RESOURCE_DURABILITY.has(resource.durability)) {
      errors.push(`resource ${resource.name}: durability "${resource.durability}" is not one of ${[...RESOURCE_DURABILITY].join(', ')}`);
    }
  }

  // Every environment variable a node names is a thing an operator will provision. The
  // ones that create a standing grant are separated from the ones that set a path, and a
  // credential nothing consumes must say so — because a manifest is an instruction, and
  // an instruction to create a credential with no consumer is the worst kind of drift:
  // it leaves a live grant behind that no failure will ever reveal.
  const env = (entry.reference ?? {}).environment;
  if (!Array.isArray(env)) {
    errors.push('reference.environment must be an array — every node states which environment variables it reads, even if that is none');
  } else {
    const seen = new Set();
    for (const item of env) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push('reference.environment: each entry is an object { name, kind, purpose }');
        continue;
      }
      const name = item.name;
      const where = `environment ${typeof name === 'string' ? name : '(unnamed)'}`;
      for (const field of Object.keys(item)) {
        // No entry may carry a value, an example or a default: this file is public, and
        // the shape is the only thing standing between a name and a leak.
        if (!ENV_FIELDS.has(field)) errors.push(`${where}: unknown field "${field}" — an environment entry names a variable, it never carries its value`);
      }
      if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
        errors.push(`${where}: name must be an upper-case environment variable name`);
      } else if (seen.has(name)) {
        errors.push(`${where}: named twice`);
      } else {
        seen.add(name);
      }
      if (!ENV_KINDS.has(item.kind)) {
        errors.push(`${where}: kind "${item.kind}" is not one of ${[...ENV_KINDS].join(', ')}`);
      } else if (item.kind === 'configuration' && typeof name === 'string' && CREDENTIAL_SHAPED.test(name)) {
        errors.push(`${where}: a variable named like a credential is treated as one — call it a credential or rename it`);
      }
      if (typeof item.purpose !== 'string' || item.purpose.trim().length < 25) {
        errors.push(`${where}: purpose must say in a sentence what the variable is for`);
      }
      if (item.client_exposed !== undefined) {
        if (item.client_exposed !== true) errors.push(`${where}: client_exposed is present only when true`);
        else if (item.kind !== 'credential') errors.push(`${where}: only a credential can be client-exposed`);
        // A credential that ships to the browser cannot be protected by secrecy, so the
        // purpose must name what does protect it. Otherwise "it is public anyway" becomes
        // a reason not to think about it.
        else if (!/referrer|origin|meter|scope|quota|restrict/i.test(item.purpose)) {
          errors.push(`${where}: a client-exposed credential must say what constrains it — referrer or origin restriction, scope, metering or quota`);
        }
      }
      if (item.unused !== undefined && (typeof item.unused !== 'string' || item.unused.trim().length < 40)) {
        errors.push(`${where}: unused must say why the variable is still named and what reading it would cost`);
      }
    }
  }

  // For the nodes that describe this repository, the reference block is checkable, so it
  // is checked. Contracts and entrypoints are source files and must resolve; resources
  // are not, because a journal, a key store and a credential registry are runtime state
  // that a clean checkout correctly does not have.
  if (md.repo === 'notationsystems/Notations-Ecosystem') {
    const ref = entry.reference ?? {};
    const cited = [
      ...(ref.contracts ?? []).map((c) => ({ where: `contract ${c.name}`, path: c.path })),
      ...((ref.runtime ?? {}).entrypoints ?? []).map((p) => ({ where: 'runtime entrypoint', path: p })),
    ].filter((c) => typeof c.path === 'string' && c.path && !/^https?:/.test(c.path));
    for (const { where, path: cited_path } of cited) {
      if (!existsSync(path.join(here, '..', cited_path))) errors.push(`${where}: "${cited_path}" does not exist in this repository`);
    }
  }

  // Corpus conformance (docs/CORPUS.md): what the node claims to hold, and against which
  // of the ten invariants it stands, fails or is structurally exempt.
  const corpus = checkCorpus(entry);
  errors.push(...corpus.errors);
  warnings.push(...corpus.warnings);
  return { errors, warnings };
}

export async function loadCatalog(dir = CATALOG_DIR) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  const entries = [];
  for (const f of files) {
    const file = path.join(dir, f);
    entries.push({ file, entry: JSON.parse(await readFile(file, 'utf8')) });
  }
  return entries;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const all = await loadCatalog();
  const known = new Set(all.map((e) => e.entry.nodeId));
  const selected = args.length ? await Promise.all(args.map(async (f) => ({ file: path.resolve(f), entry: JSON.parse(await readFile(f, 'utf8')) }))) : all;
  let errorCount = 0;
  let warningCount = 0;
  for (const { file, entry } of selected) {
    const { errors, warnings } = checkEntry(entry, file, known);
    for (const w of warnings) console.warn(`warn  ${path.basename(file)}: ${w}`);
    for (const e of errors) console.error(`error ${path.basename(file)}: ${e}`);
    errorCount += errors.length;
    warningCount += warnings.length;
  }
  const caps = selected.reduce((n, { entry }) => n + (entry.capabilities?.length ?? 0), 0);
  const rels = selected.reduce((n, { entry }) => n + (entry.relations?.length ?? 0), 0);

  // The credential surface, reported rather than buried: how many standing grants this
  // estate asks an operator to create, and which of them nothing consumes. The second
  // number is the one that matters — an unused credential is a live grant with no
  // failure mode to reveal it, so it is named here every run until it is gone.
  const env = selected.flatMap(({ file, entry }) =>
    ((entry.reference ?? {}).environment ?? []).map((item) => ({ node: path.basename(file, '.json'), ...item })),
  );
  const credentials = env.filter((item) => item.kind === 'credential');
  const unused = credentials.filter((item) => item.unused);
  const exposed = credentials.filter((item) => item.client_exposed);
  console.log(
    `environment: ${env.length} variables, ${credentials.length} credentials` +
      `${exposed.length ? `, ${exposed.length} client-exposed` : ''}` +
      `${unused.length ? `, ${unused.length} named with no consumer` : ''}`,
  );
  for (const item of unused) console.log(`  unused credential  ${item.node}: ${item.name}`);

  console.log(`${selected.length} nodes, ${caps} capabilities, ${rels} relations; errors=${errorCount} warnings=${warningCount}`);
  process.exit(errorCount ? 1 : 0);
}
