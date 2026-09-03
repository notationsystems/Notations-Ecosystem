# The Notations Universe

Synthesised from `ecosystem/catalog/*.json` (30 nodes, 634 capabilities, 46 relations; `node ecosystem/validate.mjs` → errors=0 warnings=12, every warning an ungraded invariant counted against its node), the control-plane contract, and the cross-cutting repository documents (Payload architecture ledger and exposure options, STE frozen specification, SCL architecture, DAQ standing plan, OCR agent README). The catalog is discovery and seed material; once seeded, the control-plane journal is authoritative.

## 1. How the ecosystem fits together

The Notations Universe is a set of verticals that each hold one canonical state, surrounded by engines that only ever *propose* changes to it, libraries that supply evidence, and docks that only render. Three verticals are real today. The **physical economy** is owned by Payload Terminal: a provenance-preserving world state for copper, aluminium and freight in which every figure carries its source, its basis and the date it became knowable, and in which an unanswerable question returns a typed refusal (`value: null`, a refusal type and a remedy) rather than a zero. Around it sit the OSIRIS intel service (entity ontology, sanctions), the Pythia oracle (forecasts as proposals), the OCR agent (documents become pending observation bundles, never truth), Payload Earth (a projection that must never become a second state), the Information Systems Archive (the off-repository mirror of the unreconstructable UN Comtrade vintages), and ATLAS as a candidate logistics-context index. The **scientific** vertical is owned by the Scientific Transformer Engine, whose single immutable `CanonicalState` is reachable only through `validate_candidate`; the Data Acquisition Channel admits external evidence into it, the Scientific Compute Layer runs computations behind a process boundary and hands back results that are explicitly *not* measurements, and the Notations Corpus Graph keeps polymer measurements traced to their signals. The **built environment** is owned by the BIM State Transformer's Gaussian belief state, fed by scan meshes and depth models from the perception-3d cluster, with LichtFeld Studio as the human workstation and Matrix-3D as an explicitly synthetic scene source. GeoAgent, gods-eye-view and the OSINT war room are upstream mirrors that perceive or render but hold nothing.

Every vertical repeats the same philosophy. **Canonical state has exactly one owner per domain, and the only door into it is validation.** Projections (globe, MCP tools, SVG, Three.js, HTTP views) flow strictly outward and never write back; simulation, forecasting and perception return through the same candidate/validation loop as everything else. **Provenance travels with the value**: Payload exports carry record ids, basis and a claim sentence; OCR fields carry verbatim text, page and character span, separate extraction-confidence and verification fields, and a temporal frame; STE versions are hash-linked with author, transaction and source; DAQ and the commerce ledger separate `retrieved_at`/`known_at` from the period described; BIM and the freight journals are hash-chained. **Refusal beats fabrication**: a missing basis, an unmapped code, a computation posing as a measurement, an identity that is "probably" the same entity, or a date the system only learned afterwards is refused by name, with the remedy attached, and the refusal itself is logged as demand evidence. The unreconstructable class of data (Comtrade revises in place and keeps no history) is archived before it is parsed, never edited by hand, and replicated off-repository. Machine traffic is served identically but segregated from the frozen human demand instruments. Nothing in the universe may become a person-intelligence tool; the terminal deleted those routes and gates every route in CI, and the forks are flagged where they still carry them.

The control plane coordinates all of this and must inherit the discipline rather than dilute it. It records intent and approval in an append-only, hash-linked journal, never holds provider credentials, never dispatches an external call, and every write carries `expectedRevision`. When reasoning engines coordinate across nodes through it, the plane must respect that **mode is the contract**: `observe` is free, `propose` is review material, and `execute` always waits for an operator, and even an approved intent stays `not_dispatched` until a separate least-privilege adapter exists. It must keep the direction of every relation honest (evidence flows *into* a canonical owner; docks visualise and never own), refuse to register a mirror, projection or forecaster as a state holder, and treat upstream mirrors as capabilities to be called, not truths to be copied. It must carry the knowledge bound through coordination: a request that spans nodes must state `asOf` and knowledge mode, must accept typed refusals as successful answers, must never coerce a null into a zero or a synthetic row (`provenance.source: synthetic:demo`) into a real one, and must expect that a computation returned from SCL or a scene from Matrix-3D is a proposal until admitted. And it must keep the journal free of what the nodes themselves refuse to hold: person data, credentials, raw request bodies and hand-edited archives.

