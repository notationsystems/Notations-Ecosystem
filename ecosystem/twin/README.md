# The offline instance

`ecosystem/twin/` builds a single self-contained page that **is** an instance of the Notations
Control Universe, not a document about one. It opens on the estate as a sky, carries the whole
journal it was folded from, and accepts governed commands the way the plane does.

## Build

```
node ecosystem/twin/build.mjs [output.html]
```

Two steps, both reproducible:

1. `export.mjs` seeds a throwaway control plane from the committed catalog and the fabric
   manifests, on a fixed clock, exactly as `sample-snapshot.mjs` does. It then exports **both**
   the fold and the journal records the fold came from.
2. `build.mjs` embeds that data in `instance.template.html`.

The clock is fixed and the catalog is committed, so the same corpus builds the same page byte for
byte. `test/twin.test.mjs` asserts it.

## What the page is

| Surface | What it does |
| --- | --- |
| Sky | The estate as bodies on domain orbits: health as fill, weakest standing as halo, capabilities as moons, relations and fabric bindings and coordination as arcs. |
| Control tower | Exception-first: what is unobserved, stale, unavailable, failing, unsigned, unbound, awaiting a decision, and every refusal this session produced. |
| Ledger, Fabric, Posture, Journal | The registry, the nine fabric bindings and their authority, the posture attestations, and all 96 records. |
| Inspector | Every facet of one body, and six governed verbs. |
| Drafter and command bar | Compose a command, run the plane's own validation against it, and hold it. |
| Time axis | Scrub the journal. The page folds each prefix itself. |

## What it refuses

The instance is a read of a corpus, so it inherits the corpus's refusals rather than inventing new
ones:

- **Nothing dispatches.** Every accepted command is *drafted and held*. The page has no plane to
  write to, and says so on its face.
- **`register_fabric_sync` is refused on every plane** (`ACTION_OPERATOR_LOCAL`, SEC-045),
  administrators included, because binding a fabric node is an operator-local action.
- **Deletion is refused.** The journal is append-only; `retire` is a state, not an erasure.
- **Credential, key-location, topology, vulnerability-detail and offensive text are refused at the
  command boundary**, the same classes the plane refuses.

## What it publishes

A sample fold, marked `sample: true` in the data and `sample fold` on the page. It carries what the
catalog already declares in public, plus observations and posture summaries invented for the sample
and labelled `Sample:`. It carries no credential material and no private address space;
`test/twin.test.mjs` checks both against value shapes rather than vocabulary, because the catalog
legitimately *discusses* credentials everywhere.

## Checking it rather than trusting it

The page re-folds the embedded journal with its own port of the plane's fold and prints, in the top
bar, whether its fold reached the same head the plane exported. A page that quietly disagreed with
the plane would be worse than no page, so the instance states the answer instead of assuming it.
