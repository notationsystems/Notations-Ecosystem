# Security matrix and residual risk

Asset, threat, boundary, control, implementation, test, residual. Generated from
[`security/matrix.json`](../security/matrix.json), which `security/test-matrix.mjs` holds to reality:
a row naming an implementation or test that does not exist fails the build, and a row with no test
may not claim low residual risk.

Run `node --test security/test-matrix.mjs` to check it.

## The matrix

| Asset | Threat | Control | Test | Residual |
| --- | --- | --- | --- | --- |
| canonical state | unauthorized mutation | named permission on a bound principal | `control-plane/test/security.test.js` | low |
| canonical state | a projection writes truth | no write grant for the projection role, enforced by the database | `platform/test/rls.test.mjs` | low |
| tenant data | cross-tenant read or write | row security ENABLED and FORCED, no BYPASSRLS | `platform/test/rls.test.mjs` | low |
| journal | silent history rewrite | append-only hash chain, Ed25519, anchored against truncation | `control-plane/test/security.test.js` | low |
| posture evidence | the visualiser becomes a vulnerability map | producer sees paths, plane receives counts | `control-plane/test/security.test.js` | low |
| operator infrastructure | SSRF into the metadata service | resolve, refuse non-public, pin the socket | `security/test-outbound.mjs` | **medium** |
| published twin | a compromised CDN replaces the renderer | pinned version, sha384, crossorigin | `ecosystem/test/twin-security.test.mjs` | low |
| published twin | catalog text executes as markup | escaping on every data interpolation | `ecosystem/test/twin-security.test.mjs` | low |
| product surface | a nested response denies the surface | depth-bounded walk that reports its bound | `dock/test/attack.test.ts` | low |
| reader's judgement | an unknown renders as a value | a non-success carries no value field | `dock/test/truth.test.ts` | low |
| build | an install script runs with the runner's access | `--ignore-scripts`, checked | `security/test-matrix.mjs` | low |
| build | an action tag is repointed | pinned commits, contents:read, credentials dropped | `security/test-matrix.mjs` | low |
| dependency tree | a known vulnerability ships unnoticed | audit at high with expiring, assessed exceptions | `security/test-audit-gate.mjs` | **medium** |
| credentials | a secret is committed | shape scanner with in-place exemptions | `security/test-scan-secrets.mjs` | low |
| isolation proof | the proof silently does not run | the suite fails when no database is reachable | `platform/test/rls.test.mjs` | low |

## Residual risks

Two rows are medium, and neither is closed by anything in this repository.

**The outbound policy covers one path of many.** `security/outbound.mjs` resolves before it connects,
refuses every non-public address, and pins the socket to the address it verified — closing SSRF, the
cloud metadata service, and DNS rebinding. It is wired into the health probe, which is the only
outbound path this repository has. But **92 catalogued capabilities answer by reaching a third
party**, and those live in other repositories. Until each adopts this policy, the estate's SSRF
surface is 92 endpoints wide and one of them is covered. The policy is written to be copied: zero
dependencies, one import.

**Seventeen advisories are accepted rather than fixed.** All are transitive through kepler.gl, none
has a non-breaking upgrade, and each carries a written reachability assessment in
[`security/dependency-policy.json`](../security/dependency-policy.json) — five reach browser runtime,
four are build-time, eight are unreachable in this application. Those assessments rest on the dock
being a static frontend that loads its own JSON and parses no user file. **If the dock ever gains a
server or loads a user's document, every "unreachable" entry becomes wrong.** All expire 2026-12-01
and the gate fails after that date.

## What is not covered, and why

The mandate's authentication, session, CSRF, CORS, JWT and password sections describe surfaces this
repository does not have: there is no login, no session store, no cookie authentication, no public
API gateway, no password anywhere. Writing controls for them would produce code with no caller and
tests that prove nothing. They become real when a tenant-facing API exists, and the invariants are
already written for that day in [SECURITY_INVARIANTS.md](SECURITY_INVARIANTS.md).

Native code, CUDA, fuzzing and container hardening are likewise absent here: this repository has no
C, no C++, no Rust, no Dockerfile. The estate has all of them, in other repositories, and they are
where those sections apply.