## 2. Corpus standing

Every node is graded against the ten invariants of [docs/CORPUS.md](../docs/CORPUS.md).
Standing is declared per node in `reference.corpus` with an evidence path; the grade is
derived by `node ecosystem/corpus.mjs` and never written down. Coverage is `holds` over
applicable, where a role structurally exempts the invariants it cannot be about.

| Grade | Nodes |
|---|---|
| sound (coverage 1.0) | `control-plane`, `gods-eye-view`, `notations-dock`, `payload-ocr-agent`, `payload-render-engine`, `payload-terminal` |
| developing (0.5–0.9) | `bim-state-transformer-engine`, `data-acquisition-channel`, `information-systems-archive`, `lichtfeld-studio`, `matrix-3d`, `notations-corpus-graph`, `osiris-dashboard`, `pythia-oracle-engine`, `scientific-compute-layer`, `scientific-transformer-engine`, `trustgraph` |
| bare (< 0.5) | `atlas-mcp`, `geoagent`, `geometry-grounded-gaussian-splatting`, `lingbot-depth`, `notation-systems-web`, `osint-war-room`, `osiris-intel` |
| unbuilt (an empty repository) | `building-information-corpus`, `building-information-graph`, `network-scout-signal-miner`, `notations-archival-swarm`, `notations-energy-modulator`, `payload-corpus-graph` |
| unsound | none |

Mean coverage across graded nodes is 0.55, and twenty invariants are declared failed by
name. Eight nodes hold a corpus; three own a domain's canonical state
(`payload-terminal` → physical-economy, `scientific-transformer-engine` → scientific,
`bim-state-transformer-engine` → built-environment). Five of the eight domains —
intelligence, perception-3d, geospatial, archive, platform — have no declared owner, and
`node ecosystem/corpus.mjs` reports that, because an unowned domain is where a second
owner appears unannounced.

What the grading makes visible that prose did not:

- **Knowledge time is a physical-economy property, not an estate property.** `payload-terminal`
  answers `asOf` with `knowledge=best_known|as_known_then`; both other canonical-state
  owners declare COR-004 failed. STE orders versions by hash lineage and excludes
  timestamps from identity; GAT treats evidence age as causal order. In those two
  verticals "what did we know last Tuesday" has no answer, and that is a design decision
  neither repository states as a limitation.
- **The archive of unreconstructable data is not integrity-bound.** `information-systems-archive`
  holds the only copy of Comtrade vintages that cannot be refetched, indexes every file
  by sha256 — and declares COR-008 failed, because the manifest itself is neither
  hash-linked nor signed. A consistent rewrite of files and manifest together would not
  be detectable.
- **The person-data problem is now a grade, not a paragraph.** `osiris-intel` (0.29) and
  `osiris-dashboard` both declare COR-010 failed by name: they state a refusal to become
  person-profiling services and still serve the routes.
- **Six planned repositories are graded `unbuilt` rather than omitted**, so the distance
  between the intended estate and the built one is a number.
- **The physical economy has two commitment records.** `data-acquisition-channel` declares
  COR-002 failed: `commerce/` holds the Notation Physical Commerce ledger, whose
  `commerce.tender.issue` is "the single function that binds the firm to a counterparty"
  and whose `commerce.outbound.send` is the wire boundary, inside a node whose declared
  domain is scientific and in a domain `payload-terminal` declares it owns. It is parked
  there while Sea Dog Terminal is frozen. The declaration was originally `exempt`,
  argued entirely about the scientific vertical, and the exemption concealed the
  violation — which is why the doctrine now requires an exemption to account for every
  holding a node names.

## 3. Domains

