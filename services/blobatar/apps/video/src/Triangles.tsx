/**
 * The triangles film: one shot, one shape, one pose.
 *
 * The claim is narrower than the launch film's and the structure follows it.
 * There is no round-trip to prove and no card to land on — the whole argument
 * is that a field pinned to one silhouette still comes out 252 different
 * creatures, and that they all think together. So the camera does exactly one
 * thing, and nothing else in the frame moves except the blobatars.
 *
 * Two pins, and they are the film:
 *
 * 1. **`traits.shape` is pinned into the triangle band.** The name still drives
 *    hue, tone, face and every layout range; only the silhouette is taken away
 *    from it. That is what makes the grid legible as a claim about variety
 *    rather than a claim about triangles — hold the loudest trait constant and
 *    the rest is still visibly per-name.
 *
 * 2. **Every face holds `thinking`.** Which is the one pose in the library with
 *    a loop of its own: `mo-rock` swings `--mo-rockp` on `.mo-eye`, and unlike
 *    blink and breathe it takes no seeded phase — a grid of loading indicators
 *    syncopated would read as a fault, so `motion.css` deliberately runs them in
 *    unison. That is the shot. 252 creatures breathing out of phase and thinking
 *    in phase, which no still of this grid can show.
 *
 * `seek.css` grew a `.mo-eye` rule for this film. Without it the seesaw is the
 * one channel Remotion does not freeze deterministically, and it is also the
 * only channel anybody is watching.
 */

import type { FC } from "react";
import { Blobatar } from "@blobatar/react";
import { thinking } from "blobatar/expression";
import { interpolate, spring, useCurrentFrame } from "remotion";
import { CROWD } from "./names";
import { FPS, HEIGHT, WIDTH } from "./timeline";
import "blobatar/motion.css";
import "./seek.css";

/**
 * Light, unlike the other two films.
 *
 * They are announcements and wear the site's ink; this is a texture shot posted
 * on its own. The tinted squircles carry the colour here, and on `#0a0a0b` the
 * pale end of the tone set — half the field — disappears into the ground.
 *
 * `#f4f5f8` is the demo wall's ground, taken from it deliberately rather than
 * picked: the backdrops `color.ts` builds sit at OKLCh lightness 0.965, and the
 * whole reason they read as *soft colour* rather than as grey is that the ground
 * behind them is a hair darker and completely neutral. Move it either way and
 * the field loses its tint — darker and the backdrops flatten to white tiles,
 * lighter and they vanish. This is a matched pair, not two independent choices.
 */
const BG = "#f4f5f8";

/**
 * 21 × 12 at 96px is 2016 × 1152 — bigger than the frame on both axes, on
 * purpose, and centred so it bleeds off all four edges.
 *
 * The obvious build is a field sized to fit exactly at scale 1. It was the
 * first one, and the last spring broke it: the settle overshoots *outwards*,
 * down to scale 0.958, which swung 81px of bare ground in at the sides for a
 * few frames — measured, not guessed, by `check-triangles.ts`, which is the
 * only reason it was caught at all. A field with nothing past its edge has
 * nothing to give when the camera pulls a hair too far.
 *
 * Oversizing fixes that and is the more honest picture anyway. Both the demo
 * wall and the reference grid run edge to edge; a field that stops, with ground
 * visible all the way round, reads as a poster of a grid rather than as a crowd
 * that carries on past the frame.
 */
export const CELL = 96;
export const COLS = 21;
export const ROWS = 12;
export const GRID_X = (WIDTH - COLS * CELL) / 2;
export const GRID_Y = (HEIGHT - ROWS * CELL) / 2;

/**
 * The blobatar's box inside a cell — which is also the squircle, since the
 * backdrop is the full viewBox.
 *
 * 88 in a 96 cell, so 8px of ground shows between neighbours. Measured off the
 * reference grid rather than picked: at 92 the squircles very nearly touch and
 * the field reads as one tinted sheet with triangles on it, which is a
 * different picture. The gap is what keeps 252 separate creatures separate.
 */
const BLOB = 88;

/**
 * The cell the film opens on, a little off centre.
 *
 * Dead centre would put the pull-back's fixed point on the frame's own centre
 * and the move would read as a plain scale. Off by a cell and a half in each
 * direction, the field drifts as it arrives — which is what makes it read as a
 * camera pulling back rather than a grid growing.
 */
export const HERO_COL = 9;
export const HERO_ROW = 5;

