import { NAMES } from "@/names";
import { FIRST, REACH, cell, cellIndex, chunkKey, chunkOf, type Cell } from "./geometry";
import { chunkMap, type ChunkBody, type Placement } from "./chunk";
import { FACE_NAMES } from "./expressions";
import type { Source } from "./source";

/**
 * A wall that never existed, for building the renderer against.
 *
 * Deterministic on purpose — a fixture that reshuffles is one you cannot eyeball
 * a change against, and every placement here is also asserted to have been
 * *legal in the order it was made*, so this doubles as a worked example of the
 * rules rather than a bag of coordinates that merely looks right.
 *
 * It is three things a real wall should be able to contain at once: a dense
 * core where everyone piled in, a bridge somebody walked outward a cell at a
 * time, and a word drawn in occupancy at the end of it.
 */

/** Deterministic noise. Not `Math.random`: see above. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * "HI", three cells wide a letter, five tall, as offsets from its top-left.
 *
 * Small enough that a handful of people could plausibly have made it, which is
 * the point of putting it in a fixture: it is the smallest thing that reads as
 * deliberate from far enough out, and the renderer has to make it legible.
 */
const WORD: Cell[] = [
  ...[0, 1, 2, 3, 4].flatMap((y) => [{ x: 0, y }, { x: 4, y }]),
  { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 },
  ...[0, 1, 2, 3, 4].map((y) => ({ x: 6, y })),
];

/**
 * When the fixture's wall started, as whole seconds since the epoch.
 *
 * A constant rather than a clock: this file must produce the same wall on every
 * run, and "two hours ago" in a fixture is a date that changes underneath the
 * test asserting it.
 */
const OPENED = 1_767_225_600; // 2026-01-01

/**
 * How many attempts the crowd is grown from.
 *
 * Attempts, not placements: a good half of them land on a cell somebody already
 * has or out past the soft edge, and both of those are the model working — a
 * wall where every arrival finds an empty cell is a wall with no clumps in it.
 * The number of blobatars this actually produces is asserted in `chunk.test.ts`,
 * because "thousands" is the whole point of the fixture and a change that
 * quietly halved it would otherwise go unnoticed.
 */
const CROWD = 48000;

/**
 * How many neighbours make a cell too hemmed in to take.
 *
 * A hard ceiling rather than a probability, because a probability loses: with
 * tens of thousands of attempts, any cell that *can* be taken eventually is,
 * and the middle saturates however steeply the odds fall off. Four means
 * nothing is ever placed into a pocket with more than three neighbours already
 * around it, which leaves the lattice full of holes at every scale rather than
 * only at the rim.
 */
const CROWDED = 4;

/**
 * How far the crowd has spread.
 *
 * 40 is about five thousand cells in the core alone, which is the size this
 * fixture is for: it is the only large wall that exists — the real one is
 * empty until people fill it — so it doubles as the load the renderer is
 * profiled against. A viewport at reading zoom sees a fraction of it and one
 * zoomed fully out still cannot hold it all, which is the point. It was 14, a
 * few hundred cells, and a few hundred is not a number anything gets slow at.
 *
 * The cost is that building it is no longer free: `history()` walks every ring
 * out to here, and the tests that replay it now do real work. Worth it — the
 * alternative is a renderer whose performance nobody finds out about until the
 * wall is popular.
 */
export const RADIUS = 76;

/** Where the word was drawn, as the top-left of its 7x5 box. Far enough out to
 * be its own thing, close enough that the bridge to it is a few stones rather
 * than a project. Placed relative to the crowd, so growing the core walks the
 * word out ahead of it instead of letting it be swallowed. */
const WORD_AT: Cell = { x: RADIUS + 32, y: -(RADIUS + 18) };

/**
 * Four outlying neighbourhoods, as offsets from the origin.
 *
 * The core alone is one dense blob three chunks across, which exercises drawing
 * but not *fetching*: every cell in it is in a handful of chunks that arrive
 * together. These push the wall out to roughly nine chunks a side, so panning
 * crosses real boundaries and loads real chunks — and they are what a wall with
 * a history actually looks like, which is not one crowd.
 *
 * Each is reached by its own bridge, like the word, because the rules do not
 * make an exception for a group.
 */
