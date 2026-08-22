import { describe, expect, test } from "bun:test";
import { blobatar } from "../src/blobatar";
import { blobPath, polygon, superellipse } from "../src/shape";
import { style } from "../src/styles/blob";
import type { Layout } from "../src/styles/compose";
import { traits } from "../src/traits";
import { BLOB_KEYS } from "./keys";

/**
 * Geometric invariants that replace eyeballing the tuning grid one cell at a
 * time. Taste is judged in aggregate; these checks reject broken geometry.
 */

const SEEDS = Array.from({ length: 6000 }, (_, i) => `seed-${i}`);

const inside = (
  px: number,
  py: number,
  s: { cx: number; cy: number; rx: number; ry: number; n: number },
) => Math.pow(Math.abs((px - s.cx) / s.rx), s.n) + Math.pow(Math.abs((py - s.cy) / s.ry), s.n);

function corners(e: { cx: number; cy: number; rx: number; ry: number; rot: number }) {
  const t = (e.rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => [
    e.cx + sx! * e.rx * c - sy! * e.ry * s,
    e.cy + sx! * e.rx * s + sy! * e.ry * c,
  ]);
}

/** Cubic and quadratic Béziers, flattened fine enough to test points against. */
const STEPS = 24;
const bez = (p: [number, number][], t: number): [number, number] => {
  let q = p;
  while (q.length > 1)
    q = q.slice(1).map((c, i) => [
      q[i]![0] + (c[0] - q[i]![0]) * t,
      q[i]![1] + (c[1] - q[i]![1]) * t,
    ] as [number, number]);
  return q[0]!;
};

/** One emitted `d` as closed polylines. Absolute commands only, which is all this package emits. */
function outline(d: string): [number, number][][] {
  const subs: [number, number][][] = [];
  let cur: [number, number][] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  for (const m of d.matchAll(/([MCLQHVZ])([^MCLQHVZ]*)/g)) {
    const a = (m[2]!.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    switch (m[1]) {
      case "M":
        if (cur.length > 1) subs.push(cur);
        [x, y] = [a[0]!, a[1]!];
        [sx, sy] = [x, y];
        cur = [[x, y]];
        break;
      case "L": [x, y] = [a[0]!, a[1]!]; cur.push([x, y]); break;
      case "H": x = a[0]!; cur.push([x, y]); break;
      case "V": y = a[0]!; cur.push([x, y]); break;
      case "C":
      case "Q": {
        const size = m[1] === "C" ? 6 : 4;
        for (let i = 0; i + size <= a.length; i += size) {
          const p: [number, number][] = [[x, y]];
          for (let j = 0; j < size; j += 2) p.push([a[i + j]!, a[i + j + 1]!]);
          for (let k = 1; k <= STEPS; k++) cur.push(bez(p, k / STEPS));
          [x, y] = cur[cur.length - 1]!;
        }
        break;
      }
      case "Z": cur.push([sx, sy]); subs.push(cur); cur = []; [x, y] = [sx, sy]; break;
    }
  }
  if (cur.length > 1) subs.push(cur);
  return subs;
}

/** Even-odd, per part — the fill is a union of parts, so each is tested alone and OR-ed. */
const inPath = (subs: [number, number][][], px: number, py: number) => {
  let hits = 0;
  for (const poly of subs)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!;
      const [xj, yj] = poly[j]!;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hits++;
    }
  return hits % 2 === 1;
};

/** The whole fill: the core path, the petals unioned with it, and any extra outline. */
function drawn(l: Layout) {
  const core = outline(l.draw ? l.draw(l.body) : superellipse(l.body));
  const extra = l.extra.map(outline);
  return (px: number, py: number) =>
    inPath(core, px, py) ||
    l.petals.some(p => Math.hypot(px - p.cx, py - p.cy) <= p.r) ||
    extra.some(e => inPath(e, px, py));
}