const HERO_X = GRID_X + (HERO_COL + 0.5) * CELL;
const HERO_Y = GRID_Y + (HERO_ROW + 0.5) * CELL;

/**
 * The ladder.
 *
 * The pull-back is not a move, it is five rests with four jumps between them,
 * and each jump quadruples the number of cells on screen: roughly one, then
 * six, then twenty, then seventy, then the field. A continuous ramp shows the
 * same range and says nothing, because there is no frame in it the eye is
 * invited to stop on — every count between one and two hundred goes by at the
 * same speed. Stepping it turns the range into a *count*, and the count is the
 * claim.
 *
 * The rungs are geometric between the two ends rather than a written-down list,
 * and that is worth the two lines it costs. The obvious list — one cell tall,
 * then two, then four, then eight, then the grid — has a broken last step: the
 * field is 11.25 cells tall, so its final jump is 1.4× where every other jump
 * is 2×, and a ladder whose last rung is three quarters of the way to the
 * previous one reads as a hiccup at exactly the moment the film is supposed to
 * resolve. Spacing them evenly in log space costs the round numbers and buys a
 * last beat the same size as the first.
 *
 * `OPEN` is one cell filling the frame's height. `1` is the other end, where a
 * cell is exactly its authored 96px and the field sits a little larger than the
 * frame on every side — see `COLS` for why it is not sized to fit.
 */
const OPEN = HEIGHT / CELL;
const JUMPS = 4;

export const SCALES: readonly number[] = Array.from(
  { length: JUMPS + 1 },
  (_, i) => (i === JUMPS ? 1 : OPEN ** (1 - i / JUMPS)),
);

/** Frames held at each rest, and frames spent springing to the next. */
const HOLD = 24;
const JUMP = 28;

/** The opening hold runs long: it is the only rung with a face big enough to read. */
const FIRST_HOLD = 34;

/** And the last, which is the frame anybody screenshots. */
const LAST_HOLD = 56;

/**
 * When each jump begins. Rung `i` rests until `JUMP_AT[i]`, then springs.
 *
 * Derived rather than written down for the same reason `url.ts` derives its
 * beats: adding a rung by hand would mean re-typing every later number, and the
 * one that gets missed is silent — the film still renders, it just holds wrong.
 */
export const JUMP_AT: readonly number[] = SCALES.slice(0, -1).map(
  (_, i) => FIRST_HOLD + i * (JUMP + HOLD),
);

export const END = JUMP_AT[JUMP_AT.length - 1]! + JUMP + LAST_HOLD;

/**
 * Under-damped on purpose.
 *
 * A critically damped step is a step; this one overshoots by a few percent and
 * settles, so each rung arrives with a small recoil — the grid pulls back a
 * hair too far and comes home. That is the difference between a slideshow of
 * five zoom levels and something that reads as a camera being yanked.
 *
 * `overshootClamping` stays off (it is what the overshoot *is*), and the
 * duration is stated rather than solved so the rungs are evenly spaced in time.
 */
const SPRING = { damping: 13, mass: 0.85, stiffness: 120 };

/**
 * The scale on a frame.
 *
 * Interpolated geometrically — `a · (b/a)^t` — not linearly. Zoom is perceived
 * in ratios, so a linear walk from 11.25 to 5.625 spends its first half moving
 * visibly faster than its second, and the recoil at the top of the ladder would
 * read twice as violent as the identical recoil at the bottom. In log space
 * every rung is the same jump, which is what "each step quarters it" has to
 * look like as well as arithmetically be.
 *
 * The spring's `t` runs past 1 on the overshoot and the exponential follows it
 * past the target, which is exactly the wanted recoil and the reason this is
 * not clamped.
 */
function scaleAt(frame: number): number {
  let scale = SCALES[0]!;
  for (let i = 0; i < JUMP_AT.length; i++) {
    const t = spring({
      frame: frame - JUMP_AT[i]!,
      fps: FPS,
      config: SPRING,
      durationInFrames: JUMP,
    });
    scale *= (SCALES[i + 1]! / SCALES[i]!) ** t;
  }
  return scale;
}

/**
 * The camera: a scale, and the screen point the opening cell is pinned to.
 *
 * The pan is a function of the scale rather than of the frame, so it inherits
 * the ladder — including the recoil — for free, and cannot drift out of step
 * with it when a rung or a hold moves. `0` is the opening rung and `1` is the
 * field; the pinned point walks from the frame's centre to where the cell
 * actually sits at scale 1, which is what lands the grid square in the frame.
 */