const SATELLITES: Cell[] = [
  { x: -(RADIUS + 62), y: -(RADIUS + 40) },
  { x: RADIUS + 74, y: RADIUS + 30 },
  { x: -(RADIUS + 30), y: RADIUS + 76 },
  { x: RADIUS + 96, y: -(RADIUS + 88) },
];

/** How big a neighbourhood is. Small enough to read as a group rather than as a
 * second core. */
const SATELLITE_RADIUS = 11;

/** Attempts per neighbourhood, in the same currency as `CROWD` — about the same
 * density as the crowd, so they read as the same wall. */
const SATELLITE_ATTEMPTS = 900;

/**
 * The wall's history, in the order it was placed.
 *
 * Ordered rather than a set, because order is what makes it checkable: reach is
 * a rule about the wall as it stood at the time, so a fixture that is legal
 * only as a finished picture is not a fixture of anything.
 */
export function history(): (Cell & Placement)[] {
  const random = prng(0xb10b);
  const out: (Cell & Placement)[] = [];
  const taken = new Set<string>();

  /**
   * The placed cell closest to a target.
   *
   * A bridge has to start from wherever the crowd actually reaches, not from
   * the origin: with a core forty cells across, a walk that began at 0,0 would
   * spend its first stones inside the crowd, and — worse — the stone spacing
   * would be measured from a point the wall had long since grown past.
   */
  const nearest = (to: Cell): Cell => {
    let best = out[0] ?? cell(0, 0);
    let far = Infinity;
    for (const placed of out) {
      const d = (placed.x - to.x) ** 2 + (placed.y - to.y) ** 2;
      if (d < far) {
        far = d;
        best = placed;
      }
    }
    return best;
  };

  const place = (rawX: number, rawY: number) => {
    // Through the constructor: a ring walk at radius zero counts from `-0`.
    const { x, y } = cell(rawX, rawY);
    const at = `${x},${y}`;
    if (taken.has(at)) return;
    taken.add(at);
    const name = NAMES[out.length % NAMES.length]!;
    out.push({
      x,
      y,
      index: cellIndex(x, y),
      // A number on the end of the name, exactly as the field this replaces
      // did it. Two people called the same thing get different blobs, and the
      // palette spread across the wall comes from the digits rather than from
      // anything anyone chose.
      seed: `${name}${100 + Math.floor(random() * 900)}`,
      expression: FACE_NAMES[Math.floor(random() * FACE_NAMES.length)]!,
      // Placed in order, a few hours apart — a wall filling up at a handful of
      // blobs a day, which is what the cooldown actually produces.
      at: OPENED + out.length * 12_000 + Math.floor(random() * 4_000),
    });
  };

  /*
   * The crowd, grown rather than drawn.
   *
   * Filling rings outward produces a solid disc with a ragged edge, which is
   * what a *stamp* looks like — and nothing about the rules produces it. People
   * arrive one at a time and each picks a spot near somebody, so what actually
   * accumulates is clumps, filaments and holes: a cell nobody happened to take
   * stays empty even when it is surrounded, and a knot of five friends is
   * denser than the wall around it.
   *
   * That matters beyond appearance. Occupancy is the medium (ADR 0011), so a
   * fixture with no holes in it cannot show what a drawing on this wall would
   * look like, and a renderer tuned against a solid disc is tuned against the
   * one case that never happens.
   *
   * The model is accretion: pick somebody already here, step a short way off,
   * and settle there if the cell is free. Occasionally step much further — the
   * person who wanted room — which is what opens the voids between clumps.
   */
  const grow = (centre: Cell, radius: number, attempts: number) => {
    // Whoever is nearest is who this group grew from — the first arrival in a
    // neighbourhood is the last stone of the bridge that reached it.
    const seed = nearest(centre);
    for (let i = 0; i < attempts; i++) {
      const near = out[Math.floor(random() * out.length)]!;
      const from = Math.hypot(near.x - centre.x, near.y - centre.y) <= radius + 4 ? near : seed;

      // Mostly a neighbour, sometimes a walk. `REACH - 14` keeps the long jump
      // legal with room to spare; the rules would allow a further one, but a
      // fixture that sits exactly on a limit is a fixture that breaks when the
      // limit moves.
      const wander = random() < 0.12;
      const distance = wander ? 6 + random() * (REACH - 14) : 1 + random() * 2.2;
      const angle = random() * Math.PI * 2;

      const x = Math.round(from.x + Math.cos(angle) * distance);
      const y = Math.round(from.y + Math.sin(angle) * distance);

      // A soft edge: the further out, the less likely somebody bothered.
      // Squared so the falloff is gentle in the middle and steep at the rim,
      // which is what keeps a crowd a crowd without drawing a circle around it.
      const rim = Math.hypot(x - centre.x, y - centre.y) / radius;
      if (rim > 1 || random() < rim * rim) continue;

      /*
       * And a cell mostly hemmed in usually stays empty.
       *
       * Without this the middle saturates: every attempt lands somewhere, so
       * the centre fills solid and only the rim keeps any texture — which is
       * the stamp again, wearing a ragged edge. The wall this fixture is meant
       * to be has gaps *everywhere*, because a cell is only taken when somebody
       * chose that cell, and the more neighbours a cell already has the less
       * appealing it is to squeeze in beside them.
       *
       * It is also the load the renderer needs: occupancy is the medium, so
       * holes are the thing being drawn, and a solid field never exercises
       * them.
       */
      let around = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && taken.has(`${x + dx},${y + dy}`)) around++;
        }
      }
      if (around >= CROWDED || random() < around / CROWDED) continue;

      place(x, y);
    }
  };

  place(FIRST.x, FIRST.y);
  grow(FIRST, RADIUS, CROWD);

  /**
   * Somebody walked out of the crowd toward the empty quarter, a stone at a
   * time.
   *
   * Each stone is within reach of the last and of nothing else, which is what
   * going anywhere on this wall actually costs. The spacing is `REACH - 4`
   * rather than `REACH`: walking to the exact edge of reach leaves no room for
   * the rounding below, and a bridge with one illegal stone in it is a fixture
   * that fails its own legality test.
   */
  const walk = (to: Cell) => {
    const from = nearest(to);
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    const stones = Math.ceil(span / (REACH - 4));
    for (let i = 1; i <= stones; i++) {
      const t = i / stones;
      place(Math.round(from.x + (to.x - from.x) * t), Math.round(from.y + (to.y - from.y) * t));
    }
  };

  walk(WORD_AT);

  // And then wrote something, which is the only thing on this wall that had to
  // be agreed on in advance.
  for (const cell of WORD) place(WORD_AT.x + cell.x, WORD_AT.y + cell.y);

  // Four groups who went further out and stayed. Each walked there first, and
  // each grew the same way the crowd did — a neighbourhood is a small crowd,
  // not a differently-shaped one.
  for (const at of SATELLITES) {
    walk(at);
    grow(at, SATELLITE_RADIUS, SATELLITE_ATTEMPTS);
  }

  // Two people who came out here to be by themselves.
  place(-RADIUS - 9, 6);
  place(4, RADIUS + 11);

  return out;
}

