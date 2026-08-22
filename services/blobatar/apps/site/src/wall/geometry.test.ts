import { describe, expect, test } from "bun:test";
import {
  CAPACITY,
  CHUNK,
  FIRST,
  REACH,
  cellAt,
  cellIndex,
  cellKey,
  chunkKey,
  chunkOf,
  chunksCovering,
  isPlaceable,
  nearestPlaceable,
  parseChunkKey,
  withinReach,
  type Cell,
} from "./geometry";

/**
 * The wall is unbounded in every direction, so more than half of it has a
 * negative coordinate. Most of what is asserted here is that fact surviving
 * contact with integer division — the failures it guards against do not throw,
 * they draw a blob one chunk away from where it was placed.
 */

const occupancy = (cells: Cell[]) => {
  const set = new Set(cells.map((c) => cellKey(c.x, c.y)));
  return (x: number, y: number) => set.has(cellKey(x, y));
};

describe("cells and chunks", () => {
  test("chunks floor toward negative infinity rather than toward zero", () => {
    expect(chunkOf(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(chunkOf(31, 31)).toEqual({ cx: 0, cy: 0 });
    expect(chunkOf(32, 32)).toEqual({ cx: 1, cy: 1 });
    // `(-1 / 32) | 0` is 0. The cell immediately left of the origin belongs to
    // the chunk on its left, not to the origin's own.
    expect(chunkOf(-1, -1)).toEqual({ cx: -1, cy: -1 });
    expect(chunkOf(-32, -32)).toEqual({ cx: -1, cy: -1 });
    expect(chunkOf(-33, -33)).toEqual({ cx: -2, cy: -2 });
  });

  test("the local slot is always inside the chunk, on both sides of the origin", () => {
    for (let x = -70; x <= 70; x++) {
      for (let y = -70; y <= 70; y++) {
        const index = cellIndex(x, y);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(CAPACITY);
        expect(cellAt(chunkOf(x, y), index)).toEqual({ x, y });
      }
    }
  });

  test("the origin cell is slot zero of chunk zero", () => {
    expect(cellIndex(0, 0)).toBe(0);
    expect(chunkOf(0, 0)).toEqual({ cx: 0, cy: 0 });
  });

  test("slots are row-major", () => {
    expect(cellIndex(1, 0)).toBe(1);
    expect(cellIndex(0, 1)).toBe(CHUNK);
    expect(cellIndex(-1, -1)).toBe(CAPACITY - 1);
  });
});

describe("chunk keys", () => {
  test("round-trip, negatives included", () => {
    for (const chunk of [{ cx: 0, cy: 0 }, { cx: 3, cy: -4 }, { cx: -12, cy: -12 }]) {
      expect(parseChunkKey(chunkKey(chunk))).toEqual(chunk);
    }
  });

  test("a key is a path segment a stranger controls, so near-misses are rejected", () => {
    for (const junk of ["", "3", "3_", "_4", "3_4_5", "3abc_4", " 3_4", "3_4 ", "3.0_4", "+3_4", "--3_4", "99999999_1"]) {
      expect(parseChunkKey(junk)).toBeNull();
    }
  });
});

describe("chunks under a box", () => {
  test("a box inside one chunk is one request", () => {
    expect(chunksCovering(1, 1, 30, 30)).toEqual([{ cx: 0, cy: 0 }]);
  });

  test("crossing a boundary picks up the neighbour, in row-major order", () => {
    expect(chunksCovering(30, 30, 33, 33)).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
      { cx: 0, cy: 1 },
      { cx: 1, cy: 1 },
    ]);
  });

  test("the corners may be given in any order", () => {
    expect(chunksCovering(33, 33, 30, 30)).toEqual(chunksCovering(30, 30, 33, 33));
  });

  /**
   * The bound `REACH` claims for itself: one cell short of a chunk, so a reach
   * box is at most three chunks per axis wherever on the wall it lands. The
   * write path queries cells rather than chunks, so this is not a read-count
   * claim any more — it is the ceiling that keeps that query small, and a REACH
   * grown past `CHUNK - 1` would quietly raise it.
   */
  test("a reach box never spans more than nine chunks", () => {
    for (let x = -40; x <= 40; x++) {
      for (let y = -40; y <= 40; y++) {
        const covering = chunksCovering(x - REACH, y - REACH, x + REACH, y + REACH);
        expect(covering.length).toBeLessThanOrEqual(9);
      }
    }
  });
});

