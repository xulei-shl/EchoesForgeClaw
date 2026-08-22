/**
 * Two things the triangles film depends on that no still can show.
 *
 * 1. **The impostor has to arrive with the field.** It is a find, and a find
 *    that is already on screen is a prop. The camera climbs through five rests,
 *    and at the fourth it holds roughly eleven columns — so a defector inside
 *    that box would sit at size, in frame, for two and a half seconds before
 *    the reveal it is supposed to be part of. Checked against every frame
 *    rather than against the rest positions, because the springs overshoot and
 *    an overshoot is exactly where an extra column comes from.
 *
 * 2. **The last rung must not open a gap at the frame edge.** The final spring
 *    overshoots *past* scale 1 — outwards — so the field has to be oversized
 *    enough to still cover the frame at the bottom of that recoil. It is, by
 *    96px on each axis, but the margin is a function of three numbers that live
 *    apart from each other: the grid's size, the spring's damping, and the
 *    ladder's ends. Change any one and the ground swings in for four frames,
 *    which is exactly long enough to see and far too short to find by scrubbing.
 */

import {
  CELL, COLS, EGG_COL, EGG_ROW, END, GRID_X, GRID_Y, HERO_COL, HERO_ROW,
  JUMP_AT, ROWS, camera,
} from "../src/Triangles";
import { HEIGHT, WIDTH } from "../src/timeline";

const HERO_X = GRID_X + (HERO_COL + 0.5) * CELL;
const HERO_Y = GRID_Y + (HERO_ROW + 0.5) * CELL;

/** A grid point in screen space, under a frame's camera. */
const project = (frame: number, gx: number, gy: number) => {
  const c = camera(frame);
  return { x: c.x + (gx - HERO_X) * c.scale, y: c.y + (gy - HERO_Y) * c.scale };
};

// --- 1. the impostor stays off screen until the last jump -------------------

const LAST_JUMP = JUMP_AT[JUMP_AT.length - 1]!;

let worst = Infinity;
let worstFrame = -1;

for (let f = 0; f < LAST_JUMP; f++) {
  const a = project(f, GRID_X + EGG_COL * CELL, GRID_Y + EGG_ROW * CELL);
  const b = project(f, GRID_X + (EGG_COL + 1) * CELL, GRID_Y + (EGG_ROW + 1) * CELL);

  // How far the cell's nearest edge sits outside the frame, in cells. Negative
  // means some of it is inside, on both axes at once — which is what "visible"
  // means and what this is here to forbid.
  const gapX = Math.max(-b.x, a.x - WIDTH);
  const gapY = Math.max(-b.y, a.y - HEIGHT);
  const gap = Math.max(gapX, gapY) / (CELL * camera(f).scale);

  if (gap < worst) {
    worst = gap;
    worstFrame = f;
  }
}

if (worst <= 0) {
  console.error(
    `✗ the impostor at col ${EGG_COL}, row ${EGG_ROW} is on screen at frame ${worstFrame}, ` +
      `${(-worst).toFixed(2)} cells inside the frame — it must not appear before frame ${LAST_JUMP}`,
  );
  process.exit(1);
}

console.log(
  `✓ impostor hidden for ${LAST_JUMP} frames — closest approach ${worst.toFixed(2)} cells ` +
    `outside the frame, at frame ${worstFrame}`,
);

// --- 2. the last rung does not open a gap at the sides ----------------------

let bare = 0;
let bareFrame = -1;
let minScale = Infinity;

for (let f = LAST_JUMP; f < END; f++) {
  const { scale } = camera(f);
  minScale = Math.min(minScale, scale);

  const left = project(f, GRID_X, GRID_Y).x;
  const right = project(f, GRID_X + COLS * CELL, GRID_Y).x;
  const top = project(f, GRID_X, GRID_Y).y;
  const bottom = project(f, GRID_X, GRID_Y + ROWS * CELL).y;
  const gap =
    Math.max(left, 0) + Math.max(0, WIDTH - right) +
    Math.max(top, 0) + Math.max(0, HEIGHT - bottom);

  if (gap > bare) {
    bare = gap;
    bareFrame = f;
  }
}

// A pixel of slack: the overshoot is the point of the spring, and a hairline is
// beneath the encoder's noise floor. Two is where an eye starts to catch an edge.
if (bare > 2) {
  console.error(
    `✗ the final overshoot swings ${bare.toFixed(1)}px of bare ground in at the frame edge ` +
      `on frame ${bareFrame} (scale dips to ${minScale.toFixed(4)})`,
  );
  process.exit(1);
}

console.log(
  `✓ no edge gap on the settle — worst ${bare.toFixed(1)}px, scale dips to ${minScale.toFixed(4)}`,
);
console.log(`  grid ${COLS}×${ROWS}, ${COLS * ROWS} cells, ${END} frames`);