| Domain | Member node ids |
|---|---|
| physical-economy | `payload-terminal`, `payload-render-engine`, `payload-ocr-agent`, `payload-corpus-graph`, `atlas-mcp` |
| intelligence | `osiris-intel`, `osiris-dashboard`, `pythia-oracle-engine`, `osint-war-room`, `network-scout-signal-miner` |
| scientific | `scientific-transformer-engine`, `scientific-compute-layer`, `data-acquisition-channel`, `notations-corpus-graph` |
| built-environment | `bim-state-transformer-engine`, `building-information-corpus`, `building-information-graph` |
| perception-3d | `geometry-grounded-gaussian-splatting`, `lichtfeld-studio`, `lingbot-depth`, `matrix-3d` |
| geospatial | `geoagent`, `gods-eye-view` |
| archive | `information-systems-archive`, `notations-archival-swarm`, `notations-energy-modulator`, `trustgraph` |
| platform | `control-plane`, `notations-dock`, `notation-systems-web` |

Canonical-state owners: `payload-terminal` (physical economy), `scientific-transformer-engine` (scientific), `bim-state-transformer-engine` (built environment), `control-plane` (the coordination journal itself). Every other node observes, proposes, supplies evidence or renders.

## 4. Relations

Confidence: **confirmed** = an import, call, contract file, docker-compose entry or restore path names the other side; **inferred** = documented intent, naming, shared formats or bytecode strings, no call path; **planned** = at least one end is an empty repository. Relation ids are `<source>--<kind>--<target>`.

| Source | Kind | Target | Confidence |
|---|---|---|---|
| atlas-mcp | supplies_context_to | payload-terminal | inferred (domain only; no file references the other) |
| bim-state-transformer-engine | depends_on | building-information-corpus | inferred (kind is aspirational; GAT runs on demo IFC today) |
| building-information-corpus | supplies_context_to | bim-state-transformer-engine | planned |
| building-information-graph | depends_on | building-information-corpus | planned |
| control-plane | governs | notations-dock | confirmed (OpenAPI + validation.js consumed by dock/src) |
| data-acquisition-channel | depends_on | scientific-transformer-engine | confirmed (vendored submodule, `daf/_vendor.py`) |
| data-acquisition-channel | supplies_context_to | scientific-transformer-engine | confirmed (SCOUT admission into EvidencePool) |
| data-acquisition-channel | supplies_context_to | scientific-compute-layer | confirmed (content-addressed exchange artifacts, joint decision) |
| data-acquisition-channel | supplies_context_to | payload-terminal | inferred (commerce/ hosted while Sea Dog Terminal is frozen) |
| geoagent | supplies_context_to | payload-render-engine | inferred (render engine cites the "GeoAgent pattern"; no call) |
| geometry-grounded-gaussian-splatting | supplies_context_to | bim-state-transformer-engine | confirmed on the consumer side (`gat/geometry/scan_io.py` names recon_post.ply) |
| geometry-grounded-gaussian-splatting | supplies_context_to | lichtfeld-studio | inferred (3DGS PLY format via ply2gs.py) |
| information-systems-archive | supplies_context_to | payload-terminal | confirmed (documented restore path, executed once) |
| information-systems-archive | depends_on | payload-terminal | inferred (manifest and captures produced by terminal tooling) |
| lichtfeld-studio | visualizes | geometry-grounded-gaussian-splatting | inferred (format) |
| lichtfeld-studio | visualizes | matrix-3d | inferred (format) |
| lingbot-depth | supplies_context_to | bim-state-transformer-engine | inferred (PLY point clouds as scan evidence) |
| matrix-3d | supplies_context_to | lichtfeld-studio | inferred (format; synthetic scenes) |
| network-scout-signal-miner | supplies_context_to | osiris-intel | planned |
| notation-systems-web | visualizes | control-plane | planned (public CMS catalogue not built) |
| notations-archival-swarm | supplies_context_to | information-systems-archive | planned |
| notations-dock | visualizes | control-plane | confirmed (`dock/src/api/controlPlane.ts`) |
| notations-dock | depends_on | control-plane | confirmed |
| notations-energy-modulator | governs | notations-archival-swarm | planned |
| osiris-dashboard | depends_on | osiris-intel | confirmed (`/api/entity/expand` proxy, docker-compose) |
| osiris-dashboard | supplies_context_to | pythia-oracle-engine | inferred (bytecode + runs/ledger.jsonl in the dashboard repo) |
| osiris-intel | supplies_context_to | payload-terminal | confirmed (`GET /resolve` at INTEL_URL) |
| payload-corpus-graph | supplies_context_to | payload-terminal | planned |
| payload-ocr-agent | supplies_context_to | payload-terminal | inferred (EvidenceSink port; terminal has `ocrCandidateInbox.ts`; no wire) |
| payload-ocr-agent | supplies_context_to | payload-corpus-graph | planned |
| payload-render-engine | visualizes | payload-terminal | inferred (docs: "two surfaces, one state"; SyntheticProvider only) |
| payload-render-engine | depends_on | payload-terminal | inferred (`payload:canonical` / `payload:spatial` DataSource reserved) |
| payload-terminal | depends_on | osiris-intel | confirmed (`/api/entity/expand`, docker-compose) |
| payload-terminal | supplies_context_to | pythia-oracle-engine | confirmed by bytecode strings only |
| payload-terminal | supplies_context_to | information-systems-archive | inferred (docs; S-2 shipping order) |
| payload-terminal | governs | payload-ocr-agent | inferred (intake contract in `ocrCandidateInbox.ts`) |
| pythia-oracle-engine | depends_on | payload-terminal | confirmed by bytecode strings (many target routes now 503) |
| pythia-oracle-engine | depends_on | osiris-dashboard | inferred (identical bytecode and ledger in the ancestor repo) |
| scientific-compute-layer | supplies_context_to | scientific-transformer-engine | confirmed (`scl.ste_adapter` at the dispatcher seam) |
| scientific-compute-layer | depends_on | scientific-transformer-engine | confirmed (integrated configuration only; standalone has none) |
| scientific-compute-layer | supplies_context_to | data-acquisition-channel | inferred (exchange artifacts; no call path) |
| scientific-transformer-engine | governs | scientific-compute-layer | confirmed (core@1.0.0, derived invariant register) |
| scientific-transformer-engine | depends_on | scientific-compute-layer | confirmed (register derivation binds a local SCL clone) |
| scientific-transformer-engine | governs | data-acquisition-channel | confirmed (STE-side files; DAQ side inferred) |
| scientific-transformer-engine | depends_on | data-acquisition-channel | confirmed (register derivation; data flow inferred) |
| trustgraph | supplies_context_to | notations-corpus-graph | inferred (purpose only; neither references the other) |

