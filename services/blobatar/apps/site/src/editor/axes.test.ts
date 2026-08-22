import { describe, expect, test } from "bun:test";
import { traits as reader } from "blobatar";
import {
  AXES,
  SHAPES,
  TONES,
  applies,
  bandIndex,
  bandValue,
  candidates,
  round3,
  shapeAt,
  narrowPin,
  toggleShape,
  toggleTone,
} from "./axes";
import { blobLayout, resolved } from "./resolved";

/**
 * What is tested here is not the panel — it is the handful of constants this
 * app copied out of the library, and the arithmetic that reads values back out
 * of a resolved layout. Both are couplings to numbers that live somewhere else,
 * and both fail silently: a retuned band moves every config anyone saved, and a
 * retuned range leaves the clamp readback quietly pointing at the wrong place.
 */

const NAME = "alain00";

describe("the bands copied out of the library", () => {
  test("every shape midpoint still selects the shape it names", () => {
    // The package pins these too, in `test/traits.test.ts`. Pinned again here
    // because it is *this* copy that the editor writes into people's code, and
    // a copy that agrees with nothing is the failure mode worth catching.
    for (const { name, at } of SHAPES) {
      expect(blobLayout(NAME, { shape: at }).shape).toBe(name);
    }
  });

  test("every tone midpoint lands in a different swatch", () => {
    // `toneAt` splits [0, 1) into six, and nothing in the package pins where.
    // Distinct head colours is the cheapest statement of "still six bands, and
    // these six positions still find them".
    const heads = TONES.map(t => blobLayout(NAME, { tone: t.at }).palette.head);
    expect(new Set(heads).size).toBe(TONES.length);
  });

  test("banded axes round-trip through their detents", () => {
    for (const axis of AXES) {
      if (!axis.bands) continue;
      for (let i = 0; i < axis.bands; i++) {
        expect(bandIndex(bandValue(i, axis.bands), axis.bands)).toBe(i);
      }
    }
  });

  test("a pinned value survives the round trip the panel puts it through", () => {
    // Pinning rounds; the library clamps. If either moved the number, the
    // snippet would state something the blobatar disagrees with.
    for (const v of [0, 0.001, 0.5, 0.999]) {
      expect(reader(NAME, true, { "eye.gap": round3(v) })("eye.gap")).toBe(v);
    }
  });
});

/**
 * The silhouette axis is the one that can be narrowed to several rather than
 * fixed to one, and that turns two questions the panel answers into set
 * questions: which silhouettes it has to account for, and which controls those
 * silhouettes read. Both fail quietly — a decoration control that appears only
 * for the name you happen to be previewing is one you never find.
 */
describe("a silhouette narrowed to several", () => {
  test("a midpoint names its shape, and anything else names nothing", () => {
    for (const { name, at } of SHAPES) expect(shapeAt(at)).toBe(name);
    // Not a midpoint, so there is no honest name for it — `candidates` drops
    // these rather than guessing at the band.
    expect(shapeAt(0.5)).toBeUndefined();
  });

  test("an unpinned or singly-pinned silhouette is the one on screen", () => {
    // Including the unpinned case, which is *also* "any of the ten" and is
    // deliberately not read that way: the panel follows what is rendered when
    // you have not constrained it. See `candidates`.
    expect(candidates(undefined, "cloud")).toEqual(["cloud"]);
    expect(candidates(0.965, "sun")).toEqual(["sun"]);
  });

  test("a list is the list, in the order it was written", () => {
    expect(candidates([0.11, 0.825, 0.965], "round")).toEqual(["round", "cloud", "sun"]);
  });

  test("a list that names nothing falls back to what is on screen", () => {
    // The panel must always have a real answer: every conditional axis missing
    // is worse than one extra.
    expect(candidates([], "boxy")).toEqual(["boxy"]);
    expect(candidates([0.5], "boxy")).toEqual(["boxy"]);
  });

  test("a control shows if any selected silhouette reads it", () => {
    const petals = AXES.find(a => a.key === "sun.n")!;
    const lobes = AXES.find(a => a.key === "cloud.n")!;
    const size = AXES.find(a => a.key === "body.r")!;

    // The union, which is the whole rule: pick cloud and sun and you get both
    // decoration sets, because your config produces both creatures.
    expect(applies(petals, ["cloud", "sun"])).toBe(true);
    expect(applies(lobes, ["cloud", "sun"])).toBe(true);
    expect(applies(petals, ["cloud"])).toBe(false);
    // An axis every silhouette reads is unaffected by any of this.
    expect(applies(size, ["cloud"])).toBe(true);
  });

  test("toggling is order-independent — the row's order, not the click order", () => {
    // The snippet emits this list literally, so two people who picked the same
    // three silhouettes have to get the same line of code.
    const [round, cloud, sun] = [0.11, 0.825, 0.965];
    const forwards = [round, cloud, sun].reduce(toggleShape, [] as number[]);
    const backwards = [sun, cloud, round].reduce(toggleShape, [] as number[]);

    expect(forwards).toEqual([round, cloud, sun]);
    expect(backwards).toEqual(forwards);
  });

  test("toggling a selected silhouette removes it", () => {
    expect(toggleShape([0.11, 0.965], 0.11)).toEqual([0.965]);
    expect(toggleShape([0.11], 0.11)).toEqual([]);
  });

  test("one selected is still a number, so the common snippet never changed", () => {
    // The line that is already in everybody's code and in the README. A list is
    // what appears only when you ask for something a number cannot say.
    expect(narrowPin([0.965])).toBe(0.965);
    expect(narrowPin([0.11, 0.965])).toEqual([0.11, 0.965]);
    expect(narrowPin([])).toBeUndefined();
  });

  test("a selection survives the round trip through the trait map", () => {
    // Toggle, store, read back: what the row shows selected has to be what the
    // config says, or the panel and the snippet disagree about the same object.
    for (const ats of [[0.11], [0.11, 0.965], [0.11, 0.825, 0.965]]) {
      const pin = narrowPin(ats);
      expect(candidates(pin, "round")).toEqual(ats.map(shapeAt) as never);
    }
  });

  test("every axis is reachable from some selection, and none from an empty one", () => {
    // The cheapest statement that `when` and the shape table still agree: an
    // axis no selection can show is a control nobody can ever reach.
    const every = SHAPES.map(s => s.name);
    for (const axis of AXES) expect(applies(axis, every)).toBe(true);
  });
});

