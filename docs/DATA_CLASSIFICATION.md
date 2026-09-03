# Data classification and protection

Every class of information this repository handles, what protects it, and — where it is
deliberately unprotected — why that is the right answer.

The classification exists to make one thing checkable: **the control plane holds nothing
above INTERNAL.** If a change would put CONFIDENTIAL, SECRET or CRYPTOGRAPHIC_SECRET
material into the journal or a snapshot, the classification is what makes that visibly
wrong rather than merely unfortunate.

| Class | Meaning | Protection required |
| --- | --- | --- |
| `PUBLIC` | Safe to publish | Integrity only |
| `INTERNAL` | Not secret, but not for publication | Authentication, integrity, transport encryption |
| `CONFIDENTIAL` | Damaging if disclosed | The above, plus encryption at rest and least-privilege read |
| `SECRET` | Grants access or reveals attack surface | The above, plus never in a log, a snapshot, or an LLM context |
| `CRYPTOGRAPHIC_SECRET` | Key material | The above, plus envelope encryption and a rotation schedule |

## The second axis: what losing it would cost

The table above answers one question — what disclosing something would cost — and the
estate runs on two. UN Comtrade revises its datasets in place and keeps no history, so a
capture of it is `PUBLIC` by disclosure and irreplaceable by durability: lose it and the
knowledge state it recorded cannot be recovered from anywhere, including from UNSD. One
enum could hold only one of those answers, and the catalog's resource classification held
the second by giving up the first — `unreconstructable` sat in the disclosure enum, so a
public capture had to stop calling itself public in order to say it was irreplaceable.

They are separate now, and a resource may answer both:

| Durability | Meaning | What it demands |
| --- | --- | --- |
| `reconstructable` | Can be rebuilt from something else that is kept | Nothing beyond ordinary care |
| `refetchable_at_risk` | The source will probably serve it again, and may not | A capture, and a plan for the day it does not |
| `unreconstructable` | The source revises in place or will not serve it twice | Capture before parsing, verify by digest, replicate off-provider |

The archive exists for the third row, and the third row is why `COR-007` — evidence
before interpretation — is an invariant rather than a preference. Disclosure decides who
may read a thing; durability decides whether there is still a thing to read.

## The third axis: what provisioning it would create

The two axes above ask what a thing costs to disclose and what it costs to lose. A
credential has a third property neither captures: **it does not exist until someone makes
it**, and a manifest that names one is an instruction to make it.

The catalog used to name ninety environment variables in one list called `secrets_env`.
In it, side by side and indistinguishable: `ATLAS_PORT`, `AWS_REGION`, `STE_REPO` — a
port, a region, a path — and `EMAIL_PASSWORD`, `CONTROL_PLANE_KEK`, `EARTHDATA_PASSWORD`.
One of the nodes had written a note apologising that its entry "is a path, not a secret",
which is a manifest arguing with its own schema. Two things follow from a list like that.
An operator standing the estate up cannot tell which entries create a standing grant, so
they create all of them. And the word *secret* stops carrying information, which is the
condition under which people stop reading.

`reference.environment` separates them, and the validator refuses the confusion:

| Kind | Meaning | Rule |
| --- | --- | --- |
| `credential` | Reading it uses or creates a standing grant against something | Must say in a sentence what it authorises |
| `configuration` | A path, port, URL, region, model name, timeout, feature list | May not be *named* like a credential — rename it or admit what it is |

Two further facts are declared rather than discovered. A credential marked
`client_exposed` reaches the browser by design — a map-tiles key, a Cesium ion token —
and cannot be protected by secrecy, so its purpose must name what does protect it:
referrer or origin restriction, scope, metering, a quota. And `unused` marks a credential
**nothing consumes**.