Relations added or changed in this pass (4): `control-plane--governs--notations-dock` (new, confirmed), `pythia-oracle-engine--depends_on--osiris-dashboard` (new, inferred), `payload-ocr-agent--supplies_context_to--payload-corpus-graph` (new, planned), `geoagent--supplies_context_to--payload-render-engine` (description and evidence corrected: the render engine does cite GeoAgent in `src/app/toolSurface.ts` and `docs/ARCHITECTURE.md`).

Lineages deliberately **not** modelled as relations (they are code ancestry or design studies, not data, control or contract flows): `osiris-dashboard` is the structural ancestor of `payload-terminal` (same `intel/`, `engine/`, `src/` layout); the Payload ledger records OSINT-War-Room as a curated study whose coalescing and degradation-ladder patterns were adapted into the terminal's route layer.

## 5. Located nodes

| Node id | Longitude, latitude | Label |
|---|---|---|
| `payload-terminal` | 103.85, 1.29 | Port of Singapore (representative anchor; the terminal models global freight and no home port is named in the docs) |
| `payload-render-engine` | 121.65, 31.34 | Port of Shanghai (highest-importance node in the dataset) |
| `information-systems-archive` | -70.4, -23.65 | Antofagasta, Chile (representative: Comtrade reporter 152 copper captures) |
| `data-acquisition-channel` | -79.3832, 43.6532 | Toronto, ON (measured Toronto–Montreal truck lane; CanadaBuys federal tenders; NOAA station 8454000 Providence RI is the scientific anchor) |
| `notation-systems-web` | 106.7009, 10.7769 | Ho Chi Minh City |
| `osint-war-room` | 30.5234, 50.4501 | Kyiv (Ukraine air-raid alarm focus and default region preset) |
| `gods-eye-view` | -97.7431, 30.2672 | Austin, TX (default CCTV mesh and first-run missions) |