export function camera(frame: number): { scale: number; x: number; y: number } {
  const scale = scaleAt(frame);
  // Negated because the ladder descends and `interpolate` requires a strictly
  // increasing input range. Stated here rather than by swapping the output pair,
  // so the 0-is-the-opening-rung reading survives.
  const t = interpolate(
    -Math.log(scale),
    [-Math.log(SCALES[0]!), -Math.log(SCALES[SCALES.length - 1]!)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return {
    scale,
    x: WIDTH / 2 + (HERO_X - WIDTH / 2) * t,
    y: HEIGHT / 2 + (HERO_Y - HEIGHT / 2) * t,
  };
}

/**
 * The seeds.
 *
 * `CROWD` is 119 names and the grid is 252 cells, so the tail is suffixed
 * rather than wrapped. Wrapping would repeat a name — and with the shape pinned,
 * a repeated name is a *visibly identical* cell, which in a shot arguing that
 * one silhouette still yields 252 creatures is the one thing that cannot appear.
 * `ada` and `ada1` hash independently and land nowhere near each other.
 */
export const seedAt = (i: number): string => {
  const n = CROWD.length;
  const wrap = Math.floor(i / n);
  return wrap === 0 ? CROWD[i]! : `${CROWD[i % n]!}${wrap}`;
};

/**
 * Pinned mid-band, not at the edge.
 *
 * The triangle band is [0.98, 1) and `shape` is clamped into [0, 1), so 1 would
 * land on the band above's boundary handling rather than reliably inside this
 * one. 0.99 is the middle of the band and cannot drift onto a neighbour if the
 * bands are ever re-cut by a hair.
 */
const TRIANGLE = 0.99;

/**
 * The impostor, and the middle of the `round` band.
 *
 * `round` is the first band and the commonest shape in the library — which is
 * the joke. The odd one out is not an exotic silhouette nobody has seen, it is
 * the *default*, sitting in a field that has been told to be something else.
 */
const CIRCLE = 0.11;

/**
 * Where it sits, and the constraint that chose the cell.
 *
 * Not the centre and not the opening cell, for the obvious reasons. The real
 * constraint is less obvious: the camera only reaches this column on the last
 * rung. At rung three the frame holds roughly columns 4 to 15 and rows 2 to 8,
 * so a defector inside that box would already be on screen — sitting there for
 * two and a half seconds, at size, while the film is still climbing. It has to
 * arrive *with* the field, in the same beat that turns sixty-seven cells into
 * two hundred and twenty, or it is not a find, it is just a circle.
 *
 * Column 17 clears that box with a cell and a third to spare, overshoot included.
 * `check-triangles.ts` holds the margin open rather than trusting this comment.
 */
export const EGG_COL = 17;
export const EGG_ROW = 8;

const Cell: FC<{ i: number; col: number; row: number }> = ({ i, col, row }) => (
  <div
    style={{
      position: "absolute",
      left: GRID_X + col * CELL,
      top: GRID_Y + row * CELL,
      width: CELL,
      height: CELL,
      display: "grid",
      placeItems: "center",
    }}
  >
    <Blobatar
      name={seedAt(i)}
      animate="always"
      expression={thinking}
      background="squircle"
      // The pin is the only thing that differs. The impostor is not a special
      // case anywhere else in this film: same seed rule, same pose, same
      // animation, same size — so it is a real blobatar of the same crowd that
      // simply hashed somewhere else, which is funnier than a prop would be.
      traits={{ shape: col === EGG_COL && row === EGG_ROW ? CIRCLE : TRIANGLE }}
      size={BLOB}
    />
  </div>
);

export const Triangles: FC = () => {
  const frame = useCurrentFrame();
  const cam = camera(frame);

  return (
    <div
      style={{
        ["--vid-t" as string]: `${(frame / FPS) * 1000}ms`,
        width: WIDTH,
        height: HEIGHT,
        background: BG,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: "0 0",
          transform: `translate(${cam.x - HERO_X * cam.scale}px, ${
            cam.y - HERO_Y * cam.scale
          }px) scale(${cam.scale})`,
        }}
      >
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <Cell key={i} i={i} col={i % COLS} row={Math.floor(i / COLS)} />
        ))}
      </div>
    </div>
  );
};
