# Ecosystem catalog

`catalog/*.json` describes every node of the Notations Universe in the control plane's node
model (see `CATALOG_FORMAT.md`). `UNIVERSE.md` is the prose account and relation table.

```sh
node validate.mjs                                        # the control plane's own validator over every node
node seed.mjs --journal ../control-plane/data/control-plane.jsonl   # register nodes + relations (idempotent)
node seed.mjs --url http://127.0.0.1:8787 --token "$NOTATIONS_CONTROL_PLANE_TOKEN"
node sample-snapshot.mjs                                 # dock/public/sample-snapshot.json for offline rendering
npm test
```

`payload/` is the Payload adapter: health probe, layer extractors and the layer manifest.
