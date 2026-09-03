#!/usr/bin/env node
/**
 * The API architecture, derived.
 *
 * `api-planes.json` states four roles a module's API may play, four planes the estate
 * exposes, and thirteen module families that map one onto the other. A capability
 * declares the single irreducible fact — which family it belongs to — and everything
 * else follows from the table: its role, the planes it may appear on, and what shape its
 * response must take.
 *
 * That direction matters. A per-capability role written by hand across 634 capabilities
 * would drift the way `capability_count` drifted: correct when written, unchecked
 * afterwards. Here a family that changes its treatment changes it once, and every
 * capability in it moves with it.
 *
 * The invariant the whole thing exists to make checkable is API-000: every API response
 * either carries a canonical reference and a proof root, or says explicitly that it is an
 * operational observation and states its limitations. A response with neither is the
 * dangerous shape — it reads as authoritative, cannot be verified, and nothing in it says
 * which.
 *
 * Usage: node ecosystem/api.mjs [--json]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './corpus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TABLE = JSON.parse(await readFile(path.join(HERE, 'api-planes.json'), 'utf8'));

export const API_INVARIANT = Object.freeze(TABLE.invariant);
export const API_ROLES = Object.freeze(TABLE.roles);
export const API_EXPOSURES = Object.freeze(TABLE.exposure);
export const API_DEVIATION = Object.freeze(TABLE.deviation);
export const API_PLANES = Object.freeze(TABLE.planes);
export const MODULE_FAMILIES = Object.freeze(TABLE.families);

export const ROLE_IDS = Object.freeze(Object.keys(API_ROLES));
export const PLANE_IDS = Object.freeze(Object.keys(API_PLANES));
export const FAMILY_IDS = Object.freeze(Object.keys(MODULE_FAMILIES));
export const RESPONSE_KINDS = Object.freeze(Object.keys(API_INVARIANT.response_kinds));
export const EXPOSURE_IDS = Object.freeze(Object.keys(API_EXPOSURES));
export const DEFAULT_EXPOSURE = Object.freeze(EXPOSURE_IDS.find((id) => API_EXPOSURES[id].default));

/**
 * What a capability's API is, derived from the family it declares.
 *
 * Returns null for a capability that declares no family — the honest answer, and the one
 * that lets a caller count how much of the estate has been placed rather than assume the
 * unplaced part is fine.
 */
export function apiOf(capability, node = undefined) {
  // A node may declare a default family for everything it serves, and a capability may
  // override it. First-party systems declare per capability, because the estate reads
  // them and the distinctions are real. An upstream mirror declares once, at the node:
  // how this estate exposes someone else's system is a decision the estate makes, but
  // 53 per-capability judgements about a repository nobody here reads would be
  // manufacture rather than description.
  const family = capability?.module_family ?? node?.metadata?.module_family;
  if (typeof family !== 'string' || !MODULE_FAMILIES[family]) return null;
  const entry = MODULE_FAMILIES[family];
  const role = API_ROLES[entry.role];
  return {
    family,
    modules: entry.modules,
    treatment: entry.treatment,
    role: entry.role,
    mutates: role.mutates,
    planes: entry.planes,
    never: entry.never ?? [],
    // Declared where the capability differs from its family's default; derived otherwise.
    // A projection that reads a corpus returns a reference; a worker's lag figure is an
    // observation whatever plane it is served on.
    responseKind: capability.response_kind ?? role.default_response_kind,
    responseKindDeclared: typeof capability.response_kind === 'string',
    // Not every capability is API. A key rotation and a credential issue are tools the
    // host operator runs locally; forcing them onto a plane so the model looks tidy is
    // how a local tool acquires a route.
    exposure: capability.api_exposure ?? DEFAULT_EXPOSURE,
    // A write the architecture would not serve, named rather than hidden or forced into
    // a family that fits. Always a sentence, never a flag.
    deviation: typeof capability.api_deviation === 'string' ? capability.api_deviation : null,
  };
}

/** The planes a capability may legitimately be served on, given its mode. */
export function planesFor(capability, node = undefined) {
  const api = apiOf(capability, node);
  if (!api || api.exposure !== 'plane') return [];
  return api.planes.filter((plane) => API_PLANES[plane].admits_roles.includes(api.role));
}

/**
 * Whether a capability's declaration is internally consistent.
 *
 * Four rules, and each of them exists because the shape it refuses is one that reads as
 * safe. A mutating capability on a public plane is the "read API that also writes" that
 * every canonical-CRUD leak starts as. A `host_infrastructure` capability claiming to
 * return a reference is a status endpoint dressed as an authority. And an `execute`
 * capability in a family whose role does not mutate means the family is wrong or the
 * capability is: either way something is being served that the architecture does not
 * describe.
 */
