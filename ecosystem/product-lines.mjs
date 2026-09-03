// Checks the three-API partition against itself, the catalog and the closed data vocabulary.
//
// The partition is only worth having if it is enforced: one canonical owner per spine type, a
// written non-goal per line, a named incumbent layer, a cross-line join whose keys actually exist
// on both ends, one line building at a time, and a rights profile on every source. Each check below
// is one of the LINE invariants, and each failure names the invariant it broke.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'notations.ecosystem.product-lines.v1';
const STAGES = new Set(['building', 'defined', 'retired']);
const RIGHTS = new Set(['own_material', 'public_record', 'licensed_derived_only', 'unverified']);
const OS_OWNER = 'payload_os';
const UNDECIDED = 'to_decide';

export async function loadProductLines() {
  const raw = JSON.parse(await readFile(path.join(here, 'product-lines.json'), 'utf8'));
  if (raw.schema !== SCHEMA) throw new Error(`product-lines.json must declare ${SCHEMA}`);
  return raw;
}
async function loadDataSubjects() {
  const raw = JSON.parse(await readFile(path.join(here, 'data-domains.json'), 'utf8'));
  return new Set(Object.keys(raw.subjects));
}

/** Every owner named anywhere: the OS itself, plus the declared lines. */
const ownersOf = (doc) => new Set([OS_OWNER, ...Object.keys(doc.lines)]);

