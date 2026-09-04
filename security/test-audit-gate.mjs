import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { advisoriesOf, evaluate } from './audit-gate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(await readFile(path.join(here, 'dependency-policy.json'), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(policy));
const reported = (rows) => new Map(rows.map((r) => [r.advisory, r]));
const known = policy.accepted[0];

test('a fully assessed, in-date report passes', () => {
  const found = reported(policy.accepted.map((a) => ({ advisory: a.advisory, package: a.package, severity: a.severity, title: a.title })));
  assert.deepEqual(evaluate(found, policy, new Date('2026-09-04')), []);
});

test('an advisory nobody has assessed fails the build', () => {
  const found = reported([...policy.accepted.map((a) => ({ advisory: a.advisory, package: a.package, severity: a.severity, title: a.title })),
    { advisory: 999_999, package: 'brand-new', severity: 'high', title: 'something nobody has read yet' }]);
  const f = evaluate(found, policy, new Date('2026-09-04'));
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'unassessed');
  assert.match(f[0].detail, /Nothing in the register says/);
});

test('an acceptance that has expired fails the build', () => {
  const found = reported(policy.accepted.map((a) => ({ advisory: a.advisory, package: a.package, severity: a.severity, title: a.title })));
  // An acceptance with no expiry is a permanent exception, so the date is the control.
  const f = evaluate(found, policy, new Date('2027-01-01'));
  assert.equal(f.length, policy.accepted.length);
  assert.ok(f.every((x) => x.kind === 'expired'));
});

test('an acceptance that no longer describes anything fails the build', () => {
  const found = reported(policy.accepted.slice(1).map((a) => ({ advisory: a.advisory, package: a.package, severity: a.severity, title: a.title })));
  const f = evaluate(found, policy, new Date('2026-09-04'));
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'stale');
  assert.match(f[0].detail, /keeps describing the system/);
});

test('an entry listed without an assessment is not an acceptance', () => {
  const p = clone();
  p.accepted[0].exposure = 'unassessed';
  const found = reported(p.accepted.map((a) => ({ advisory: a.advisory, package: a.package, severity: a.severity, title: a.title })));
  const f = evaluate(found, p, new Date('2026-09-04'));
  assert.ok(f.some((x) => x.kind === 'unassessed' && x.advisory === known.advisory));
});

test('every acceptance states an exposure, a reason and a date', () => {
  for (const a of policy.accepted) {
    assert.ok(['browser_runtime', 'build_time', 'unreachable'].includes(a.exposure), `${a.package} carries exposure "${a.exposure}"`);
    assert.ok(a.assessment && a.assessment.length > 40, `${a.package} has no real assessment`);
    assert.ok(a.accepted_because, `${a.package} does not say why it is accepted`);
    assert.match(a.review_by, /^\d{4}-\d{2}-\d{2}$/, `${a.package} has no review date`);
  }
});

test('the threshold was not lowered to make the gate green', () => {
  // The failure mode this whole file exists to prevent.
  assert.equal(policy.audit_level, 'high');
  assert.match(policy.description, /Lowering the threshold/);
});

test('advisoriesOf reads distinct advisories out of a real report shape', () => {
  const report = { vulnerabilities: { a: { via: [{ source: 1, name: 'x', severity: 'high', title: 't' }, 'b'] }, b: { via: [{ source: 1, name: 'x', severity: 'high', title: 't' }] } } };
  const found = advisoriesOf(report);
  assert.equal(found.size, 1, 'one advisory reached through two packages is one advisory');
});
