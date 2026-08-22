/**
 * The 590 people who starred the repo: who they are, where each one sits, and
 * the frame each one arrives on.
 *
 * The film's whole idea is that this list needs no illustration. A blobatar is
 * a pure function of a string and a stargazer is a string, so the thank-you and
 * the demo are the same shot — nobody in the crowd was designed, and the one on
 * screen belonging to a given viewer is the one they already have everywhere
 * else the library is used.
 *
 * `stars.json` is frozen at `capturedAt` and committed rather than fetched at
 * render time. Two reasons, and the second is the real one: a render whose
 * content changes when a stranger clicks a button is not a render, and the
 * placement below is *solved*, so re-fetching would silently reshuffle a
 * hundred cells and invalidate every check that ran against the old list.
 * Refreshing is a deliberate act — re-run the fetch in `scripts/check-stars.ts`
 * and commit the diff.
 */

import { traits } from "blobatar";
import data from "./stars.json";

export const REPO = data.repo;
export const CAPTURED_AT = data.capturedAt;

/** In star order, oldest first — the order GitHub returns them in. */
export const STARS = data.stars;
export const COUNT = STARS.length;

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/**
 * The crowd is a heart, and the heart is what fixes the cell size.
 *
 * 590 is not a number anybody chose, so the shape has to be solved to it
 * rather than the other way round: `CELLS` below ranks every cell in the
 * addressing grid by how far it sits along its own ray to the heart's boundary
 * and keeps the nearest `COUNT`. That yields exactly 590 cells whose outline is
 * a contour of the curve — no padding, no cell left half-used, and the same
 * construction still works if the list is ever refreshed to a different count.
 *
 * A heart is close to square and the frame is not, so `WIDE` stretches it to
 * 1.25 and buys back most of the cell size that a square shape would have cost
 * in a 16:9 frame — 38px a cell rather than 32. It still reads unmistakably as
 * a heart; most heart glyphs are wider than they are tall.
 *
 * The cells are small. A body is about 25px on screen at rest, which is a
 * mosaic rather than a portrait gallery, and that is the deliberate trade: the
 * silhouette resolving out of 590 arrivals is the shot, and the beats that need
 * an individual — the opening push-in, the anchored handle — bring the camera
 * or the type to them instead.
 */
export const COLS = 37;
export const ROWS = 30;
export const CELL = 38;

/** The heart, in cells: radius, horizontal stretch, and its offset from centre. */
const HEART_R = 11.5;
const HEART_WIDE = 1.25;
const HEART_DY = -0.145 * HEART_R;

const HEART_CX = COLS / 2;
const HEART_CY = ROWS / 2 + HEART_DY;

/** The blobatar's box inside a cell. */
export const BLOB = 36;

export interface Slot {
  readonly col: number;
  readonly row: number;
}

/**
 * `(x² + y² - 1)³ - x²y³`, negative inside the curve.
 *
 * The implicit value is not a distance — it is a cubic, so it plunges near the
 * centre and says nothing useful about how close a cell is to the edge. What
 * the ranking needs is a normalised radius, so every cell is measured against
 * the boundary *along its own ray*: the heart is star-shaped about its centre,
 * so that ray meets the curve exactly once and bisection finds it.
 */
const heartAt = (x: number, y: number) => {
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y;
};

const boundaryRadius = (ux: number, uy: number) => {
  let lo = 0.01;
  let hi = 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (heartAt(mid * ux, mid * uy) <= 0) lo = mid;
    else hi = mid;
  }
  return lo;
};

/** A cell's position as a fraction of the way to the heart's edge. 1 is on it. */
const heartMetric = (col: number, row: number) => {
  const x = (col + 0.5 - HEART_CX) / (HEART_R * HEART_WIDE);
  const y = -(row + 0.5 - HEART_CY) / HEART_R;
  const r = Math.hypot(x, y);
  if (r < 1e-9) return 0;
  return r / boundaryRadius(x / r, y / r);
};

/** The 590 cells that make the heart, nearest the centre first. */
const CELLS: (Slot & { m: number })[] = (() => {
  const all: (Slot & { m: number })[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) all.push({ col, row, m: heartMetric(col, row) });
  }
  all.sort((a, b) => a.m - b.m);
  return all.slice(0, COUNT);
})();

/** The heart's box in grid pixels — what the camera frames, not the whole grid. */
export const HEART_BOX = (() => {
  const cols = CELLS.map((c) => c.col);
  const rows = CELLS.map((c) => c.row);
  const minCol = Math.min(...cols);
  const minRow = Math.min(...rows);
  return {
    x: minCol * CELL,
    y: minRow * CELL,
    width: (Math.max(...cols) - minCol + 1) * CELL,
    height: (Math.max(...rows) - minRow + 1) * CELL,
  };
})();

