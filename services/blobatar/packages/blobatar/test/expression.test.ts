import { describe, expect, test } from "bun:test";
import { blobatar, _layout, _parts } from "../src/blobatar";
import {
  bakePose,
  happy,
  idle,
  love,
  mad,
  poseVars,
  sad,
  scared,
  shy,
  sick,
  sleepy,
  smug,
  surprised,
  thinking,
  unsure,
  wink,
  type Expression,
  type Pose,
} from "../src/expression";
import { traits } from "../src/traits";

/**
 * Expressions multiply the seed space by the roster, and the interesting failures
 * live in that product rather than in either factor. A pose is safe on its own
 * and every seed is safe on its own; what these check is that no *pair* is
 * broken — a seed already at its clearance ceiling meeting the pose that tilts
 * hardest, a body scale pushing a sun's petals through the frame.
 *
 * The other half is the contract, which is cheap to assert and expensive to
 * discover broken: `idle` costs nothing, and every blobatar wears a given
 * expression at the same strength.
 */

const SEEDS = Array.from({ length: 4000 }, (_, i) => `seed-${i}`);
/** Labelled, because expressions are values now and a failure needs a name. */
const NAMED: [string, Expression][] = [
  ["happy", happy],
  ["sad", sad],
  ["mad", mad],
  ["surprised", surprised],
  ["wink", wink],
  ["sleepy", sleepy],
  ["smug", smug],
  ["unsure", unsure],
  ["scared", scared],
  ["love", love],
  ["shy", shy],
  ["sick", sick],
  ["thinking", thinking],
];
const ALL: [string, Expression][] = [["idle", idle], ...NAMED];

/** The four corners of a rotated box — a conservative hull for a capsule. */
function corners(e: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
}) {
  const t = (e.rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].map(([sx, sy]) => [
    e.cx + sx! * e.rx * c - sy! * e.ry * s,
    e.cy + sx! * e.rx * s + sy! * e.ry * c,
  ]);
}

describe("the contract", () => {
  test("idle is byte-identical to no expression at all", () => {
    // The whole determinism story depends on this: adding expressions in a minor
    // must not move a single existing blobatar.
    for (const s of SEEDS.slice(0, 500)) {
      expect(blobatar(s, { expression: idle })).toBe(blobatar(s));
    }
  });

  test("idle emits no custom properties, and no pose emits a channel it leaves alone", () => {
    expect(poseVars(idle.p)).toEqual({});
    expect(bakePose({ eyes: [] }, idle.p).wrap).toBe("");
    // `happy` and `sad` never tremble, so neither should ship `--mo-shake`.
    expect(poseVars(happy.p)).not.toHaveProperty("--mo-shake");
    expect(poseVars(mad.p)).toHaveProperty("--mo-shake");
    // Same for the seesaw: `thinking` is the only pose that moves over time, and
    // the stylesheet's loop has to collapse to nothing on all the others.
    for (const [name, e] of NAMED)
      if (name !== "thinking") {
        expect(poseVars(e.p), name).not.toHaveProperty("--mo-rock");
        expect(poseVars(e.p), name).not.toHaveProperty("--mo-edy2");
      }
    expect(poseVars(thinking.p)).toHaveProperty("--mo-rock");
    expect(poseVars(thinking.p)).toHaveProperty("--mo-edy2");
    // `heat` is a pose channel that is deliberately not a custom property: it
    // resolves to a colour in `tint` and the stylesheet never sees the number.
    expect(mad.p.heat).toBeGreaterThan(0);
    expect(poseVars(mad.p)).not.toHaveProperty("--mo-heat");
  });

  test("a named expression changes the markup", () => {
    for (const [name, e] of NAMED) {
      expect(blobatar("seed-1", { expression: e }), name).not.toBe(
        blobatar("seed-1"),
      );
    }
  });

  test("the animated markup does not depend on the expression", () => {
    // The invariant the whole custom-property design rests on: when animating,
    // a pose is *style*, so changing expression must change no byte of the
    // markup. It is asserted here rather than left implicit because React hands
    // this string to `dangerouslySetInnerHTML` — a single character of drift
    // rebuilds the subtree, which kills the morph (there is no previous
    // computed value to transition from) and restarts every idle animation
    // underneath it. Both symptoms are invisible to a static-markup test and
    // very visible on screen.
    for (const s of SEEDS.slice(0, 50))
      for (const [name, e] of ALL)
        expect(
          _parts(s, { animate: "always", expression: e }).inner,
          name,
        ).toBe(_parts(s, { animate: "always" }).inner);
  });

  test("a non-idle expression still marks the root class", () => {
    // The other half of the invariant above: `mo-expr` carries the enter/return
    // timing asymmetry (§7), so it has to keep existing — just not inside the
    // markup string.
    expect(_parts("alain", { animate: "hover" }).cls).toBe("mo-root");
    expect(_parts("alain", { animate: "hover", expression: idle }).cls).toBe(
      "mo-root",
    );
    for (const [name, e] of NAMED)
      expect(
        _parts("alain", { animate: "hover", expression: e }).cls,
        name,
      ).toBe("mo-root mo-expr");
  });

  test("every pose covers every channel", () => {
    // The morph is a transition between two vectors, so a channel missing from
    // one pose would jump rather than interpolate on the way to it.
    const keys = Object.keys(idle.p).sort();
    for (const [name, e] of ALL)
      expect(Object.keys(e.p).sort(), name).toEqual(keys);
  });
});

