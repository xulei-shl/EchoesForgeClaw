/**
 * What the thank-you film depends on and a still cannot show.
 *
 * The crowd is not a curated list — it is 590 real GitHub handles, and every
 * property the shot relies on is an accident of who happened to star the repo.
 * So each one is checked rather than assumed:
 *
 * 1. **Everybody is on screen exactly once.** The film says "590 people" and
 *    then shows them; a login rendered twice, or dropped by a bug in the
 *    placement solver, makes that sentence false in a way nobody would catch by
 *    eye in a field of 590.
 *
 * 2. **No two neighbours are twins.** Same silhouette within 45° of hue, side
 *    by side, reads as the same blobatar rendered twice — which is precisely
 *    the doubt the film exists to remove.
 *
 * 3. **Nobody was moved far.** The solver trades slots to break twins, and the
 *    claim that the crowd gathers in the order it gathered survives a swap of a
 *    few places and does not survive a rewrite. The worst displacement is
 *    printed on every run so a refresh that quietly needs a bigger budget is
 *    visible rather than silent.
 *
 * 4. **The grid holds them.** `SLOTS` must be `COUNT` distinct cells inside the
 *    grid, or the fill order and the list have drifted apart.
 *
 * 5. **The camera never crops anybody.** It is authored rather than fitted to
 *    the crowd, which is what makes the pull-back watchable and also what makes
 *    it capable of leaving an arrived stargazer outside the frame. Every frame
 *    of the move is walked and every arrival checked against the viewport, so
 *    the one risk the authored camera introduces is the one thing measured.
 *
 * 6. **Everybody has a face to swap to, and it is their own.** The ending reads
 *    all 590 cells out of one sprite atlas by index. A missing index renders as
 *    a hole in the heart; a duplicated one renders as somebody wearing another
 *    person's face, which is worse, looks entirely correct, and is the reason
 *    the index is checked for being a bijection rather than merely present.
 *
 * Refreshing the list is deliberate — the render is frozen against a committed
 * `stars.json` on purpose. To refresh:
 *
 *   gh api repos/Alain00/blobatar/stargazers \
 *     -H "Accept: application/vnd.github.star+json" --paginate \
 *     --jq '.[] | {login: .user.login, at: .starred_at}'
 *
 * then rewrite `src/stars.json`, bump `capturedAt`, and run this.
 */

import {
  B_HOLD,
  B_PULL,
  camera,
  CAPTURED_AT,
  CELL,
  COLS,
  COUNT,
  HEIGHT,
  PLACED,
  PULL_LEN,
  REPO,
  ROWS,
  SLOTS,
  STARS,
  SWAP_WINDOW,
  TWIN_HUE,
  twins,
  WIDTH,
  arrivedAt,
} from "../src/stars";
import AVATARS from "../src/avatars.json";

let failed = false;
const fail = (msg: string) => {
  console.error(`✗ ${msg}`);
  failed = true;
};

console.log(`  ${REPO} — ${COUNT} stars, captured ${CAPTURED_AT}`);

// 1. Everybody, exactly once.
const logins = STARS.map((s) => s.login);
if (new Set(logins).size !== logins.length) fail("stars.json contains a duplicate login");
if (PLACED.length !== COUNT) fail(`PLACED has ${PLACED.length} entries for ${COUNT} stars`);
const missing = logins.filter((l) => !PLACED.includes(l));
if (missing.length) fail(`${missing.length} stargazers are not placed: ${missing.slice(0, 5)}`);
else if (!failed) console.log(`✓ all ${COUNT} stargazers appear exactly once`);

// 4. The grid holds them.
if (SLOTS.length !== COUNT) fail(`SLOTS has ${SLOTS.length} cells for ${COUNT} stars`);
const cells = new Set(SLOTS.map((s) => `${s.col},${s.row}`));
if (cells.size !== SLOTS.length) fail("two stargazers are placed in the same cell");
for (const { col, row } of SLOTS) {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) fail(`cell ${col},${row} is off the grid`);
}
console.log(`✓ ${SLOTS.length} distinct cells inside ${COLS}×${ROWS}`);

