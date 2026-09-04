#!/usr/bin/env node
// The dependency gate.
//
// `npm audit --audit-level=high` had been failing for every run: 34 findings, all transitive
// through kepler.gl, none with a non-breaking fix. A gate that always fails is a gate nobody reads,
// and the usual response — lower the threshold until it goes green — produces a gate that reads
// nothing. So the threshold stays where it is and the exceptions are written down instead: every
// accepted advisory carries an assessment, a reason and a date it must be looked at again.
//
// The gate fails on three things: an advisory nobody has assessed, an acceptance that has expired,
// and an acceptance that no longer describes anything. The last one matters as much as the first —
// a register that accumulates dead entries stops being a description of the system.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SEVERITY = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

export async function auditWorkspace(workspace) {
  try {
    const { stdout } = await run('npm', ['audit', '--json'], { cwd: path.join(root, workspace), maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (e) {
    // npm audit exits non-zero when it finds anything; the report is still on stdout.
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

/** Every distinct advisory in the report, keyed by its advisory id. */
export function advisoriesOf(report) {
  const found = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via === 'object' && via.source) {
        found.set(via.source, { advisory: via.source, package: via.name, severity: via.severity, title: via.title });
      }
    }
  }
  return found;
}

export function evaluate(found, policy, today = new Date()) {
  const threshold = SEVERITY[policy.audit_level] ?? 3;
  const accepted = new Map(policy.accepted.map((a) => [a.advisory, a]));
  const failures = [];

  for (const [id, a] of found) {
    const entry = accepted.get(id);
    if (!entry) {
      if ((SEVERITY[a.severity] ?? 0) >= threshold) {
        failures.push({ kind: 'unassessed', advisory: id, detail: `${a.severity} in ${a.package}: ${a.title}. Nothing in the register says whether this reaches this deployment.` });
      }
      continue;
    }
    if (entry.exposure === 'unassessed') {
      failures.push({ kind: 'unassessed', advisory: id, detail: `${a.package} is listed but carries no assessment.` });
    }
    if (new Date(entry.review_by) < today) {
      failures.push({ kind: 'expired', advisory: id, detail: `${a.package} was accepted until ${entry.review_by}, which has passed. An acceptance with no expiry is a permanent exception.` });
    }
  }
  for (const [id, entry] of accepted) {
    if (!found.has(id)) {
      failures.push({ kind: 'stale', advisory: id, detail: `${entry.package} is accepted in the register and no longer reported. Remove it, so the register keeps describing the system.` });
    }
  }
  return failures;
}

export async function gate(today = new Date()) {
  const policy = JSON.parse(await readFile(path.join(here, 'dependency-policy.json'), 'utf8'));
  const report = await auditWorkspace(policy.workspace);
  const found = advisoriesOf(report);
  return { policy, found, failures: evaluate(found, policy, today), counts: report.metadata?.vulnerabilities ?? {} };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { policy, found, failures, counts } = await gate();
  const byExposure = {};
  for (const a of policy.accepted) byExposure[a.exposure] = (byExposure[a.exposure] ?? 0) + 1;
  console.log(`${policy.workspace}: ${found.size} distinct advisories reported, ${policy.accepted.length} assessed and accepted`);
  console.log(`  reported by severity: ${JSON.stringify(counts)}`);
  console.log(`  accepted by exposure: ${JSON.stringify(byExposure)}`);
  console.log(`  threshold: ${policy.audit_level} — an unassessed advisory at or above this fails the build`);
  if (!failures.length) {
    console.log('\nEvery reported advisory is assessed, in date, and still real.');
  } else {
    console.log(`\n${failures.length} failure(s):`);
    for (const f of failures) console.log(`  ${f.kind.padEnd(11)} ${f.advisory}  ${f.detail}`);
    process.exitCode = 1;
  }
}
