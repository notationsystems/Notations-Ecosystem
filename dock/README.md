# Notations Universe Dock

The front end of the control plane. Reads `GET /v1/snapshot` and `GET /v1/events?after=…`,
submits `POST /v1/commands` with the snapshot revision, and renders:

| Lens | Shows |
| --- | --- |
| Operator | healthy · stale · needs approval · blocked, with the observed → proposed → approved → dispatched strip |
| Security | the constellation: 11 posture dimensions, weakest-link state, coverage and severity counts, and every node that has not been attested |
| Corpus | corpus standing across the estate: role, grade, coverage, the invariants each node declares it fails and the ones it has not assessed ([docs/CORPUS.md](../docs/CORPUS.md)) |
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
npm run screenshots # Playwright screenshots of every lens into docs/media/
```

Connection: enter the bearer token in the rail. It is held **in memory for the page only** —
never in `sessionStorage` or `localStorage`, so a reload asks for it again — and the dock
refuses to send it anywhere but a same-origin path, loopback, or the origin this build was
configured with. Without a token
the dock shows `public/sample-snapshot.json`, generated from the catalog and labelled as a
sample. For a deployed dock set `VITE_CONTROL_PLANE_URL` and add the dock origin to
`CONTROL_PLANE_ALLOWED_ORIGINS` on the control plane.
