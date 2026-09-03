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

test('the collection policy is the estate\'s, and every node states where it sits', async () => {
  const entries = await loadCatalog();
  const standing = (value) => entries.filter(({ entry }) => entry.metadata.person_data === value);

  // Enforced in one repository's CI and stated as prose everywhere else, the policy was
  // that repository's. Declared per node, it is the company's.
  assert.equal(entries.length, standing('refused').length + standing('incidental').length + standing('serves').length);
  assert.ok(standing('refused').length > standing('serves').length * 5);

  // A first-party node may not answer questions about people without saying so and
  // saying what would end it, so an exception is a sentence someone wrote rather than a
  // route someone finds.
  for (const { entry } of standing('serves')) {
    if (entry.metadata.maturity === 'upstream-mirror') continue;
    assert.ok(entry.metadata.person_data_exception, `${entry.nodeId}: serves without a declared exception`);
    assert.ok(entry.metadata.person_data_exception.length > 80, `${entry.nodeId}: the exception must say what would end it`);
  }
  // And the two that do are the two the estate already records as COR-010 failures.
  const serving = standing('serves').map(({ entry }) => entry.nodeId).sort();
  assert.deepEqual(serving, ['osiris-dashboard', 'osiris-intel']);
  for (const { entry } of standing('serves')) {
    assert.equal(entry.reference.corpus.standing['COR-010'].standing, 'fails', `${entry.nodeId}: serving people is a declared refusal to hold that is not held`);
  }

  // The validator refuses both halves of the confusion.
  const [{ entry, file }] = entries.filter((e) => e.entry.nodeId === 'payload-terminal');
  const undeclared = structuredClone(entry);
  delete undeclared.metadata.person_data;
  assert.ok(checkEntry(undeclared, file).errors.some((e) => /person_data/.test(e)));

  const unexplained = structuredClone(entry);
  unexplained.metadata.person_data = 'serves';
  assert.ok(checkEntry(unexplained, file).errors.some((e) => /declare metadata\.person_data_exception/.test(e)));

  const orphaned = structuredClone(entry);
  orphaned.metadata.person_data_exception = 'because';
  assert.ok(checkEntry(orphaned, file).errors.some((e) => /is set but person_data is not "serves"/.test(e)));
});

test('every environment variable says what it is, and a credential nothing reads is named', async () => {
  const entries = await loadCatalog();
  const env = entries.flatMap(({ entry }) => (entry.reference.environment ?? []).map((item) => ({ node: entry.nodeId, ...item })));

  // Required on every node, empty or not: "this system reads no environment" is an
  // answer, and it is a different answer from nobody having looked.
  for (const { entry } of entries) assert.ok(Array.isArray(entry.reference.environment), `${entry.nodeId}: no environment block`);
  assert.equal(env.length, 90);

  const credentials = env.filter((item) => item.kind === 'credential');
  assert.equal(credentials.length, 62);
  assert.equal(env.filter((item) => item.kind === 'configuration').length, 28);

  // The whole point of the split: a port, a path and a region are no longer secrets, and
  // a mailbox password is no longer filed beside them.
  const config = env.filter((item) => item.kind === 'configuration').map((item) => item.name);
  for (const name of ['ATLAS_PORT', 'AWS_REGION', 'STE_REPO', 'VISIBLE_GPU_NUM']) assert.ok(config.includes(name), `${name} is not a credential`);
  assert.ok(credentials.some((item) => item.name === 'EMAIL_PASSWORD'));

  // Six credentials the estate asks an operator to create that nothing in the estate
  // reads. They are the reason the field exists; when they are gone this number is 0 and
  // the assertion below is the thing that has to be changed deliberately.
  const unused = credentials.filter((item) => item.unused).map((item) => `${item.node}:${item.name}`).sort();
  assert.deepEqual(unused, [
    'gods-eye-view:OPENSKY_PASSWORD',
    'gods-eye-view:OPENSKY_USERNAME',
    'payload-terminal:FIRMS_API_KEY',
    'payload-terminal:N2YO_API_KEY',
    'payload-terminal:OPENSKY_CLIENT_ID',
    'payload-terminal:OPENSKY_CLIENT_SECRET',
  ]);

  // A client-exposed credential cannot be protected by secrecy, so it has to be
  // protected by something the purpose names.
  const exposed = credentials.filter((item) => item.client_exposed);
  assert.equal(exposed.length, 2);
  for (const item of exposed) assert.match(item.purpose, /referrer|origin|meter|scope|quota|restrict/i);

  // And no entry anywhere carries a value. This file is public.
  for (const item of env) {
    assert.deepEqual(Object.keys(item).filter((k) => !['node', 'name', 'kind', 'purpose', 'client_exposed', 'unused'].includes(k)), []);
  }
});

