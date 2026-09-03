# Working in this repository

Instructions for any agent or contributor working across the Notation Systems Ecosystem. Read this,
then [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md), before changing anything.

## The one rule everything else serves

**An answer either walks back to the material it came from, or says it cannot.** Every doctrine in
this repository is a way of making that checkable rather than believed. A change that makes an
unknown look like a known is the one category of change this project treats as a defect regardless
of how good it looks.

## Before you write

1. **Name the owner.** Which API owns the object you are touching — Caravan, Tradewind, Landshark —
   or is it Payload OS spine? [`ecosystem/product-lines.json`](ecosystem/product-lines.json) is
   authoritative and `node ecosystem/product-lines.mjs` checks it.
2. **Name the plane.** Tenant read, verification, governance, or internal operator.
   [docs/API_SURFACE.md](docs/API_SURFACE.md).
3. **Name the truth class.** What is the response worth, and which of the seven classes says so?
   [`ecosystem/truth-classes.json`](ecosystem/truth-classes.json).
4. **Check the status.** Is the thing you are building on built, declared, or specified?
   [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) says which.

## Doctrines, and what checks them

| Doctrine | Document | Checked by |
| --- | --- | --- |
| Corpus — what makes a holding worth anything | [docs/CORPUS.md](docs/CORPUS.md) | `node ecosystem/corpus.mjs` |
| Security invariants | [docs/SECURITY_INVARIANTS.md](docs/SECURITY_INVARIANTS.md) | `cd control-plane && npm test` (46 named) |
| API planes and response shape | [docs/API_PLANES.md](docs/API_PLANES.md) | enforced in `json()` on the wire |
| Truth classes and the frontend boundary | [docs/API_SURFACE.md](docs/API_SURFACE.md) | `dock/test/truth.test.ts` |
| Product-line partition | [docs/PRODUCT_LINES.md](docs/PRODUCT_LINES.md) | `node ecosystem/product-lines.mjs` |
| Data platform invariants | [docs/PLATFORM.md](docs/PLATFORM.md) | `node --test platform/test/` against live PostgreSQL |
| Frontend visual contract | [docs/CONTROL_PLANE_UNIVERSE.md](docs/CONTROL_PLANE_UNIVERSE.md) | review, and the dock's own tests |
| Collection policy | [docs/COLLECTION_POLICY.md](docs/COLLECTION_POLICY.md) | `node ecosystem/validate.mjs` |

**Write the check with the claim.** A doctrine nobody can run is a preference. When you add an
invariant, add the test that refuses the way it can be broken — not the test that confirms it holds
today.

## Standing refusals

These do not bend for a deadline or a demo.

- **No secret in source control.** `node security/scan-secrets.mjs` must exit 0 — run it without a
  pipe, since a pipe masks the exit code.
- **No long-lived secret in browser storage**, and no credential returned to an LLM context unless
  explicitly designed and redacted.
- **No novel cryptography.** Vetted AEAD, and never a reused nonce.
- **No disabled TLS verification**, ever, including to get past a proxy.
- **No authorization in hidden frontend controls.** A control the user cannot see is not a control.
- **Internal is not trusted.** A component is not trustworthy because it is inside.
- **No canonical write from a derived representation.** Frontends and projections do not mutate
  authoritative state except through an explicit, validated command boundary.
- **No deletion.** The journal is append-only; `retire` is a state.

Identity classes stay separate and are never collapsed into one another: evidence, data, canonical
state, execution, user, service, agent, cryptographic, deployment, verification.

## Naming

**Caravan, Tradewind, Landshark** are the three APIs. **Payload OS** is the layer beneath them and is
not a product. `payload-*` node identifiers are legacy compatibility names — they stay in the catalog
and the journal because they are stable references, and they never appear in a customer-facing
surface as a product offer.

## Frontend work specifically

The frontend is a projection and explanation layer. It never becomes canonical state, a hidden
orchestration layer, or a privileged operations console. Read
[docs/CONTROL_PLANE_UNIVERSE.md](docs/CONTROL_PLANE_UNIVERSE.md) before designing a route, a data
view or a provenance interaction, and keep types, contracts, copy, tests and documentation in step
whenever a new product claim is exposed.

## Before you finish

Run what your change touches, and say what you ran:

```
cd control-plane && npm test
node ecosystem/validate.mjs && node ecosystem/corpus.mjs && node ecosystem/product-lines.mjs
node security/scan-secrets.mjs > /dev/null 2>&1; echo $?
cd ecosystem && npm test
cd dock && npm run check && npm test && npm run build
```

Report failures with their output. A skipped step is stated, not implied.
