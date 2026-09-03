# Ecosystem catalog format

`ecosystem/catalog/<nodeId>.json` — one file per node of the Notations Universe. The catalog is
the *discovered* description of the ecosystem's APIs, world models, libraries, reasoning engines
and docks. `ecosystem/seed.mjs` turns it into control-plane commands (`register_node`,
`declare_relation`) and the dock can layer its `reference` block over the live snapshot. Once
seeded, the control plane journal (`control-plane/`) is authoritative; the catalog is
documentation and seed material, never an execution authority.

Every constraint below mirrors `control-plane/src/validation.js`; `node ecosystem/validate.mjs`
runs the real validator over every file.

## Node

```json
{
  "nodeId": "payload-terminal",
  "name": "Payload Terminal V0",
  "kind": "api",
  "description": "2–6 sentences: what it is, what role it plays in the ecosystem, what it must never become. ≤ 1200 chars.",
  "capabilities": [
    {
      "capabilityId": "economy.entity.read",
      "label": "Read an economy entity",
      "description": "≤ 600 chars. What it returns / does.",
      "mode": "observe",
      "approval": "automatic",
      "surface": "http",
      "method": "GET",
      "path": "/api/economy/entity",
      "evidence": "src/app/api/economy/entity/route.ts"
    }
  ],
  "metadata": {
    "repo": "notationsystems/Payload-Terminal-V0",
    "domain": "physical-economy",
    "maturity": "v0",
    "language": "TypeScript",
    "framework": "Next.js 16",
    "exposure": "docker",
    "upstream": "",
    "visibility": "public",
    "last_pushed_at": "2026-09-03T01:18:22Z",
    "capability_count": 12
  },
  "location": { "longitude": 103.85, "latitude": 1.29, "label": "Port of Singapore" },
  "relations": [
    {
      "relationId": "payload-terminal--depends_on--osiris-intel",
      "targetNodeId": "osiris-intel",
      "kind": "depends_on",
      "description": "≤ 600 chars. Why, with the direction made explicit.",
      "evidence": "intel/server.js; src/lib/... (repo-relative paths)"
    }
  ],
  "reference": {
    "runtime": { "entrypoints": [], "run": [], "ports": [], "container": false },
    "contracts": [{ "name": "", "path": "", "summary": "" }],
    "resources": [{ "name": "", "classification": "public|internal|sensitive", "durability": "reconstructable|refetchable_at_risk|unreconstructable", "path": "", "description": "" }],
    "external_services": [{ "name": "", "domain": "", "purpose": "", "auth": "" }],
    "environment": [{ "name": "NAMES_ONLY", "kind": "credential|configuration", "purpose": "", "client_exposed": true, "unused": "" }],
    "health": { "method": "http|cli|manifest-only|none", "endpoint": "/api/health" },
    "spatial": "one sentence on what geography the system natively carries",
    "temporal": "one sentence on what time dimension it carries",
    "open_questions": [],
    "corpus": {
      "role": "hold|feed|transform|project|coordinate",
      "holding": "One sentence naming the body of material and its extent, or what it holds instead of one.",
      "owner_of": ["physical-economy"],
      "standing": {
        "COR-003": { "standing": "holds",  "evidence": "src/lib/economy/basis.ts", "note": "every figure carries source, basis and known_at" },
        "COR-007": { "standing": "fails",  "note": "captures are parsed on the wire; no manifest yet" },
        "COR-009": { "standing": "exempt", "note": "holds no state to write back to" }
      }
    }
  }
}
```

### Rules (enforced)