describe("geometry survives every expression", () => {
  const posed = (seed: string, e: Expression) =>
    _layout(seed, { expression: e });

  test("the two capsules never fuse, on any seed, in any expression", () => {
    for (const [name, e] of ALL) {
      for (const s of SEEDS) {
        const [a, b] = posed(s, e).eyes as unknown as [
          { cx: number; rx: number; ry: number; rot: number },
          { cx: number; rx: number; ry: number; rot: number },
        ];
        // Separating axis on x, same conservative test the idle geometry uses:
        // clearing it proves no overlap.
        const reach = (eye: typeof a) => {
          const t = (eye.rot * Math.PI) / 180;
          return (
            Math.abs(eye.rx * Math.cos(t)) + Math.abs(eye.ry * Math.sin(t))
          );
        };
        expect(Math.abs(b.cx - a.cx), name).toBeGreaterThan(
          reach(a) + reach(b),
        );
      }
    }
  });

  test("nothing leaves the frame, including the body offset", () => {
    // `bdy` is a `transform` on a wrapper rather than baked into path data, so
    // the emitted numbers do not carry it. Applied here instead.
    //
    // This used to have to model a scale and a lean as well, and modelled them
    // per-axis, which cannot see `skew` at all — it moves x *by* y. Extending it
    // caught `mad` leaning about two units outside the viewBox, which is part of
    // why the deforming body channels are gone: they were breaking the frame
    // before they were loud enough to read. What is left is a rigid translate on
    // one axis, and one axis is all this needs to check.
    //
    // Every path in this style is absolute `M`/`C`/`Q`, so the numbers alternate
    // x, y and the odd indices are the ones `bdy` moves.
    for (const [name, e] of NAMED) {
      for (const s of SEEDS.slice(0, 1500)) {
        const svg = blobatar(s, { expression: e, background: false });
        for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
          const n = m[1]!.match(/-?\d+\.?\d*/g)!.map(Number);
          for (let i = 1; i < n.length; i += 2) {
            const v = n[i]! + e.p.bdy;
            expect(v, name).toBeGreaterThanOrEqual(-0.5);
            expect(v, name).toBeLessThanOrEqual(100.5);
          }
        }
      }
    }
  });

  test("eyes stay on the body except where a glance already allows otherwise", () => {
    // The soft invariant. `sad` and `mad` push the pair around, and the tolerance
    // is the same one the saccade layer already established — an eye riding past
    // the outline reads as a face turning, not as a bug.
    for (const [, e] of NAMED) {
      for (const s of SEEDS.slice(0, 2000)) {
        const l = posed(s, e);
        const shrink =
          l.shape === "organic" || l.shape === "cloud"
            ? Math.min(...(l.body as { radii: number[] }).radii) * 0.95
            : 1;
        const core = {
          cx: l.body.cx,
          cy: l.body.cy,
          rx: l.body.rx * shrink * 1.12,
          ry: l.body.ry * shrink * 1.12,
          n: 2,
        };
        for (const eye of l.eyes as {
          cx: number;
          cy: number;
          rx: number;
          ry: number;
          rot: number;
        }[]) {
          for (const [x, y] of corners(eye)) {
            expect(
              Math.pow(Math.abs((x! - core.cx) / core.rx), core.n) +
                Math.pow(Math.abs((y! - core.cy) / core.ry), core.n),
            ).toBeLessThan(1);
          }
        }
      }
    }
  });
});