That last one is the reason for the whole change. Six of the estate's sixty-two
credentials are named by a system that does not read them: four OSIRIS keys that survived
a fork whose routes did not (`FIRMS_API_KEY`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`,
`N2YO_API_KEY` on Payload Terminal), and two halves of an authentication scheme OpenSky
retired (`OPENSKY_USERNAME`, `OPENSKY_PASSWORD` on God's Eye View). An operator following
those manifests creates six live grants against four external accounts, and no failure
will ever reveal them: nothing calls them, so nothing breaks when they expire, and nothing
notices when they are used by someone else. `node ecosystem/validate.mjs` prints them by
name on every run.

## What this repository holds

| Data | Class | Where | Protection |
| --- | --- | --- | --- |
| Ecosystem catalog (`ecosystem/catalog/*.json`) | `PUBLIC` | Git | Reviewed in the diff; validated before it can be seeded |
| Payload spatial layers (`ecosystem/payload/layers/`) | `PUBLIC` | Git | Per-row provenance in one declared shape; `basis` per layer — capture, manifest, curated or synthetic — with `real` derived from it |
| Sample snapshot (`dock/public/sample-snapshot.json`) | `PUBLIC` | Git | Marked `sample: true`, rendered with a notice |
| Node registrations, relations, capabilities | `INTERNAL` | Journal | Authenticated read, signed chain |
| Health observations | `INTERNAL` | Journal | As above |
| Security posture (states, coverage, counts) | `INTERNAL` | Journal | As above, plus the evidence boundary that keeps it at this class |
| Coordination requests and decisions | `INTERNAL` | Journal | As above; approval attributed to a bound actor |
| Security event log | `INTERNAL` | stderr, in-memory ring | Sources pseudonymised, no credential material, operator-only read |
| Journal signing key | `CRYPTOGRAPHIC_SECRET` | `data/keystore.json` | AES-256-GCM envelope encryption under a KEK, 0600, rotatable |
| Key encryption key | `CRYPTOGRAPHIC_SECRET` | Environment / secret manager | Never written by this repository, never in a response |
| Credential registry | `SECRET` | `data/principals.json` | SHA-256 digests only, 0600 — a stolen registry yields no usable credential |
| Bearer credentials | `SECRET` | Operator's secret manager; dock memory | Printed once, never persisted by the dock, never logged |

## What it deliberately does not hold

These are the classes that make a visualiser worth attacking. Each is refused at the
command boundary in `control-plane/src/security/evidence.js`, with a refusal that names
the class:

| Would-be data | Class | Why it is refused |
| --- | --- | --- |
| Provider credentials and API keys | `SECRET` | The plane coordinates; it does not authenticate to the systems it names |
| Private keys in any form | `CRYPTOGRAPHIC_SECRET` | A visualiser is not a key store |
| Raw vulnerability detail (advisory ids, vulnerable versions) | `SECRET` | A specific exploitable version is a targeting instruction |
| Network topology (addresses, ports, internal hostnames) | `SECRET` | Describes where to attack |
| Offensive capability (payloads, tooling invocations) | `SECRET` | The plane records posture; it never carries the means to act on a weakness |
| Links or paths to raw findings | `SECRET` | Moves the exposure rather than removing it, and invites whatever follows the pointer |
| Source artifacts, documents, datasets | `CONFIDENTIAL` | The projection is not the database — see [SUBSTRATE.md](SUBSTRATE.md) |

## How the class is enforced, per boundary

- **Into the journal** — `validation.js` refuses credential-shaped values in any field,
  including metadata values, not just credential-shaped key *names*.
- **Into posture** — `evidence.js` refuses the five classes above and caps summaries at
  280 characters, so there is no room for a payload even if a pattern were missed.
- **Out of an API response** — proven by test: no credential, secret half, KEK, private
  key or credential digest appears in a snapshot, an event, the security status, or
  liveness (`SEC-013`).
- **Into a log** — `audit.js` passes every field through `logSafe`, names principals by
  id, never names credentials, and pseudonymises remote addresses with a per-process
  salt.
- **At rest** — the signing key is envelope-encrypted; the registry holds digests; the
  journal is `0600` and holds nothing above `INTERNAL`.
- **In the browser** — the credential is held in memory only; preferences persist,
  secrets do not.

## The one asymmetry worth restating

The posture producer (`security/attest.mjs`) reads package versions, advisory
identifiers, key-store contents and filesystem paths. It sends states, coverage
fractions and severity counts. That gap is the security property: it is what makes the
constellation useful to an operator and useless to an attacker who takes it.
