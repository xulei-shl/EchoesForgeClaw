/**
 * The control set.
 *
 * Deliberately not the keyspace. `test/keys.ts` lists forty-odd trait keys and
 * every one of them is configurable, but a slider per key is a settings dump —
 * the split between a complete encoding and a curated editor is the whole point
 * of ADR 0003, and this file is the curated half.
 *
 * Everything here writes exactly one key. The macro controls the spec proposes
 * — lumpiness over `body.r0`–`body.r7`, asymmetry over the four second-eye
 * traits — are not here, and their absence is a decision rather than an
 * omission: a macro has to be *read back* as well as written, so that an axis
 * coming from the name can show where it currently sits, and there is no honest
 * inverse of "eight jitters" to a single amplitude. One key per axis is what
 * makes lock, shuffle, readback and the snippet all the same mechanism.
 */

/**
 * The silhouette table lives in `@/shapes`, because the landing hero picks one
 * too and the two pages must not disagree about what `0.888` is.
 */
export { SHAPES, type Shape, type ShapeOption } from "@/shapes";

import { SHAPES, type Shape } from "@/shapes";

/**
 * The tone set, same treatment.
 *
 * `tone` reads as a *band* rather than as a number — `toneAt` in `color.ts`
 * splits [0, 1) into six swatches — so a slider would be a control with five
 * invisible detents and no way to tell you where they are. Six chips instead,
 * at the band midpoints.
 *
 * Unlike the shape bands these are not pinned by a test in the package, so
 * `editor.test.ts` asserts here that all six still resolve to distinct
 * palettes. That is the cheapest thing that fails if the tone set is retuned.
 */
export const TONES: { name: string; at: number }[] = [
  { name: "pastel", at: 0.1 },
  { name: "pale", at: 0.28 },
  { name: "mid", at: 0.49 },
  { name: "deep", at: 0.71 },
  { name: "bright", at: 0.865 },
  { name: "ink", at: 0.965 },
];

export type Group = "shape" | "body" | "eyes" | "color" | "decoration";

export interface Axis {
  /** The trait key this axis pins. Also its identity everywhere else. */
  key: string;
  label: string;
  group: Group;
  /**
   * How it is driven. `shape` and `tone` are categorical in the layout, not
   * continuous, so they get pickers; everything else is a slider.
   */
  kind: "slider" | "shape" | "tone";
  /**
   * Which silhouettes read this key at all. Absent means all six.
   *
   * `body.rot` is the trap the spec names: `layout` only reads it when the
   * shape is `boxy`, and the same is true of every decoration key for its own
   * shape. A tilt slider that does nothing on five of the six silhouettes is
   * the worst kind of control, so an axis that does not apply is not rendered
   * at all — and its group says, in a line, which silhouettes it needs. Same
   * answer for `body.rot` and for every decoration key, which is the point: one
   * rule, not two.
   */
  when?: Shape[];
  /**
   * Set when the layout reads this key through `t.int` — the number of distinct
   * values it can take. The slider then has that many detents instead of a
   * thousand, because a count with four outcomes dragged over 0.001 steps
   * spends most of its travel doing nothing.
   */
  bands?: number;
}

/**
 * In display order, which is also snippet order: the silhouette first, then
 * what it is made of, then how it is decorated. A pinned map that reads
 * top-to-bottom the way the panel does is one fewer thing to reconcile when
 * someone comes back to code they generated a month ago.
 *
 * Blobatar 2 reads `body.rot` on polygons as well as on a boxy body: rotating
 * a polygon never costs it any of its frame.
 */
const BASE_AXES: Axis[] = [
  { key: "shape", label: "silhouette", group: "shape", kind: "shape" },

  { key: "body.r", label: "size", group: "body", kind: "slider" },
  { key: "body.ratio", label: "proportion", group: "body", kind: "slider" },
  // The same position means a different squareness per shape — `body.n` is read
  // over 3.4–6 on a boxy body and 1.9–2.5 on every other. Not inert, so not
  // disabled; just not comparable across silhouettes.
  { key: "body.n", label: "squareness", group: "body", kind: "slider" },
  { key: "body.rot", label: "tilt", group: "body", kind: "slider", when: ["boxy"] },

  { key: "eye.rx", label: "size", group: "eyes", kind: "slider" },
  { key: "eye.ratio", label: "roundness", group: "eyes", kind: "slider" },
  { key: "eye.n", label: "squareness", group: "eyes", kind: "slider" },
  { key: "eye.gap", label: "separation", group: "eyes", kind: "slider" },
  { key: "eye.lean", label: "lean", group: "eyes", kind: "slider" },
  { key: "gaze.x", label: "gaze x", group: "eyes", kind: "slider" },
  { key: "gaze.y", label: "gaze y", group: "eyes", kind: "slider" },

  { key: "tone", label: "tone", group: "color", kind: "tone" },
  { key: "hue", label: "hue", group: "color", kind: "slider" },

  { key: "sun.n", label: "petals", group: "decoration", kind: "slider", when: ["sun"], bands: 4 },
  { key: "sun.dist", label: "petal distance", group: "decoration", kind: "slider", when: ["sun"] },
  { key: "sun.r", label: "petal size", group: "decoration", kind: "slider", when: ["sun"] },
  { key: "sun.rot", label: "petal rotation", group: "decoration", kind: "slider", when: ["sun"] },

  { key: "cloud.n", label: "lobes", group: "decoration", kind: "slider", when: ["cloud"], bands: 3 },

  { key: "nub.n", label: "nubs", group: "decoration", kind: "slider", when: ["nub"], bands: 2 },
  { key: "nub.a0", label: "nub angle", group: "decoration", kind: "slider", when: ["nub"] },
  { key: "nub.r0", label: "nub size", group: "decoration", kind: "slider", when: ["nub"] },
];