/**
 * How many arrivals land on the seeded core before the crowd scatters.
 *
 * The camera makes exactly one move and it needs something to hold while it
 * makes it. These are the cells nearest the heart's centre, in order, so the
 * opening seconds are a handful of people gathering around the first star
 * rather than a scatter the camera cannot frame.
 *
 * Kept as small as the pull can live with. Every seeded cell is one the scatter
 * does not get, and a core much bigger than this stops reading as the people
 * who arrived first and starts reading as a lump in the middle of the noise —
 * which is what 36 looked like.
 */
const SEEDED = 18;

/**
 * The fill order: a seeded core, then scatter.
 *
 * The obvious order — outward from the centre, ring by ring — is what the first
 * cut did, and it is why its camera looked wrong. A crowd growing radially has
 * a radius that goes as √k, so a camera fitted to it spends two thirds of its
 * travel in the first three seconds and then barely moves for twenty: a lurch
 * and then a freeze, which is precisely how it read.
 *
 * Scattering fixes the shot and the camera together. The footprint is full size
 * within a second, so the camera can pull out once and then hold completely
 * still — the launch film's structure, and the beat in it that works. What
 * changes over the twenty seconds after that is density rather than extent, and
 * the heart resolves out of the noise like a photograph developing instead of
 * being drawn outward from a point.
 *
 * The scatter is a hash, not a shuffle: each cell is keyed by its own
 * coordinates through the library's own hash, so the order is fixed and
 * reproducible without a seeded RNG in a module that has to render the same
 * bytes every time.
 */
const ORDER: Slot[] = (() => {
  const core = CELLS.slice(0, SEEDED).map(({ col, row }) => ({ col, row }));
  const rest = CELLS.slice(SEEDED)
    .map(({ col, row }) => ({ col, row, k: traits(`cell:${col}:${row}`)("scatter") }))
    .sort((a, b) => a.k - b.k)
    .map(({ col, row }) => ({ col, row }));
  return [...core, ...rest];
})();

export const SLOTS: readonly Slot[] = ORDER;

const shapeOf = (v: number) =>
  v < 0.28
    ? "round"
    : v < 0.58
      ? "organic"
      : v < 0.72
        ? "boxy"
        : v < 0.84
          ? "nub"
          : v < 0.93
            ? "cloud"
            : "sun";

const read = (name: string) => {
  const t = traits(name);
  return { shape: shapeOf(t("shape")), hue: t.num("hue", 0, 360) };
};

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Same test the launch film's crowd check uses on the hero's neighbours. */
export const TWIN_HUE = 45;
export const twins = (a: string, b: string): boolean => {
  const x = read(a);
  const y = read(b);
  return x.shape === y.shape && hueGap(x.hue, y.hue) < TWIN_HUE;
};

/** How far a star may be moved from its own arrival slot, in slots. */
export const SWAP_WINDOW = 4;

const neighbours: number[][] = (() => {
  const index = new Map(ORDER.map((s, i) => [`${s.col},${s.row}`, i]));
  return ORDER.map((s) => {
    const out: number[] = [];
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const j = index.get(`${s.col + dc},${s.row + dr}`);
        if (j !== undefined) out.push(j);
      }
    }
    return out;
  });
})();

/**
 * The placement: which login lands in which slot.
 *
 * Star order and slot order are the same list, so the default placement is the
 * identity — the crowd gathers in the order it actually gathered. The problem
 * is that 590 real handles are not a curated list: 143 adjacent pairs come out
 * the same silhouette within 45° of hue, and a twin pair sitting side by side
 * is the one thing a film claiming "no two alike" cannot have on screen.
 *
 * So the placement is solved rather than asserted, and the perturbation is kept
 * small enough to be honest: a star may only trade slots with one arriving
 * within `SWAP_WINDOW` of it, which at the build's cadence is a fraction of a
 * second either way. Chained swaps can carry one a little further — the check
 * script reports the worst — but nobody moves from the beginning of the crowd
 * to the end of it, and the film never claims a precise order anyway.
 *
 * Greedy, deterministic, and it converges in a single pass with no collisions
 * left. If a future list does not converge, `scripts/check-stars.ts` fails with
 * the pairs that survived rather than letting them render.
 */
const solve = (): string[] => {
  const placed = STARS.map((s) => s.login);
  const badness = (i: number) =>
    neighbours[i]!.reduce((n, j) => n + (twins(placed[i]!, placed[j]!) ? 1 : 0), 0);

  // Arrival 0 is pinned. The film opens on the first star by name and holds on
  // them for two and a half seconds; a solver that trades that slot away to
  // break a twin makes the opening caption a lie about who got there first.
  for (let pass = 0; pass < 32; pass++) {
    let moved = 0;
    for (let i = 1; i < placed.length; i++) {
      if (!badness(i)) continue;
      let best = 0;
      let target = -1;
      const lo = Math.max(1, i - SWAP_WINDOW);
      const hi = Math.min(placed.length - 1, i + SWAP_WINDOW);
      for (let j = lo; j <= hi; j++) {
        if (j === i) continue;
        const before = badness(i) + badness(j);
        [placed[i], placed[j]] = [placed[j]!, placed[i]!];
        const after = badness(i) + badness(j);
        [placed[i], placed[j]] = [placed[j]!, placed[i]!];
        if (before - after > best) {
          best = before - after;
          target = j;
        }
      }
      if (target >= 0) {
        [placed[i], placed[target]] = [placed[target]!, placed[i]!];
        moved++;
      }
    }
    if (!moved) break;
  }
  return placed;
};

