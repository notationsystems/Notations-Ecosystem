# Notations Universe Dock

The front end of the control plane. Reads `GET /v1/snapshot` and `GET /v1/events?after=…`,
submits `POST /v1/commands` with the snapshot revision, and renders:

| Lens | Shows |
| --- | --- |
| Operator | healthy · stale · needs approval · blocked, with the observed → proposed → approved → dispatched strip |
| Security | the constellation: 11 posture dimensions, weakest-link state, coverage and severity counts, and every node that has not been attested |
| Corpus | corpus standing across the estate: role, grade, coverage, the invariants each node declares it fails and the ones it has not assessed ([docs/CORPUS.md](../docs/CORPUS.md)), and beside them where each node sits under the estate's collection policy ([docs/COLLECTION_POLICY.md](../docs/COLLECTION_POLICY.md)) |
| Api | the four planes of [docs/API_PLANES.md](../docs/API_PLANES.md): which systems are served on Tenant Read, Verification, Governance and Operator, how many of their capabilities write, how many are off every plane, and the count that must stay zero — writes reachable on a public plane |
| Solar | the digital twin: the estate as a solar system on a Kepler.gl sky with no basemap, with a time axis (scrub any journal record and the plane serves the sky as it stood, referenced at that record's hash), coordination drawn as arcs coloured by status, posture halos on attested bodies, a fidelity panel that counts what the twin has observed, attested and knows nothing about, and drift between the catalog blueprint and the live estate. As a picture: the control plane is the sun, each domain an orbit, each system a body sized by capabilities and coloured by health, each capability a moon coloured by what it may do, relations as arcs. Every verb in its palette — navigate, browse, query, add, edit, retire, observe, secure, control, mine, scan, download — is a governed command the plane already accepts or a read the dock already holds; there is no delete and nothing dispatches |
| Map | Kepler.gl: located nodes, relation arcs, and the nine Payload layers — 562 rows, each showing its own provenance and, where the rows carry it, when the value became knowable |
| Graph | force-directed capability graph, ring = health, size = capabilities |
| Ledger | every coordination record; approved ones read *approved · not dispatched* |
| Timeline | journal events (polled every 5 s) and a maturity timeline of nodes |
| Console | all six commands the plane accepts — including recording an operator review, whose signals cross the same evidence boundary the server enforces — validated client-side with the control plane's own `validation.js` |

```sh
npm install
npm run dev        # http://localhost:5173, proxies /cp → http://127.0.0.1:8787
npm run build      # typecheck + vite build (dist/)
npm test           # vitest over the model, commands, client and layer manifest
npm run screenshots # Playwright screenshots of every lens and detail view into docs/media/
                   # CONTROL_PLANE_TOKEN=… also captures the ledger against a live plane;
                   # the run fails if any image in docs/media is one it cannot reproduce
```

Connection: enter the bearer token in the rail. It is held **in memory for the page only** —
never in `sessionStorage` or `localStorage`, so a reload asks for it again — and the dock
refuses to send it anywhere but a same-origin path, loopback, or the origin this build was
configured with. Without a token
the dock shows `public/sample-snapshot.json`, generated from the catalog and labelled as a
sample. For a deployed dock set `VITE_CONTROL_PLANE_URL` and add the dock origin to
`CONTROL_PLANE_ALLOWED_ORIGINS` on the control plane.
