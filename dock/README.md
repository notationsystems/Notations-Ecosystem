# Notations Universe Dock

The front end of the control plane. Reads `GET /v1/snapshot` and `GET /v1/events?after=…`,
submits `POST /v1/commands` with the snapshot revision, and renders:

| Lens | Shows |
| --- | --- |
| Operator | healthy · stale · needs approval · blocked, with the observed → proposed → approved → dispatched strip |
| Map | Kepler.gl: located nodes, relation arcs, and the Payload layers (facilities, corridors, chokepoints, flows, disruptions, coverage) |
| Graph | force-directed capability graph, ring = health, size = capabilities |
| Ledger | every coordination record; approved ones read *approved · not dispatched* |
| Timeline | journal events (polled every 5 s) and a maturity timeline of nodes |
| Console | the five commands, validated client-side with the control plane's own `validation.js` |

```sh
npm install
npm run dev        # http://localhost:5173, proxies /cp → http://127.0.0.1:8787
npm run build      # typecheck + vite build (dist/)
npm test           # vitest over the model, commands, client and layer manifest
npm run screenshots # Playwright screenshots of every lens into docs/media/
```

Connection: enter the bearer token in the rail (kept in sessionStorage only). Without a token
the dock shows `public/sample-snapshot.json`, generated from the catalog and labelled as a
sample. For a deployed dock set `VITE_CONTROL_PLANE_URL` and add the dock origin to
`CONTROL_PLANE_ALLOWED_ORIGINS` on the control plane.
