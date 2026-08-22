import { describe, expect, test } from "bun:test";
import { CAPACITY, FIRST, cellIndex, chunkOf, isPlaceable, nearestPlaceable } from "./geometry";
import {
  chunkMap,
  placementAt,
  decodeChunk,
  encodeChunk,
  isFull,
  occupancyOf,
  placements,
  type ChunkBody,
} from "./chunk";
import { RADIUS, fixtureChunks, history } from "./fixture";
import { FACE_NAMES } from "./expressions";

const body = (cells: ChunkBody["cells"], key = "0_0", version = 1): ChunkBody => ({ key, version, cells });

describe("the wire format", () => {
  test("a body survives the round trip", () => {
    const original = body([
      { index: 0, seed: "alain100", expression: "idle", at: 1767225600 },
      { index: 1023, seed: "zoya742", expression: "wink", at: 1767312000 },
    ], "3_-4", 812);
    expect(decodeChunk(encodeChunk(original))).toEqual(original);
  });

  test("an empty chunk is a chunk, not an absence", () => {
    expect(decodeChunk(encodeChunk(body([])))).toEqual(body([]));
  });

  test("tuples, so a full chunk does not spend its bytes on field names", () => {
    const wire = encodeChunk(body([{ index: 7, seed: "alain100", expression: "idle", at: 1767225600 }]));
    expect(wire).not.toContain("index");
    expect(wire).not.toContain("expression");
    expect(JSON.parse(wire).c[0]).toEqual([7, "alain100", "idle", 1767225600]);
  });

  /**
   * These bodies are cached for a year under an immutable URL, in caches this
   * code cannot reach. Every rejection below is a shape that could plausibly
   * come back from one of them after the format has moved on, and the only safe
   * response to any of them is to discard and refetch.
   */
  describe("refuses to half-draw a body it does not understand", () => {
    for (const [what, text] of [
      ["not JSON at all", "<!doctype html>"],
      ["truncated", '{"k":"0_0","v":1,"c":[[0,"alain'],
      ["null", "null"],
      ["an array", "[]"],
      ["no version", '{"k":"0_0","c":[]}'],
      ["a fractional version", '{"k":"0_0","v":1.5,"c":[]}'],
      ["cells that are not an array", '{"k":"0_0","v":1,"c":{}}'],
      ["a short tuple", '{"k":"0_0","v":1,"c":[[0,"alain","idle"]]}'],
      ["a slot past the end of the chunk", `{"k":"0_0","v":1,"c":[[${CAPACITY},"a","idle",1]]}`],
      ["a negative slot", '{"k":"0_0","v":1,"c":[[-1,"a","idle",1]]}'],
      ["an empty seed", '{"k":"0_0","v":1,"c":[[0,"","idle",1]]}'],
      ["a seed that is not a string", '{"k":"0_0","v":1,"c":[[0,7,"idle",1]]}'],
      ["no timestamp", '{"k":"0_0","v":1,"c":[[0,"alain","idle",null]]}'],
      ["a fractional timestamp", '{"k":"0_0","v":1,"c":[[0,"alain","idle",1.5]]}'],
    ] as const) {
      test(what, () => expect(decodeChunk(text)).toBeNull());
    }
  });

  test("an unknown face is kept rather than rejected", () => {
    // Forward compatibility runs the other way from the checks above: a body
    // written by a wall that offered a face this one does not is still a valid
    // body, and the client falls back to `idle` when it draws.
    const decoded = decodeChunk('{"k":"0_0","v":1,"c":[[0,"alain100","thinking",1767225600]]}');
    expect(decoded?.cells[0]?.expression).toBe("thinking");
  });
});

describe("fullness", () => {
  test("a chunk holding every cell it has can never change again", () => {
    const full = body(
      Array.from({ length: CAPACITY }, (_, index) => ({
        index,
        seed: `n${index}`,
        expression: "idle",
        at: 1767225600 + index,
      })),
    );
    expect(isFull(full)).toBe(true);
    expect(isFull(body(full.cells.slice(0, CAPACITY - 1)))).toBe(false);
  });
});

describe("the loaded wall", () => {
  const chunks = chunkMap(fixtureChunks());

  test("occupancy answers for cells across chunk boundaries, negatives included", () => {
    const occupied = occupancyOf(chunks);
    for (const placement of history()) {
      expect(occupied(placement.x, placement.y)).toBe(true);
    }
    expect(occupied(9999, 9999)).toBe(false);
  });

  test("every placement comes back out with the cell it went in at", () => {
    const drawn = [...placements(chunks)];
    const expected = history();
    expect(drawn.length).toBe(expected.length);
    const byCell = new Map(drawn.map((p) => [`${p.x},${p.y}`, p]));
    for (const placement of expected) {
      const found = byCell.get(`${placement.x},${placement.y}`)!;
      expect(found).toBeDefined();
      expect(found.seed).toBe(placement.seed);
      expect(found.index).toBe(cellIndex(placement.x, placement.y));
    }
  });
});