The other 23 nodes are unlocated: they are either services without a native geography (control plane, STE, SCL, BIM, corpus graphs, intel), upstream mirrors, or empty repositories. Location labels are catalog-only and stripped before seeding.

## 6. Flows worth a map layer

Spatial and temporal datasets inside the world models and feed nodes, with where the data lives. `real` follows the per-row provenance discipline of `ecosystem/payload/layers.json`: a layer is only real when every row names a capture or a verified manifest entry.

| Flow / dataset | Geometry · time | Where the data lives | Real? |
|---|---|---|---|
| Payload Earth facilities (ports, airports, rail terminals, warehouses, mines, refineries, cities) | 106 WGS84 points; sim clock 2026-08-17 → 2026-09-14, `known_at` per row | `Payload-Render-Engine/src/data/synthetic/world.ts` → `ecosystem/payload/layers/earth-facilities.json` (via `extract-earth.mjs`) | No — `synthetic:demo` |
| Payload Earth chokepoints and standing constraints | 8 points with constraint severity | same source → `layers/earth-chokepoints.json` | No |
| Payload Earth routes (road / rail / maritime / air) | 55 lon/lat LineStrings, `geometry_basis` per row, utilization | same source → `layers/earth-routes.json` | No |
| Payload Earth commodity flows and disruption events | 14 arcs over route chains; 9 timed events (`start`/`end`) | same source → `layers/earth-flows.json`, `layers/earth-events.json` | No |
| UN Comtrade copper-ore flows (HS 2603) | 88 reporter→partner arcs (Chile, Peru, Indonesia; 2017/2019/2020/2022), value and net weight, `captured_at` | `Payload-Terminal-V0/data-archive/comtrade/2026-08-27/` (+ test-run captures dated 2026-08-31), `src/data/economy/snapshots/comtrade-*.json`; mirrored in `Information-Systems-Archive/sea-dog-terminal/data-archive/comtrade/`; extracted to `layers/comtrade-flows.json` | Yes — unreconstructable vintage |
| Archive coverage by reporter | 5 reporter centroids, capture counts, first/last capture | `Payload-Terminal-V0/data-archive/MANIFEST.json` (sha256-verified) → `layers/archive-coverage.json` | Yes |
| Payload economy map (mines, smelters, refineries, ports, great-circle material flows, disruption flags) | points + arcs; `asOf` and `knowledge=best_known\|as_known_then` playback | `GET /api/economy?view=map` and `view=timeline`; snapshots under `src/data/economy/snapshots/` (USGS MCS, Comtrade, CFTC, Westmetall, curated flow topology) | Yes, with refusals where basis is missing |
| Submarine cables (long-haul subset) | 220 LineStrings | `Payload-Terminal-V0/public/data/submarine-cables-filtered.json` → `layers/submarine-cables.json`; TeleGeography copy also bundled in `gods-eye-view/src/data/telegeographySubmarineCables.js` (CC BY-NC-SA) | Yes (licence-constrained) |
| Nuclear power facilities | 57 points with reactors and MW | Payload Terminal `/api/infrastructure` curated list → `layers/nuclear-facilities.json` | Yes |
| Payload Terminal live feeds (AIS vessels, NASA EONET / NOAA NWS / GDACS / OpenAQ weather and hazards, markets, signals) | live points; polled, not archived | `/api/feeds/*` routes in `Payload-Terminal-V0/src/app/api`; aisstream.io, eonet.gsfc.nasa.gov, api.weather.gov, gdacs.org, api.openaq.org | Live, uncached beyond process memory |
| Freight lanes, loads, carrier events | origin/destination lanes; `occurredAt`/`knownAt`/`recordedAt` | `PAYLOAD_OPERATIONS_LOG`, `PAYLOAD_CARRIER_COMMUNICATIONS_LOG` (hash-chained JSONL, sensitive, not in git) | Yes, but commercial — needs a policy before any map layer |
| Notation Physical Commerce lanes and tenders | facilities, Toronto–Montreal measured truck lane, CanadaBuys tender locations | `Data-Acquisition-Channel/commerce/` (`commerce/fixtures/`, `$COMMERCE_LEDGER`); mileage in `commerce/mileage.py` | Fixtures real; ledger empty until Phase 0 |
| Scientific anchors (NOAA station 8454000 water levels, USGS earthquake events) | station point / event coordinates; `retrieved_at` vs `known_at` | `Data-Acquisition-Channel/tests/fixtures/noaa_live_8454000_*.json`; per-run evidence pools under `<root>/evidence` | Yes (fixture) / live |
| gods-eye-view live layers (flights, military flights, vessels, satellites, earthquakes, traffic, CCTV, radio, bikeshare, fires, launches, military installations) | whole-Earth points; polled every 15–30 s, 24 h / 30 d trails | Vite `/api/*` middlewares in `gods-eye-view/`; bundled datacenters/dams/cables in `src/data/localLayers.js`, `localGeojson.js`; CCTV poses in `config/cctv_sources.*.json` | Live or bundled; freshness labelled live/delayed/simulated/unavailable |
| OSINT war room feeds (GDELT conflict events, Ukraine air-raid alarms, OSM military bases, OpenSky aircraft, AIS vessels, CISA KEV) | regional point layers; Telegram 15 s, GDELT 15 min, bases 6 h | `OSINT-War-Room/backend/` routers; `backend/database.json` holds the last 200 alerts | Live; no history |
| OSIRIS dashboard feeds (aircraft, maritime, 17k cameras, hazards, GDELT/GDACS, Sentinel-1 scenes, cyber) | global point layers on a MapLibre globe | ~70 routes under `osiris-palantir-dashboard/src/app/api`; nothing archived | Live |
| Entity ontology geolocations | ip-api city lat/lon on GEOLOCATED nodes; country nodes | `Payload-Terminal-V0/intel/server.js` in-memory index and LRU cache | Live, incidental |
| Pythia forecasts | approximate lat/lng + location string per forecast; horizons 24h/week/month/year | `Payload-Terminal-V0/runs/ledger.jsonl` and `osiris-palantir-dashboard/runs/ledger.jsonl` (9 records, July 2026) | Proposals, not state |
| ATLAS shipments and tracking events | ISO country / city on origin, destination and lanes; lat/lon on tracking events; ETD/ETA windows | `ATLASUniversal-MCP-server-for-logistics./seed/` (synthetic) and `./atlas.db` (operator data, never leaves the perimeter) | Seed synthetic |
| Earth-observation searches | STAC / NASA Earthdata bounding boxes and date ranges | `GeoAgent-MultiModal-AI/geoagent/tools/*` (on demand; nothing stored) | Live, on request |

