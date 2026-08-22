import { _layout } from "blobatar";
import { blobatar } from "blobatar/blob";
import type { ChunkBody } from "./chunk";
import {
  CELL,
  MAX_ZOOM,
  MIN_ZOOM,
  cellToScreen,
  edgeMarker,
  visibleBox,
  type Camera,
  type Viewport,
} from "./camera";
import { faceOf } from "./expressions";
import { cellAt, chunkKey, chunksCovering, type Cell } from "./geometry";

/**
 * Drawing the wall.
 *
 * To a canvas, not to the DOM, and the existing field is the argument: sixty
 * inline SVGs at hydration was enough to show up in Total Blocking Time, which
 * is why that section waits for the viewport at all. A pannable wall holds
 * hundreds at once and moves them every frame, which is not a smaller version
 * of that problem. One canvas, one draw call per blob, and the DOM left for the
 * one cell the pointer is over.
 */

/**
 * The size a blobatar is rasterised at, once, and then scaled to whatever the
 * zoom asks for.
 *
 * 96 is a mild upscale at reading zoom and a larger one at maximum, which blobs
 * — smooth curves in flat colour — take better than text or line art would.
 * Rasterising per zoom level instead would multiply a cache that is already the
 * largest thing this component holds. It came down from 128 when the budget
 * below had to go up: the product of the two is the memory, and a wall shows
 * far more blobs at once than it needs detail in any one of them.
 */
const SPRITE_PX = 96;

/**
 * How many rasterised blobatars to keep.
 *
 * Every seed is different, so there is no sharing to exploit and the cache is
 * simply a window onto wherever the visitor has been. At 96px and four bytes a
 * pixel a full cache is on the order of 55MB, which is the price of not
 * re-rasterising the wall every time somebody pans back the way they came.
 *
 * It must exceed what a single frame can draw, and by a margin. At 400 it did
 * not: a zoomed-out viewport holds five hundred or more, so every frame evicted
 * the sprites it had drawn moments earlier in that same frame, the next frame
 * rebuilt them, each rebuild fired `onload`, and every `onload` asked for
 * another frame. A hundred SVGs rasterised per frame, forever, on an idle wall.
 * The guard below is the real fix — this number only has to be comfortable.
 *
 * A 4K viewport at minimum zoom still passes it: about three thousand blobs are
 * on screen, so the cache runs over budget and eviction correctly refuses to
 * touch any of them. That is the guard working rather than a leak, and it costs
 * ~110MB of bitmaps while somebody sits there. The case that removes it is the
 * overview tile in ADR 0011 — which is the same case, measured: see the
 * handoff's numbers.
 */
const SPRITE_BUDGET = 1500;

/**
 * Below this zoom, blobatars are drawn as their colour and nothing else.
 *
 * Deliberately below `MIN_ZOOM`, which is to say: never, for now. The first
 * cut put it at 0.7 on the theory that a 48px blob is four pixels of eye and
 * not worth fetching — which was wrong about what people are looking at. A
 * face at 48px still reads as a face, and a wall of flat discs reads as a
 * palette swatch; the crowd stops being made of anybody. Dots stay in the file
 * as the not-yet-decoded fallback, and the zoom that earns them is the one the
 * overview tile will serve, much further out than anything reachable today.
 */
const SPRITE_ZOOM = 0.3;

const spriteKey = (seed: string, expression: string) => `${seed}|${expression}`;

const colours = new Map<string, string>();

/**
 * The blob's body colour, resolved through the library rather than guessed.
 *
 * `_layout` is the same resolution the renderer runs, so the dot drawn at low
 * zoom and the blobatar drawn at high zoom cannot disagree about what colour
 * somebody is. It is underscored and not public API; the editor reads it the
 * same way for the same reason.
 */
export function colourOf(seed: string, expression: string): string {
  const key = spriteKey(seed, expression);
  const known = colours.get(key);
  if (known) return known;
  const { palette } = _layout(seed, { expression: faceOf(expression) });
  const colour = palette.head ?? "#8a8a8a";
  colours.set(key, colour);
  return colour;
}

/**
 * A rasterised blobatar.
 *
 * `bitmap` rather than the `<img>` it was decoded from, and that is a
 * measured decision rather than a tidy one. The source is an SVG data URI, and
 * an SVG-backed image is a *description*: drawing it at 36px asks the engine to
 * rasterise it at 36px, and the next frame at a slightly different zoom asks
 * again. At 4K and minimum zoom — three thousand blobs a frame — that was 61ms
 * per frame, which is sixteen frames a second on a wall being dragged.
 *
 * `createImageBitmap` freezes it into pixels once. After that a draw is a
 * scaled blit of a bitmap the engine already has, which is the thing canvases
 * are fast at. The `<img>` is kept only until the bitmap exists.
 */