/**
 * The same history, grouped into the bodies a client would have fetched.
 *
 * `version` is the count of writes the chunk has seen, which for a fixture is
 * simply how many cells it holds — a real one increments per write and never
 * decrements, since placements are permanent.
 */
export function fixtureChunks(): ChunkBody[] {
  const bodies = new Map<string, ChunkBody>();
  for (const placement of history()) {
    const key = chunkKey(chunkOf(placement.x, placement.y));
    let body = bodies.get(key);
    if (!body) bodies.set(key, (body = { key, version: 0, cells: [] }));
    body.cells.push({
      index: placement.index,
      seed: placement.seed,
      expression: placement.expression,
      at: placement.at,
    });
    body.version++;
  }
  return [...bodies.values()];
}

/**
 * The fixture, as something the canvas can fetch from.
 *
 * Same interface as the real thing and no network behind it, which is what lets
 * the preview page and the landing page run the identical component. It answers
 * every load instantly and never changes underneath itself — a fixture that
 * behaved like a slow server would be simulating the one thing there is no
 * point simulating.
 */
export function fixtureSource(): Source {
  const chunks = chunkMap(fixtureChunks());
  let size = [...chunks.values()].reduce((total, body) => total + body.cells.length, 0);
  return {
    load: async () => false,
    wall: () => ({ chunks, size }),
    claim(chunk, placement) {
      const key = chunkKey(chunk);
      const body = chunks.get(key) ?? { key, version: 0, cells: [] };
      chunks.set(key, { ...body, version: body.version + 1, cells: [...body.cells, placement] });
      size += 1;
    },
  };
}