## 7. Open questions and gaps

Graph shape
- `gods-eye-view` and `osint-war-room` have no relations; they render only external feeds. They stay isolated on the map until a first-party node consumes their feed catalogues or layer designs.
- `notations-corpus-graph` has no consumer and its only supplier is an upstream mirror (`trustgraph`, inferred). Does DAQ's evidence pool ever feed `ncg ingest`, and does STE's materials layer read the corpus?
- `bim-state-transformer-engine--depends_on--building-information-corpus` overstates the kind: GAT runs on demo IFC today. Reconsider once the corpus has content.
- Code ancestry (`osiris-dashboard` → `payload-terminal`, OSINT-War-Room design study) is not expressible with the five relation kinds; it is recorded here, not in the journal.
- `scientific-transformer-engine.evidence.trust_graph.build` vs the `trustgraph` node is a naming collision, not a relation.

Identity and naming
- Is Sea Dog Terminal (frozen at `5a6def1`) exactly `Payload-Terminal-V0`? The archive README names Sea-Dog-OSIRIS-Terminal-V0; the terminal's health route exposes a `seaDogTerminal` block; DAQ's `commerce/` is parked pending that freeze.
- The acquisition layer is `data-acquisition-channel` here, `notations-acquisition-channel` in STE and `data-acquisition-channel-daq` in SCL docs.
- The Pythia engine exists only as CPython 3.14 bytecode in two repositories; its source home and intended world source (dashboard or terminal) are unknown, and 20+ intake routes now answer 503.
- ATLAS README claims 35 MCP tools; the code registers 21 (12 over HTTP/SSE).