export const AXES: Axis[] = BASE_AXES.map(a =>
  a.key === "body.rot" ? { ...a, when: ["boxy", "triangle", "hexagon"] as Shape[] } : a,
).concat([
    // `capsule.squat` sits in `body` rather than in `decoration`: it is how tall
    // the body is, not something attached to it.
    { key: "capsule.squat", label: "squat", group: "body", kind: "slider", when: ["capsule"] },
    {
      key: "poly.round",
      label: "corner rounding",
      group: "body",
      kind: "slider",
      when: ["triangle", "hexagon"],
    },
    // One knob, because the taper is tangent to the body: how high the apex
    // reaches is also how wide its base is and how sharp its point comes out.
    { key: "droplet.tip", label: "tip length", group: "decoration", kind: "slider", when: ["droplet"] },
]);

/** Snippet key order. Panel order, so the two never disagree. */
export const KEY_ORDER = AXES.map(a => a.key);

/**
 * Whether an axis applies to any silhouette the config can currently produce.
 *
 * A set rather than a shape, because the silhouette axis can be narrowed to
 * several: "round, cloud or sun" is one config that renders three different
 * creatures depending on the name. The panel has to cover all of them, so the
 * rule is the union — an axis shows if any candidate reads it. Anything else
 * means a decoration control that exists for some of your users and not
 * others, which is the one thing you cannot see by looking at one preview.
 */
export const applies = (axis: Axis, shapes: Shape[]) =>
  !axis.when || shapes.some(s => axis.when!.includes(s));

/**
 * A picker row's toggle, as a value rather than as an event.
 *
 * Rebuilt from the row's own order rather than pushed and spliced, so what
 * comes out is in row order and not in click order. The snippet emits this list
 * literally — two people who picked the same three silhouettes should get the
 * same line of code, and a config that reshuffles itself as you toggle is a
 * diff for nothing.
 *
 * Generic over the row because narrowing is generic over the key: a trait
 * override reads a list the same way whatever key it is under, so the two
 * categorical rows are the same control with a different table behind them.
 * What decides whether an axis *can* offer this is not the axis — it is whether
 * its positions have names somebody can point at, which is exactly what having
 * a table means.
 */
const toggleAt = (order: number[], chosen: number[], at: number): number[] =>
  order.filter(p => (p === at ? !chosen.includes(at) : chosen.includes(p)));

export const toggleShape = (chosen: number[], at: number): number[] =>
  toggleAt(SHAPES.map(s => s.at), chosen, at);

export const toggleTone = (chosen: number[], at: number): number[] =>
  toggleAt(TONES.map(t => t.at), chosen, at);

/**
 * What a selection becomes in the trait map.
 *
 * The collapse is the point, and it is why this is here rather than in the
 * library: one selected has to keep emitting `{ shape: 0.965 }`, the line that
 * is already in everybody's code and in the README — and the same for
 * `{ tone: 0.49 }`. A list is what appears only
 * when you have asked for something a number cannot say. Nothing selected is
 * `auto` — the library reads an empty list as an absent key anyway, but leaving
 * the key out keeps it out of the snippet too.
 */
export const narrowPin = (ats: number[]): number | number[] | undefined =>
  ats.length === 0 ? undefined : ats.length === 1 ? ats[0]! : ats;

/**
 * Which silhouette a pinned position names.
 *
 * A table lookup rather than a band search, and it can miss: the picker only
 * ever writes midpoints, so a position that is not one came from somewhere
 * else and there is no honest name for it. `candidates` drops those instead of
 * guessing, which costs nothing — the panel still has the resolved shape to
 * fall back on.
 */
export const shapeAt = (at: number): Shape | undefined =>
  SHAPES.find(s => s.at === at)?.name;

/**
 * The silhouettes the panel has to account for.
 *
 * Narrowed to a list, that is the list. Otherwise it is the one on screen —
 * and that is the answer for an *unpinned* silhouette too, which is worth
 * saying out loud because "unpinned" also means "any of the ten". Reading it
 * that way would put every decoration control on the panel at once, which is
 * the settings dump this file exists to avoid. The distinction that makes it
 * coherent: the panel covers what you have *constrained* it to, and an
 * unconstrained silhouette is followed rather than covered.
 */
export const candidates = (
  pin: number | number[] | undefined,
  resolved: Shape,
): Shape[] => {
  const named = Array.isArray(pin) ? (pin.map(shapeAt).filter(Boolean) as Shape[]) : [];
  // A list that named nothing is treated as no list at all, for the same reason
  // the library treats an empty one as an absent key: what is on screen is
  // always a real answer, and a panel with every conditional axis missing is
  // not.
  return named.length ? named : [resolved];
};

/**
 * Three decimals, everywhere a value is pinned.
 *
 * This is the one rule that makes the page's acceptance test mechanical. The
 * snippet rounds because six decimals off a slider is noise — so if the preview
 * were driven by the unrounded value, the pasted snippet would render a
 * *slightly* different blobatar than the one that was on screen, in a way
 * nobody would ever catch by looking. Rounding at the point of pinning instead
 * means the preview and the snippet are driven by the identical number and the
 * generator's rounding is the identity.
 */
export const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** The value a banded axis takes at detent `i`. */
export const bandValue = (i: number, bands: number) => round3((i + 0.5) / bands);

/** Which detent a value sits in. The inverse of `bandValue`, for readback. */
export const bandIndex = (v: number, bands: number) =>
  Math.min(bands - 1, Math.max(0, Math.floor(v * bands)));

/** Panel order. Silhouette first — every axis under it decorates that choice. */
export const GROUPS: Group[] = ["shape", "body", "eyes", "color", "decoration"];
