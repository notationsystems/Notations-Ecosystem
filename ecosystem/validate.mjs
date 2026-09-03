#!/usr/bin/env node
// Validate ecosystem/catalog/*.json with the control plane's own validator.
// Usage: node ecosystem/validate.mjs [file ...]   (default: every catalog file)
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
const CAPABILITY_EXTRA = new Set(['surface', 'method', 'path', 'evidence', 'side_effects', 'cost', 'latency', 'provenance', 'data_domain', 'workflow']);
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
  metadata.corpus_role = graded.role;
  metadata.corpus_grade = graded.grade;
  if (typeof graded.coverage === 'number') metadata.corpus_coverage = graded.coverage;
  if (graded.fails.length) metadata.corpus_fails = graded.fails.join(' ');
  return metadata;
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
  }
  const md = entry.metadata ?? {};
  if (!DOMAINS.has(md.domain)) errors.push(`metadata.domain "${md.domain}" is not one of ${[...DOMAINS].join(', ')}`);
  if (md.maturity !== undefined && !MATURITIES.has(md.maturity)) errors.push(`metadata.maturity "${md.maturity}" is not allowed`);
  if (!md.repo) warnings.push('metadata.repo is missing');
  if (entry.location && typeof entry.location.label !== 'string') warnings.push('location has no label');
  for (const k of Object.keys(entry)) if (!['nodeId', 'name', 'kind', 'description', 'capabilities', 'metadata', 'location', 'relations', 'reference'].includes(k)) warnings.push(`unknown top-level field "${k}"`);
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
  console.log(`${selected.length} nodes, ${caps} capabilities, ${rels} relations; errors=${errorCount} warnings=${warningCount}`);
  process.exit(errorCount ? 1 : 0);
}