describe("per-eye asymmetry", () => {
  /**
   * The differential channels are the one place a pose distinguishes between
   * the two eyes, and the mechanism is split across two files that cannot see
   * each other: `bakePose` adds them to eye index 1, and `motion.css` multiplies
   * them by `--mo-sel`, which is `--mo-wrap` mapped from ±1 to 0/1. If those two
   * ever disagree about *which* eye is the second one, the static and animated
   * renderings quietly mirror each other. `scripts/probe-compose.ts` check A is
   * what would catch that; these are what say what the intent was.
   */
  const eyesOf = (p: Partial<typeof idle.p>) =>
    bakePose(
      {
        eyes: [
          { cx: 40, cy: 50, rx: 4, ry: 10, rot: 0 },
          { cx: 60, cy: 50, rx: 4, ry: 10, rot: 0 },
        ],
      },
      { ...idle.p, ...p },
    ).l.eyes;

  test("a differential moves the right eye and leaves the left alone", () => {
    const [l, r] = eyesOf({ esx: 1.5, esy: 0.4, tilt: 20, esx2: 0.5, esy2: 0.1, tilt2: 10 });
    // Left: the shared channels only.
    expect(l!.rx).toBeCloseTo(4 * 1.5);
    expect(l!.ry).toBeCloseTo(10 * 0.4);
    expect(l!.rot).toBeCloseTo(-20);
    // Right: shared plus differential — and the tilt differential is added
    // *before* the per-side mirroring, so it deepens the right lean rather than
    // flipping sign and cancelling into symmetry.
    expect(r!.rx).toBeCloseTo(4 * 2.0);
    expect(r!.ry).toBeCloseTo(10 * 0.5);
    expect(r!.rot).toBeCloseTo(30);
  });

  test("zero differentials are exactly the symmetric pose", () => {
    // The identity has to be free, or every existing pose would have to state
    // three channels it does not care about.
    const sym = eyesOf({ esx: 1.5, esy: 0.4, tilt: 20 });
    const asym = eyesOf({ esx: 1.5, esy: 0.4, tilt: 20, esx2: 0, esy2: 0, tilt2: 0 });
    expect(asym).toEqual(sym);
    expect(sym[0]!.rot).toBe(-sym[1]!.rot);
  });

  test("the roster's asymmetry survives into real geometry", () => {
    // Guarding against the differential being emitted but never applied — which
    // is exactly how `--mo-edx` managed to do nothing on the animated path for
    // an entire release. Measured as a *ratio* against the same seed's idle
    // eyes, because the two eyes differ per seed to begin with.
    for (const [name, e] of NAMED) {
      const p = e.p;
      if (!p.esy2 && !p.esx2 && !p.tilt2) continue;
      const base = _layout("seed-7") as { eyes: { ry: number; rot: number }[] };
      const posed = _layout("seed-7", { expression: e }) as typeof base;
      const grow = posed.eyes.map((eye, i) => eye.ry / base.eyes[i]!.ry);
      expect(Math.abs(grow[0]! - grow[1]!), name).toBeCloseTo(Math.abs(p.esy2));
    }
  });
});