describe("the frame", () => {
  test("all geometry stays inside the viewBox", () => {
    for (const s of SEEDS) {
      const svg = blobatar(s, { background: false });
      for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
        for (const n of m[1]!.match(/-?\d+\.?\d*/g)!.map(Number)) {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe("path emission", () => {
  test("superellipse coordinates stay finite for the whole n range", () => {
    for (let n = 1.6; n <= 8; n += 0.1) {
      const d = superellipse({ cx: 50, cy: 50, rx: 30, ry: 30, n });
      expect(d).not.toContain("NaN");
      for (const v of d.match(/-?\d+(\.\d+)?/g)!) expect(Number.isFinite(+v)).toBe(true);
    }
  });

  test("the 45-degree control constant matches the circle case exactly", () => {
    // n=2 must reproduce the standard 0.5523 kappa, or the derivation is wrong.
    expect(superellipse({ cx: 0, cy: 0, rx: 100, ry: 100, n: 2 })).toContain("55.23");
  });

  test("control points never overshoot the bounding box", () => {
    for (let n = 1.6; n <= 8; n += 0.1) {
      for (const v of superellipse({ cx: 50, cy: 50, rx: 40, ry: 40, n }).match(/-?\d+(\.\d+)?/g)!) {
        expect(+v).toBeGreaterThanOrEqual(9.9);
        expect(+v).toBeLessThanOrEqual(90.1);
      }
    }
  });

  test("blobPath interpolates its vertices exactly", () => {
    // Catmull-Rom passes through its points, which is what makes the radii
    // mean what they say and containment predictable.
    const d = blobPath(50, 50, 20, 20, [1, 1, 1, 1], 0);
    expect(d).toStartWith("M70 50");
    expect(d).toContain("50 70");
    expect(d).toContain("30 50");
  });

  test("blobPath closes and stays within its radii", () => {
    const radii = [1.1, 0.9, 1.05, 0.95, 1.12, 0.88];
    const d = blobPath(50, 50, 20, 20, radii, 0);
    expect(d).toEndWith("Z");
    for (const v of d.match(/-?\d+(\.\d+)?/g)!) {
      expect(+v).toBeGreaterThan(50 - 20 * 1.5);
      expect(+v).toBeLessThan(50 + 20 * 1.5);
    }
  });
});

/**
 * Blobatar 2's containment, which is a different proof from the previous generation's.
 *
 * gen1 could measure the eye cluster against the body radius because all six of
 * its silhouettes were roughly round and roughly centred. Half of Blobatar 2's are
 * not — a triangle's usable interior is a fraction of its circumradius, a
 * capsule's is squat, a droplet's is not centred on the frame — so the layout
 * states a `face` and everything below checks that the face is honest: that it
 * really is inside the silhouette it claims to be inscribed in, shape by shape,
 * with the actual geometry rather than with a shared approximation.
 */
describe("blob", () => {
  const layouts = SEEDS.map(s => style.layout(traits(s)) as Layout);

  /** The rounded polygon's cut points, which the drawn outline strictly contains. */
  function cutHull(b: Layout["body"] & { sides: number; round: number }): [number, number][] {
    const k = b.round > 0 ? (b.round < 1 ? b.round / 2 : 0.5) : 0;
    const t0 = (b.rot * Math.PI) / 180 - Math.PI / 2;
    const v = Array.from({ length: b.sides }, (_, i) => {
      const a = t0 + (2 * Math.PI * i) / b.sides;
      return [b.cx + b.rx * Math.cos(a), b.cy + b.ry * Math.sin(a)] as [number, number];
    });
    const at = (i: number) => v[((i % b.sides) + b.sides) % b.sides]!;
    const out: [number, number][] = [];
    for (let i = 0; i < b.sides; i++) {
      for (const j of [i - 1, i + 1]) {
        const [x0, y0] = at(i);
        const [x1, y1] = at(j);
        out.push([x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]);
      }
    }
    // Angular sort, so the cut points come back as a traversable convex polygon
    // rather than in vertex-pair order.
    return out.sort(
      (a, c) => Math.atan2(a[1] - b.cy, a[0] - b.cx) - Math.atan2(c[1] - b.cy, c[0] - b.cx),
    );
  }

  const inConvex = (px: number, py: number, poly: [number, number][]) => {
    let neg = false;
    let pos = false;
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i]!;
      const [x1, y1] = poly[(i + 1) % poly.length]!;
      const cross = (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
      if (cross > 1e-9) pos = true;
      if (cross < -1e-9) neg = true;
    }
    return !(pos && neg);
  };

  /** Distance from a point to the segment joining a capsule's two cap centres. */
  const toSpine = (px: number, py: number, l: Layout) => {
    const half = l.body.rx - l.body.ry;
    const dx = Math.max(0, Math.abs(px - l.body.cx) - half);
    return Math.hypot(dx, py - l.body.cy);
  };

  /**
   * Whether a point is inside the drawn silhouette. Conservative everywhere: the
   * shapes that union extra parts are tested against the core alone, and the
   * spline shapes against their smallest sampled radius.
   */
  function inBody(px: number, py: number, l: Layout) {
    const b = l.body;
    // The `shape` guard is what makes `sides` and `round` present — they are
    // optional on `Body` because only the polygon shapes set them, and only the
    // polygon shapes reach this branch.
    if (l.shape === "triangle" || l.shape === "hexagon")
      return inConvex(px, py, cutHull(b as typeof b & { sides: number; round: number }));
    if (l.shape === "capsule") return toSpine(px, py, l) <= b.ry;
    const shrink =
      l.shape === "organic" || l.shape === "cloud" ? Math.min(...b.radii) * 0.95 : 1;
    // Squareness is understated and tilt is not: a boxy body is squarer than
    // `n: 2` and so roomier, but a body whose seeded `n` falls under 2 is drawn
    // *inside* that ellipse, and measuring it against one was the model
    // claiming room the shape does not have.
    const t = (-b.rot * Math.PI) / 180;
    const dx = px - b.cx;
    const dy = py - b.cy;
    return inside(
      b.cx + dx * Math.cos(t) - dy * Math.sin(t),
      b.cy + dx * Math.sin(t) + dy * Math.cos(t),
      { cx: b.cx, cy: b.cy, rx: b.rx * shrink, ry: b.ry * shrink, n: Math.min(b.n, 2) },
    ) < 1;
  }

  const checkEyes = (ls: Layout[]) => {
    for (const l of ls) {
      for (const e of l.eyes) {
        for (const [x, y] of corners(e)) {
          // First against the face, which is what the layout's `fit` promises…
          expect(inside(x!, y!, { ...l.face, n: 2 })).toBeLessThan(1);
          // …and then against the silhouette itself, which is what the face is
          // only a claim about. This is the assertion that catches a face table
          // retuned past what the shape can actually hold.
          expect(inBody(x!, y!, l)).toBe(true);
        }
      }
    }
  };


  /**
   * The check that makes `inBody` accountable to what is drawn.
   *
   * Everything above measures the eyes against a *model* of the silhouette — a
   * stadium for the capsule, a shrunken ellipse for the spline shapes, the cut
   * hull for the polygons. A model is a claim about the path, and nothing above
   * ever compares the two: the capsule shipped a middle drawn as a superellipse,
   * which rounds its corners by a fraction of the whole radius and so pinched
   * away from its own caps, while every test here went on asserting against the
   * stadium it was supposed to be. The caps stood proud of a waist that had
   * quietly shrunk, and the seed grid was the only place it showed.
   *
   * So the model is held against the outline the renderer emits, by flattening
   * the curves and testing points. Whichever of the ten drifts from what it
   * promises fails here — this is not a capsule test that happens to generalize.
   */
  const checkDrawn = (ls: Layout[]) => {
    // A margin, because the two agree exactly along the boundary wherever the
    // model is tight — the capsule's stadium *is* its outline — and a point
    // sampled onto that shared edge would decide the test by rounding. Interior
    // points only: a point counts as the model's when its neighbourhood does.
    const m = 0.3;
    for (const l of ls) {
      const has = drawn(l);
      for (let px = 2; px <= 98; px += 2) {
        for (let py = 2; py <= 98; py += 2) {
          const interior =
            inBody(px, py, l) &&
            inBody(px + m, py, l) && inBody(px - m, py, l) &&
            inBody(px, py + m, l) && inBody(px, py - m, l);
          if (!interior) continue;
          if (!has(px, py))
            throw new Error(
              `${l.shape}: (${px}, ${py}) is inside the model and outside the drawn outline`,
            );
        }
      }
    }
  };

  test("eyes sit inside the face, and the face inside the body", () => {
    checkEyes(layouts);
  });

  test("eyes never fuse into each other", () => {
    for (const l of layouts) {
      const [a, b] = l.eyes as [(typeof l.eyes)[0], (typeof l.eyes)[0]];
      const reach = (e: typeof a) => {
        const t = (e.rot * Math.PI) / 180;
        return Math.abs(e.rx * Math.cos(t)) + Math.abs(e.ry * Math.sin(t));
      };
      expect(Math.abs(b.cx - a.cx)).toBeGreaterThan(reach(a) + reach(b));
    }
  });

  test("decoration stays attached to the body", () => {
    for (const l of layouts) {
      for (const p of l.petals) {
        const d = Math.hypot(p.cx - l.body.cx, p.cy - l.body.cy);
        expect(d).toBeLessThan(l.body.rx * 0.95 + p.r);
      }
      // The droplet's taper is the one part meant to leave the core, so it is
      // checked the other way round: it starts at a tangent point, which has to
      // sit *on* the body ellipse. Off it either way and the union comes apart
      // — a gap below, or the crease that a cone stuck onto a ball shows.
      for (const d of l.extra) {
        const [x, y] = d.slice(1, d.indexOf("L")).split(" ").map(Number) as [number, number];
        expect(inside(x, y, { ...l.body, n: 2 })).toBeCloseTo(1, 2);
        // …and the curve it is tangent to has to be the one actually drawn, so
        // the body it hangs off stays a true ellipse rather than a squarer one.
        expect(l.body.n).toBe(2);
      }
    }
  });


  test("the drawn silhouette covers what the containment model claims", () => {
    // Sampled per shape rather than off the front of the sweep: `triangle` is
    // under 4% of seeds, so a flat slice would check it a dozen times while
    // `round` gets three hundred.
    const per = new Map<string, Layout[]>();
    for (const l of layouts) {
      const seen = per.get(l.shape) ?? [];
      if (seen.length < 120) seen.push(l);
      per.set(l.shape, seen);
    }
    checkDrawn([...per.values()].flat());
  });

  test("every shape in the vocabulary is reachable", () => {
    expect(new Set(layouts.map(l => l.shape))).toEqual(
      new Set([
        "round", "organic", "boxy", "nub", "cloud", "sun",
        "capsule", "triangle", "hexagon", "droplet",
      ]),
    );
  });

  test("the everyday shapes stay everyday and the loud ones stay rare", () => {
    const share = (s: string) => layouts.filter(l => l.shape === s).length / layouts.length;
    // Four more silhouettes than the previous generation and still not a uniform ten-way split:
    // rounds and pebbles carry a wall of these, and a triangle is a find.
    expect(share("round") + share("organic")).toBeGreaterThan(0.4);
    expect(share("triangle")).toBeLessThan(0.04);
    expect(share("sun") + share("hexagon") + share("droplet")).toBeLessThan(0.16);
  });

  test("all geometry stays inside the viewBox", () => {
    for (const s of SEEDS) {
      const svg = blobatar(s, { background: false });
      for (const m of svg.matchAll(/ d="([^"]+)"|<circle ([^>]+)>/g)) {
        const src = m[1] ?? m[2]!;
        for (const n of src.match(/-?\d+\.?\d*/g)!.map(Number)) {
          expect(n).toBeGreaterThanOrEqual(-0.01);
          expect(n).toBeLessThanOrEqual(100.01);
        }
      }
    }
  });

  /**
   * The same invariants under configuration rather than under seeds — the
   * corners a hashed sweep barely samples and an editor's sliders reach in one
   * drag. Same construction as the previous generation's block above, over Blobatar 2's key list.
   */
  describe("under trait overrides", () => {
    const MAPS: Record<string, number>[] = [];
    for (const v of [0, 0.5, 0.999999]) {
      const all: Record<string, number> = {};
      for (const k of BLOB_KEYS) all[k] = v;
      MAPS.push(all);
      for (const k of BLOB_KEYS) MAPS.push({ ...all, [k]: 0 }, { ...all, [k]: 0.999999 });
    }
    // Every shape band crossed with those extremes, since one `shape` value per
    // map would otherwise leave eight of the ten silhouettes untested here.
    for (const at of [0.1, 0.35, 0.55, 0.65, 0.75, 0.82, 0.89, 0.93, 0.96, 0.99]) {
      for (const v of [0, 0.5, 0.999999]) {
        const all: Record<string, number> = {};
        for (const k of BLOB_KEYS) all[k] = v;
        MAPS.push({ ...all, shape: at });
      }
    }
    let s = 1;
    for (let i = 0; i < 400; i++) {
      const m: Record<string, number> = {};
      for (const k of BLOB_KEYS) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        m[k] = s / 4294967296;
      }
      MAPS.push(m);
    }

    const cfg = MAPS.map(m => style.layout(traits("cfg", true, m)) as Layout);

    test("eyes sit inside the face, and the face inside the body", () => {
      checkEyes(cfg);
    });

    test("the drawn silhouette covers what the containment model claims", () => {
      checkDrawn(cfg);
    });

    test("all geometry stays inside the viewBox", () => {
      for (const m of MAPS) {
        const svg = blobatar("cfg", { traits: m, background: false });
        expect(svg).not.toContain("NaN");
        for (const g of svg.matchAll(/ d="([^"]+)"|<circle ([^>]+)>/g)) {
          for (const n of (g[1] ?? g[2]!).match(/-?\d+\.?\d*/g)!.map(Number)) {
            expect(n).toBeGreaterThanOrEqual(-0.01);
            expect(n).toBeLessThanOrEqual(100.01);
          }
        }
      }
    });
  });
});

describe("polygon", () => {
  test("sharp corners land exactly on the vertices", () => {
    // round: 0 means no cut, so the path walks the vertices themselves — the
    // property that makes `rx`/`ry` mean circumradius rather than something near it.
    const d = polygon({ cx: 50, cy: 50, rx: 20, ry: 20, sides: 4, round: 0 });
    expect(d).toContain("50 30");
    expect(d).toContain("70 50");
    expect(d).toContain("50 70");
    expect(d).toContain("30 50");
  });

  test("a vertex sits at the top, so a triangle rests on its base", () => {
    const d = polygon({ cx: 50, cy: 50, rx: 20, ry: 20, sides: 3, round: 0 });
    expect(d).toContain("50 30");
    // …and the other two are level, at cy + ry·sin(30°).
    expect(d).toContain("60");
    expect(d).not.toContain("50 70");
  });

  test("the outline never leaves the bounding box", () => {
    // Quadratics through the vertices stay in the convex hull of their control
    // points, which is what makes this true by construction rather than by luck.
    for (const sides of [3, 4, 5, 6, 8]) {
      for (let round = 0; round <= 1.0001; round += 0.1) {
        for (const rot of [0, 17, 90, -33]) {
          const d = polygon({ cx: 50, cy: 50, rx: 30, ry: 20, sides, round, rot });
          expect(d).not.toContain("NaN");
          expect(d).toEndWith("Z");
          for (const [i, v] of d.match(/-?\d+\.?\d*/g)!.map(Number).entries()) {
            const [lo, hi] = i % 2 === 0 ? [19.9, 80.1] : [29.9, 70.1];
            expect(v).toBeGreaterThanOrEqual(lo);
            expect(v).toBeLessThanOrEqual(hi);
          }
        }
      }
    }
  });

  test("full rounding drops the straight runs instead of emitting empty ones", () => {
    // At round: 1 the two cuts on an edge meet at its midpoint, so every `L`
    // would be zero-length. One per side, on a shape drawn once per blobatar.
    expect(polygon({ cx: 50, cy: 50, rx: 20, ry: 20, sides: 6, round: 1 })).not.toContain("L");
    expect(polygon({ cx: 50, cy: 50, rx: 20, ry: 20, sides: 6, round: 0.9 })).toContain("L");
  });
});