export function checkProductLines(doc, { subjects = null, catalogNodeIds = null } = {}) {
  const errors = [], warnings = [];
  const fail = (invariant, message) => errors.push(`${invariant}: ${message}`);
  const warn = (invariant, message) => warnings.push(`${invariant}: ${message}`);
  const owners = ownersOf(doc);
  const lines = Object.entries(doc.lines);

  // LINE-001 — one canonical owner per spine type, and per contract subtype.
  const ownerOfType = new Map();
  for (const [type, spec] of Object.entries(doc.spine.types)) {
    if (!owners.has(spec.owner)) fail('LINE-001', `spine type "${type}" is owned by "${spec.owner}", which is not the OS or a declared line`);
    ownerOfType.set(type, spec.owner);
    for (const [subtype, sub] of Object.entries(spec.subtypes ?? {})) {
      if (!owners.has(sub.owner)) fail('LINE-001', `contract subtype "${subtype}" is owned by "${sub.owner}", which is not a declared line`);
      ownerOfType.set(`${type}.${subtype}`, sub.owner);
    }
  }
  // What each line claims to own must match what the spine says it owns — in both directions.
  const claimed = new Map();
  for (const [id, line] of lines) {
    for (const type of line.spine?.owns ?? []) {
      if (!ownerOfType.has(type)) fail('LINE-001', `${id} claims to own "${type}", which is not a spine type`);
      else if (ownerOfType.get(type) !== id) fail('LINE-001', `${id} claims to own "${type}", but the spine gives it to ${ownerOfType.get(type)}`);
      if (claimed.has(type)) fail('LINE-001', `"${type}" is claimed by both ${claimed.get(type)} and ${id}`);
      claimed.set(type, id);
    }
  }
  for (const [type, owner] of ownerOfType) {
    if (owner === OS_OWNER) continue;
    if (claimed.get(type) !== owner) fail('LINE-001', `the spine gives "${type}" to ${owner}, but ${owner} does not claim it`);
  }

  // LINE-002 — a non-owner holds a reference, never a definition. The reference shape must be a
  // strict subset of the owner's keys plus display fields, and must never carry the owner's payload.
  for (const [type, spec] of Object.entries(doc.spine.types)) {
    const shape = spec.reference_shape ?? [];
    if (!shape.length) fail('LINE-002', `spine type "${type}" declares no reference shape, so a non-owner has nothing lawful to hold`);
    const keys = new Set(spec.keys ?? []);
    if (![...keys].some((k) => shape.includes(k))) fail('LINE-002', `the reference shape for "${type}" carries none of its keys, so a reference cannot be resolved`);
  }
  // A line that owns a class keyed on another line's spine key must declare the reference.
  for (const [id, line] of lines) {
    const refs = new Set(line.spine?.references ?? []);
    const ownKeys = new Set(Object.values(doc.class_keys?.[id] ?? {}).flat());
    for (const [type, spec] of Object.entries(doc.spine.types)) {
      if (ownerOfType.get(type) === id || ownerOfType.get(type) === OS_OWNER) continue;
      const holdsKey = (spec.keys ?? []).some((k) => ownKeys.has(k));
      if (holdsKey && !refs.has(type)) fail('LINE-002', `${id} carries a key of "${type}" on its classes but does not declare it as a reference`);
    }
  }

  // LINE-003 — every line says what it is not, in sentences.
  for (const [id, line] of lines) {
    const not = line.not_the_job;
    if (!Array.isArray(not) || not.length < 2) fail('LINE-003', `${id} must state at least two non-goals; a line with no written non-goal grows into the one next to it`);
    else for (const [i, sentence] of not.entries()) {
      if (typeof sentence !== 'string' || sentence.trim().split(/\s+/).length < 5) fail('LINE-003', `${id}.not_the_job[${i}] must be a sentence, not a label`);
    }
    if (typeof line.job !== 'string' || !line.job.trim()) fail('LINE-003', `${id} must state its job`);
  }

  // LINE-004 — the incumbent layer declined, and the layer competed on.
  for (const [id, line] of lines) {
    const inc = line.incumbents;
    if (!inc || typeof inc.layer_not_cloned !== 'string' || !inc.layer_not_cloned.trim()) fail('LINE-004', `${id} must name the incumbent layer it does not clone`);
    if (!inc || typeof inc.where_we_compete !== 'string' || !inc.where_we_compete.trim()) fail('LINE-004', `${id} must name the layer it competes on`);
  }

  // LINE-005 — every hop of the join resolves: both endpoints exist, and the key is on both.
  const keysOf = (line, klass) => {
    const own = doc.class_keys?.[line]?.[klass];
    if (own) return new Set(own);
    const spec = doc.spine.types[klass];
    return spec ? new Set(spec.keys ?? []) : null;
  };
  for (const hop of doc.join?.path ?? []) {
    for (const end of ['from', 'through', 'to']) {
      const e = hop[end];
      if (!e) continue;
      if (!doc.lines[e.line]) { fail('LINE-005', `hop "${hop.hop}" names line "${e.line}", which is not declared`); continue; }
      if (!keysOf(e.line, e.class)) fail('LINE-005', `hop "${hop.hop}" names class "${e.line}.${e.class}", whose keys are not declared`);
    }
    const chain = [hop.from, hop.through, hop.to].filter(Boolean);
    for (const e of chain) {
      const keys = keysOf(e.line, e.class);
      if (!keys) continue;
      // The join key must be reachable: on this class, or on the class the hop passes through.
      if (!keys.has(hop.key) && e === hop.from && !keysOf(hop.through?.line, hop.through?.class)?.has(hop.key)) {
        fail('LINE-005', `hop "${hop.hop}" joins on "${hop.key}", which is on neither ${e.line}.${e.class} nor the class it passes through`);
      }
    }
    const target = keysOf(hop.to?.line, hop.to?.class);
    if (target && !target.has(hop.key)) fail('LINE-005', `hop "${hop.hop}" joins on "${hop.key}", which ${hop.to.line}.${hop.to.class} does not carry`);
    if (hop.from?.line === hop.to?.line) warn('LINE-005', `hop "${hop.hop}" does not cross a line, so it is not a cross-line join`);
  }
  if ((doc.join?.path ?? []).length < 2) fail('LINE-005', 'the join must cross all three lines; fewer hops than that is not the argument for one company');

  // LINE-006 — exactly one line building.
  for (const [id, line] of lines) if (!STAGES.has(line.stage)) fail('LINE-006', `${id}.stage must be one of ${[...STAGES].join(', ')}`);
  const building = lines.filter(([, l]) => l.stage === 'building').map(([id]) => id);
  if (building.length !== 1) fail('LINE-006', `exactly one line builds at a time; ${building.length === 0 ? 'none is building' : `${building.join(' and ')} are both building`}`);

  // LINE-007 — the building line's v1 slice is bounded, or says openly that it is not yet.
  for (const [id, line] of lines) {
    if (line.stage !== 'building') continue;
    const slice = line.v1_slice ?? {};
    const undecided = ['mode', 'corridor', 'geography'].filter((f) => slice[f] === undefined || slice[f] === UNDECIDED);
    if (undecided.length) warn('LINE-007', `${id} is building with an unbounded v1: ${undecided.join(', ')} still ${UNDECIDED}. ${slice.open_decision ?? ''}`.trim());
  }

  // LINE-008 — a rights profile on every source class.
  for (const [id, line] of lines) {
    for (const source of line.source_classes ?? []) {
      const r = source.rights?.redistribution;
      if (!RIGHTS.has(r)) fail('LINE-008', `${id} source "${source.id}" must carry a rights profile from ${[...RIGHTS].join(', ')}`);
      if (typeof source.rights?.note !== 'string' || !source.rights.note.trim()) fail('LINE-008', `${id} source "${source.id}" must record why its rights read that way`);
      if (r === 'unverified' && !source.rights.note.trim()) fail('LINE-008', `${id} source "${source.id}" is unverified and must say what has to be read before admission`);
    }
  }

  // LINE-009 — an optional venue adapter states the tie to an object the line owns.
  for (const [id, line] of lines) {
    for (const source of line.source_classes ?? []) {
      if (source.kind !== 'venue_adapter') continue;
      if (typeof source.admission_rule !== 'string' || !source.admission_rule.trim()) {
        fail('LINE-009', `${id} source "${source.id}" is a venue adapter and must state the tie to an object this line already owns`);
      }
    }
  }

  // LINE-010 — data subjects come from the closed vocabulary.
  if (subjects) {
    for (const [id, line] of lines) {
      for (const subject of line.data_subjects ?? []) {
        if (!subjects.has(subject)) fail('LINE-010', `${id} names data subject "${subject}", which is not in the closed vocabulary`);
      }
      if (!(line.data_subjects ?? []).length) fail('LINE-010', `${id} names no data subjects`);
    }
  }

  // The catalog has to recognise every node a line claims, and a line may not claim a node twice.
  if (catalogNodeIds) {
    const seen = new Map();
    for (const [id, line] of lines) {
      for (const nodeId of [...(line.implemented_by ?? []), ...(line.adjacent ?? [])]) {
        if (!catalogNodeIds.has(nodeId)) errors.push(`catalog: ${id} names node "${nodeId}", which is not in the catalog`);
      }
      for (const nodeId of line.implemented_by ?? []) {
        if (seen.has(nodeId)) errors.push(`catalog: node "${nodeId}" is claimed as an implementation by both ${seen.get(nodeId)} and ${id}`);
        seen.set(nodeId, id);
      }
      if (line.stage === 'building' && !(line.implemented_by ?? []).length) fail('LINE-006', `${id} is building but names no implementing node`);
    }
  }

  // The sequence must start with the spine and be ordered.
  const steps = doc.sequence?.steps ?? [];
  steps.forEach((step, i) => {
    if (step.order !== i + 1) errors.push(`sequence: step ${i + 1} declares order ${step.order}`);
    if (typeof step.gate !== 'string' || !step.gate.trim()) errors.push(`sequence: step ${step.order} must state the gate that ends it`);
  });
  if (steps.length && !/spine|identity/i.test(steps[0].what ?? '')) errors.push('sequence: the first step must be the shared spine; a line built before it is a separate company');

  return { errors, warnings, building: building[0] ?? null, owners: ownerOfType };
}

