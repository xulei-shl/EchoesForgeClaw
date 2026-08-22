# Shapes are importable values, generations are compositions over them

> Superseded by ADR-0008. Shape composition remains an internal implementation
> technique, but shapes, composers and generations are no longer public library
> values.

gen1 and gen2 were two hand-written style modules, `styles/blob.ts` (~300 lines)
and `styles/blob2.ts` (~380), and six of the ten silhouettes existed in both. The
copy was deliberate — ADR-0006 argued that gen1 is frozen forever, so gen2 must
not be able to move it by sharing code with it — and it was the right call for
one generation. At two it was already 380 lines to add four shapes.

Both are now **`compose(bands, fit)`** over a shared vocabulary of ten shape
values:

```ts
const GEN1: Band[] = [
  [round, 0.28], [organic, 0.58], [boxy, 0.72], [nub, 0.84], [cloud, 0.93], [sun, 1],
];

export const gen1: Generation = /* @__PURE__ */ (() => ({
  id: 1, ...compose(GEN1, bodyFit),
}))();
```

A shape carries everything needed to draw one silhouette and nothing about when
to draw it. The thresholds live on the generation, because gen1 and gen2 draw six
of the same silhouettes and weight them differently — a `round` carrying its own
threshold could belong to only one of them. `fit` is a parameter for the same
reason: gen1 measures the eye cluster against the body radius on one axis, gen2
against a per-shape face on both, and that difference is frozen into gen1
forever. It is not a refinement that can be applied retroactively; applying it
would move every existing gen1 blobatar.

The six shared silhouettes turned out to be *identical values* between the two
generations — same core, same decoration, same paths. Only bands and fit differ.

`blobatar/shapes` and `blobatar/compose` ship this to consumers, so a caller can
build their own vocabulary out of geometry whose containment is already proven.

## Why this was safe to do to a frozen generation

Because it is verifiable to be a no-op. Both generations compose
**byte-identically against their frozen fixtures**: all 1312 recorded hashes,
all recorded full renders, and both 20,000-seed histograms, for gen1 and gen2
alike. `test/golden/gen1.txt` and `gen2.txt` were not touched, and a failure
there would have meant the composition drifted rather than that the fixture was
stale.

That is the whole safety argument, and nothing weaker would have justified
touching gen1 at all.

## What it costs

Measured through `scripts/size.ts` — a synthetic consumer bundled from source,
minified, gzipped — because every prior estimate of this number was wrong.

| consumer | before | after | Δ |
|---|---|---|---|
| `blob only` — the default import | 3680 | **3827** | **+147** |
| `blob + gen1` | 3706 | 3834 | +128 |
| `blob + gen2` | 4764 | 4440 | −324 |
| gen2's marginal cost over gen1 | 1058 | **606** | −452 |
| `blob + custom` — 3 shapes, composed | impossible | 3861 | — |

**+147 B on the majority case is the price, and it is a real regression for the
consumers who never name a generation.** It buys a second generation costing 606
B instead of 1058, ten silhouettes becoming importable values, and the deletion
of ~680 lines of duplicated geometry.

Two trims were measured and rejected. Dropping the `name` field from each shape
saves 45 B and breaks `blobatar/blob`'s `layout` export, whose entire documented
purpose is bulk filtering seeds by silhouette — not a trade worth making for 45
B. Making `Deco.extra` lazily allocated came out **1 B worse**, because the
`?.`/`??` guards in `render` cost more than the empty array they avoid.

The +108 B figure from the spike that preceded this was measured on a consumer
that composed inline and skipped `generation.ts` entirely. That form does exist
and measures 3805 — but no real default import takes it, because the default
import reaches gen1 through `generation.ts`. The 22 B between them is what buys
gen2 shaking out.

## The tree-shaking hazard, and a correction to ADR-0006

ADR-0006 recorded that `{ id, ...styleModule }` dragged gen2 into every gen1-only
bundle, and concluded that **naming the three members explicitly** was the fix.
That conclusion does not survive this change: a generation is now
`{ id, ...compose(bands, fit) }`, and there are no members to name — it is a
spread of a *call result*, which a bundler will not assume is side-effect-free.

The fix that works is an annotated IIFE:

```ts
/* @__PURE__ */ (() => ({ id: 1, ...compose(GEN1, bodyFit) }))()
```

and specifically **not** the obvious `{ id, .../* @__PURE__ */ compose(…) }`.
Both were measured. The IIFE holds `blob + gen1` 606 B below `blob + gen2`; the
annotation-on-the-call form puts the two rows at exactly 4433 B each, which is
the tell that gen2 is in every bundle again.

The same hazard applies to the shapes themselves. Writing the wrappers the
obvious way — `boxy = { ...round, core: 0.86 }` — makes *nothing* shake: one
shape measured 4221 B where it should have been 3301. Shapes dedupe by naming
shared function references (`path: spline`, `face: splineFace`), never by
spreading a parent value.

This is the third time object spread has cost this repo a kilobyte. The general
rule: **`scripts/size.ts` is the only thing that knows whether a seam works.**
The `blob + gen1` row exists to catch exactly this and has now caught it twice.

## What a composed generation still cannot do

*Choose its own numeric ranges.* `compose` hardcodes all of them — `body.r`
31–38, `eye.rx` 0.075–0.105, `eye.gap` 0.1–0.24 and the rest. gen1 and gen2
happen to share every one, which is why a single composer serves both. A
generation wanting different ranges cannot be expressed without extending
`compose`, at which point ranges become part of the generation too and the
signature grows a third parameter. Deferred deliberately: nothing has needed it
across two generations, and inventing the knob before there is a second set of
ranges would be guessing at its shape.

*Be the only generation in a bundle.* `blobatar` is `makeBlobatar(gen1)`, and
that factory is not public, so rendering with a custom generation goes through
`blobatar(seed, { generation })` and carries gen1's band table and `bodyFit`
along with it. This is why `scripts/size.ts` has no "gen2 only" row — it is not
reachable either. Exporting the factory is the obvious next step and is not
taken here, because it is a new public entry point in service of a use case
nobody has asked for yet.

*Guarantee its own identity.* `Generation.id` is still load-bearing —
`blobatar/react` memoizes on `JSON.stringify` of its options, which drops
functions, so the id is the only thing distinguishing two generations. A
consumer-composed generation must supply an id nothing else uses, and nothing in
the library can enforce it. Ids 1 and 2 are taken.

## The one API change

`blobatar/blob` exported `type Shape = "round" | "organic" | …`, the union of
gen1's six names. `Shape` is now the better claim on the word — it means a
silhouette *value*, exported from `blobatar/shapes` — so the union was renamed
to `ShapeName`, with `Shape` kept as a deprecated alias. Nothing breaks; types
cost no bytes.

`layout` keeps the narrow union rather than the composer's `shape: string`,
which is a hand-written assertion in `blob.ts`. It is sound by the same thing
that makes it necessary: gen1's band table lists exactly those six names and
`gen1.txt` freezes that it always will.

**Revisit when** a third generation wants numeric ranges gen1 and gen2 do not
share, or when somebody actually needs a custom generation without gen1 riding
along. The first extends `compose`; the second makes the factory public.