export function checkCapabilityApi(capability, where = '', node = undefined) {
  const errors = [];
  const at = where ? `${where}: ` : '';
  const family = capability?.module_family ?? node?.metadata?.module_family;

  if (family === undefined) return { errors, warnings: [`${at}declares no module_family`] };
  if (typeof family !== 'string' || !MODULE_FAMILIES[family]) {
    errors.push(`${at}module_family "${family}" is not one of ${FAMILY_IDS.join(', ')} — see docs/API_PLANES.md`);
    return { errors, warnings: [] };
  }

  const api = apiOf(capability, node);
  const warnings = [];

  if (capability.response_kind !== undefined && !RESPONSE_KINDS.includes(capability.response_kind)) {
    errors.push(`${at}response_kind "${capability.response_kind}" is not one of ${RESPONSE_KINDS.join(', ')}`);
  }
  if (capability.api_exposure !== undefined && !EXPOSURE_IDS.includes(capability.api_exposure)) {
    errors.push(`${at}api_exposure "${capability.api_exposure}" is not one of ${EXPOSURE_IDS.join(', ')}`);
  }
  if (capability.api_deviation !== undefined && (typeof capability.api_deviation !== 'string' || capability.api_deviation.trim().length < 40)) {
    errors.push(`${at}api_deviation must say what does not fit and why it is served anyway`);
  }

  // A capability that is not on a plane is exempt from the plane rules — there is no
  // plane — but it earns two obligations instead, and they are the ones that keep the
  // exemption from becoming a way around the architecture: an operator decides, and it
  // is not reachable over a network.
  if (api.exposure === 'operator_local') {
    const required = API_EXPOSURES.operator_local.requires;
    if (capability.approval !== required.approval) {
      errors.push(`${at}an operator_local capability requires approval "${required.approval}", not "${capability.approval}"`);
    }
    // A person decides; an agent does not get to. The forbidden surfaces are exactly the
    // machine-reachable ones, so "can a model activate a release or mint a credential?"
    // has an answer rather than a convention.
    if (required.forbidden_surface.includes(capability.surface)) {
      errors.push(`${at}an operator_local capability is triggered by a person, never over "${capability.surface}"`);
    }
    return { errors, warnings };
  }

  // API-000, at the point where a capability is described rather than only where a
  // response is built: a capability that returns a reference must be able to name a proof
  // root, and only a role that reads held material can.
  if (api.responseKind === 'referenced' && api.role === 'host_infrastructure') {
    errors.push(`${at}host_infrastructure returns an operational observation, not a reference — it has no proof root to name`);
  }

  // The rule the four planes exist for. A public plane admits reads and verifications;
  // a write reaches canonical state through governance or the operator plane or not at all.
  const usable = planesFor(capability, node);
  if (!usable.length) {
    errors.push(`${at}family "${family}" is ${api.role}, which none of its planes (${api.planes.join(', ')}) admit`);
  }
  if (api.mutates && usable.some((plane) => API_PLANES[plane].public)) {
    errors.push(`${at}a ${api.role} capability may not be served on a public plane: never public canonical CRUD`);
  }
  if (capability.mode === 'execute' && !api.mutates) {
    // Either the family is wrong, or the estate is serving something its own architecture
    // would not. Both are worth knowing, and only the second is allowed to stand — as a
    // sentence somebody wrote, which is the same bar an exemption meets elsewhere.
    if (api.deviation) {
      warnings.push(`${at}declared deviation: executes in ${api.role} family "${family}" — ${api.deviation}`);
    } else {
      errors.push(`${at}mode is "execute" but family "${family}" is ${api.role}, which does not mutate — correct the family, or declare api_deviation saying why this is served anyway`);
    }
  }
  // The gate itself. `governed_write` means a write passes a named gate, and for a
  // capability that writes canonical state the gate is a person. A `propose` in a writing
  // family is not an anomaly — a monitor appends an observation, a client submits a
  // request — so only the executing case is checked, and it is checked as an error
  // because "writes canonical state, needs nobody" is the shape the architecture exists
  // to refuse.
  if (capability.mode === 'execute' && api.mutates && capability.approval !== 'operator') {
    errors.push(`${at}a governed write that executes requires an operator: approval is "${capability.approval}"`);
  }

  return { errors, warnings };
}

