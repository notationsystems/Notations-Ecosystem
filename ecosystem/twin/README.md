# The offline instance

`ecosystem/twin/` builds a single self-contained page that **is** an instance of the Notations
Control Universe, not a document about one. It opens on the estate as a sky, carries the whole
journal it was folded from, and accepts governed commands the way the plane does.

## Build

```
node ecosystem/twin/build.mjs [output.html]
```

Two steps, both reproducible:

The page loads deck.gl from `cdn.jsdelivr.net`, the one script host it is allowed to reach. If that
load fails, the sky says so and refuses to draw a system it cannot compute; every other lens reads
the same embedded fold and is unaffected.

1. `export.mjs` seeds a throwaway control plane from the committed catalog and the fabric
   manifests, on a fixed clock, exactly as `sample-snapshot.mjs` does. It then exports **both**
   the fold and the journal records the fold came from.
2. `build.mjs` embeds that data in `instance.template.html`.

The clock is fixed and the catalog is committed, so the same corpus builds the same page byte for
byte. `test/twin.test.mjs` asserts it.

## What the page is

| Surface | What it does |
| --- | --- |
| Sky | The estate as a Keplerian solar system on deck.gl — the renderer the dock's Kepler.gl solar lens draws through, loaded standalone. Bodies run real elliptical orbits in 3D; health is the fill, weakest standing the halo, capabilities are moons with their own orbits, and relations, fabric bindings and coordination are arcs that follow the bodies as they move. Drag to orbit the camera, wheel to zoom, click a body. |
| Control tower | Exception-first: what is unobserved, stale, unavailable, failing, unsigned, unbound, awaiting a decision, and every refusal this session produced. |
| Ledger, Fabric, Posture, Journal | The registry, the nine fabric bindings and their authority, the posture attestations, and all 96 records. |
| Inspector | Every facet of one body, and six governed verbs. |
| Drafter and command bar | Compose a command, run the plane's own validation against it, and hold it. |
| Time axis | Scrub the journal. The page folds each prefix itself. |

Every rail panel is a disclosure, and two edge controls collapse whole regions: the rail (`\`) and
the time-and-fidelity strip (`-`), which folds to its four titles rather than vanishing. **Solo**
(`h`, or the `#solo` fragment on the URL) hides every panel and runs the twin alone; after a few
still seconds the sky's own controls fade too. Escape or `h` brings the instrument panel back
exactly as it was — the panels are hidden, never unmade, so filters, drafts and the journal cursor
all survive. What a viewer keeps open is remembered in their own browser and nowhere else, guarded
so that a viewer who blocks site data still gets the page as designed.

## The orbits

Nothing in the sky is a place, and none of the motion is telemetry. Every orbital element is read
off the corpus:

| Element | Read from |
| --- | --- |
| Semi-major axis | The body's domain ring, plus its own lane within that ring |
| Eccentricity | One minus its corpus coverage — thin evidence visibly swings, complete evidence runs a near-circle |
| Inclination, ascending node | Its domain, so each ring sits at its own tilt |
| Argument of periapsis, epoch anomaly | Its order within the ring |
| Period | Kepler's third law from the axis, so the outer domains genuinely lag the inner ones |

Position comes from solving Kepler's equation, `M = E − e·sin E`, by Newton–Raphson. A capability
orbits its own body on the same mathematics, eccentric in proportion to how much authority its mode
carries. So the sky moves under a law applied to declared facts, never under a measurement — and
because the elements are a function of the committed catalog, the same corpus always builds the same
system.

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