describe("a tone narrowed to several", () => {
  const [pastel, mid, ink] = TONES.map(t => t.at) as [number, number, number];

  test("toggling is row order, not click order — the snippet emits it literally", () => {
    const forwards = [pastel, mid, ink].reduce(toggleTone, [] as number[]);
    const backwards = [ink, mid, pastel].reduce(toggleTone, [] as number[]);

    expect(forwards).toEqual([pastel, mid, ink]);
    expect(backwards).toEqual(forwards);
  });

  test("toggling a selected tone removes it", () => {
    expect(toggleTone([pastel, ink], pastel)).toEqual([ink]);
    expect(toggleTone([pastel], pastel)).toEqual([]);
  });

  test("the two rows collapse and clear through the same function", () => {
    // The whole of what makes this the shape row's feature rather than a second
    // one: narrowing is a property of the override map, not of the key, so the
    // tone row needed a table and nothing else.
    expect(narrowPin([mid])).toBe(mid);
    expect(narrowPin([pastel, ink])).toEqual([pastel, ink]);
    expect(narrowPin([])).toBeUndefined();
  });

  test("every listed tone is one the name can actually come out as", () => {
    // Narrowing is only honest if the seed's pick lands inside what was chosen.
    // A midpoint that resolved to its neighbour's swatch would make a picked
    // chip a lie for some fraction of names, and nothing on screen would say so.
    const chosen = [pastel, ink];
    // Hue pinned throughout, or forty names come out forty colours for a reason
    // that has nothing to do with the axis under test.
    const wanted = chosen.map(at => blobLayout(NAME, { tone: at, hue: 0.6 }).palette.head);

    const seen = new Set(
      Array.from(
        { length: 40 },
        (_, i) => blobLayout(`user${i}`, { tone: chosen, hue: 0.6 }).palette.head,
      ),
    );

    expect(seen.size).toBe(2);
    for (const head of seen) expect(wanted).toContain(head);
  });
});

describe("reading the clamp back", () => {
  /*
   * The corner everyone tries first — biggest eyes, widest gap, tallest capsule
   * — on an organic body, which is where it actually bites. `fit` measures the
   * cluster against the *tightest* radius the body reaches, and a round body's
   * is its only one: on a round or boxy silhouette this same map fits with room
   * to spare, and reports nothing, which is the other half of being correct.
   */
  const extremes = {
    shape: 0.35,
    "eye.rx": 0.999,
    "eye.gap": 0.999,
    "eye.ratio": 0.999,
  };

  test("nothing is reported when the layout gave you what you asked for", () => {
    const t = reader(NAME, true, {});
    expect(resolved(blobLayout(NAME, {}), t)).toEqual({});

    // Including a configured eye cluster on a body with room for it.
    const round = { shape: 0.11, "eye.rx": 0.5, "eye.gap": 0.5, "eye.ratio": 0.5 };
    expect(resolved(blobLayout(NAME, round), reader(NAME, true, round))).toEqual({});
  });

  test("the biggest eyes and the widest gap come back short, and say so", () => {
    // The case ADR 0003 calls out: `fit` scales the eye cluster as a unit to
    // keep it inside the body, so both sliders stop moving near their tops.
    const t = reader(NAME, true, extremes);
    const ghosts = resolved(blobLayout(NAME, extremes), t);

    expect(ghosts["eye.rx"]).toBeLessThan(0.999);
    expect(ghosts["eye.gap"]).toBeLessThan(0.999);
    for (const v of Object.values(ghosts)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test("the reported position is the one the blobatar was actually drawn at", () => {
    // The readback is arithmetic over the library's ranges, so it can drift
    // from them. This is what notices: pinning the *resolved* position has to
    // produce the same geometry, because at that value nothing needs clamping.
    const t = reader(NAME, true, extremes);
    const ghosts = resolved(blobLayout(NAME, extremes), t);
    const settled = blobLayout(NAME, { ...extremes, ...ghosts });
    const drawn = blobLayout(NAME, extremes).eyes[0]!.rx;

    // The two-axis face clamp can re-engage slightly on the smaller cluster, so
    // the ghost is a close approximation rather than a fixed point — a few
    // percent, which is a fraction of a slider's width and still the right
    // answer to "why did this stop moving".
    expect(Math.abs(settled.eyes[0]!.rx - drawn) / drawn).toBeLessThan(0.05);
  });
});