test('the validator refuses a manifest that hides what a variable is', async () => {
  const entries = await loadCatalog();
  const [{ entry, file }] = entries.filter((e) => e.entry.nodeId === 'payload-terminal');

  const missing = structuredClone(entry);
  delete missing.reference.environment;
  assert.ok(checkEntry(missing, file).errors.some((e) => /reference\.environment must be an array/.test(e)));

  // The one that matters: calling a key "configuration" to escape the credential rules.
  const disguised = structuredClone(entry);
  disguised.reference.environment.push({ name: 'STRIPE_SECRET_KEY', kind: 'configuration', purpose: 'Just some configuration for the billing integration.' });
  assert.ok(checkEntry(disguised, file).errors.some((e) => /named like a credential is treated as one/.test(e)));

  const valued = structuredClone(entry);
  valued.reference.environment.push({ name: 'DEMO_TOKEN', kind: 'credential', purpose: 'A demonstration bearer used by nothing at all.', example: 'sk-live-abc' });
  assert.ok(checkEntry(valued, file).errors.some((e) => /it never carries its value/.test(e)));

  const mute = structuredClone(entry);
  mute.reference.environment.push({ name: 'DEMO_TOKEN', kind: 'credential', purpose: 'a token' });
  assert.ok(checkEntry(mute, file).errors.some((e) => /purpose must say in a sentence/.test(e)));

  const unconstrained = structuredClone(entry);
  unconstrained.reference.environment.push({ name: 'MAP_TILES_KEY', kind: 'credential', client_exposed: true, purpose: 'Basemap tiles for the terminal map, shipped to the browser.' });
  assert.ok(checkEntry(unconstrained, file).errors.some((e) => /must say what constrains it/.test(e)));

  const twice = structuredClone(entry);
  twice.reference.environment.push({ name: 'EIA_API_KEY', kind: 'credential', purpose: 'The same variable declared a second time, by accident.' });
  assert.ok(checkEntry(twice, file).errors.some((e) => /named twice/.test(e)));

  const shrug = structuredClone(entry);
  shrug.reference.environment.push({ name: 'LEGACY_TOKEN', kind: 'credential', purpose: 'Something the fork left behind and nobody has removed.', unused: 'residue' });
  assert.ok(checkEntry(shrug, file).errors.some((e) => /unused must say why/.test(e)));
});

test('a count of what is in the file may not also be asserted in it', async () => {
  const entries = await loadCatalog();

  // control-plane declared twelve capabilities while carrying fourteen, and nothing
  // noticed because both numbers were in the same file and only one was checked.
  for (const { entry } of entries) {
    for (const field of ['capability_count', 'mcp_tool_count', 'mcp_tools']) {
      assert.equal(entry.metadata[field], undefined, `${entry.nodeId}: metadata.${field} is derivable`);
    }
  }

  const [{ entry, file }] = entries.filter((e) => e.entry.nodeId === 'payload-terminal');
  const restated = structuredClone(entry);
  restated.metadata.capability_count = entry.capabilities.length;
  // Refused even when it is *right*: a correct copy today is a stale one after the next
  // capability is added, and the failure is silent either way.
  assert.ok(checkEntry(restated, file).errors.some((e) => /capability_count is derived, not declared/.test(e)));

  const tools = structuredClone(entry);
  tools.metadata.mcp_tool_count = 12;
  assert.ok(checkEntry(tools, file).errors.some((e) => /mcp\.\* capabilities that are not transports/.test(e)));

  // Counts about another system stay: nothing here can derive how many routes Osiris has.
  const observed = entries.find((e) => e.entry.nodeId === 'osiris-dashboard');
  assert.equal(typeof observed.entry.metadata.api_route_count, 'number');
  assert.equal(checkEntry(observed.entry, observed.file).errors.length, 0);
});

test('every first-party capability names its subject, and an empty repository names none', async () => {
  const entries = await loadCatalog();
  const caps = entries.flatMap(({ entry }) => entry.capabilities);
  const annotated = caps.filter((c) => c.data_domain).length;

  // 487 of 634. The remainder are on upstream mirrors, where annotating someone else's
  // capabilities would be a claim about a repository nobody here reads.
  assert.ok(annotated / caps.length > 0.75, `data_domain coverage fell to ${Math.round((annotated / caps.length) * 100)}%`);

  for (const { entry } of entries) {
    const maturity = entry.metadata.maturity;
    if (maturity === 'upstream-mirror') continue;
    if (maturity === 'empty') {
      // The six placeholder repositories. A `charter.observe` that named a subject would
      // be the catalog inventing a holding out of a repository name.
      for (const c of entry.capabilities) assert.equal(c.data_domain, undefined, `${entry.nodeId}: an empty repository claims ${c.data_domain}`);
      continue;
    }
    for (const c of entry.capabilities) assert.ok(c.data_domain, `${entry.nodeId}/${c.capabilityId}: no data_domain`);
  }

  // And the validator refuses both directions rather than leaving them to review.
  const gap = structuredClone(entries.find((e) => e.entry.nodeId === 'pythia-oracle-engine'));
  delete gap.entry.capabilities[0].data_domain;
  assert.ok(checkEntry(gap.entry, gap.file).errors.some((e) => /do not state subject/.test(e)));

  const invented = structuredClone(entries.find((e) => e.entry.nodeId === 'payload-corpus-graph'));
  invented.entry.capabilities[0].data_domain = 'trade-flows';
  assert.ok(checkEntry(invented.entry, invented.file).errors.some((e) => /an empty repository touches no subject/.test(e)));
});