describe("reach", () => {
  const crowd = occupancy([{ x: 0, y: 0 }]);

  test("reach is a disc, not a square", () => {
    expect(withinReach(REACH, 0, crowd)).toBe(true);
    expect(withinReach(0, REACH, crowd)).toBe(true);
    expect(withinReach(REACH + 1, 0, crowd)).toBe(false);
    // The corner of the square halo is REACH * 1.41 away and is out.
    expect(withinReach(REACH, REACH, crowd)).toBe(false);
    expect(withinReach(22, 22, crowd)).toBe(true); // 31.1 away
    expect(withinReach(23, 23, crowd)).toBe(false); // 32.5 away
  });

  test("a taken cell is not placeable however deep in the crowd it sits", () => {
    expect(isPlaceable(0, 0, crowd)).toBe(false);
    expect(isPlaceable(1, 0, crowd)).toBe(true);
  });

  test("out past the frontier nothing is placeable", () => {
    expect(isPlaceable(200, 200, crowd)).toBe(false);
  });
});

describe("the empty wall", () => {
  const nobody = () => false;

  test("the only cell on offer is the origin", () => {
    expect(isPlaceable(FIRST.x, FIRST.y, nobody, false)).toBe(true);
    for (const cell of [{ x: 1, y: 0 }, { x: 0, y: -1 }, { x: 40, y: 40 }]) {
      expect(isPlaceable(cell.x, cell.y, nobody, false)).toBe(false);
    }
  });

  test("wherever you aim on an empty wall, you are walked to the origin", () => {
    for (const target of [{ x: 0, y: 0 }, { x: 9, y: 3 }, { x: -400, y: 250 }]) {
      expect(nearestPlaceable(target, nobody, false)).toEqual(FIRST);
    }
  });

  /**
   * The distinction the `populated` flag exists to keep: a predicate that says
   * "empty" because the wall is empty, and one that says "empty" because
   * nothing has been fetched yet, are the same function and must not mean the
   * same thing. Told the wall is populated, the origin is not a special case
   * and an unreachable target is unreachable.
   */
  test("an unfetched region is not an empty wall", () => {
    expect(isPlaceable(FIRST.x, FIRST.y, nobody, true)).toBe(false);
    expect(nearestPlaceable({ x: 9, y: 3 }, nobody, true)).toBeNull();
  });

  test("once the origin is taken the wall is no longer empty to anyone", () => {
    const first = occupancy([FIRST]);
    expect(isPlaceable(FIRST.x, FIRST.y, first, false)).toBe(false);
    expect(nearestPlaceable({ x: 5, y: 5 }, first, false)).toBeNull();
    // ...and under the ordinary rule its neighbours open up.
    expect(isPlaceable(1, 0, first)).toBe(true);
  });
});

describe("walking back to placeable ground", () => {
  const crowd = occupancy([{ x: 0, y: 0 }]);

  test("ground that is already good is returned untouched", () => {
    expect(nearestPlaceable({ x: 5, y: 0 }, crowd)).toEqual({ x: 5, y: 0 });
  });

  test("a taken cell settles onto a neighbour rather than refusing", () => {
    const found = nearestPlaceable({ x: 0, y: 0 }, crowd);
    expect(found).not.toBeNull();
    expect(isPlaceable(found!.x, found!.y, crowd)).toBe(true);
    // Chebyshev, not Manhattan: the ring walk is square, so the diagonal
    // neighbour is reached on the same ring as the orthogonal one and may win.
    expect(Math.max(Math.abs(found!.x), Math.abs(found!.y))).toBe(1);
  });

  test("aiming past the frontier lands on the edge of reach, in the direction aimed", () => {
    const found = nearestPlaceable({ x: 40, y: 0 }, crowd)!;
    expect(isPlaceable(found.x, found.y, crowd)).toBe(true);
    expect(found).toEqual({ x: REACH, y: 0 });
  });

  test("the direction is preserved on a diagonal too", () => {
    const found = nearestPlaceable({ x: 30, y: 30 }, crowd)!;
    expect(isPlaceable(found.x, found.y, crowd)).toBe(true);
    // Still out along the diagonal, not snapped to an axis.
    expect(found.x).toBeGreaterThan(0);
    expect(found.y).toBeGreaterThan(0);
  });

  test("whatever it returns is a cell the write path would accept", () => {
    const dense = occupancy(
      Array.from({ length: 9 }, (_, i) => ({ x: (i % 3) - 1, y: Math.floor(i / 3) - 1 })),
    );
    for (const target of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 40, y: 0 },
      { x: -40, y: 7 },
      { x: 12, y: -30 },
    ]) {
      const found = nearestPlaceable(target, dense)!;
      expect(found).not.toBeNull();
      expect(isPlaceable(found.x, found.y, dense)).toBe(true);
    }
  });

  /**
   * The bound is not arbitrary. A client only knows occupancy for the chunks it
   * has fetched, so once the crowd is further away than a couple of chunks the
   * predicate is answering "empty" out of ignorance rather than out of fact,
   * and searching further would be searching data nobody has. Past that, the
   * frontier cell the region index suggests is the only honest answer.
   */
  test("a crowd too far to have been fetched is the region index's problem", () => {
    expect(nearestPlaceable({ x: 200, y: 0 }, crowd)).toBeNull();
    expect(nearestPlaceable({ x: 10_000, y: 10_000 }, crowd)).toBeNull();
  });
});
