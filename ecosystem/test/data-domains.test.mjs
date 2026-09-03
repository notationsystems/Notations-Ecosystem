import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkEntry, loadCatalog, subjectsOf, toNode } from '../validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(await readFile(path.join(here, '..', 'data-domains.json'), 'utf8'));
const SUBJECTS = Object.keys(registry.subjects);
const DOMAINS = new Set(['physical-economy', 'intelligence', 'scientific', 'built-environment', 'perception-3d', 'geospatial', 'archive', 'platform']);

test('the vocabulary is closed: one subject, one domain, one spelling', () => {
  assert.ok(SUBJECTS.length >= 70);
  const aliases = new Map();
  for (const [subject, entry] of Object.entries(registry.subjects)) {
    assert.ok(DOMAINS.has(entry.domain), `${subject}: "${entry.domain}" is not an estate domain`);
    assert.ok(entry.description && entry.description.length > 10, `${subject}: needs a description`);
    for (const alias of entry.aliases ?? []) {
      assert.ok(!SUBJECTS.includes(alias), `${alias} is both a subject and an alias of ${subject}`);
      assert.ok(!aliases.has(alias), `${alias} is claimed by ${aliases.get(alias)} and ${subject}`);
      aliases.set(alias, subject);
    }
  }
});

test('every annotation in the catalog uses a subject, never an alias', async () => {
  const entries = await loadCatalog();
  const used = new Set();
  for (const { entry } of entries) {
    for (const capability of entry.capabilities ?? []) {
      if (!capability.data_domain) continue;
      assert.ok(SUBJECTS.includes(capability.data_domain), `${entry.nodeId}/${capability.capabilityId}: "${capability.data_domain}" is not a subject`);
      used.add(capability.data_domain);
    }
  }
  // A registry entry nobody uses is a subject nobody has, and would rot.
  const unused = SUBJECTS.filter((subject) => !used.has(subject));
  assert.deepEqual(unused, [], `unused subjects: ${unused.join(', ')}`);
});

test('an alias is refused going in, and the refusal names the subject', async () => {
  const [{ entry, file }] = (await loadCatalog()).filter((e) => e.entry.nodeId === 'control-plane');
  const withAlias = structuredClone(entry);
  withAlias.capabilities[0].data_domain = 'gaussian-splats';
  const { errors } = checkEntry(withAlias, file);
  assert.ok(errors.some((e) => /is a recorded spelling of "gaussian-splat"/.test(e)), errors.join('; '));

  const invented = structuredClone(entry);
  invented.capabilities[0].data_domain = 'vibes';
  assert.ok(checkEntry(invented, file).errors.some((e) => /not a subject in ecosystem\/data-domains\.json/.test(e)));
});

test('person-intelligence exists so it can be refused by name', () => {
  // The estate declares that no first-party system may hold it. A vocabulary that simply
  // omitted the subject could not express the refusal, only the absence.
  assert.ok(SUBJECTS.includes('person-intelligence'));
  assert.match(registry.subjects['person-intelligence'].description, /refused by name/i);
});

test('a node carries the set of subjects it touches, truncated on a whole subject', async () => {
  const entries = await loadCatalog();
  for (const { entry } of entries) {
    const metadata = toNode(entry).metadata;
    const declared = metadata.data_domains;
    if (declared === undefined) {
      assert.equal((entry.capabilities ?? []).filter((c) => c.data_domain).length, 0, `${entry.nodeId} has annotations but declares no data_domains`);
      continue;
    }
    assert.ok(declared.length <= 480, `${entry.nodeId}: data_domains is ${declared.length} chars`);
    for (const subject of declared.split(' ')) {
      assert.ok(SUBJECTS.includes(subject), `${entry.nodeId}: "${subject}" is not a whole subject`);
    }
  }
  // A long node truncates rather than overflowing, and never mid-subject.
  const many = { capabilities: SUBJECTS.map((s, i) => ({ capabilityId: `c${i}`, data_domain: s })) };
  const truncated = subjectsOf(many, 60);
  assert.ok(truncated.length <= 60);
  for (const subject of truncated.split(' ')) assert.ok(SUBJECTS.includes(subject));
});

test('the surface vocabulary is closed too, and its aliases are recorded', async () => {
  const surfaces = JSON.parse(await readFile(path.join(here, '..', 'surfaces.json'), 'utf8'));
  const names = Object.keys(surfaces.surfaces);
  assert.ok(names.length >= 15);
  const aliases = new Map();
  for (const [name, entry] of Object.entries(surfaces.surfaces)) {
    assert.ok(entry.description && entry.description.length > 10, `${name}: needs a description`);
    for (const alias of entry.aliases ?? []) {
      assert.ok(!names.includes(alias), `${alias} is both a surface and an alias of ${name}`);
      assert.ok(!aliases.has(alias), `${alias} is claimed twice`);
      aliases.set(alias, name);
    }
  }

  const entries = await loadCatalog();
  const used = new Set();
  for (const { entry } of entries) {
    for (const capability of entry.capabilities ?? []) {
      if (!capability.surface) continue;
      assert.ok(names.includes(capability.surface), `${entry.nodeId}/${capability.capabilityId}: "${capability.surface}" is not a surface`);
      used.add(capability.surface);
    }
  }
  assert.deepEqual(names.filter((n) => !used.has(n)), [], 'a surface nobody uses would rot');

  const [{ entry, file }] = entries.filter((e) => e.entry.nodeId === 'control-plane');
  const aliased = structuredClone(entry);
  aliased.capabilities[0].surface = 'docs';
  assert.ok(checkEntry(aliased, file).errors.some((e) => /is a recorded spelling of "doc"/.test(e)));
});

test('a mirror is machine-legible, and so is what it is a mirror of', async () => {
  const entries = await loadCatalog();
  const mirrors = entries.filter(({ entry }) => entry.metadata.maturity === 'upstream-mirror');
  assert.equal(mirrors.length, 10);
  for (const { entry } of mirrors) {
    // Mirroring someone else's code without recording whose, and under what terms, is
    // the one provenance question this catalog is uniquely able to answer about itself.
    assert.ok(entry.metadata.upstream, `${entry.nodeId}: an upstream-mirror must name its upstream`);
    assert.ok(entry.metadata.license, `${entry.nodeId}: an upstream-mirror must state a licence`);
  }

  // `upstream` carried two relationships: an ongoing copy, which brings the upstream's
  // licence with it, and a one-time ancestry, which does not. Five first-party nodes
  // recorded the second under the first. Lineage is `derived_from` now, and no node
  // claims both.
  for (const { entry } of entries) {
    const { maturity, upstream, derived_from: derived } = entry.metadata;
    if (upstream) assert.equal(maturity, 'upstream-mirror', `${entry.nodeId}: upstream is for mirrors`);
    assert.ok(!(upstream && derived), `${entry.nodeId}: a node is a mirror or a descendant, not both`);
  }
  assert.equal(entries.filter(({ entry }) => entry.metadata.derived_from).length, 5);

  // And the validator refuses the confusion rather than leaving it to review.
  const [{ entry, file }] = entries.filter((e) => e.entry.nodeId === 'payload-terminal');
  const confused = structuredClone(entry);
  confused.metadata.upstream = 'somebody/else';
  assert.ok(checkEntry(confused, file).errors.some((e) => /a node that mirrors another repository is an upstream-mirror/.test(e)));
});