type Sprite = { bitmap: ImageBitmap | HTMLImageElement | null; ready: boolean; used: number };

const sprites = new Map<string, Sprite>();

/**
 * Which frame is being drawn.
 *
 * Eviction is not allowed to touch a sprite the frame in progress has already
 * asked for, however old it is, because that is what turns a cache miss into a
 * loop rather than a cost. Least-recently-used is the wrong question inside a
 * single frame: everything on screen was used a moment ago.
 */
let frame = 0;

/**
 * A rasterised blobatar, or `null` while it is still decoding.
 *
 * Never blocks and never throws: a caller that gets `null` draws the colour dot
 * instead, so a blob resolves from a coloured cell into a face rather than
 * appearing out of nothing. `onReady` is how the canvas learns to redraw.
 */
export function spriteOf(
  seed: string,
  expression: string,
  onReady: () => void,
): CanvasImageSource | null {
  const key = spriteKey(seed, expression);
  const known = sprites.get(key);
  if (known) {
    // Touched, so eviction takes the least recently *used* rather than the
    // least recently created — panning back over a blob you have already seen
    // should not cost a re-raster.
    known.used = frame;
    sprites.delete(key);
    sprites.set(key, known);
    return known.ready ? known.bitmap : null;
  }

  const image = new Image();
  const sprite: Sprite = { bitmap: null, ready: false, used: frame };
  sprites.set(key, sprite);
  image.onload = () => {
    // Two steps, because decoding the SVG and freezing it into pixels are two
    // different things and only the second one makes drawing cheap. The
    // fallback is the decoded image itself: correct everywhere, and slow only
    // where `createImageBitmap` does not exist.
    if (typeof createImageBitmap !== "function") {
      sprite.bitmap = image;
      sprite.ready = true;
      onReady();
      return;
    }
    void createImageBitmap(image).then(
      bitmap => {
        sprite.bitmap = bitmap;
        sprite.ready = true;
        onReady();
      },
      () => {
        sprite.bitmap = image;
        sprite.ready = true;
        onReady();
      },
    );
  };
  // A failed decode stays unready forever and keeps drawing as a dot, which is
  // the correct degradation: the wall is still the right shape and the right
  // colours, it is simply less detailed.
  image.onerror = () => sprites.delete(key);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    blobatar(seed, { expression: faceOf(expression), size: SPRITE_PX }),
  )}`;

  return null;
}

/**
 * Drop the coldest sprites, and only ones this frame has not drawn.
 *
 * Running after the frame rather than during it is what makes that guarantee
 * cheap to state: by the time this is called, `used === frame` means "on screen
 * right now", and those are exactly the ones that must survive. If everything
 * in the cache is on screen the cache simply runs over budget for a while,
 * which costs memory — the alternative cost it forever.
 */
function evict() {
  if (sprites.size <= SPRITE_BUDGET) return;
  for (const [key, sprite] of sprites) {
    if (sprites.size <= SPRITE_BUDGET) break;
    if (sprite.used === frame) continue;
    // Closed rather than merely dropped: a bitmap is pixels the engine holds
    // outside the JS heap, so letting go of the reference is not the same as
    // giving the memory back.
    if (sprite.bitmap instanceof ImageBitmap) sprite.bitmap.close();
    sprites.delete(key);
  }
}

/** The gutter. A blob does not fill its cell — the lattice reads as a lattice
 * because of the thin ground showing between neighbours. */
export const FILL = 0.88;

function dot(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(sx, sy, size / 2, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The cell under the pointer is not drawn here at all.
 *
 * It is a real `<Blobatar>` laid over the canvas by `WallCanvas`, because the
 * library animates a pose with CSS and a rasterised sprite cannot animate at
 * all. This file draws the crowd; the DOM draws the one you are asking about.
 * Skipping it here is what stops the still copy from showing through while the
 * live one moves.
 */

export type Scene = {
  camera: Camera;
  view: Viewport;
  chunks: Map<string, ChunkBody>;
  /** The cell the DOM overlay is covering, if any. Left undrawn — see above. */
  skip?: Cell | null;
  /** The visitor's own blob. Drawn like every other one; it earns an edge
   * arrow only while it is off screen. */
  mine?: Cell | null;
  /** Redraw, because a sprite finished decoding since the last frame. */
  onSpriteReady: () => void;
};

/**
 * The lattice, under everything.
 *
 * The wall's own argument is that it is a *surface with slots*, and until this
 * was drawn the empty parts of it were not a surface at all — they were black.
 * That reads as "nothing here" where the section is asking you to click, and it
 * makes panning across a quiet region look like a frozen canvas, because
 * nothing on screen moves. Ruled ground fixes both: an empty cell becomes a
 * place a blobatar goes, and the wall visibly slides under the drag.
 *
 * Three things keep it from turning the wall into a spreadsheet, which is the
 * failure mode ADR 0011 names:
 *
 * - **Dashed.** A continuous rule is a table border. A dash is a fold line —
 *   the eye reads it as guide rather than as structure.
 * - **Barely there, and less so far out.** Alpha ramps with zoom, from about
 *   3% at the floor to 8% at the ceiling. Zoomed out the cells are 36px and a
 *   constant-alpha grid becomes a texture — moiré, near enough — competing
 *   with the occupancy pattern that is the actual drawing.
 * - **Underneath.** Drawn before the placements, so a line never crosses a
 *   face. The blobs sit *in* the grid rather than on top of a graph.
 *
 * Cost is a couple of dozen strokes a frame at the widest zoom — the loop is
 * bounded by the viewport, not by the wall, and the wall is unbounded.
 */
function lattice(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: Viewport,
  box: { x0: number; y0: number; x1: number; y1: number },
) {
  const t = (camera.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${(0.03 + 0.05 * t).toFixed(3)})`;
  ctx.lineWidth = 1;
  // Dashes scale with the cell, so the rhythm stays the same fraction of a cell
  // at every zoom rather than getting denser as you pull back — which is the
  // version that turns into a dotted haze.
  const step = CELL * camera.zoom;
  ctx.setLineDash([Math.max(2, step * 0.06), Math.max(4, step * 0.09)]);

  ctx.beginPath();
  // Lines fall on cell *boundaries*, which sit half a cell off the centres
  // `cellToScreen` returns.
  for (let x = Math.floor(box.x0); x <= Math.ceil(box.x1) + 1; x++) {
    const at = cellToScreen(camera, view, x - 0.5, 0).x;
    ctx.moveTo(at, 0);
    ctx.lineTo(at, view.height);
  }
  for (let y = Math.floor(box.y0); y <= Math.ceil(box.y1) + 1; y++) {
    const at = cellToScreen(camera, view, 0, y - 0.5).y;
    ctx.moveTo(0, at);
    ctx.lineTo(view.width, at);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * One frame.
 *
 * Cleared and redrawn whole rather than damaged in regions: at these counts the
 * bookkeeping to track dirty rectangles costs more than the fills it saves, and
 * a pan invalidates everything anyway.
 */
export function paint(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { camera, view, chunks } = scene;
  frame++;
  ctx.clearRect(0, 0, view.width, view.height);

  const size = CELL * camera.zoom * FILL;
  const detailed = camera.zoom >= SPRITE_ZOOM;

  // One cell of margin, so a blob whose centre is just off screen still draws
  // the half of itself that is on it.
  const box = visibleBox(camera, view, 1);

  lattice(ctx, camera, view, box);

  for (const chunk of chunksCovering(box.x0, box.y0, box.x1, box.y1)) {
    const body = chunks.get(chunkKey(chunk));
    if (!body) continue;

    for (const placement of body.cells) {
      const at = cellAt(chunk, placement.index);
      if (at.x < box.x0 || at.x > box.x1 || at.y < box.y0 || at.y > box.y1) continue;

      if (scene.skip && at.x === scene.skip.x && at.y === scene.skip.y) continue;

      const screen = cellToScreen(camera, view, at.x, at.y);
      const sprite = detailed
        ? spriteOf(placement.seed, placement.expression, scene.onSpriteReady)
        : null;

      if (sprite) ctx.drawImage(sprite, screen.x - size / 2, screen.y - size / 2, size, size);
      else dot(ctx, screen.x, screen.y, size, colourOf(placement.seed, placement.expression));
    }
  }

  if (scene.mine) {
    /*
     * Off screen, your own blobatar becomes an arrow pinned to the edge
     * pointing at where it went. On screen it is drawn exactly like everybody
     * else's — no ring.
     *
     * The ring was here and it was wrong twice over: a white circle around a
     * blob is chrome laid over the surface, and it marked the one cell that
     * needs no marking, since the person looking at it is the person who put it
     * there. What the ring was actually for is the case it now handles alone —
     * finding your blobatar when it is not on screen.
     *
     * The arrow is drawn here rather than as a DOM element so that it moves
     * with the wall on the same frame the wall does — a chevron lagging the
     * drag by a React render is the one thing that would make it read as chrome
     * rather than as part of the surface.
     */
    const marker = edgeMarker(camera, view, scene.mine);

    if (marker) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.save();
      ctx.translate(marker.x, marker.y);
      ctx.rotate(marker.angle);
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -6.5);
      ctx.lineTo(-6, 6.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  evict();
}