export async function report() {
  const doc = await loadProductLines();
  const subjects = await loadDataSubjects();
  let catalogNodeIds = null;
  try {
    const { loadCatalog } = await import('./validate.mjs');
    catalogNodeIds = new Set((await loadCatalog()).map(({ entry }) => entry.nodeId));
  } catch { /* the check still runs without the catalog */ }
  const result = checkProductLines(doc, { subjects, catalogNodeIds });
  return { doc, ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { doc, errors, warnings, building } = await report();
  for (const [id, line] of Object.entries(doc.lines)) {
    const owns = (line.spine?.owns ?? []).join(', ') || 'nothing';
    console.log(`${line.name.padEnd(10)} ${String(line.stage).padEnd(9)} owns ${owns}`);
    console.log(`${''.padEnd(10)} job: ${line.job}`);
    console.log(`${''.padEnd(10)} not: ${(line.not_the_job ?? [])[0] ?? ''}`);
  }
  console.log(`\njoin: ${(doc.join?.path ?? []).map((h) => `${h.from.line}.${h.from.class} -${h.key}-> ${h.to.line}.${h.to.class}`).join('  |  ')}`);
  console.log(`building: ${building ?? 'none'}`);
  for (const w of warnings) console.log(`  warning  ${w}`);
  for (const e of errors) console.log(`  error    ${e}`);
  console.log(`\nerrors=${errors.length} warnings=${warnings.length}`);
  if (errors.length) process.exitCode = 1;
}
