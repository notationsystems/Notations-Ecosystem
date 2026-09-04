// What answering a capability costs, and how long it takes.
//
// The catalog has always declared provenance and never cost or latency. The tempting fix is to
// write figures — "p95 120 ms", "$0.004 a call" — but a figure nobody measured is exactly the
// unsupported claim this estate refuses everywhere else, and latency is a property of a deployment
// rather than of a declaration. So this derives a *class* from what the catalog already says, and
// leaves the measurement NOT_EVIDENCED until something measures it.
//
// Derived rather than declared, for the same reason the API planes are: 645 hand-written profiles
// would drift, and a rule that changes changes once, here.
import { loadCatalog } from './validate.mjs';

/** What kind of work answering does. Ordered from cheapest to dearest. */
export const WORK_CLASSES = Object.freeze({
  in_process_read: { order: 1, latency: 'sub_millisecond_to_millisecond', spends: 'nothing', means: 'Answered from state already in the process.' },
  journal_fold: { order: 2, latency: 'millisecond_to_second', spends: 'nothing', means: 'Folds an append-only journal or reads a local store.' },
  local_compute: { order: 3, latency: 'millisecond_to_second', spends: 'cpu', means: 'Computes over material it already holds.' },
  external_fetch: { order: 4, latency: 'network_bound', spends: 'a third party’s quota or licence', means: 'Reaches a third party to answer.' },
  model_inference: { order: 5, latency: 'second_to_minute', spends: 'tokens or accelerator time', means: 'Runs a model over the input.' },
  heavy_compute: { order: 6, latency: 'minute_or_longer', spends: 'accelerator or cluster time', means: 'Runs a simulation, solver or long optimisation.' },
});

// Provenance is written for a reader, not for a parser, so these match how it is actually written
// across the catalog rather than a vocabulary invented here. Each is a shape, and the profile says
// which one matched, so a wrong derivation is visible instead of silent.
const REACHES_OUT = /\b(HTTPS? GET|API|feed|live|Wikidata|OpenSky|AISStream|Overpass|Nominatim|EDGAR|Comtrade|arXiv|USGS|NOAA|NASA|GDELT|CelesTrak|Yahoo Finance|OpenSanctions|Telegram|crt\.sh|RIPE|ip-api|DNS-over-HTTPS|FMCSA|EIA|CanadaBuys|Radio Browser|TomTom|Valhalla|OSRM|Photon|CARTO|webhook|Webflow|provider|Ollama)\b/i;
const IS_MODEL = /\b(model (output|prediction)|LLM|inference|diffusion|OCR|classification, with confidence|prompt)\b/i;
const IS_HEAVY = /\b(GROMACS|simulation|solver|optimis|optimiz|Monte-Carlo|zero-knowledge|SP1|RISC Zero|Nexus|proof|splat|render)\b/i;
// "computation:" is how the catalog opens a provenance that is a calculation rather than a read, so
// it is matched first — otherwise "computation over the corpus" reads as a corpus read.
const IS_EXPLICIT_COMPUTE = /^\s*computation\b|\bderivation, not a measurement\b/i;
const IS_JOURNAL = /\b(journal|ledger|append-only|corpus|register|catalog|store|pool|index|repository|file|snapshot|manifest)\b/i;
const IS_LOCAL_COMPUTE = /\b(computation|computed|derived|folded|replayed|projected|rendered)\b/i;
const IS_IN_PROCESS = /\b(this process|this instance|in memory|already (held|loaded)|configuration)\b/i;

const FAMILY_DEFAULT = Object.freeze({
  acquisition: 'external_fetch',
  agent: 'model_inference',
  adjudication: 'local_compute',
  corpus: 'journal_fold',
  federation: 'external_fetch',
  infrastructure: 'in_process_read',
  kernel: 'journal_fold',
  operations: 'journal_fold',
  persistence: 'journal_fold',
  projection: 'local_compute',
  readiness: 'in_process_read',
  release: 'local_compute',
  topology: 'in_process_read',
});

/**
 * The profile of one capability. `basis` names what the derivation matched on, so a reader can see
 * why it says what it says, and `measured` is always absent — nothing here has been measured.
 */
