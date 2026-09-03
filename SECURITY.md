# Security

The Notations control plane is a coordination ledger for systems it does not own. Its
security model is built on one asymmetry: **it must know what every system can do, and
must never hold what would let someone do it.**

- [Threat model](docs/THREAT_MODEL.md) — actors, assets, boundaries, and known limits
- [Invariants](docs/SECURITY_INVARIANTS.md) — the properties, and the tests that prove them
- [Substrate](docs/SUBSTRATE.md) — the identity space and why the projection is not the database
- [Data classification](docs/DATA_CLASSIFICATION.md) — every class held, and what is deliberately refused
- [Corpus doctrine](docs/CORPUS.md) — what the company builds, and the ten invariants that decide whether a system is one

## Reporting a vulnerability

Report privately to the repository owners. Please include what you did, what happened,
and what you expected. Do not open a public issue, and do not include exploit material
or live credentials in the report — a description of the flaw is enough to act on.

Anything that lets a caller read state without a credential, write history as another
actor, approve an intent they proposed, forge or erase a record, or extract material
through the posture boundary is treated as urgent.

## What the control plane holds, and what it refuses

| Holds | Refuses |
| --- | --- |
| Node identities, kinds and declared capabilities | Provider credentials and API keys |
| Relations between nodes | Private keys and key material |
| Health observations (a state and a sentence) | Raw vulnerability detail, advisory ids, package versions |
| Coordination requests and operator decisions | Network topology: addresses, ports, internal hostnames |
| Security posture: states, coverage fractions, severity counts | Offensive capability: payloads, tooling invocations |
| Opaque evidence references (`sha256:…`, `notation://…`) | Links or filesystem paths to raw findings |

The right-hand column is enforced in `control-plane/src/security/evidence.js` and
`text.js`, at the command boundary, with a refusal that names the class and says what to
send instead. It is not a documentation convention.

## Running it safely

```sh
# 1. A key encryption key wraps the journal signing key at rest.
export CONTROL_PLANE_KEK=$(node control-plane/src/security/cli.js kek generate | grep -o 'CONTROL_PLANE_KEK=.*' | cut -d= -f2-)

# 2. Issue a credential per principal. The secret is printed once and never stored.
export CONTROL_PLANE_PRINCIPALS_FILE=control-plane/data/principals.json
node control-plane/src/security/cli.js issue --principal operator:alice --roles operator,registrar
node control-plane/src/security/cli.js issue --principal monitor:probe  --roles monitor --nodes payload-terminal
node control-plane/src/security/cli.js issue --principal attestor:ci    --roles attestor

# 3. Serve. Off loopback, TLS is required or must be explicitly delegated.
export CONTROL_PLANE_TLS_CERT=/path/cert.pem CONTROL_PLANE_TLS_KEY=/path/key.pem
cd control-plane && npm start
```

### Configuration that matters

| Variable | Effect if unset |
| --- | --- |
| `CONTROL_PLANE_PRINCIPALS_FILE` | No bound identities; only the legacy token works, and it warns |
| `NOTATIONS_CONTROL_PLANE_TOKEN` | — (this is the legacy path; prefer issued credentials) |
| `CONTROL_PLANE_KEK` | The signing key is written in plaintext, and says so at boot |
| `CONTROL_PLANE_TLS_CERT` / `_KEY` | Loopback only, unless `CONTROL_PLANE_TRUST_PROXY_TLS=1` |
| `CONTROL_PLANE_REQUIRE_SIGNATURES` | Unsigned legacy records are tolerated on read |
| `CONTROL_PLANE_ALLOWED_ORIGINS` | No browser origin may call the API |
| `CONTROL_PLANE_JOURNAL_REPLICA` | `backup` posture reports `unknown`, honestly |

### Operating rules

- **Rotate the signing key on a schedule.** Stop the plane, run `node
  control-plane/src/security/cli.js keys rotate`, then start it again. Rotation reads
  the journal length and records it as the retired key's boundary: records it signed
  before that point keep verifying, anything it signs afterwards does not, and its
  private half is dropped from the store. Rotating while the plane is running would
  leave the in-memory store disagreeing with the file.
- **Replicate the journal off-host.** The rollback anchor makes tampering loud; only a
  replica makes it recoverable.
- **Never reuse one credential across roles.** Separation of duties is enforced on
  actors, so an approver and a proposer must be genuinely different identities.
- **Treat a `JOURNAL_ROLLBACK` or `JOURNAL_CORRUPT` as an incident.** The plane fails
  closed rather than serving history it cannot verify. Check a replica offline before
  trusting it — `node control-plane/src/security/cli.js verify <journal>` reads and
  reports without writing — then restore from a sound one. Never append to a shortened
  chain: a truncated journal still verifies as a chain, and only the anchor catches it.
- **Keep posture attestation at the source.** Run `security/attest.mjs` where the system
  is, so redaction happens before anything crosses the network.

## Checks

```sh
cd control-plane && npm test        # 39 tests covering 37 named invariants
node security/scan-secrets.mjs      # repository credential scan
node security/attest.mjs --print    # what this deployment would attest, sent nowhere
cd dock && npm test                 # includes credential-handling invariants
```

CI runs all of these on every push.
