import { describe, expect, test } from "bun:test";
import { CHUNK } from "./geometry";
import {
  CELL,
  MAX_ZOOM,
  MIN_ZOOM,
  cellToScreen,
  cellUnder,
  chunksInView,
  edgeMarker,
  flightAt,
  framing,
  panBy,
  screenToCell,
  visibleBox,
  zoomAt,
  type Camera,
  type Viewport,
} from "./camera";

/**
 * The camera is where a wall stops being arithmetic and starts being something
 * a hand drags around, so what is asserted here is mostly reversibility: a
 * pointer that goes to a cell and back must land where it started, and a drag
 * must move the wall by exactly as much as the hand moved.
 */

const VIEW: Viewport = { width: 1440, height: 700 };
const HOME: Camera = { x: 0, y: 0, zoom: 1 };

describe("cells and pixels", () => {
  test("the camera's own cell sits in the middle of the viewport", () => {
    expect(cellToScreen(HOME, VIEW, 0, 0)).toEqual({ x: 720, y: 350 });
    const off: Camera = { x: 12, y: -3, zoom: 1 };
    expect(cellToScreen(off, VIEW, 12, -3)).toEqual({ x: 720, y: 350 });
  });

  test("one cell along is CELL pixels along, scaled by zoom", () => {
    expect(cellToScreen(HOME, VIEW, 1, 0).x - cellToScreen(HOME, VIEW, 0, 0).x).toBe(CELL);
    const close: Camera = { x: 0, y: 0, zoom: 2 };
    expect(cellToScreen(close, VIEW, 1, 0).x - cellToScreen(close, VIEW, 0, 0).x).toBe(CELL * 2);
  });

  test("screen to cell and back is the identity, at every zoom", () => {
    for (const zoom of [MIN_ZOOM, 0.6, 1, 1.5, MAX_ZOOM]) {
      const camera: Camera = { x: -7.25, y: 3.5, zoom };
      for (const [sx, sy] of [[0, 0], [720, 350], [1439, 699], [13, 601]]) {
        const cell = screenToCell(camera, VIEW, sx!, sy!);
        const back = cellToScreen(camera, VIEW, cell.x, cell.y);
        expect(back.x).toBeCloseTo(sx!, 6);
        expect(back.y).toBeCloseTo(sy!, 6);
      }
    }
  });

  test("cells are centred on their coordinate, not cornered at it", () => {
    // Just inside half a cell of the origin, in every direction, is the origin.
    expect(cellUnder(HOME, VIEW, 720 + CELL * 0.49, 350)).toEqual({ x: 0, y: 0 });
    expect(cellUnder(HOME, VIEW, 720 - CELL * 0.49, 350)).toEqual({ x: 0, y: 0 });
    // Past it is the neighbour.
    expect(cellUnder(HOME, VIEW, 720 + CELL * 0.51, 350)).toEqual({ x: 1, y: 0 });
    expect(cellUnder(HOME, VIEW, 720, 350 - CELL * 0.51)).toEqual({ x: 0, y: -1 });
  });
});

describe("dragging", () => {
  test("the wall follows the hand exactly", () => {
    const moved = panBy(HOME, CELL, 0);
    // Dragging right by one cell brings the cell on the left into the centre.
    expect(moved.x).toBeCloseTo(-1, 10);
    expect(cellToScreen(moved, VIEW, 0, 0).x).toBeCloseTo(720 + CELL, 10);
  });

  test("a drag covers less wall when zoomed in", () => {
    const close = panBy({ x: 0, y: 0, zoom: 2 }, CELL, 0);
    expect(close.x).toBeCloseTo(-0.5, 10);
  });

  test("dragging does not change zoom", () => {
    expect(panBy(HOME, 300, -120).zoom).toBe(1);
  });
});

