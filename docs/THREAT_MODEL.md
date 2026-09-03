# Threat model

The control plane is a coordination ledger for an ecosystem of systems it does not
own. It is valuable to an attacker for two different reasons, and they pull in opposite
directions:

1. **As a ledger** — it decides what has been proposed and approved. Forging or erasing
   an approval is the direct attack.
2. **As a map** — it describes what every system can do and how healthy each control is.
   Reading it is a reconnaissance win even if nothing is forged.

The second is why the plane is deliberately poorer than it could be. It holds no
credentials, no key material, no addresses, no vulnerability detail, and no way to
dereference the identities it stores. Compromising the visualiser should yield a
dashboard, not an inventory and a key ring.

## Actors

| Actor | Assumed capability | Primary mitigation |
| --- | --- | --- |
| Anonymous internet user | Reach the listener | Bearer credential required for everything but liveness; liveness discloses no state; non-loopback plaintext refused at boot |
| Authenticated reader | A `reader` credential | Roles grant no write permission; security status requires `operator` |
| Compromised monitor or attestor | A narrow credential | Least privilege: a monitor may record health, nothing else; node-scoped credentials cannot act for other nodes |
| Malicious or compromised agent | A `requester` credential | May propose, never approve. Separation of duties makes self-approval impossible regardless of roles held |
| Compromised operator credential | Full approval rights | Every action is attributed to a bound actor and signed into an append-only chain; approval still never dispatches |
| Compromised dock (XSS in the browser) | Whatever the page can do | Token held in memory only, strict CSP, base-URL allowlist so a credential cannot be posted elsewhere |
| Attacker with journal write access | Rewrite history on disk | Ed25519 signatures make rewriting require the key; the head anchor makes truncation loud |
| Attacker with read access to the host | Read files | Signing key is envelope-encrypted; credential registry holds digests; the journal holds no secrets by construction |
| Malicious dependency | Run code in the process | Zero runtime dependencies in the control plane; `npm audit` and a secret scan in CI |
| Malicious attestor | Submit posture | The evidence boundary refuses material; posture cannot carry a payload, a link, or an address |
| Replay attacker | Capture and resend traffic | Freshness window plus content-addressed event ids |
| Network observer | Read traffic | TLS required off loopback, or an explicitly acknowledged upstream terminator |

## Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Coordination history | `control-plane/data/*.jsonl` | The record of what was proposed and approved |
| Approval authority | Operator credentials | The ability to authorise an execution intent |
| Capability graph | The journal, projected in snapshots | What every system can do — reconnaissance value |
| Security posture | Posture attestations | Where the estate is weak — high reconnaissance value, hence bounded to counts |
| Journal signing key | `data/keystore.json`, wrapped | The ability to forge history |
| Credential registry | `data/principals.json` | Digests only; a stolen registry yields no usable credential |
| Ecosystem catalog | `ecosystem/catalog/*.json` | Public description of the estate; committed deliberately |

## Trust boundaries

```
 browser (dock)                    ← untrusted: renders attacker-influenced text
   │  bearer credential, memory-held
   ▼
 edge / reverse proxy              ← TLS terminates here or at the plane
   │
   ▼
 control plane HTTP                ← authenticate → authorize → validate → append
   │
   ▼
 hash-linked, signed journal       ← integrity boundary: signatures + rollback anchor
   │
   ▼
 (no further edge)                 ← the plane dispatches nothing; execution adapters
                                     are a separate, later, least-privilege boundary
```

The evidence path is separate and deliberately one-way:

```
 system under attestation
   │ producer sees versions, advisories, paths, addresses
   ▼
 security/attest.mjs               ← redaction happens HERE, at the source
   │ states, coverage fractions, severity counts, one sentence
   ▼
 record_security_posture           ← boundary re-checks and refuses material
   │
   ▼
 constellation
```

Trust never increases along either path. Nothing downstream of the plane gains
authority from being recorded in it.

## Attacks considered, and what stops them

| Attack | Outcome |
| --- | --- |
| Call the API without a credential | 401; no state disclosed |
| Guess credentials | Constant-time comparison, indistinguishable failures, per-source lockout |
| Claim another actor's identity in a command | 403 — the actor is bound to the credential |
| Approve one's own execution intent | 403 — separation of duties on the recorded actor |
| Escalate by declaring `execute` with `automatic` approval | 422 at validation |
| Submit an unknown action hoping for a default | 422 — no permission mapping, fails closed |
| Exhaust the stack with deeply nested JSON | 422 — structure bounded before anything recurses |
| Pollute `Object.prototype` | 422 — forbidden keys refused independently of the contract |
| Inject terminal escapes or bidi overrides into the ledger | 422 — control and bidi characters refused |
| Smuggle a credential into metadata or a description | 422 — credential shapes refused in any field |
| Replay a captured command later | 422 `COMMAND_STALE` outside the freshness window |
| Rewrite a record on disk | 503 `JOURNAL_CORRUPT` — chain and signature both fail |
| Truncate history to erase an approval | 503 `JOURNAL_ROLLBACK` — the anchor disagrees |
| Amplify load through unauthenticated liveness | Liveness does no journal work; verified reads are cached |
| Drain the plane with unbounded event reads | Paginated with a server-side cap |
| Exfiltrate a dock credential to an attacker origin | Refused by the base-URL allowlist, at call time |
| Frame the dock and clickjack an approval | `frame-ancestors`/`X-Frame-Options` served as headers |
| Use posture attestation as a data-exfiltration channel | Refused: no URLs, paths, addresses, advisories or key material |

## Known limits

Stated plainly, because a threat model that claims completeness is not one.

- **Rate limits and lockouts are per process.** The plane is a single writer by design;
  a multi-instance deployment must carry the same limits at its shared edge.
- **The anchor is not off-host replication.** An attacker who can rewrite both the
  journal and its anchor consistently defeats it. It converts silent history loss into a
  loud failure; durable replication is still required, and `backup` posture reports
  `unknown` until one is configured.
- **A compromised operator credential can approve.** Separation of duties requires two
  *actors*; one attacker holding two credentials defeats it. Attribution and the signed
  chain remain.
- **`'unsafe-inline'` for styles** is required by styled-components inside Kepler.gl.
  Scripts carry no such exception, and `'wasm-unsafe-eval'` is the narrow directive for
  deck.gl's WebAssembly rather than full `'unsafe-eval'`.
- **The legacy single token** grants every role and may claim any actor. It exists for
  local development, warns at boot, and is reported as weak identity posture.

- **The evidence boundary is pattern-based, and patterns have edges.** It refuses the
  shapes attackers and tools actually produce — literal addresses, host:port, internal
  hostnames, port claims, advisory identifiers with any separator, package@version,
  exploit language, offensive tooling, URLs with or without a scheme, report-artifact
  paths, and credential formats. It does **not** catch an address written as a decimal
  or hex integer, spelled out in words, or base64-encoded, because every pattern that
  would catch those also refuses ordinary posture prose ("2130706433 records"), and a
  boundary that rejects legitimate summaries pushes attestors toward vaguer ones. The
  boundary is a control against accident and casual misuse, not against an attestor
  determined to smuggle data through a 280-character field it already controls — such an
  attestor is inside the trust boundary and is better addressed by credential scope and
  the audit trail.

- **Report-artifact paths are refused; source and documentation paths are not.** An
  attestor may say which module implements a control. `ops/scan.json` is a pointer to
  findings; `security/evidence.js` is a reference to code.
