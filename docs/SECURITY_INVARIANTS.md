# Security invariants

Each invariant is a property the system must hold, written so it can be checked rather
than believed. Every one that can be tested is tested; the test name carries the
invariant id, so a failing suite names the property that broke.

Run them with `cd control-plane && npm test`.

| Id | Invariant | Where it is enforced | Where it is proven |
| --- | --- | --- | --- |
| SEC-001 | No unauthenticated actor may read state or invoke a state transition. | `server.js` authenticates before any route but `/health`. | `SEC-001 no unauthenticated actor…` |
| SEC-002 | Authorization is checked server-side at every privileged boundary, and fails closed. | `policy.js` `requirePermission`, called from `ControlPlane.command`. | `SEC-002 authorization is checked per action…` |
| SEC-003 | Frontend state is never authorization evidence; the recorded actor is bound to the credential, exactly. | `policy.js` `requireActorBinding`; actor patterns are exact or the single legacy `*`, never prefixes. | `SEC-003 and SEC-006 the recorded actor…`, `SEC-003 actor binding is exact…` |
| SEC-004 | No secret may be committed to source control. | `security/scan-secrets.mjs`, run in CI; `.gitignore` excludes the runtime state directory the key store and registry live in. | CI job `security`, exemptions written in place. |
| SEC-005 | No long-lived secret is stored in browser storage. | `dock/src/api/controlPlane.ts` holds the token in memory only. | `the credential never reaches browser storage` (dock) |
| SEC-006 | Every canonical-state mutation carries an authenticated execution identity. | Actor binding plus the journal's `actorId`. | `SEC-003 and SEC-006 …` |
| SEC-007 | Every privileged mutation and every denial produces an auditable event. | `audit.js` `SecurityLog`, written from the request path. | `SEC-AUDIT privileged outcomes are recorded…` |
| SEC-008 | Every externally supplied payload crosses a validation boundary before entering canonical state. | `validation.js` with `security/text.js`. | `SEC-008 external payloads cross a validation boundary…` |
| SEC-009 | History is cryptographically bound to its writer, not merely hash-linked. | `journal.js` + `crypto/signing.js` (Ed25519 over the record hash). | `SEC-014 integrity failures fail closed…`, `SEC-INTEGRITY …` |
| SEC-010 | Identity classes stay distinct and are never collapsed into one trust domain. | `identity/uri.js` typed classes; principal ≠ actor ≠ node ≠ key. | `SEC-010 identity classes stay distinct…` |
| SEC-011 | An agent may not grant itself a capability. | Separation of duties on `resolve_coordination`. | `SEC-011 an actor may not approve its own execution intent` |
| SEC-012 | Approval is not execution: a coordination record is never dispatched by the plane. | `control-plane.js` sets `dispatch: 'not_dispatched'` and never changes it. | `SEC-011 …` asserts it after approval. |
| SEC-013 | No credential, key or digest may leave through an API response, and so never reaches an agent's context. | Nothing above `INTERNAL` enters the journal or the status surface. | `SEC-013 no credential or key material can leave through an API response` |
| SEC-014 | Cryptographic and integrity verification failures fail closed. | `verifyRecords`, `assertNotRolledBack`. | `SEC-014 …` (tamper and rollback both refused) |
| SEC-015 | Authorization failure fails closed. | `forbidden()` is thrown, never defaulted around. | `SEC-002`, `SEC-SCOPE` |
| SEC-016 | Unknown actions, roles and enum values never acquire privileged semantics. | Allowlists in `validation.js` and `permissionForAction`. | `SEC-016 unknown actions, roles and enum values…` |
| SEC-017 | A derived representation cannot mutate canonical state. | The dock only submits commands through the plane; it holds no store. | Architecture: `dock/` has no write path other than `/v1/commands`. |
| SEC-018 | Production services reject plaintext transport outside a documented local boundary. | `assertTransportPolicy` refuses non-loopback plaintext at boot. | `SEC-018 plaintext transport is refused…` |
| SEC-019 | A captured command cannot be replayed outside a freshness window. | `maxCommandAgeSeconds` plus the event-id digest. | `SEC-REPLAY a captured command cannot be replayed…` |
| SEC-020 | History cannot be silently shortened or rewritten. | `security/anchor.js` head anchor. | `SEC-014 …` (rollback case) |
| SEC-021 | Credential guessing is bounded and locks the source out, and revocation is immediate. | `ratelimit.js`; the verification cache holds the digest comparison, never the authorization decision. | `SEC-ABUSE credential guessing is rate limited…`, `SEC-021 disabling a credential takes effect immediately…` |
| SEC-022 | Unauthenticated callers learn nothing about state. | `/health` returns liveness only. | `SEC-DISCLOSURE liveness reveals no state…` |
| SEC-023 | Reads are bounded; no caller can force unbounded work or response size. | Events pagination, body cap, verified-read cache. | `SEC-DOS reads are bounded…` |
| SEC-024 | A node-scoped credential cannot act for another node, including as the source of a relation. | `requireNodeBinding` over every command with a subject node. | `SEC-SCOPE …`, `SEC-024 a node-scoped credential cannot declare relations…` |
| SEC-025 | Secrets never appear in logs, and callers are pseudonymised. | `audit.js` `logSafe` and `sourceKey`. | `SEC-AUDIT …` |
| SEC-026 | The dock will not send a credential to an origin it was not configured for. | `checkBaseUrl`, enforced at call time. | `the dock will not hand its credential to an arbitrary origin` (dock) |
| SEC-027 | Only JSON is parsed, and only into the declared contract. | `readJSON` plus `exactKeys`; no other deserializer exists in the plane. | `SEC-SERIALIZATION the plane parses only JSON…` |
| SEC-028 | Snapshot content never becomes markup, an attribute, or a link destination. | `esc`/`safeColor`/`own` in the graph tooltip; `githubRepoUrl` for links. | `a hostile snapshot cannot inject into the graph tooltip`, `untrusted metadata never becomes a link destination` (dock) |
| SEC-029 | A bulk writer meeting a rate limit backs off rather than defeating it. | `HttpControlPlane` honours `Retry-After`; authorization failures are never retried. | `SEC-ABUSE a legitimate bulk writer backs off…` |
| SEC-030 | The constellation holds evidence, never material. | `security/evidence.js` refusal boundary. | `SEC-030 the constellation accepts posture evidence and refuses material` |
| SEC-031 | An inherited property name is never a member of an allowlist. | `security/table.js`: every lookup table is prototype-less and asked with `Object.hasOwn`. | `SEC-031 an inherited property name…`, `SEC-031 a role name outside the table…` |
| SEC-032 | The projection is total over anything the journal can hold. | `buildConstellation` counts what it does not recognise instead of failing on it. | `SEC-032 the projection is total over anything the journal can hold` |
| SEC-033 | No single field can make the plane stop answering. | `MAX_SAFE_TEXT_LENGTH`, applied ahead of the first pattern; bounded quantifiers. | `SEC-033 no single field…`, `SEC-033 an oversized field is refused over HTTP…` |
| SEC-034 | Everything a record carries is covered by the hash chain and the signature. | `verifyRecords` closes the record shape. | `SEC-034 a record field outside the contract…` |
| SEC-035 | Retirement removes a key's authority, not only its label. | `KeyStore.verify` holds a retired key to `retiredAtRecord`; rotation drops its private half. | `SEC-035 a retired signing key cannot sign new history…` |
| SEC-036 | A control that cannot run is refused at boot, never reported as running. | `createRuntime` refuses `requireSignatures` without a key store. | `SEC-036 a control that cannot run is refused…` |
| SEC-037 | Material with no legitimate reading is refused in every field, not only in posture. | `assertNoWeaponisedText`, called from `validation.js` `string()` and metadata. | `SEC-037 material with no legitimate reading…` |
| SEC-038 | The published contract names every code the plane can emit, and no code it cannot. | `openapi/control-plane.openapi.yaml` `ErrorCode`; the test walks `src/` rather than a list. | `SEC-CONTRACT the published contract names every code…` |
| SEC-039 | Every variable the plane reads is documented, and nothing else is. | `.env.example`, checked against the source tree. | `SEC-CONFIG every variable the plane reads is documented…` |
| SEC-040 | The evidence producer holds itself to the boundary it claims, not a subset of it. | `assertProducerOutputIsEvidence` runs the server's `parseSignals`. | `SEC-PRODUCER the producer holds itself…` |
| SEC-041 | Every action the parser accepts requires a named permission. | `SUPPORTED_ACTIONS` compared against `ACTION_PERMISSIONS`, in the producer and in a test. | `SEC-PRODUCER the authorization signal measures something other than itself` |
| SEC-042 | A journal's signing key lives beside the journal it signs, never beside whoever opened it. | `defaultKeystorePath(journalPath)` in `control-plane.js`, used by the server, the offline tools and the key CLI alike. | `SEC-042 a journal's signing key lives beside the journal…` |
| SEC-043 | Every response carries a canonical reference and a proof root, or states that it is an operational observation and what it does not cover. | `api/response.js`; asserted in `json()` on the way out, so a body satisfying neither is refused rather than served. | `API-000 every response carries a proof root or states its limitations` |
| SEC-044 | A posture statement may carry its collector's own Ed25519 signature; the plane verifies it against public keys it holds, records who vouched, and holds no key that could forge one. | `security/attestation.js`, called from `record_security_posture` before anything is written; `NOTATIONS_SECURITY_ATTESTERS` carries public halves only. | `SEC-044 an independent signature is verified against public keys…` |
| SEC-045 | An operator-local action is refused over every plane, whatever the principal holds, and accepted only in-process at the host. | `policy.js` `OPERATOR_LOCAL_ACTIONS` and `requireOperatorLocal`, checked in `ControlPlane.command` on the principal rather than the route. | `SEC-045 an operator-local action is refused over every plane…` |
| SEC-046 | A projection never binds to the fabric as canonical state: the authority a fabric sync claims must be one the system's corpus role entitles it to. | `control-plane.js` `FABRIC_AUTHORITY_BY_ROLE`, checked in `register_fabric_sync`; PLAT-004 holds the same rule in the database as a missing grant. | `SEC-046 a projection never binds to the fabric as canonical state` |

## Recovery

An operator who sees `JOURNAL_CORRUPT` or `JOURNAL_ROLLBACK` must be able to answer "is
this replica sound?" without starting a server against it — starting one would append to
a history that may be wrong. `node control-plane/src/security/cli.js verify <journal>`
reads, verifies and reports, writing nothing: chain, signature coverage, anchor
agreement, and a breakdown by event kind. It exits non-zero when the journal is not
sound.

A truncated journal is the case worth understanding: the remaining prefix still
*verifies as a chain*. Only the anchor catches it.

## Published surfaces

The estate publishes a self-contained instance of the Control Universe and serves product surfaces
in a browser. Both execute code and render text that originates elsewhere, so both carry invariants
of their own.

**SEC-047 — every third-party script a published surface executes is pinned by version and bound by
subresource integrity.**

The renderer runs with full DOM access in a page that is published and shared. Pinning a version
stops an upgrade from changing behaviour; integrity stops the same URL from serving different bytes.
Without the second the first is a naming convention, not a control — and `crossorigin` is required
alongside it, because a browser does not enforce integrity on a cross-origin script fetched in
no-cors mode. Checked by `ecosystem/test/twin-security.test.mjs`, which also re-fetches the pinned
bundle and compares its digest to the one in the page.

**SEC-048 — no catalog text reaches a published page as markup.**

Names, descriptions, capability labels and observation detail are written by people and assembled by
tooling, and all of them are rendered. Text that became markup would be stored XSS in a page built
to be shared. Verified by attack: 2,868 string fields across the fold were replaced with six XSS
payloads, the instance was rebuilt and rendered headlessly, and nothing executed — every payload
arrived as characters. The test asserts the escaping helper survives and that no `innerHTML`
template interpolates a snapshot field without routing it through one.

**SEC-049 — a walk over an externally supplied document is depth-bounded, and the bound is
reported rather than silently applied.**

A response is attacker-influenced the moment it crosses a boundary. The Caravan surface walks a
slice to find what it could not answer, and that walk was unbounded: a nested document overflowed
the stack and took the surface down. It is bounded at 64 levels now, and exceeding the bound emits a
typed `NOT_EVIDENCED` rather than stopping quietly — a surface that silently stopped looking would
be claiming it had looked, which is the same failure as rendering an unknown as a zero. Found by
attack, fixed, and held by `dock/test/attack.test.ts`.

## Invariants that are architectural rather than testable

Some properties are held by the shape of the system rather than by a check. They are
recorded here so that a change which breaks one is visible in review.

- **The control plane holds no resolver.** `identity/uri.js` exports `resolve()` only to
  throw. A projection that can dereference every identity it displays would be a
  credential-bearing gateway to the whole substrate.
- **The plane holds no provider credentials.** It records that a system exists and what
  it may do, never how to authenticate to it. Execution adapters, when they exist, are a
  separate least-privilege boundary that the plane cannot reach.
- **Posture is asymmetric by construction.** The producer (`security/attest.mjs`) sees
  package versions, advisory ids and paths; the plane receives counts and states. This
  is what makes compromising the visualiser unprofitable.
- **A projection may not be able to fail.** Everything downstream of the journal reads
  an append-only history, so a read path that throws on one stored record takes every
  future read with it and the record cannot be withdrawn. Validation fails closed at
  the write boundary; projection is total (SEC-032). The two rules point in opposite
  directions on purpose, and which side of the journal the code is on decides which
  one applies.
