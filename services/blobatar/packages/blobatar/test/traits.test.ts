import { describe, expect, test } from "bun:test";
import { blobatar, _layout } from "../src/blobatar";
import { traits } from "../src/traits";
import { BLOB_KEYS } from "./keys";

/**
 * Trait overrides are the whole configuration surface, so what these pin is the
 * contract that makes them one: an override means the same thing a hashed value
 * means, in the same units, and everything left out still comes from the seed.
 *
 * The geometric half — that no combination of overrides can break a blobatar —
 * lives in `geometry.test.ts`, next to the containment helpers it needs.
 */

const SEED = "alain";

/** Narrowed once here rather than cast at each assertion. */
const blobLayout = (seed: string, opts: Parameters<typeof _layout>[1] = {}) =>
  _layout(seed, opts) as Extract<ReturnType<typeof _layout>, { shape: unknown }>;

describe("reading", () => {
  test("an override replaces exactly its own key", () => {
    const base = traits(SEED);
    const over = traits(SEED, true, { "eye.gap": 0.82 });

    expect(over("eye.gap")).toBe(0.82);
    for (const k of ["shape", "body.r", "eye.rx", "hue", "tone"]) {
      expect(over(k)).toBe(base(k));
    }
  });

  test("zero is a value, not an absence", () => {
    // The bottom of every range is a legitimate thing to ask for, and the one
    // an `??` on the lookup would silently discard.
    const t = traits(SEED, true, { "eye.rx": 0 });
    expect(t("eye.rx")).toBe(0);
    expect(t.num("eye.rx", 0.075, 0.105)).toBe(0.075);
  });

  test("the derived readers use the override", () => {
    const t = traits(SEED, true, { a: 0, b: 0.5, c: 0.999999 });
    expect(t.num("a", 10, 20)).toBe(10);
    expect(t.int("b", 0, 10)).toBe(5);
    expect(t.pick("c", ["x", "y", "z"])).toBe("z");
    expect(t.jitter("a", 4)).toBe(-4);
    expect(t.bool("a")).toBe(true);
    expect(t.bool("c")).toBe(false);
  });

  test("out-of-range values are clamped instead of trusted", () => {
    const t = traits(SEED, true, {
      high: 1,
      way: 99,
      low: -3,
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
    });

    // Exactly 1 is the one that looks reasonable and indexes off the end.
    for (const k of ["high", "way", "inf"]) {
      expect(t.pick(k, ["x", "y", "z"])).toBe("z");
      expect(t.int(k, 6, 8)).toBe(8);
      expect(t(k)).toBeLessThan(1);
    }
    for (const k of ["low", "nan"]) {
      expect(t(k)).toBe(0);
      expect(t.pick(k, ["x", "y", "z"])).toBe("x");
    }
  });
});

/**
 * The third position between a pinned key and an omitted one.
 *
 * A number narrows a key to one outcome and an absent key leaves it at all of
 * them; a list narrows it to what it names and leaves the seed to choose. What
 * these pin is that the choosing is the *same* choosing — the key's own hash,
 * spent on an index instead of a value — because that is the whole claim: a
 * narrowed key keeps every property an open one had.
 */