describe("the tilt has real headroom", () => {
  /**
   * This replaces a per-seed clamp that turned out to be unnecessary.
   *
   * The worry was concrete: `mad` tilts the pair 14° on top of a seeded lean
   * that `styles/compose.ts` has already pushed to its clearance ceiling, and two
   * tall capsules swinging toward each other is the one failure that style calls
   * unsurvivable. Measured, it never happens: `mad` squashes the capsules on the
   * way in, and a shorter capsule sweeps sideways less per degree than the tilt
   * adds. The clamp was removed rather than kept as insurance, because it
   * engaged on 3.2% of seeds and quietly made their `mad` milder than everyone
   * else's — exactly the per-seed variation expressions are supposed not to have.
   *
   * So the guard is this margin instead. A future expression that spends the
   * headroom fails here, with a number, instead of fusing a face in production.
   */
  const reach = (e: { rx: number; ry: number; rot: number }) => {
    const t = (e.rot * Math.PI) / 180;
    return Math.abs(e.rx * Math.cos(t)) + Math.abs(e.ry * Math.sin(t));
  };

  test("the tightest pair in the space still clears by a wide margin", () => {
    for (const [name, e] of NAMED) {
      let min = Infinity;
      for (const s of SEEDS) {
        const l = _layout(s, { expression: e });
        const [a, b] = l.eyes as unknown as [
          { cx: number; rx: number; ry: number; rot: number },
          { cx: number; rx: number; ry: number; rot: number },
        ];
        min = Math.min(min, Math.abs(b.cx - a.cx) - reach(a) - reach(b));
      }
      // Units of the 100-unit viewBox, against bodies whose radius runs 22–38.
      // `mad` is the tight one at 2.5, so this is a live guard rather than
      // slack: it converges the pair *and* tilts it, and a future pose that
      // leans harder on either fails here first.
      expect(min, name).toBeGreaterThan(2);
    }
  });

  test("every blobatar wears the same strength of a given expression", () => {
    // The positive form of the same decision: no seed gets a milder `mad`. The
    // variation that makes a grid read as a crowd comes from the geometry the
    // pose lands on, never from the pose.
    //
    // A pose that locks the seeded lean makes the stronger claim — not the same
    // *change* in tilt per seed, the same tilt outright — so it is asserted on
    // the absolute angle. An unlocked pose can only promise the delta, since the
    // lean it adds to is the seed's.
    for (const [name, e] of NAMED) {
      const tilts = new Set(
        SEEDS.slice(0, 800).map((s) => {
          const l = _layout(s, { expression: e });
          const rot = (l.eyes[0] as { rot: number }).rot;
          const base =
            e.p.lock === 1 ? 0 : (_layout(s).eyes[0] as { rot: number }).rot;
          return Math.round((rot - base) * 1e6) / 1e6;
        }),
      );
      expect(tilts.size, name).toBe(1);
    }
  });

  test("a locked pose sits at exactly the angle it names", () => {
    // The brow is absolute, and the seeded lean is gone rather than diluted —
    // `mad`'s `\ /` cannot come out `\ \` on the seeds that lean with it.
    for (const [name, e] of NAMED) {
      if (e.p.lock !== 1) continue;
      for (const s of SEEDS.slice(0, 400)) {
        const [a, b] = _layout(s, { expression: e }).eyes as unknown as [
          { rot: number },
          { rot: number },
        ];
        expect(a.rot, name).toBeCloseTo(-e.p.tilt, 10);
        expect(b.rot, name).toBeCloseTo(e.p.tilt + e.p.tilt2, 10);
      }
    }
  });

  test("the seeded lean comes back the moment the expression clears", () => {
    // Locking is a property of the pose, not a permanent edit to the blobatar:
    // identity lives in the idle face and has to survive being posed.
    for (const s of SEEDS.slice(0, 200)) {
      const before = (_layout(s).eyes as { rot: number }[]).map((e) => e.rot);
      _layout(s, { expression: mad });
      const after = (_layout(s).eyes as { rot: number }[]).map((e) => e.rot);
      expect(after).toEqual(before);
    }
  });
});

