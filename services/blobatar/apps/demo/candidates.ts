import {
  bakePose,
  poseVars,
  thinking,
  type Expression,
  type Pose,
  type Posable,
} from "blobatar/expression";

/**
 * The three `thinking` candidates, for the poll.
 *
 * **These are demo-local on purpose and two of them are meant to be deleted.**
 * A candidate is a question, not a feature, so none of this may reach the
 * published surface until one of them wins: `Pose` gains no channel, `motion.css`
 * gains no rule and no gzipped byte, and `test/golden` never sees these poses.
 * What makes that possible is the seam the library already has — `vars` and
 * `bake` ride on the `Expression` value rather than being imported by the
 * renderer, so an expression defined out here composes exactly like one defined
 * in the library. `candidates.css` carries the loops.
 *
 * The cost of staying out of the library is one channel each. `Pose` has no
 * *pair* translate — `edx` is convergence, mirrored per side, and `edy` is
 * vertical only — so the horizontal excursion both B and C need is a custom
 * property the CSS reads and a `bake` that shifts the eyes to match. If B or C
 * wins, that is precisely the channel to add, and the numbers below are the
 * numbers to add it with.
 *
 * ### The static frame is frame zero of the loop
 *
 * `thinking` already holds this rule and it is worth restating, because it is
 * what keeps a candidate honest: a blobatar with the stylesheet missing, or
 * under `prefers-reduced-motion`, holds *one frame of the swing* rather than a
 * separate resting pose nobody designed. So each `bake` below reproduces its
 * loop's 0% stop exactly — B parked away, C at the top of the circle — and each
 * `@keyframes` starts where its `bake` lands. Move one, move the other.
 */

/** The away fixation, in viewBox units. Read by `lookaway`'s bake and its CSS. */
export const GAZE = { x: -3.2, y: -2.2 };

/** The orbit radius, in viewBox units. Read by `orbit`'s bake and its CSS. */
export const ORBIT_R = 2.4;

/**
 * A `bake` that shifts the whole pair after the standard one, which is the
 * static half of a channel `Pose` does not have.
 *
 * It runs *after* `bakePose` rather than instead of it, so every ordinary
 * channel keeps behaving exactly as it does everywhere else and the only new
 * thing on the face is the translate. Both eyes take the same offset — a pair
 * that translates together is a face looking somewhere; a pair that translates
 * independently is a lazy eye, instantly.
 */
const bakeShifted =
  (dx: number, dy: number) =>
  <L extends Posable>(l: L, p: Pose) => {
    const r = bakePose(l, p);
    return {
      l: {
        ...r.l,
        eyes: r.l.eyes.map((e) => ({ ...e, cx: e.cx + dx, cy: e.cy + dy })),
      },
      wrap: r.wrap,
    };
  };

/**
 * **A — Seesaw.** The shipped pose, unchanged, listed here only so the poll
 * compares three things in one place. Two eyes at two heights trading places on
 * a 900ms ease — the two-dot loader, drawn with the two dots a blobatar already
 * has.
 */
export const seesaw = thinking;

/**
 * **B — Look away.** Both eyes travel off-axis together, hold, snap back to
 * centre, hold short, repeat.
 *
 * The one candidate that reads as *thought* rather than as *waiting*: it is what
 * a person does when they stop looking at you and go find the answer somewhere
 * over your shoulder. It is therefore also the only one that still says
 * something with nothing loading, which is the argument for it as an
 * *expression* rather than as a status indicator.
 *
 * The pose itself is deliberately quiet — a slight narrow and a slight lift —
 * because all of the meaning is in the excursion and its timing. A loud pose
 * underneath would be a second sentence competing with the first.
 *
 * Ballistic, not eased; see `candidates.css`. That is the whole animation.
 */
export const lookaway: Expression = {
  p: {
    esx: 1.05,
    esy: 0.72,
    tilt: 0,
    edy: -0.8,
    edx: 0,
    esx2: 0,
    esy2: 0,
    tilt2: 0,
    edy2: 0,
    lock: 1,
    heat: 0,
    shake: 0,
    rock: 0,
    bdy: 0,
  },
  vars: (p) => ({
    ...poseVars(p),
    "--mo-gaze-x": `${GAZE.x}px`,
    "--mo-gaze-y": `${GAZE.y}px`,
  }),
  bake: bakeShifted(GAZE.x, GAZE.y),
};

/**
 * **C — Orbit.** The pair traces a slow circle together, linear and continuous.
 *
 * The most legible of the three as pure progress — it is a spinner, and nobody
 * has to be taught a spinner. It is on the ballot as the honest "this is a
 * loading indicator" pole.
 *
 * Two things to watch for while judging it, because both are the reason it might
 * lose. Continuous circular motion with no dwell reads as **woozy**, and `sick`
 * is already in the roster wearing a tremor — check the two against each other
 * before voting. And linear circular motion is the most mechanical thing the
 * library would contain, which is on-message for a loader and off-message for a
 * face.
 *
 * The eyes orbit without spinning: the CSS conjugates the translate by the phase
 * angle, so the pair goes round while each eye keeps its own orientation.
 */
export const orbit: Expression = {
  p: {
    esx: 1.1,
    esy: 0.66,
    tilt: 0,
    edy: 0,
    edx: 0,
    esx2: 0,
    esy2: 0,
    tilt2: 0,
    edy2: 0,
    lock: 1,
    heat: 0,
    shake: 0,
    rock: 0,
    bdy: 0,
  },
  vars: (p) => ({ ...poseVars(p), "--mo-orbit-r": `${ORBIT_R}px` }),
  // 0% of `mo-orbit` is the top of the circle, so the static frame is the pair
  // riding high — the reading closest to the loop's own average, and the one
  // that does not look like a mistake when it is the only frame anyone sees.
  bake: bakeShifted(0, -ORBIT_R),
};

/** The ballot, in poll order. */
export const CANDIDATES: [string, Expression][] = [
  ["A · seesaw", seesaw],
  ["B · look away", lookaway],
  ["C · orbit", orbit],
];
