/**
 * The wall's coordinate system.
 *
 * Shared by the client that draws the wall and the Worker that validates writes
 * against it, because the two must never disagree about which cells exist or
 * which of them may be claimed. A client that offers a cell the server refuses
 * is a broken affordance; a server that accepts a cell the client cannot draw
 * is a blob nobody ever sees. One module, imported by both.
 *
 * Everything here is integer arithmetic over pure functions. No storage, no
 * rendering, no D1 — occupancy arrives as a predicate, so the same code answers
 * for a `Set` held in the browser and for rows read out of a chunk query.
 */

/**
 * Cells per chunk side.
 *
 * The number is a request-count decision, not a storage one. At the current
 * ~80px cell a 32-wide chunk covers ~2560px, so a viewport spans one to two
 * chunks across and one down — two to four requests to paint. 16 doubles that
 * for no payload saving, because a chunk carries only its *occupied* cells:
 * a local index, a seed and an expression byte, and a full one still gzips
 * small. See ADR 0011.
 */
export const CHUNK = 32;

/** Cells in a chunk. A chunk holding this many can never change again. */
export const CAPACITY = CHUNK * CHUNK;

/**
 * How far from the crowd a blob may be placed, in cells.
 *
 * Deliberately generous — this is the "I want to be alone for a while" number.
 * At ~80px a cell, 32 puts you two full screens clear of everyone, far enough
 * to be visibly by yourself and still close enough that somebody panning
 * outward finds you. Tightening it turns the wall into a queue; loosening it
 * lets blobs be planted in voids nobody will ever pan to.
 *
 * It was 16, which is a screen. The number that settled it is the cost of a
 * bridge: reach is also how far apart the stones are when a group walks out
 * into the quiet to draw something, and at 16 the fixture's two-letter word
 * cost five stones before the first letter — five people, at one blob per
 * address per day. 32 halves every bridge on the wall. Changing it later is
 * cheap only until somebody has placed something; a wall built under one reach
 * cannot be re-walked under another, so it is set here, before the first write.
 *
 * Measured as a true (Euclidean) distance rather than a square halo, so the
 * wall grows as a disc. A Chebyshev reach is cheaper by one multiply and grows
 * a square, which reads as a UI element rather than as a crowd.
 *
 * One cell short of a chunk, and that bound is deliberate: a reach box is
 * `2 * REACH + 1` cells on a side, which spans at most three chunks per axis.
 * The write path does not read chunks — it queries the cell box directly — but
 * the ceiling is what keeps that query a small one.
 */
export const REACH = 32;

export type Cell = { x: number; y: number };
export type Chunk = { cx: number; cy: number };

/**
 * Occupancy, as a question rather than a container.
 *
 * The client answers it from chunks it has fetched, the Worker from rows it has
 * just read; neither has to adopt the other's data structure to reuse the rules
 * below.
 */
export type Occupied = (x: number, y: number) => boolean;

/**
 * A cell, with negative zero collapsed.
 *
 * Not fussiness. `-0` reaches a cell from three directions — `Math.round` of a
 * pointer just left of the origin, `-r` when a ring walk is at radius zero,
 * `0 * -1` in anything that mirrors — and it compares equal to `0`, prints as
 * `"0"`, and is a *different value* to `Object.is`, to `Map` keys and to
 * React's key diffing. So the cell left of the origin is the same cell as the
 * origin until something asks the one question that separates them, and then it
 * is not. Every cell coming out of arithmetic goes through here.
 */
export const cell = (x: number, y: number): Cell => ({ x: x || 0, y: y || 0 });

/**
 * `Math.floor`, not truncation, and that is the whole reason these are
 * functions rather than inline arithmetic. The wall extends in every direction,
 * so `x` is routinely negative, and `(-1 / 32) | 0` is `0` where the correct
 * chunk is `-1`. Getting this wrong puts the cells just left of the origin in
 * the chunk to their right, which looks like a rendering bug and is not one.
 */