describe("the seesaw", () => {
  /**
   * `thinking` is the first pose whose message is a duration, and the only one
   * where the static bake is a *frame* of something rather than the whole of it.
   * That makes the interesting geometry unreachable through `_layout` alone —
   * the frame it emits is one end of the travel, and the pose spends most of its
   * life somewhere else.
   *
   * So the phase is modelled here, exactly as `--mo-ph` computes it in
   * `motion.css`, and the guards the rest of this file runs on a still pose run
   * along the whole swing. This mirror is the same arrangement `--mo-sel` already
   * has in "per-eye asymmetry": two files that cannot see each other, and a test
   * that says what they are supposed to agree on.
   *
   *   left  = edy + edy2 · rock · (1 − ph) / 2
   *   right = edy + edy2 · ((1 − rock) + rock · (1 + ph) / 2)
   *
   * Both are expressible as a still pose — a shared offset plus a differential —
   * which is what lets every existing guard be pointed at them unchanged.
   */
  const atPhase = (p: Pose, ph: number): Pose => ({
    ...p,
    edy: p.edy + p.edy2 * p.rock * ((1 - ph) / 2),
    edy2: p.edy2 * (1 - p.rock + p.rock * ph),
    rock: 0,
  });

  const PHASES = [1, 0.5, 0, -0.5, -1];
  const frozen = (ph: number): Expression => ({
    ...thinking,
    p: atPhase(thinking.p, ph),
  });

  test("frame zero is exactly what bakePose emits", () => {
    // The identity the whole design rests on: `(1 + wrap · ph) / 2` is `--mo-sel`
    // at ph = 1, on both eyes, so the loop's extreme and the static pose are the
    // same geometry with no corrective term on either side. If this drifts, a
    // `thinking` blobatar rendered as an `<img>` and one rendered animated are
    // different faces.
    expect(atPhase(thinking.p, 1)).toEqual({ ...thinking.p, rock: 0 });
  });

  test("the pair trades heights without moving its mean", () => {
    // A seesaw and not a bounce, and this is the difference. `mo-bob` already
    // owns the pair moving together at its own period; a second loop on that
    // axis would beat against it.
    const mean = (ph: number) => {
      const [l, r] = bakePose(
        { eyes: [{ cx: 40, cy: 50, rx: 4, ry: 10, rot: 0 }, { cx: 60, cy: 50, rx: 4, ry: 10, rot: 0 }] },
        atPhase(thinking.p, ph),
      ).l.eyes;
      return (l!.cy + r!.cy) / 2;
    };
    for (const ph of PHASES) expect(mean(ph)).toBeCloseTo(mean(1));
  });

  test("the stagger really reverses", () => {
    // Amplitude, not decoration: the loop has to carry the pair through level
    // and out the other side, or it reads as a twitch rather than as work being
    // done. `rock` below 1 makes the return swing shallower than the outbound
    // one — see the channel's own note — so this asserts the sign flips, not
    // that the two ends mirror.
    const spread = (ph: number) => atPhase(thinking.p, ph).edy2;
    expect(Math.sign(spread(1))).toBe(-Math.sign(spread(-1)));
    expect(spread(0)).toBeCloseTo(thinking.p.edy2 * (1 - thinking.p.rock));
    expect(Math.abs(spread(-1))).toBeGreaterThan(0.5);
  });

  test("nothing fuses or leaves the body anywhere in the travel", () => {
    // Every other pose is checked at one point because it only has one. This one
    // gets the same two guards at five, and the middle of the swing is not the
    // safe part — it is where the pair is closest to level and the tilt-free
    // capsules sit nearest each other.
    for (const ph of PHASES) {
      const e = frozen(ph);
      for (const s of SEEDS.slice(0, 1500)) {
        const l = _layout(s, { expression: e });
        const [a, b] = l.eyes as unknown as [
          { cx: number; cy: number; rx: number; ry: number; rot: number },
          { cx: number; cy: number; rx: number; ry: number; rot: number },
        ];
        const reach = (eye: typeof a) => {
          const t = (eye.rot * Math.PI) / 180;
          return Math.abs(eye.rx * Math.cos(t)) + Math.abs(eye.ry * Math.sin(t));
        };
        expect(Math.abs(b.cx - a.cx), `ph=${ph}`).toBeGreaterThan(
          reach(a) + reach(b),
        );

        const shrink =
          l.shape === "organic" || l.shape === "cloud"
            ? Math.min(...(l.body as { radii: number[] }).radii) * 0.95
            : 1;
        const core = {
          cx: l.body.cx,
          cy: l.body.cy,
          rx: l.body.rx * shrink * 1.12,
          ry: l.body.ry * shrink * 1.12,
        };
        for (const eye of [a, b])
          for (const [x, y] of corners(eye))
            expect(
              Math.abs((x! - core.cx) / core.rx) ** 2 +
                Math.abs((y! - core.cy) / core.ry) ** 2,
              `ph=${ph}`,
            ).toBeLessThan(1);
      }
    }
  });

  test("a vertical differential moves the right eye only", () => {
    // `edy2`'s half of the mechanism, stated the way the other three are: it
    // lands on eye index 1, which is what `--mo-sel` selects on the animated
    // side. Disagreeing about which eye is the second one mirrors the pose
    // silently.
    const [l, r] = bakePose(
      { eyes: [{ cx: 40, cy: 50, rx: 4, ry: 10, rot: 0 }, { cx: 60, cy: 50, rx: 4, ry: 10, rot: 0 }] },
      { ...idle.p, edy: 2, edy2: -6 },
    ).l.eyes;
    expect(l!.cy).toBeCloseTo(52);
    expect(r!.cy).toBeCloseTo(46);
  });
});