describe("narrowing a key to a list", () => {
  /** Enough seeds to see a distribution, fixed so the assertions cannot flake. */
  const SEEDS = Array.from({ length: 600 }, (_, i) => `user${i}`);

  test("a one-element list is the number", () => {
    // The degenerate case, and the one that says a list is a generalization of
    // pinning rather than a second mechanism beside it.
    expect(blobatar(SEED, { traits: { shape: [0.95] } })).toBe(
      blobatar(SEED, { traits: { shape: 0.95 } }),
    );
  });

  test("an empty list is an absent key", () => {
    // "Nothing selected" and "not configured" are the same request — a picker
    // with everything deselected must not have to special-case itself.
    expect(blobatar(SEED, { traits: { shape: [] } })).toBe(blobatar(SEED));
  });

  test("every seed lands on a listed value, and only on one", () => {
    const listed = [0.11, 0.825, 0.965];
    for (const seed of SEEDS) {
      expect(listed).toContain(traits(seed, true, { shape: listed })("shape"));
    }
  });

  test("the seed still chooses, roughly evenly, among what is listed", () => {
    // The property that makes this worth having over a pin: 600 names come
    // back as three populations rather than one. Uniform over the *list*, not
    // over the bands behind it — three silhouettes of very unequal band width
    // come out in thirds, which is what someone naming three of them means.
    const listed = [0.11, 0.825, 0.965];
    const tally = new Map<string, number>();
    for (const seed of SEEDS) {
      const { shape } = blobLayout(seed, { traits: { shape: listed } });
      tally.set(shape, (tally.get(shape) ?? 0) + 1);
    }

    expect([...tally.keys()].sort()).toEqual(["cloud", "round", "sun"]);
    for (const n of tally.values()) {
      expect(n).toBeGreaterThan(SEEDS.length / 5);
      expect(n).toBeLessThan(SEEDS.length / 2);
    }
  });

  test("the choice is stable, and independent of every other key", () => {
    const listed = [0.11, 0.825, 0.965];
    const base = traits(SEED, true, { shape: listed })("shape");

    expect(traits(SEED, true, { shape: listed })("shape")).toBe(base);
    // Pinning a neighbour must not move it: the index comes from this key's own
    // stream, so the trait namespace stays as append-only as it is for a
    // hashed value.
    expect(
      traits(SEED, true, { shape: listed, hue: 0.5, "eye.gap": 0.9 })("shape"),
    ).toBe(base);
  });

  test("a listed value is clamped like a written one", () => {
    // The clamp runs over the chosen element, not over the list, so a bad
    // number is caught wherever in the input it was typed.
    const t = traits(SEED, true, { high: [1, 1], low: [-3, Number.NaN] });
    expect(t.pick("high", ["x", "y", "z"])).toBe("z");
    expect(t("high")).toBeLessThan(1);
    expect(t("low")).toBe(0);
  });

  test("narrowing one key leaves the rest of the blobatar on the seed", () => {
    // The sparse guarantee, restated for lists: two names narrowed to the same
    // pair are still two different creatures.
    const opts = { traits: { shape: [0.11, 0.965] } };
    const a = blobLayout("one", opts);
    const b = blobLayout("two", opts);

    expect(a.body.rx).not.toBe(b.body.rx);
    expect(a.palette.head).not.toBe(b.palette.head);
  });
});

describe("configuring a blobatar", () => {
  test("the same seed and overrides always render the same markup", () => {
    const opts = { traits: { shape: 0.95, "eye.ratio": 0.1 } };
    expect(blobatar(SEED, opts)).toBe(blobatar(SEED, opts));
  });

  test("an empty map renders byte-identical markup to no map at all", () => {
    expect(blobatar(SEED, { traits: {} })).toBe(blobatar(SEED));
  });

  test("a sparse map leaves the rest of the blobatar on the seed", () => {
    const a = blobLayout("one", { traits: { shape: 0.95 } });
    const b = blobLayout("two", { traits: { shape: 0.95 } });

    expect(a.shape).toBe("sun");
    expect(b.shape).toBe("sun");
    // Same silhouette family, still two different creatures.
    expect(a.body.rx).not.toBe(b.body.rx);
    expect(a.palette.head).not.toBe(b.palette.head);
  });

  test("every shape in the vocabulary is reachable by band midpoint", () => {
    // What the editor's shape buttons write: one midpoint per private band.
    const bands = [
      [0.11, "round"],
      [0.35, "organic"],
      [0.54, "boxy"],
      [0.65, "capsule"],
      [0.745, "nub"],
      [0.825, "cloud"],
      [0.888, "droplet"],
      [0.933, "hexagon"],
      [0.965, "sun"],
      [0.99, "triangle"],
    ] as const;
    for (const [v, shape] of bands) {
      expect(blobLayout(SEED, { traits: { shape: v } }).shape).toBe(shape);
    }
  });

  test("pinning every trait makes the seed irrelevant", () => {
    // The "one fixed blobatar" case: a full map plus any constant string.
    const full: Record<string, number> = {};
    for (const k of BLOB_KEYS) full[k] = 0.42;

    const a = blobatar("one", { traits: full });
    const b = blobatar("two", { traits: full });
    expect(a).toBe(b);
    // And it is a real blobatar, not an empty frame.
    expect(a).toContain("<path");
  });

  test("hue and tone win over the traits that back them", () => {
    // Two ways to state the same value, in different units. The friendly one
    // is the one that takes effect.
    const l = _layout(SEED, { hue: 200, tone: 0.9, traits: { hue: 0, tone: 0 } });
    expect(l.palette).toEqual(_layout(SEED, { hue: 200, tone: 0.9 }).palette);
  });

  test("an override at the very top of its range is clamped, not wrapped", () => {
    // `t.pick` is the reader an unclamped override breaks first: 0.999999 must
    // land on the last item rather than falling off the end of the list.
    const opts = { traits: { shape: 0.14, "body.r": 1, eyes: 0.999999 } };
    expect(blobLayout(SEED, opts).shape).toBe("round");
    expect(blobatar(SEED, opts)).toContain("<path");
  });
});