describe("who is in a cell", () => {
  const chunks = chunkMap(fixtureChunks());

  test("a click on somebody's blob finds them, and when they arrived", () => {
    const first = history()[0]!;
    const found = placementAt(chunks, chunkOf(first.x, first.y), cellIndex(first.x, first.y));
    expect(found?.seed).toBe(first.seed);
    expect(found?.at).toBe(first.at);
  });

  test("an empty cell is nobody rather than an error", () => {
    expect(placementAt(chunks, { cx: 400, cy: 400 }, 0)).toBeNull();
    // The last slot of the origin's chunk is the cell at 31,31 — a corner 44
    // cells from the middle, which is outside the crowd's radius. A slot in the
    // thick of it would only be testing how big the fixture happens to be.
    expect(placementAt(chunks, chunkOf(0, 0), CAPACITY - 1)).toBeNull();
  });

  test("the wall was filled in the order it was placed", () => {
    const made = history();
    for (let i = 1; i < made.length; i++) {
      expect(made[i]!.at).toBeGreaterThan(made[i - 1]!.at);
    }
  });
});

describe("the fixture is a wall that could have happened", () => {
  const made = history();

  test("it starts at the origin, because nothing is seeded", () => {
    expect(made[0]).toMatchObject(FIRST);
  });

  test("it is the same wall every time it is built", () => {
    expect(history().map((p) => `${p.x},${p.y},${p.seed}`)).toEqual(
      made.map((p) => `${p.x},${p.y},${p.seed}`),
    );
  });

  /**
   * Thousands, and spread thin.
   *
   * Both halves matter and both are easy to lose by accident. The size is what
   * makes this the load the renderer is profiled against — a few hundred blobs
   * is not a number anything gets slow at. The density is what makes it a wall
   * rather than a stamp: occupancy is the medium, so a fixture with no holes in
   * it cannot show what a drawing on this wall would look like.
   *
   * Wide bounds, because the generator is stochastic and this is a guard
   * against a change that moves it by an order of magnitude, not a golden file.
   */
  test("it is thousands of blobatars, with room between them", () => {
    expect(made.length).toBeGreaterThan(4000);

    const taken = new Set(made.map((p) => `${p.x},${p.y}`));
    let filled = 0;
    let cells = 0;
    for (let y = -RADIUS; y <= RADIUS; y++) {
      for (let x = -RADIUS; x <= RADIUS; x++) {
        if (Math.hypot(x, y) > RADIUS) continue;
        cells++;
        if (taken.has(`${x},${y}`)) filled++;
      }
    }
    const density = filled / cells;
    expect(density).toBeGreaterThan(0.25);
    expect(density).toBeLessThan(0.75);
  });

  test("every face on it is one the picker offers", () => {
    for (const placement of made) expect(FACE_NAMES).toContain(placement.expression);
  });

  /**
   * The assertion this fixture exists for. Reach is a rule about the wall as it
   * stood at the time, so replaying the history one placement at a time is the
   * only way to know the fixture is a wall somebody could actually have built —
   * and it is simultaneously the closest thing to an end-to-end test of the
   * placement rules that does not need a database.
   */
  test("every placement was legal at the moment it was made", () => {
    const taken = new Set<string>();
    const occupied = (x: number, y: number) => taken.has(`${x},${y}`);
    made.forEach((placement, i) => {
      const legal = isPlaceable(placement.x, placement.y, occupied, i > 0);
      expect({ i, at: `${placement.x},${placement.y}`, legal }).toEqual({
        i,
        at: `${placement.x},${placement.y}`,
        legal: true,
      });
      taken.add(`${placement.x},${placement.y}`);
    });
  });

  test("the word out in the quiet needed a bridge to get there", () => {
    const taken = new Set(made.map((p) => `${p.x},${p.y}`));
    const occupied = (x: number, y: number) => taken.has(`${x},${y}`);
    // The far end of the wall is reachable only because somebody walked there:
    // remove the stones and the word's own cells are out of anyone's reach.
    // The crowd itself, at its real extent — not a disc small enough to make
    // the point by construction. The word is out past the edge of it by more
    // than a reach, which is what makes the stones load-bearing.
    const core = new Set(
      made.filter((p) => Math.hypot(p.x, p.y) <= RADIUS).map((p) => `${p.x},${p.y}`),
    );
    const coreOnly = (x: number, y: number) => core.has(`${x},${y}`);
    const word = made.at(-3)!;
    expect(occupied(word.x, word.y)).toBe(true);
    expect(isPlaceable(word.x + 1, word.y, coreOnly)).toBe(false);
    expect(nearestPlaceable({ x: word.x, y: word.y }, coreOnly)).not.toEqual({ x: word.x, y: word.y });
  });
});