export function profileOf(capability) {
  const provenance = typeof capability.provenance === 'string' ? capability.provenance : '';
  const family = capability.module_family;
  let workClass = null;
  let basis = null;

  if (provenance) {
    if (IS_HEAVY.test(provenance)) { workClass = 'heavy_compute'; basis = 'provenance names a simulation, solver or proof'; }
    else if (IS_MODEL.test(provenance)) { workClass = 'model_inference'; basis = 'provenance names a model or prompt'; }
    else if (REACHES_OUT.test(provenance)) { workClass = 'external_fetch'; basis = 'provenance names a third party'; }
    else if (IS_IN_PROCESS.test(provenance)) { workClass = 'in_process_read'; basis = 'provenance names this process or state already held'; }
    else if (IS_EXPLICIT_COMPUTE.test(provenance)) { workClass = 'local_compute'; basis = 'provenance opens as a computation rather than a read'; }
    else if (IS_JOURNAL.test(provenance)) { workClass = 'journal_fold'; basis = 'provenance names a journal, corpus or local store'; }
    else if (IS_LOCAL_COMPUTE.test(provenance)) { workClass = 'local_compute'; basis = 'provenance names a computation or derivation'; }
    else { workClass = 'journal_fold'; basis = 'provenance names local material'; }
  } else if (family && FAMILY_DEFAULT[family]) {
    workClass = FAMILY_DEFAULT[family];
    basis = `no provenance; the ${family} family answers this way by default`;
  }

  if (!workClass) {
    return {
      capabilityId: capability.capabilityId,
      workClass: null,
      truthClass: 'NOT_EVIDENCED',
      whyUnknown: 'The capability declares neither provenance nor a module family, so nothing here bears on what answering costs.',
      external: null, costBearing: null, unboundedInput: null, latencyClass: null, measured: null,
    };
  }

  const spec = WORK_CLASSES[workClass];
  const external = workClass === 'external_fetch';
  const costBearing = external || workClass === 'model_inference' || workClass === 'heavy_compute';
  // A caller who can widen the work is a caller who can spend the operator's money.
  const unboundedInput = capability.mode !== 'observe' || /\bquery|search|traversal|range|asOf\b/i.test(capability.description ?? '');

  return {
    capabilityId: capability.capabilityId,
    workClass,
    basis,
    truthClass: 'VERIFIED_DERIVATION',
    external,
    costBearing,
    spends: spec.spends,
    unboundedInput,
    latencyClass: spec.latency,
    // A latency figure is a property of a deployment. Nothing has measured one, and the profile
    // says so rather than carrying a number that would be read as a service level.
    measured: { truthClass: 'NOT_EVIDENCED', whyUnknown: 'No latency or cost measurement has been recorded for this capability in any deployment.' },
  };
}

export async function profileEstate() {
  const entries = await loadCatalog();
  const rows = [];
  for (const { entry } of entries) {
    for (const capability of entry.capabilities ?? []) {
      rows.push({ nodeId: entry.nodeId, ...profileOf(capability) });
    }
  }
  return rows;
}

export function summarise(rows) {
  const byClass = {};
  for (const r of rows) byClass[r.workClass ?? 'unclassified'] = (byClass[r.workClass ?? 'unclassified'] ?? 0) + 1;
  return {
    total: rows.length,
    byClass,
    external: rows.filter((r) => r.external).length,
    costBearing: rows.filter((r) => r.costBearing).length,
    unclassified: rows.filter((r) => !r.workClass).length,
    measured: rows.filter((r) => r.measured && r.measured.truthClass !== 'NOT_EVIDENCED').length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await profileEstate();
  const s = summarise(rows);
  const order = (k) => WORK_CLASSES[k]?.order ?? 99;
  console.log(`${s.total} capabilities profiled\n`);
  for (const [k, n] of Object.entries(s.byClass).sort((a, b) => order(a[0]) - order(b[0]))) {
    console.log(`  ${String(n).padStart(4)}  ${k.padEnd(17)} ${WORK_CLASSES[k]?.means ?? 'no provenance and no family: nothing bears on what answering costs'}`);
  }
  console.log(`\n  ${s.external} reach a third party to answer · ${s.costBearing} spend something to answer · ${s.unclassified} cannot be classified`);
  console.log(`  ${s.measured} carry a latency or cost measurement. Every profile is a derivation from what the catalog declares; nothing here has been measured.`);
  const worst = rows.filter((r) => r.costBearing && r.unboundedInput);
  console.log(`\n  ${worst.length} capabilities both spend something and let the caller widen the work:`);
  for (const r of worst.slice(0, 12)) console.log(`    ${r.nodeId} · ${r.capabilityId} · ${r.workClass}`);
  if (worst.length > 12) console.log(`    … and ${worst.length - 12} more`);
}