test('every first-party capability says where its answers come from', async () => {
  const entries = await loadCatalog();
  const caps = entries.flatMap(({ entry }) => entry.capabilities);

  // The company states that it builds provenance-bearing corpora. The field stood at 44
  // of 634 and at zero on Payload Terminal, which is the node the claim is about.
  assert.ok(caps.filter((c) => c.provenance).length >= 395, 'provenance coverage fell');

  for (const { entry } of entries) {
    const maturity = entry.metadata.maturity;
    if (maturity === 'upstream-mirror') continue;
    for (const c of entry.capabilities) {
      if (maturity === 'empty') assert.equal(c.provenance, undefined, `${entry.nodeId}: an empty repository claims a source`);
      else assert.ok(c.provenance, `${entry.nodeId}/${c.capabilityId}: no provenance`);
    }
  }

  // A computation is not a measurement, and the field is where a reader of the catalog
  // actually meets that distinction — COR-005 stated at the point of use.
  const computed = caps.filter((c) => /^computation[: ]/.test(c.provenance ?? ''));
  assert.ok(computed.length >= 8, 'the analytic capabilities no longer mark themselves as computations');
  const synthetic = caps.filter((c) => /^synthetic:/.test(c.provenance ?? ''));
  assert.ok(synthetic.length >= 40, 'the synthetic corpora no longer say so');

  const bare = structuredClone(entries.find((e) => e.entry.nodeId === 'payload-terminal'));
  delete bare.entry.capabilities[0].provenance;
  assert.ok(checkEntry(bare.entry, bare.file).errors.some((e) => /do not state where its answers come from/.test(e)));

  const claiming = structuredClone(entries.find((e) => e.entry.nodeId === 'payload-corpus-graph'));
  claiming.entry.capabilities[0].provenance = 'UN Comtrade capture 2026-08-27';
  assert.ok(checkEntry(claiming.entry, claiming.file).errors.some((e) => /an empty repository answers nothing/.test(e)));
});

test('osiris-intel names person-intelligence, because a refusal has to be nameable', async () => {
  const entries = await loadCatalog();
  const intel = entries.find((e) => e.entry.nodeId === 'osiris-intel').entry;
  const person = intel.capabilities.find((c) => c.capabilityId === 'intel.resolve.person');

  // The subject exists in the vocabulary so it can be refused by name. The one capability
  // in the estate that resolves natural persons now says so in the same word the policy
  // uses, and the three records — vocabulary, collection standing, corpus grade — agree.
  assert.equal(person.data_domain, 'person-intelligence');
  assert.equal(intel.metadata.person_data, 'serves');
  assert.equal(intel.reference.corpus.standing['COR-010'].standing, 'fails');

  // Two capabilities in the estate name this subject, and they are on exactly the two
  // nodes the collection policy records as serving. A third would mean a system started
  // answering questions about people without the policy hearing about it, and this is
  // where it surfaces.
  const naming = entries.flatMap(({ entry }) => entry.capabilities.filter((c) => c.data_domain === 'person-intelligence').map((c) => `${entry.nodeId}/${c.capabilityId}`)).sort();
  assert.deepEqual(naming, ['osiris-dashboard/osint.person_recon', 'osiris-intel/intel.resolve.person']);
  const serving = entries.filter(({ entry }) => entry.metadata.person_data === 'serves').map(({ entry }) => entry.nodeId).sort();
  assert.deepEqual([...new Set(naming.map((n) => n.split('/')[0]))].sort(), serving);

  // The check that found the third: payload-terminal declared `person_data: refused` and
  // annotated its retired-route contract `person-intelligence` — the capability whose
  // whole function is that those routes are gone. The annotation aggregates into
  // `metadata.data_domains`, so it crossed into the snapshot and told an operator the
  // terminal touches person data.
  const [{ entry: terminal, file }] = entries.filter((e) => e.entry.nodeId === 'payload-terminal');
  assert.equal(terminal.capabilities.find((c) => c.capabilityId === 'ops.retired_routes').data_domain, 'architecture-invariants');
  const contradiction = structuredClone(terminal);
  contradiction.capabilities.find((c) => c.capabilityId === 'ops.retired_routes').data_domain = 'person-intelligence';
  assert.ok(checkEntry(contradiction, file).errors.some((e) => /while metadata\.person_data is "incidental"/.test(e)));
});