/** Every capability of a node, checked, with the node named in each message. */
export function checkNodeApi(entry) {
  const errors = [];
  const warnings = [];
  const declared = entry.metadata?.module_family;
  if (declared !== undefined && !MODULE_FAMILIES[declared]) {
    errors.push(`metadata.module_family "${declared}" is not one of ${FAMILY_IDS.join(', ')} — see docs/API_PLANES.md`);
  }
  // An empty repository serves nothing, so it has no API to place. The same rule the
  // catalog already applies to data_domain and provenance: a placeholder that claimed a
  // role would be the architecture describing a repository name.
  if (entry.metadata?.maturity === 'empty') {
    if (declared !== undefined) errors.push('metadata.module_family is set on an empty repository, which serves nothing');
    for (const capability of entry.capabilities ?? []) {
      if (capability.module_family) errors.push(`capability ${capability.capabilityId}: an empty repository serves no API — remove module_family`);
    }
    return { errors, warnings };
  }
  for (const capability of entry.capabilities ?? []) {
    const result = checkCapabilityApi(capability, `capability ${capability.capabilityId}`, entry);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  return { errors, warnings };
}

/**
 * The estate's API surface: how much of it has been placed, and where it sits.
 *
 * Reported rather than summarised into a score. "78% placed" would be a number nobody
 * can act on; the list of what is unplaced is the work.
 */
export function gradeApiSurface(entries) {
  const capabilities = entries.flatMap(({ entry }) => entry.capabilities.map((c) => ({ nodeId: entry.nodeId, maturity: entry.metadata.maturity, node: entry, capability: c })));
  const placed = capabilities.filter(({ capability, node }) => apiOf(capability, node));
  const unplaced = capabilities.filter(({ capability, node }) => !apiOf(capability, node));

  const byFamily = {};
  const byRole = {};
  const byPlane = {};
  const byResponseKind = {};
  const byExposure = {};
  for (const { capability, node } of placed) {
    const api = apiOf(capability, node);
    byFamily[api.family] = (byFamily[api.family] ?? 0) + 1;
    byRole[api.role] = (byRole[api.role] ?? 0) + 1;
    byResponseKind[api.responseKind] = (byResponseKind[api.responseKind] ?? 0) + 1;
    byExposure[api.exposure] = (byExposure[api.exposure] ?? 0) + 1;
    if (api.exposure === 'plane') for (const plane of api.planes) byPlane[plane] = (byPlane[plane] ?? 0) + 1;
  }

  // The count that matters most: capabilities that mutate. Every one of them is a way
  // into canonical state, and the architecture says each must pass a governed gate.
  const mutating = placed.filter(({ capability, node }) => apiOf(capability, node).mutates);
  const publicMutating = mutating.filter(({ capability, node }) => planesFor(capability, node).some((plane) => API_PLANES[plane].public));

  return {
    total: capabilities.length,
    placed: placed.length,
    unplaced: unplaced.map(({ nodeId, capability, maturity }) => ({ nodeId, capabilityId: capability.capabilityId, maturity })),
    byFamily,
    byRole,
    byPlane,
    byResponseKind,
    byExposure,
    // Off every plane, and therefore the set to be able to enumerate on demand: these are
    // the tools that mint credentials, rotate keys and touch the store.
    operatorLocal: placed.filter(({ capability, node }) => apiOf(capability, node).exposure === 'operator_local').map(({ nodeId, capability }) => `${nodeId}/${capability.capabilityId}`),
    deviations: placed.filter(({ capability, node }) => apiOf(capability, node).deviation).map(({ nodeId, capability, node }) => ({ id: `${nodeId}/${capability.capabilityId}`, deviation: apiOf(capability, node).deviation })),
    mutating: mutating.length,
    publicMutating: publicMutating.map(({ nodeId, capability }) => `${nodeId}/${capability.capabilityId}`),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = await loadCatalog();
  const surface = gradeApiSurface(entries);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(surface, null, 2));
  } else {
    console.log(`API surface: ${surface.placed} of ${surface.total} capabilities placed in a module family\n`);
    const table = (title, counts) => {
      console.log(title);
      for (const [key, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)}  ${key}`);
      console.log();
    };
    table('By role', surface.byRole);
    table('By plane (a family may serve more than one)', surface.byPlane);
    table('By response kind (API-000)', surface.byResponseKind);
    table('By exposure', surface.byExposure);
    table('By module family', surface.byFamily);
    console.log(`${surface.mutating} capabilities mutate; ${surface.publicMutating.length} of them reach a public plane.`);
    if (surface.deviations.length) {
      console.log(`\n${surface.deviations.length} declared deviations — writes the architecture would not serve, named:`);
      for (const d of surface.deviations) console.log(`  ${d.id}`);
    }
    if (surface.operatorLocal.length) {
      console.log(`${surface.operatorLocal.length} are on no plane at all — operator tools run at the host:`);
      for (const id of surface.operatorLocal) console.log(`  ${id}`);
    }
    for (const id of surface.publicMutating) console.log(`  never public canonical CRUD: ${id}`);
    if (surface.unplaced.length) {
      const firstParty = surface.unplaced.filter((u) => u.maturity !== 'upstream-mirror' && u.maturity !== 'empty');
      console.log(`\n${surface.unplaced.length} unplaced (${firstParty.length} on first-party nodes):`);
      for (const u of firstParty.slice(0, 20)) console.log(`  ${u.nodeId}/${u.capabilityId}`);
    }
  }
  process.exit(surface.publicMutating.length ? 1 : 0);
}