export function chunkOf(x: number, y: number): Chunk {
  return { cx: Math.floor(x / CHUNK), cy: Math.floor(y / CHUNK) };
}

/** The cell's slot inside its own chunk, `0`–`1023`. Row-major, floor-modulo. */
export function cellIndex(x: number, y: number): number {
  const lx = x - Math.floor(x / CHUNK) * CHUNK;
  const ly = y - Math.floor(y / CHUNK) * CHUNK;
  return ly * CHUNK + lx;
}

/** The inverse: a chunk plus a stored slot is a cell again. */
export function cellAt(chunk: Chunk, index: number): Cell {
  return {
    x: chunk.cx * CHUNK + (index % CHUNK),
    y: chunk.cy * CHUNK + Math.floor(index / CHUNK),
  };
}

/**
 * Chunk identity as a string, because it is a URL path segment
 * (`/wall/c/3_-4/812`) and a JSON object key in the region index before it is
 * anything else. `_` rather than `,` so it needs no escaping in either.
 */
export function chunkKey(chunk: Chunk): string {
  return `${chunk.cx}_${chunk.cy}`;
}

/**
 * Parses a key back, and rejects anything that is not exactly the form above.
 * This runs on a path segment a stranger controls, so `parseInt`'s cheerful
 * acceptance of `"3abc"` and `" 3"` is a liability rather than a convenience.
 */
export function parseChunkKey(key: string): Chunk | null {
  const match = /^(-?\d{1,7})_(-?\d{1,7})$/.exec(key);
  return match ? { cx: Number(match[1]), cy: Number(match[2]) } : null;
}

/** A cell's identity for the `Set` a caller builds its `Occupied` from. */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Every chunk touching an inclusive cell-space box, row-major.
 *
 * The client asks for the chunks under its viewport, which is what it has to
 * fetch to draw. The Worker does not use it to validate a write: a reach box at
 * `REACH = 32` spans up to nine chunks, and reading nine chunk-fulls of seeds
 * and names to answer one distance question is the wrong query — the write path
 * asks for the cells in the box directly instead.
 */
export function chunksCovering(x0: number, y0: number, x1: number, y1: number): Chunk[] {
  const from = chunkOf(Math.min(x0, x1), Math.min(y0, y1));
  const to = chunkOf(Math.max(x0, x1), Math.max(y0, y1));
  const chunks: Chunk[] = [];
  for (let cy = from.cy; cy <= to.cy; cy++) {
    for (let cx = from.cx; cx <= to.cx; cx++) chunks.push({ cx, cy });
  }
  return chunks;
}

/** Squared distance, so the reach test never needs a square root. */
function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

/**
 * The cells of the square ring at Chebyshev radius `r`, in no meaningful order
 * beyond being one ring. Radius `0` is the centre itself.
 *
 * Square rings rather than circular ones: a ring walk is used to find the
 * *nearest* something, and a square ring at radius `r` can contain cells up to
 * `r * 1.41` away, so the first hit is near-nearest rather than exactly
 * nearest. Nobody can see the difference on a wall, and the exact version costs
 * a sorted frontier.
 */
function* ring(cx: number, cy: number, r: number): Generator<Cell> {
  if (r === 0) {
    yield { x: cx, y: cy };
    return;
  }
  for (let d = -r; d <= r; d++) {
    yield { x: cx + d, y: cy - r };
    yield { x: cx + d, y: cy + r };
  }
  for (let d = -r + 1; d <= r - 1; d++) {
    yield { x: cx - r, y: cy + d };
    yield { x: cx + r, y: cy + d };
  }
}

/** Is any occupied cell within `REACH` of here? Searched inside out, so a cell
 * in the thick of the crowd answers on the first ring rather than after 1089
 * lookups. */
export function withinReach(x: number, y: number, occupied: Occupied): boolean {
  for (let r = 0; r <= REACH; r++) {
    for (const c of ring(x, y, r)) {
      if (dist2(x, y, c.x, c.y) <= REACH * REACH && occupied(c.x, c.y)) return true;
    }
  }
  return false;
}