Wiring not yet built
- No Payload Spatial API client implements `SpatialDataProvider`; Payload Earth renders only `synthetic:demo`.
- No EvidenceSink adapter exists over a real EvidencePool; the OCR agent has no HTTP/MCP wrapper and the terminal's intake is a contract, not a route.
- The control plane has no execution adapters; every approved intent stays `not_dispatched`. LichtFeld's MCP (localhost, unauthenticated, `editor.run` is arbitrary code) and GeoAgent (no MCP at this commit) need a gated bridge before any coordination.
- Flow vintages (several Comtrade periods coexisting under `asOf`) are blocked on the country↔facility allocation model, not on acquisition.

Operations, exposure and durability
- Payload exposure is decided as internal, stdio-only MCP: authentication, telemetry counting of machine traffic and licensing for machine consumers (Westmetall republish) are undecided by design (EXPOSURE_OPTIONS.md).
- The data archive is replicated GitHub-to-GitHub, not backed up off-provider; only one capture day (2026-08-27) is mirrored; the test suite has been observed writing new Comtrade captures (2026-08-31); five captures are 11-byte empty bodies of unknown meaning.
- DAQ Phase 0 (one real transaction) is undischarged; QCMobile, ORS, load-board terms, AIS and LME are blocked on a person.
- The SCL CUDA backend has never executed on a GPU; STE's EvidencePool, VersionStore and OperationTrace are in-memory only.

Corpus ownership
- Where does the Notation Physical Commerce ledger belong once Sea Dog Terminal unfreezes:
  into `payload-terminal` as part of the physical-economy canonical state, or into a node
  of its own that owns freight commitments? Until it moves, COR-002 does not hold for the
  physical economy.
- Five domains have no declared canonical-state owner. `intelligence` and `geospatial`
  contain only mirrors and projections, which may be the right answer; `archive` and
  `perception-3d` each contain a node that holds material (`information-systems-archive`,
  `geometry-grounded-gaussian-splatting`) without claiming to own the domain's state.
  `platform` is owned by nothing because the coordination journal is not a domain state.

Provenance of the estate itself
- Two mirrors record `license: "unrecorded"` — `geometry-grounded-gaussian-splatting`
  (HKUST-SAIL) and `matrix-3d` (SkyworkAI). Both are research code with no licence
  recorded in this catalog; until someone reads the upstream repositories, what may be
  done with those mirrors is unknown, and the catalog now says so rather than leaving the
  field absent.
- `metadata.upstream` (a copy, carrying the upstream's licence) is now distinct from
  `metadata.derived_from` (ancestry, carrying none). Ten mirrors, five descendants.

Policy
- The universe-level collection policy is now declared once, in
  [docs/COLLECTION_POLICY.md](../docs/COLLECTION_POLICY.md), and every node states where
  it sits: 18 refused, 10 incidental, 2 serving. The two that serve —
  `osiris-intel` (`intel.resolve.person`, RIPE abuse contacts as person nodes) and
  `osiris-dashboard` (the full upstream username/phone/leaks surface) — carry a declared
  exception naming what would end it, and both are recorded as COR-010 failures.
  `osiris-intel` is the sharper case: Payload Terminal gates person routes in its own CI
  and then forwards `type=person` to it, so the gate is routed around by its dependency.
- `osint-war-room` hardcodes an AIS key and pins scraping libraries no route uses.
- Licence constraints on map layers: OpenSky (non-commercial), TeleGeography cables (CC BY-NC-SA), Westmetall (republisher scrape, licensed LME feed is the remedy), CanadaBuys (ca-ogl-lgo).
- Freight paperwork is sent to Mistral in live OCR mode; no platform-level data-handling policy is recorded.
- Where is the dock hosted, which origin goes into `CONTROL_PLANE_ALLOWED_ORIGINS`, and should the control plane publish a public catalogue into the Webflow CMS?