describe("zooming", () => {
  test("whatever is under the pointer stays under the pointer", () => {
    const pointer = { x: 300, y: 120 };
    const before = screenToCell(HOME, VIEW, pointer.x, pointer.y);
    for (const factor of [1.2, 0.8, 3, 0.1]) {
      const zoomed = zoomAt(HOME, VIEW, factor, pointer.x, pointer.y);
      const after = screenToCell(zoomed, VIEW, pointer.x, pointer.y);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  test("zoom is clamped, and the camera does not drift once it is", () => {
    const far = zoomAt(HOME, VIEW, 0.001, 300, 120);
    expect(far.zoom).toBe(MIN_ZOOM);
    const further = zoomAt(far, VIEW, 0.001, 300, 120);
    expect(further.zoom).toBe(MIN_ZOOM);
    expect(further.x).toBeCloseTo(far.x, 9);
    expect(further.y).toBeCloseTo(far.y, 9);

    expect(zoomAt(HOME, VIEW, 1000, 720, 350).zoom).toBe(MAX_ZOOM);
  });
});

describe("what to fetch", () => {
  test("a default viewport is the two-to-four chunks ADR 0011 promises", () => {
    expect(chunksInView(HOME, VIEW, 0).length).toBeLessThanOrEqual(4);
  });

  test("the margin reaches past the edge of the screen, so pans are already drawn", () => {
    const tight = visibleBox(HOME, VIEW, 0);
    const loose = visibleBox(HOME, VIEW, 4);
    expect(loose.x0).toBe(tight.x0 - 4);
    expect(loose.y1).toBe(tight.y1 + 4);
    expect(chunksInView(HOME, VIEW).length).toBeGreaterThanOrEqual(chunksInView(HOME, VIEW, 0).length);
  });

  test("zoomed all the way out is much more wall", () => {
    const wide: Camera = { x: 0, y: 0, zoom: MIN_ZOOM };
    const near = visibleBox(HOME, VIEW, 0);
    const far = visibleBox(wide, VIEW, 0);
    expect(far.x1 - far.x0).toBeGreaterThan((near.x1 - near.x0) * 2);
  });

  /**
   * ...and yet still not many more chunks, which is the whole reason the chunk
   * is 32 cells. A 51-cell-wide view of a 32-cell lattice lands on three chunks
   * across at worst. If this ceiling ever moves, the cost argument in ADR 0011
   * has moved with it.
   */
  test("even zoomed all the way out a viewport is under ten requests", () => {
    const wide: Camera = { x: 0, y: 0, zoom: MIN_ZOOM };
    for (let x = 0; x < 32; x++) {
      expect(chunksInView({ ...wide, x, y: x }, VIEW).length).toBeLessThanOrEqual(9);
    }
  });

  test("the visible box covers the corners of the screen", () => {
    const box = visibleBox(HOME, VIEW, 0);
    const topLeft = screenToCell(HOME, VIEW, 0, 0);
    const bottomRight = screenToCell(HOME, VIEW, VIEW.width, VIEW.height);
    expect(box.x0).toBeLessThanOrEqual(topLeft.x);
    expect(box.y0).toBeLessThanOrEqual(topLeft.y);
    expect(box.x1).toBeGreaterThanOrEqual(bottomRight.x);
    expect(box.y1).toBeGreaterThanOrEqual(bottomRight.y);
  });
});

describe("flying to a cell", () => {
  const home: Camera = { x: 0, y: 0, zoom: 1 };
  const far: Camera = { x: 300, y: -200, zoom: 1 };

  test("it starts where it started and ends where it was sent", () => {
    expect(flightAt(home, far, 0)).toEqual(home);
    expect(flightAt(home, far, 1)).toEqual(far);
  });

  test("t outside the flight is clamped rather than extrapolated", () => {
    expect(flightAt(home, far, -3)).toEqual(home);
    expect(flightAt(home, far, 12)).toEqual(far);
  });

  test("a long flight pulls back and comes in again", () => {
    const middle = flightAt(home, far, 0.5);
    expect(middle.zoom).toBeLessThan(home.zoom);
    expect(middle.zoom).toBeLessThan(far.zoom);
    // And is on its way, not parked.
    expect(middle.x).toBeGreaterThan(0);
    expect(middle.x).toBeLessThan(far.x);
  });

  test("a short hop does not lurch backwards first", () => {
    const near: Camera = { x: 4, y: 2, zoom: 1 };
    for (const t of [0.25, 0.5, 0.75]) {
      expect(flightAt(home, near, t).zoom).toBeCloseTo(1, 6);
    }
  });

  test("it never flies outside the zoom the wall allows", () => {
    const wide: Camera = { x: 900, y: 900, zoom: MIN_ZOOM };
    for (let t = 0; t <= 1; t += 0.05) {
      const at = flightAt(home, wide, t);
      expect(at.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(at.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  test("it moves monotonically toward the destination", () => {
    let previous = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const { x } = flightAt(home, far, t);
      expect(x).toBeGreaterThanOrEqual(previous);
      previous = x;
    }
  });
});

describe("the arrow to an off-screen blob", () => {
  test("nothing to point at while it is on screen", () => {
    expect(edgeMarker(HOME, VIEW, { x: 0, y: 0 })).toBeNull();
    expect(edgeMarker(HOME, VIEW, { x: 8, y: 4 })).toBeNull();
  });

  test("off to the right pins to the right edge, pointing right", () => {
    const marker = edgeMarker(HOME, VIEW, { x: 200, y: 0 })!;
    expect(marker).not.toBeNull();
    expect(marker.x).toBe(VIEW.width - 28);
    expect(marker.angle).toBeCloseTo(0, 6);
  });

  test("it stays inside the viewport whatever direction it points", () => {
    for (const target of [
      { x: -900, y: -900 },
      { x: 900, y: -900 },
      { x: -900, y: 900 },
      { x: 900, y: 900 },
      { x: 0, y: -400 },
    ]) {
      const marker = edgeMarker(HOME, VIEW, target)!;
      expect(marker.x).toBeGreaterThanOrEqual(28);
      expect(marker.x).toBeLessThanOrEqual(VIEW.width - 28);
      expect(marker.y).toBeGreaterThanOrEqual(28);
      expect(marker.y).toBeLessThanOrEqual(VIEW.height - 28);
    }
  });

  test("a chunk away is off screen at reading zoom", () => {
    expect(edgeMarker(HOME, VIEW, { x: CHUNK, y: 0 })).not.toBeNull();
  });
});


describe("framing", () => {
  const view = { width: 1000, height: 600 };

  test("puts the cell exactly where the interface has room for it", () => {
    const camera = framing(view, { x: 12, y: -4 }, { x: 300, y: 420 }, 1);
    const at = cellToScreen(camera, view, 12, -4);
    expect(at.x).toBeCloseTo(300);
    expect(at.y).toBeCloseTo(420);
  });

  test("the centre is the case `flyTo` already had", () => {
    const camera = framing(view, { x: 3, y: 3 }, { x: 500, y: 300 }, 1.5);
    expect(camera).toEqual({ x: 3, y: 3, zoom: 1.5 });
  });

  test("and it holds at any zoom", () => {
    for (const zoom of [0.45, 1, 2]) {
      const camera = framing(view, { x: -7, y: 21 }, { x: 120, y: 90 }, zoom);
      const at = cellToScreen(camera, view, -7, 21);
      expect(at.x).toBeCloseTo(120);
      expect(at.y).toBeCloseTo(90);
    }
  });
});
