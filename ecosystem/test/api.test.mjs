import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCatalog } from '../corpus.mjs';
import {
  API_INVARIANT, API_PLANES, API_ROLES, EXPOSURE_IDS, FAMILY_IDS, MODULE_FAMILIES,
  PLANE_IDS, RESPONSE_KINDS, ROLE_IDS, apiOf, checkCapabilityApi, checkNodeApi, gradeApiSurface, planesFor,
} from '../api.mjs';

const cap = (over = {}) => ({ capabilityId: 'x.read', mode: 'observe', approval: 'automatic', surface: 'http', ...over });

test('API-DOCTRINE four roles, four planes, four exposures and thirteen families', () => {
  assert.deepEqual(ROLE_IDS, ['public_read', 'proof_verifiable', 'governed_write', 'host_infrastructure']);
  assert.deepEqual(PLANE_IDS, ['tenant_read', 'verification', 'governance', 'internal_operator']);
  assert.deepEqual(RESPONSE_KINDS, ['referenced', 'operational_observation']);
  assert.deepEqual(EXPOSURE_IDS, ['plane', 'operator_local']);
  assert.equal(FAMILY_IDS.length, 13);

  // Exactly one role mutates. If a second ever does, every "never public canonical CRUD"
  // check silently widens, because the rule is written against this property.
  assert.deepEqual(ROLE_IDS.filter((id) => API_ROLES[id].mutates), ['governed_write']);

  // Two planes are public and neither admits a mutating role. This is the invariant the
  // four planes exist for, asserted against the table rather than against one example.
  for (const [id, plane] of Object.entries(API_PLANES)) {
    if (!plane.public) continue;
    for (const role of plane.admits_roles) assert.equal(API_ROLES[role].mutates, false, `${id} admits ${role}, which mutates`);
  }

  // Every family names a real role and real planes, and every plane admits it.
  for (const [id, family] of Object.entries(MODULE_FAMILIES)) {
    assert.ok(API_ROLES[family.role], `${id}: unknown role ${family.role}`);
    assert.ok(family.planes.length, `${id}: no planes`);
    for (const plane of family.planes) assert.ok(API_PLANES[plane], `${id}: unknown plane ${plane}`);
    assert.ok(family.planes.some((p) => API_PLANES[p].admits_roles.includes(family.role)), `${id}: no plane admits its own role`);
    assert.ok(family.treatment.length > 20, `${id}: no treatment sentence`);
  }
});

test('API-000 a response is referenced or an operational observation, never neither', () => {
  assert.match(API_INVARIANT.statement, /canonical reference and a proof root|operational observation/);
  assert.deepEqual(API_INVARIANT.response_kinds.referenced.requires, ['reference', 'proof_root']);
  assert.deepEqual(API_INVARIANT.response_kinds.operational_observation.requires, ['observed_at', 'limitations']);

  // Host infrastructure holds nothing, so it has no root to name. A status endpoint
  // dressed as an authority is worse than an honest one.
  assert.equal(API_ROLES.host_infrastructure.default_response_kind, 'operational_observation');
  const dressed = checkCapabilityApi(cap({ module_family: 'operations', response_kind: 'referenced' }));
  assert.ok(dressed.errors.some((e) => /no proof root to name/.test(e)));
});

test('never public canonical CRUD, in the check and across the estate', async () => {
  // A governed write cannot be reached on a plane anyone may call. Asserted on a
  // construction, then on all 634 capabilities the catalog actually declares.
  const publicWrite = { ...cap({ module_family: 'corpus', mode: 'execute', approval: 'operator' }) };
  assert.ok(checkCapabilityApi(publicWrite).errors.some((e) => /does not mutate|api_deviation/.test(e)));

  const write = checkCapabilityApi(cap({ module_family: 'acquisition', mode: 'execute', approval: 'operator' }));
  assert.deepEqual(write.errors, []);
  for (const plane of planesFor(cap({ module_family: 'acquisition' }))) assert.equal(API_PLANES[plane].public, false);

  const surface = gradeApiSurface(await loadCatalog());
  assert.deepEqual(surface.publicMutating, []);
});