- `nodeId`, `capabilityId`, `relationId`: `^[A-Za-z0-9][A-Za-z0-9:_./-]{0,179}$`. Use kebab-case node ids and dotted capability ids (`world.read`, `sdk.ingest`).
- `name` ≤ 160 chars; `description` 1–1200 chars; capability `label` ≤ 120; capability `description` ≤ 600.
- `kind` ∈ `api` · `world_model` · `information_library` · `reasoning_engine` · `visual_dock` · `operator_surface`.
- 1–100 capabilities, unique ids. `mode` ∈ `observe` · `propose` · `execute`; `approval` ∈ `automatic` · `operator`; **`execute` requires `operator`**.
- `metadata`: flat strings (≤ 500 chars) / finite numbers / booleans; keys `^[a-z][a-z0-9_.-]{0,80}$`; keys may never contain `token secret password credential authorization cookie email phone contact`.
- `location`: `null` or `{ longitude, latitude }` (a `label` is allowed in the catalog and stripped before seeding).
- `relations[].kind` ∈ `supplies_context_to` · `coordinates` · `visualizes` · `governs` · `depends_on`; `targetNodeId` should be another catalog node.
- `surface` and `data_domain` are **closed vocabularies**, declared in [`surfaces.json`](surfaces.json) (19 surfaces) and [`data-domains.json`](data-domains.json) (77 subjects). Each records every spelling it has been written as, and the validator refuses both an unknown value and a recorded alias, naming the canonical one. Left open they produced 28 spellings for 19 surfaces and 84 for 77 subjects; systems that name the same thing differently cannot be queried across.
- `surface`, `method`, `path`, `evidence`, `side_effects`, `cost`, `latency`, `provenance`, `data_domain` and `workflow` on capabilities, and the whole `reference` block, are catalog-only: they never enter the control plane. `cost` is a short hint ("free", "rate-limited 60/min", "GPU minutes"); `latency` a typical figure ("~200 ms", "minutes"); `provenance` where the capability's answers come from ("UN Comtrade capture 2026-08-27", "synthetic:demo", "OpenSanctions bulk CSV"); `data_domain` the data domain it touches (e.g. `trade-flows`, `carrier-identity`, `sanctions`); `workflow` the operator workflow it belongs to (e.g. `daily-chain`, `deploy`).
- `reference` may also carry `workflows` (`[{ id, name, steps: [string], doc_path }]`) and `layers` (`[{ id, name, geometry, source, provenance }]`) for systems that are modelled deeply. External data sources go in `external_services` (`[{ name, domain, purpose, auth }]`), which 21 nodes use for 112 services; there is no separate `data_sources` field, because one system's sources described two ways is the incoherence this catalog exists to remove.
- `metadata.person_data` is **required**, one of `refused` · `incidental` · `serves` ([COLLECTION_POLICY.md](../docs/COLLECTION_POLICY.md)). A first-party node declaring `serves` must also declare `metadata.person_data_exception` saying what it serves and what would end it — an exception is a sentence someone wrote, not a route someone finds.
- `reference.environment` is **required** (it may be empty): every environment variable a node reads, each with a `kind` and a `purpose`. `kind` is `credential` (reading it creates or uses a standing grant) or `configuration` (a path, port, URL, region, model name, timeout). A variable whose *name* reads as a credential — ending in `_KEY`, `_TOKEN`, `_SECRET`, `_PASSWORD`, `_CREDENTIAL`, or containing `PASSWORD`/`SECRET` — may not be declared `configuration`; rename it or admit what it is. `client_exposed: true` marks a credential that reaches the browser by design, and its `purpose` must then name what constrains it (origin or referrer restriction, scope, metering, quota), because secrecy no longer can. `unused` is a sentence saying why a variable is still named when nothing consumes it. Entries carry names only: any field outside `name`, `kind`, `purpose`, `client_exposed`, `unused` is refused, so a value can never arrive by accident in a public file.

  The field replaced `secrets_env`, a flat list of ninety names that put a TCP port, a filesystem path, an AWS region and a mailbox password in one word. `validate.mjs` now reports the estate's credential surface on every run — variables, credentials, client-exposed, and the ones nothing consumes.

- `reference.corpus` is **required**: every node is graded against [docs/CORPUS.md](../docs/CORPUS.md), including one that holds nothing. `role` is one of `hold`, `feed`, `transform`, `project`, `coordinate`; `holding` names the body of material and its extent; `owner_of` lists the domains whose canonical state this node owns and may only be non-empty for a `hold`. `standing` is keyed by invariant id (`COR-001`…`COR-010`) with one of four values:
  - `holds` — requires an `evidence` path, exactly as a capability does;
  - `fails` — legal, expected, and never a validation error. A catalog that could not record a failure would record only flattery;
  - `exempt` — requires a `note` giving a *structural* reason. "Not implemented yet" is refused and must be declared `fails`;
  - `unknown` — the default for anything undeclared, and it counts against the node.

  The grade is derived by `ecosystem/corpus.mjs` and never written down. `role`, `grade` and `coverage` cross into the journal as `metadata.corpus_*`; the declaration and its evidence paths do not.

### Meaning of the enums

- **kind** — `api`: a service exposing HTTP/MCP surfaces others call. `world_model`: an engine that holds or renders a state of the world (canonical state, simulation, globe, BIM belief). `information_library`: archives, corpora, graphs, datasets, knowledge platforms. `reasoning_engine`: agents and models that perceive, plan or infer (OCR agent, geospatial agent, scouts, depth models). `visual_dock`: viewers and dashboards that only render. `operator_surface`: terminals where a human operates and approves.
- **mode** — `observe`: read-only queries and views. `propose`: produces plans, scenarios, validations or observations for review without changing canonical state. `execute`: writes canonical state, ingests, publishes, sends, spends, triggers compute or external side effects → `approval: operator`.
- **relation kind** (source → target) — `supplies_context_to`: evidence/data/context flows from source into target. `coordinates`: source orchestrates or calls target. `visualizes`: source renders target's state. `governs`: source defines policy or contract that target follows. `depends_on`: source needs target to function.
- **metadata.domain** ∈ `physical-economy` · `intelligence` · `scientific` · `built-environment` · `perception-3d` · `geospatial` · `archive` · `platform`.
- **metadata.maturity** ∈ `empty` · `prototype` · `v0` · `active` · `archived` · `upstream-mirror` · `external`.
- **`upstream` and `derived_from` are different relationships.** `upstream` means "this repository is a copy of X": ongoing, and it carries X's licence, so an `upstream-mirror` must name both and may say `license: "unrecorded"` to make the gap visible rather than absent. `derived_from` means "this descends from X": ancestry, one-time, no continuing obligation. They were one field, and five first-party forks recorded the second under the first, so a reader could not tell a mirror from a descendant. A node is one or the other, never both, and the validator refuses the confusion.
- **corpus role** (function in the program, as against `kind`, which is shape) — `hold`: owns a corpus or a canonical state. `feed`: supplies evidence into someone else's corpus. `transform`: computes over a corpus and returns proposals, never measurements. `project`: renders a corpus it does not own. `coordinate`: records what exists and what was agreed between corpora. The two are orthogonal, and where they disagree the disagreement is the point: `payload-render-engine` is a `world_model` that must only `project`.
- **`cost` and `latency` are measurements.** A system that refuses to turn an unknown figure into a zero cannot annotate its own capabilities with invented ones. State the basis where one exists (`~3.7 ms native at N=2000`, `measured in docs/incremental-propagation-v1.md`); leave the field absent where it does not.
