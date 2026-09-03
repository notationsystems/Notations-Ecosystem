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

`payload/` is the Payload adapter: health probe, layer extractors, the layer manifest and the
one row-provenance shape every extracted row uses.

Two closed vocabularies keep the catalog queryable across systems: `surfaces.json` (how a
capability is reached) and `data-domains.json` (what subject it touches). Both record every
spelling they have been written as, and `validate.mjs` refuses an alias by naming the
canonical form. The distinct set per node crosses into the journal as `metadata.surfaces`
and `metadata.data_domains`, so the dock's search answers "which systems are reachable
over MCP?" from a snapshot alone — a vocabulary nothing can be searched by is one that
only validates. `corpus.mjs` grades every node against [docs/CORPUS.md](../docs/CORPUS.md)
and reports how much of each grade is verified here, taken on trust from another
repository, or merely declared in this catalog.