// 2. No twin neighbours.
const at = new Map(SLOTS.map((s, i) => [`${s.col},${s.row}`, i]));
let collisions = 0;
for (let i = 0; i < SLOTS.length; i++) {
  const { col, row } = SLOTS[i]!;
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (!dc && !dr) continue;
      const j = at.get(`${col + dc},${row + dr}`);
      if (j === undefined || j <= i) continue;
      if (twins(PLACED[i]!, PLACED[j]!)) {
        collisions++;
        if (collisions <= 5) fail(`${PLACED[i]} and ${PLACED[j]} are adjacent twins`);
      }
    }
  }
}
if (collisions > 5) fail(`…and ${collisions - 5} more adjacent twin pairs`);
if (!collisions) console.log(`✓ no neighbours share a silhouette within ${TWIN_HUE}°`);

// 3. Nobody was moved far.
const slotOf = new Map(PLACED.map((l, i) => [l, i]));
let worst = 0;
let worstLogin = "";
let moved = 0;
logins.forEach((login, i) => {
  const d = Math.abs(slotOf.get(login)! - i);
  if (d) moved++;
  if (d > worst) {
    worst = d;
    worstLogin = login;
  }
});
console.log(
  `  ${moved} of ${COUNT} traded slots to break twins; worst is ${worstLogin} by ${worst}` +
    ` (window ${SWAP_WINDOW})`,
);

// 5. The camera never crops an arrival.
//
// Walked over the pull and a beat past it rather than the whole film: the
// camera is nailed down after `PULL_LEN` and a still camera that contained the
// crowd on the frame it stopped contains it forever. A margin of half a cell is
// required rather than zero, because a blobatar breathes and bobs inside its
// cell and a body grazing the frame edge reads as a crop even when the box does
// not technically leave it.
const MARGIN = CELL / 2;
let worstFrame = -1;
// Starts at -Infinity, not 0: initialised to 0 this reports a clean pass as
// "0.0px" whatever the real clearance is, which is a number that looks like a
// near miss and is not one.
let worstOver = -Infinity;
for (let frame = B_PULL; frame <= B_PULL + PULL_LEN + 30; frame++) {
  const cam = camera(frame);
  const arrived = Math.ceil(arrivedAt(frame));
  for (let i = 0; i < arrived; i++) {
    const { col, row } = SLOTS[i]!;
    const left = cam.x + col * CELL * cam.scale;
    const top = cam.y + row * CELL * cam.scale;
    const right = left + CELL * cam.scale;
    const bottom = top + CELL * cam.scale;
    const over = Math.max(
      MARGIN - left,
      MARGIN - top,
      right - (WIDTH - MARGIN),
      bottom - (HEIGHT - MARGIN),
    );
    if (over > worstOver) {
      worstOver = over;
      worstFrame = frame;
    }
  }
}
if (worstOver > 0) {
  fail(
    `the camera crops an arrived stargazer by ${worstOver.toFixed(1)}px at frame ${worstFrame}`,
  );
} else {
  console.log(
    `✓ the camera never crops an arrival — closest approach ${(-worstOver).toFixed(1)}px` +
      ` inside the margin`,
  );
}

// The camera has to be still once the build is under way, or the shot is the
// fitted camera again by another name.
const held = camera(B_PULL + PULL_LEN);
const still = camera(B_HOLD);
if (held.scale !== still.scale || held.x !== still.x || held.y !== still.y) {
  fail("the camera is still moving after the pull");
} else {
  console.log(`✓ the camera is still from frame ${B_PULL + PULL_LEN} to the end`);
}

// 6. Everybody has a face to swap to, and it is their own.
const ATLAS_COLS = 25;
const ATLAS_ROWS = 24;
const faces = AVATARS as Record<string, number>;
let faceless = 0;
const seenFace = new Map<number, string>();
for (const login of PLACED) {
  const face = faces[login];
  if (face === undefined) {
    if (faceless < 3) fail(`${login} has no entry in avatars.json`);
    faceless++;
    continue;
  }
  if (!Number.isInteger(face) || face < 0 || face >= ATLAS_COLS * ATLAS_ROWS) {
    fail(`${login} points at atlas cell ${face}, which is not on the sheet`);
    faceless++;
    continue;
  }
  const taken = seenFace.get(face);
  if (taken) fail(`${login} and ${taken} both point at atlas cell ${face}`);
  seenFace.set(face, login);
}
if (faceless > 3) fail(`…and ${faceless - 3} more stargazers without a usable avatar`);
if (!(await Bun.file("public/avatar-atlas.png").exists())) {
  fail("public/avatar-atlas.png is missing — run `bun scripts/build-avatars.ts`");
} else if (!faceless && seenFace.size === COUNT) {
  console.log(`✓ all ${COUNT} stargazers have their own cell on the avatar atlas`);
}

process.exit(failed ? 1 : 0);