/**
 * Where the wall starts.
 *
 * Nothing is seeded — the first blobatar is placed by a person, not by a
 * migration — so an empty wall is a state these rules have to express rather
 * than one the schema hides. It lasts exactly one placement, and it is the only
 * time reach means nothing, because there is nothing to be in reach of.
 *
 * The first cell is the origin by rule, which is what anchors the coordinate
 * system to the first blobatar rather than to an arbitrary zero. On an empty
 * wall the client therefore has exactly one placeable cell to offer, dead
 * centre, and no explaining to do.
 */
export const FIRST: Cell = { x: 0, y: 0 };

/**
 * The rule, in one place: a cell may be claimed if it is empty, and either the
 * crowd is within reach of it or there is no crowd yet and this is the origin.
 *
 * `populated` is the wall's own emptiness, which the predicate cannot answer
 * for itself — `occupied` returning false everywhere means "nothing here" to a
 * Worker holding the whole region and "nothing fetched yet" to a client, and
 * those must not be confused. The caller knows which it has.
 */
export function isPlaceable(
  x: number,
  y: number,
  occupied: Occupied,
  populated = true,
): boolean {
  if (occupied(x, y)) return false;
  if (!populated) return x === FIRST.x && y === FIRST.y;
  return withinReach(x, y, occupied);
}

/**
 * The nearest cell to `target` that may actually be claimed, or `null`.
 *
 * This is what makes the auto-pan honest: a visitor who has panned out past the
 * frontier and clicked is walked back to the closest ground that would accept
 * them, rather than shown a ghost blob and then refused.
 *
 * The naive version — ring outward from the target testing `isPlaceable` — is
 * quadratic, because every candidate runs its own reach scan. Instead: find the
 * nearest occupied cell, then step back along the line from it to the target
 * and stop at the edge of its reach. That is one ring walk plus a short one,
 * and it answers with the cell closest to where the visitor actually aimed.
 *
 * It is conservative rather than exact — it only considers the reach of the one
 * nearest neighbour, so a cell reachable from some *other* blob might be
 * marginally closer. The cost of being wrong is landing a cell or two further
 * out than strictly necessary, which is invisible; the cost of being exact is a
 * scan of every occupied cell in the region on every click.
 *
 * `null` means the crowd is nowhere near — the caller should fall back to the
 * frontier cell the region index suggests rather than search further, because
 * at that distance "nearest" has stopped being a useful answer anyway.
 */
export function nearestPlaceable(
  target: Cell,
  occupied: Occupied,
  populated = true,
  maxSearch = REACH * 4,
): Cell | null {
  // An empty wall has one answer wherever you aimed, and walking someone to it
  // is the whole of the first-placement experience.
  if (!populated) return occupied(FIRST.x, FIRST.y) ? null : FIRST;
  if (isPlaceable(target.x, target.y, occupied)) return target;

  let anchor: Cell | null = null;
  for (let r = 0; r <= maxSearch && !anchor; r++) {
    for (const c of ring(target.x, target.y, r)) {
      if (occupied(c.x, c.y)) {
        anchor = c;
        break;
      }
    }
  }
  if (!anchor) return null;

  // Walk from the anchor toward where they aimed, stopping at the edge of its
  // reach. Inside the reach already, the aim itself is the starting point — the
  // cell was refused for being taken, not for being far.
  const dx = target.x - anchor.x;
  const dy = target.y - anchor.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  let from = target;
  if (d > REACH) {
    const scale = REACH / d;
    from = { x: anchor.x + Math.round(dx * scale), y: anchor.y + Math.round(dy * scale) };
  }

  // Rounding can land a cell outside the reach it was aimed at, and the cell
  // itself may be taken, so settle onto the first free cell that the anchor can
  // actually reach.
  for (let r = 0; r <= REACH; r++) {
    for (const c of ring(from.x, from.y, r)) {
      if (occupied(c.x, c.y)) continue;
      if (dist2(c.x, c.y, anchor.x, anchor.y) <= REACH * REACH) return c;
    }
  }
  return null;
}