test('a governed write that executes requires an operator', () => {
  const ungated = checkCapabilityApi(cap({ module_family: 'federation', mode: 'execute', approval: 'automatic' }));
  assert.ok(ungated.errors.some((e) => /requires an operator/.test(e)));
  assert.deepEqual(checkCapabilityApi(cap({ module_family: 'federation', mode: 'execute', approval: 'operator' })).errors, []);
});

test('an action that is not API says so, and no agent can trigger one', async () => {
  // operator_local is off every plane, so the plane rules cannot apply to it. What keeps
  // that from being an escape hatch: a person decides, and no machine surface reaches it.
  const local = cap({ module_family: 'infrastructure', mode: 'execute', approval: 'operator', surface: 'cli', api_exposure: 'operator_local' });
  assert.deepEqual(checkCapabilityApi(local).errors, []);
  assert.deepEqual(planesFor(local), []);

  assert.ok(checkCapabilityApi({ ...local, approval: 'automatic' }).errors.some((e) => /requires approval "operator"/.test(e)));
  for (const surface of ['mcp', 'agent-tool', 'webhook']) {
    assert.ok(checkCapabilityApi({ ...local, surface }).errors.some((e) => /triggered by a person/.test(e)), `${surface} should be refused`);
  }

  // The estate's actual set, and what is in it: key rotation, credential issue, site
  // activation, runtime switches. Every one of them a person triggers.
  const surface = gradeApiSurface(await loadCatalog());
  assert.ok(surface.operatorLocal.includes('control-plane/credential.issue'));
  assert.ok(surface.operatorLocal.includes('control-plane/key.rotate'));
  assert.ok(surface.operatorLocal.includes('notation-systems-web/site.publish'));
});

test('a write the architecture would not serve is named, not hidden and not forced to fit', async () => {
  const unfit = cap({ module_family: 'agent', mode: 'execute', approval: 'operator' });
  assert.ok(checkCapabilityApi(unfit).errors.some((e) => /declare api_deviation/.test(e)));

  const declared = { ...unfit, api_deviation: 'A configuration write reachable by any agent holding the endpoint, with no operator between the request and the effect.' };
  const result = checkCapabilityApi(declared);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((w) => /declared deviation/.test(w)));

  // A deviation is a sentence somebody wrote, at the same bar an exemption meets.
  assert.ok(checkCapabilityApi({ ...unfit, api_deviation: 'legacy' }).errors.some((e) => /must say what does not fit/.test(e)));

  // Two in the estate today, both on the same mirror, both config mutation over MCP.
  const surface = gradeApiSurface(await loadCatalog());
  assert.deepEqual(surface.deviations.map((d) => d.id), ['trustgraph/mcp.put_config', 'trustgraph/mcp.delete_config']);
});

test('every first-party capability is placed, and an empty repository serves nothing', async () => {
  const entries = await loadCatalog();
  for (const { entry } of entries) {
    const maturity = entry.metadata.maturity;
    if (maturity === 'empty') {
      assert.equal(entry.metadata.module_family, undefined, `${entry.nodeId}: an empty repository declares an API family`);
      for (const c of entry.capabilities) assert.equal(c.module_family, undefined);
      continue;
    }
    if (maturity === 'upstream-mirror') {
      // A mirror declares once, at the node: how this estate exposes someone else's
      // system is the estate's decision, but 53 per-capability judgements about a
      // repository nobody here reads would be manufacture.
      assert.ok(entry.metadata.module_family, `${entry.nodeId}: a deployed mirror with no declared family`);
      continue;
    }
    for (const c of entry.capabilities) assert.ok(apiOf(c, entry), `${entry.nodeId}/${c.capabilityId}: unplaced`);
    assert.deepEqual(checkNodeApi(entry).errors, [], entry.nodeId);
  }

  const surface = gradeApiSurface(entries);
  assert.equal(surface.placed, 628);
  assert.equal(surface.unplaced.length, 6);
  for (const u of surface.unplaced) assert.equal(u.maturity, 'empty');
});