/** Login by slot. Slot `i` is also arrival `i`. */
export const PLACED: readonly string[] = solve();

// Beat boundaries.
export const B_ONE = 0;
/**
 * The camera's one move: out, and then never again.
 *
 * It starts before the crowd does and finishes after the crowd has started,
 * which is not tidiness — it is the fix for a real crop. At the opening scale
 * the frame holds about two and a half cells, so a second star landing beside
 * the first while the camera is still pushed in is half outside the frame. The
 * camera therefore gets a 60-frame head start, and the overlap at the other end
 * keeps the pull from reading as a separate empty beat before anything happens.
 * `scripts/check-stars.ts` walks every frame of this and is what caught it.
 */
export const B_PULL = 75;
export const PULL_LEN = 100;
export const B_BUILD = 135;
export const BUILD_LEN = 630;
export const B_HOLD = B_BUILD + BUILD_LEN;
/** The swap: every blobatar cross-fades to its owner's real GitHub avatar. */
export const B_SWAP = B_HOLD + 30;
export const SWAP_LEN = 150;
export const B_CARD = B_SWAP + SWAP_LEN + 30;
export const END = B_CARD + 130;

/**
 * The arrival curve, as an exponent on normalised progress.
 *
 * Below 1, so the crowd starts slow and floods: the first dozen arrivals are
 * legible as individual people showing up, which is the only stretch where a
 * viewer can read a handle, and the last two hundred are a wave, which is what
 * five hundred stars in four days actually felt like. A linear build spends its
 * opening seconds at a cadence too fast to read and its closing seconds too
 * slow to feel like anything.
 */
const CURVE = 0.62;

/** The frame arrival `i` lands on. Arrival 0 is on screen from frame 0. */
export const arrivalAt = (i: number): number =>
  i <= 0 ? B_ONE : B_BUILD + BUILD_LEN * Math.pow(i / (COUNT - 1), CURVE);

/**
 * How many have arrived by a frame, as a real number.
 *
 * Fractional on purpose: it is what the camera reads, and a camera driven by an
 * integer count steps once per arrival — at the end of the build that is thirty
 * jolts a second. Inverting the curve costs one `pow` and the pull-back comes
 * out continuous.
 */
export const arrivedAt = (frame: number): number => {
  if (frame <= B_BUILD) return 1;
  if (frame >= B_HOLD) return COUNT;
  const t = (frame - B_BUILD) / BUILD_LEN;
  return Math.min(COUNT, 1 + (COUNT - 1) * Math.pow(t, 1 / CURVE));
};

/**
 * The stage the heart is framed in, which is deliberately not the frame.
 *
 * The handle is a label on a person and has to sit under them, and the counter
 * has to sit somewhere that is not a face, so 90px of the frame's bottom is
 * reserved and the heart is centred in what is left. `CELL` was chosen so the
 * heart's 25 rows come out at exactly that height — the camera's rest scale is
 * therefore 1, and every cell renders at its natural size with nothing resampled.
 */
export const STAGE_CY = 40 + HEART_BOX.height / 2;

/** How far in the camera opens on the first star. Its body reads about 420px. */
export const OPEN = 11;

export interface Camera {
  scale: number;
  x: number;
  y: number;
}

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * The camera. One eased move out, and then it is nailed down for the rest of
 * the film.
 *
 * Authored rather than fitted to the crowd, which is the whole correction — a
 * fitted camera is a slave to how the crowd happens to grow, and the crowd
 * grows in a shape nobody wants a camera to copy. What keeps an authored camera
 * honest is that it can crop somebody, so `scripts/check-stars.ts` walks every
 * frame of the pull and asserts that no stargazer who has arrived is outside
 * the frame. The move is verified rather than eyeballed.
 */
export const camera = (frame: number): Camera => {
  const t =
    frame <= B_PULL ? 0 : frame >= B_PULL + PULL_LEN ? 1 : (frame - B_PULL) / PULL_LEN;
  const e = easeInOutCubic(t);
  const scale = OPEN + (1 - OPEN) * e;

  // Open centred on the first star's own cell; rest centred on the heart.
  const first = SLOTS[0]!;
  const fromX = (first.col + 0.5) * CELL;
  const fromY = (first.row + 0.5) * CELL;
  const toX = HEART_BOX.x + HEART_BOX.width / 2;
  const toY = HEART_BOX.y + HEART_BOX.height / 2;
  const cx = fromX + (toX - fromX) * e;
  const cy = fromY + (toY - fromY) * e;

  return { scale, x: WIDTH / 2 - cx * scale, y: STAGE_CY - cy * scale };
};
