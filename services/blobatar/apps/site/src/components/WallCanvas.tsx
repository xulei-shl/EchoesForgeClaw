import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Blobatar } from "@blobatar/react";
import {
  FLIGHT_MS,
  cellToScreen,
  cellUnder,
  chunksInView,
  flightAt,
  framing,
  panBy,
  zoomAt,
  type Camera,
  type Viewport,
} from "@/wall/camera";
import { placementAt, placements, type Placement } from "@/wall/chunk";
import type { Source } from "@/wall/source";
import {
  FIRST,
  cellIndex,
  cellKey,
  chunkOf,
  isPlaceable,
  nearestPlaceable,
  type Cell,
} from "@/wall/geometry";
import { CELL } from "@/wall/camera";
import { faceOf } from "@/wall/expressions";
import { cn } from "@/lib/utils";
import { FILL, paint } from "@/wall/paint";

/**
 * The wall, as a surface you can drag.
 *
 * Everything that decides *what* is true lives in `src/wall`; this file is only
 * the part that has to touch a browser — a canvas, a pointer, and a request
 * animation frame.
 *
 * Almost nothing here is React state, and that is the whole design. A drag
 * moves the camera sixty times a second, a hover moves the ghost as often, and
 * not one of those frames wants a render. State that changes per frame lives in
 * a ref and is drawn imperatively; React is left holding only the things that
 * change when a person decides something.
 */

export type Inspected = Placement & Cell;

/**
 * The one cell that is DOM rather than pixels.
 *
 * Either somebody's blobatar, playing its pose, or the translucent preview of
 * what the visitor would leave here. Both need things a canvas cannot give
 * them: the library animates an expression with CSS, and a name that fades in
 * has to be a real element to transition.
 */
type Spot =
  | { kind: "who"; cell: Cell; seed: string; expression: string }
  | { kind: "ghost"; cell: Cell };

/**
 * Where a popover should sit, in viewport coordinates.
 *
 * Viewport rather than canvas-relative so the anchor can be a fixed-position
 * element rendered anywhere in the tree, instead of something the canvas has to
 * host and keep in step with its own layout.
 */
export type At = { x: number; y: number };

type Props = {
  /**
   * Where the wall comes from.
   *
   * A source rather than a fetcher, because the two callers of this component
   * want different ones and neither wants the other's: the preview page runs it
   * against a fixture, and the landing page runs it against the Worker. The
   * canvas asks the same questions of both.
   */
  source: Source;
  /** What the visitor would be placing, drawn as the ghost under the pointer. */
  /**
   * What the visitor would be placing.
   *
   * `seed` is what the blobatar is *drawn* from and is never empty — an empty
   * cell still has to show something, so it falls back to a chosen seed. `label`
   * is what the plate under it *prints*, and is empty until somebody types:
   * printing the fallback would put a name nobody chose on the wall under a
   * blob nobody has placed yet.
   */
  draft: { seed: string; expression: string; label?: string };
  /** Their existing blob, if they have one: the target of the locate control,
   * and an edge arrow while it is off screen. Drawn like any other on screen —
   * the person looking at it is the person who put it there. */
  mine?: Cell | null;
  /**
   * A cell the ghost is held on regardless of where the pointer goes.
   *
   * Set while the placement popover is open. Without it the preview follows the
   * pointer onto the popover and away from the cell the popover is talking
   * about, so the panel says "this spot" while the blob it describes has
   * wandered off — and the one affordance the wall rests on stops meaning
   * anything at the moment it matters most.
   */
  pinned?: Cell | null;
  /** An empty cell was chosen, already resolved to somewhere placeable. */
  onPick?: (cell: Cell, at: At) => void;
  /** Somebody else's blob was clicked. Who, and when they arrived. */
  onInspect?: (placement: Inspected, at: At) => void;
  /**
   * The wall started moving.
   *
   * Anything anchored to a cell is stale the moment the camera does, and the
   * cheap honest answer is to dismiss it rather than to chase it. Fired once
   * per gesture, not per frame — a callback into React sixty times a second is
   * the thing this component is arranged to avoid.
   */
  onCameraMove?: () => void;
  /**
   * Whether a plain wheel zooms.
   *
   * Off by default, and that default is about where this component now lives: a
   * section inside a scrolling page. A canvas that swallows the wheel is a
   * canvas that traps a reader on their way down the page, which is the single
   * rudest thing an embedded map can do. Pinch — which arrives as ctrl+wheel —
   * still zooms, because that gesture means nothing else.
   *
   * The full-screen preview turns it on: there is no page to scroll there, so
   * the wheel has no other job.
   */
  wheelZooms?: boolean;
  /**
   * The wall changed underneath — how many blobatars it now holds, across the
   * whole wall rather than the part on screen.
   *
   * Zero is a real state with its own copy in the section above — an empty
   * lattice reading as "be the first" — so the section has to hear about it.
   */
  onLoaded?: (size: number) => void;
  /**
   * Dim everything except the cell being placed in.
   *
   * The scrim goes *between* the canvas and the overlay node, which is the
   * whole reason this is a prop here rather than a sibling element in the page:
   * the one cell that matters is already the only thing on this wall that is
   * DOM rather than pixels, so dimming the canvas under it lights that cell and
   * nothing else, with no second render path and no compositing tricks.
   */
  dim?: boolean;
  /**
   * Where the focused cell is on screen, reported from inside the draw loop.
   *
   * This runs on every frame of a flight, so it must not set state — it exists
   * for the arrow, which mutates one SVG path attribute and is exactly the kind
   * of per-frame work the rest of this component is arranged to keep out of
   * React.
   */
  onTrack?: (at: At | null) => void;
  /** Hands the surface's imperative bits to whatever renders the controls. */
  onReady?: (api: WallApi) => void;
};

export type WallApi = {
  /**
   * Fly to a cell, optionally landing it at a given point on screen rather than
   * in the middle.
   *
   * The placement panel occupies one side of the viewport, so "centre it" would
   * put half the picked cells underneath the panel that is talking about them.
   * The caller measures where it has room and says so.
   */
  flyTo: (cell: Cell, at?: At) => void;
  /** Ask the source for whatever is under the viewport now. The canvas does
   * this on its own cadence; this is for the caller who has just learned that
   * something changed. */
  sync: () => void;
  /** Zoom about the middle of the canvas, for a control that is not a wheel.
   * With plain-wheel zoom off by default, this is how a mouse without a
   * trackpad gets there at all. */
  zoomBy: (factor: number) => void;
  /** Draw a placement into the wall immediately.
   *
   * Optimistic on purpose: the writer sees their own blob land at once, while
   * everybody else picks it up whenever their chunk's cache entry turns over.
   * A wall that waits for a round trip before acknowledging a click feels
   * broken in exactly the way a wall must not. */
  place: (cell: Cell, seed: string, expression: string) => void;
};

/** A drag under this many pixels is a click. Above it the pointer was panning,
 * and the release must not place anything — the single most annoying way for a
 * map to betray you. */
const DRAG_SLOP = 4;

export function WallCanvas({
  source,
  draft,
  mine = null,
  pinned = null,
  dim = false,
  wheelZooms = false,
  onLoaded,
  onPick,
  onInspect,
  onCameraMove,
  onTrack,
  onReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>({ ...FIRST, zoom: 1 });
  const viewRef = useRef<Viewport>({ width: 0, height: 0 });
  const hoverRef = useRef<Cell | null>(null);
  const frameRef = useRef(0);
  const flightRef = useRef<{ from: Camera; to: Camera; start: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: number } | null>(null);

  /**
   * Every finger currently on the wall, by pointer id.
   *
   * A one-finger drag needs only the last point, which is what `dragRef` held
   * on its own — and why a two-finger pinch did nothing but pan erratically:
   * the second `pointerdown` overwrote the first one's anchor, so the wall
   * followed whichever finger moved last. A pinch is a relationship *between*
   * two points, so both have to be kept.
   */
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());

  /**
   * The pinch in progress: the distance between the fingers and their midpoint,
   * as of the last move.
   *
   * Both are needed, and the midpoint is the half that is easy to forget. Zoom
   * alone anchors the gesture to a fixed point and the wall slides out from
   * under the fingers as they travel; carrying the midpoint's own movement into
   * a pan is what makes the wall stay where it is being held.
   */
  const pinchRef = useRef<{ span: number; x: number; y: number } | null>(null);

  /**
   * A pinch happened, so the release is not a tap.
   *
   * Lifting two fingers fires two `pointerup`s, and the second one arrives with
   * no drag recorded — which is exactly the shape of a click. Without this,
   * every pinch ended by opening the placement panel on whatever cell the last
   * finger happened to be over.
   */
  const pinchedRef = useRef(false);

  /** The fingers, as a pair, when there are exactly two. */
  const spanOf = () => {
    const [a, b] = [...touchesRef.current.values()];
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return { span: Math.hypot(dx, dy), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  /**
   * Props the draw loop reads, mirrored into a ref.
   *
   * `draft` is a fresh object on every parent render, so a `draw` that closed
   * over it changed identity on every render too — and the effect that sizes
   * the canvas depended on `draw`, so it re-ran and reassigned `canvas.width`,
   * which clears the canvas. That was the flicker: a full repaint from blank
   * every time any state anywhere above changed. `draw` is now stable and reads
   * through here instead.
   */
  const propsRef = useRef({ draft, mine, pinned, wheelZooms, onPick, onInspect, onCameraMove, onTrack });
  propsRef.current = { draft, mine, pinned, wheelZooms, onPick, onInspect, onCameraMove, onTrack };

  /**
   * Where the canvas sits in the viewport.
   *
   * Everything inside this component thinks in canvas coordinates, which used
   * to be the same thing as viewport coordinates because the only page holding
   * a wall was a full-screen one. In a section halfway down the landing page it
   * is not, and the difference is exactly the arrow pointing at the wrong cell.
   *
   * Cached rather than measured per frame: `getBoundingClientRect` inside a
   * draw loop is a layout read sixty times a second. Refreshed where it can
   * actually change — a resize, and a scroll, which moves the canvas without
   * the wall moving at all.
   */
  const rectRef = useRef({ left: 0, top: 0 });

  /** Through a ref so a parent that re-renders on this callback cannot make
   * `rebuild` — and therefore every effect that depends on it — unstable. */
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  /** The debounced fetch, reached through a ref by the hand-bound wheel
   * listener — which must not re-bind on every render. Assigned below, once
   * the source and the draw loop it depends on exist. */
  const syncRef = useRef<() => void>(() => {});

  // The source, through a ref for the same reason the props are: the draw loop
  // and the pointer handlers must not change identity when the parent renders.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const chunksOf = useCallback(() => sourceRef.current.wall().chunks, []);

  // Occupancy as a mutable set rather than rebuilt from the chunks on every
  // placement: a placement is the one thing that changes it, and it changes it
  // by exactly one cell.
  const takenRef = useRef<Set<string>>(new Set());

  const occupied = useCallback((x: number, y: number) => takenRef.current.has(cellKey(x, y)), []);
  const populatedRef = useRef(false);

  /*
   * The overlay is the one thing here that is allowed to cost a React render,
   * and it costs exactly one per cell — not per pointer move, and never per
   * frame. Its *position* is still set imperatively in the draw loop below,
   * because that changes with the camera.
   */
  const [spot, setSpot] = useState<Spot | null>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  /*
   * Where the overlay is and what it hides, advanced only at commit time.
   *
   * They cannot be written when the hover is *decided*, because that happens in
   * an event handler and the node it describes does not exist until React
   * commits. A frame landing in between then positioned the outgoing node at
   * the incoming cell — the stale blob appearing where the new one belongs —
   * and the incoming node mounted untransformed at the corner of the canvas.
   * Both symptoms, one cause: the refs and the element have to move together.
   */
  const spotAtRef = useRef<Cell | null>(null);
  const skipRef = useRef<Cell | null>(null);

  /** Put the overlay over its cell. Straight on the element: a CSS variable
   * would be inherited and recalculate every child's style; this touches one
   * node. */
  const placeSpot = useCallback(() => {
    const node = spotRef.current;
    const at = spotAtRef.current;
    const { pinned: held, onTrack: track } = propsRef.current;
    // The arrow follows the *held* cell only. A ghost under a moving pointer is
    // not something to point at, and pointing at it would mean an arrow
    // redrawn on every pointer move for no one's benefit.
    track?.(
      held
        ? (() => {
            const screen = cellToScreen(cameraRef.current, viewRef.current, held.x, held.y);
            // Viewport coordinates: the arrow is drawn by a fixed-position
            // element that knows nothing about where this canvas is.
            return { x: screen.x + rectRef.current.left, y: screen.y + rectRef.current.top };
          })()
        : null,
    );
    if (!node || !at) return;
    const screen = cellToScreen(cameraRef.current, viewRef.current, at.x, at.y);
    const size = CELL * cameraRef.current.zoom * FILL;
    node.style.width = `${size}px`;
    node.style.height = `${size}px`;
    node.style.transform = `translate(${screen.x - size / 2}px, ${screen.y - size / 2}px)`;
  }, []);

  /** One frame, at most, per animation frame. Pointer moves, wheel events and
   * sprite decodes all arrive faster than the display refreshes and each wants
   * a redraw; coalescing here means the expensive thing happens once. */
  const draw = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const flight = flightRef.current;
      if (flight) {
        const t = (performance.now() - flight.start) / FLIGHT_MS;
        cameraRef.current = flightAt(flight.from, flight.to, t);
        if (t >= 1) {
          flightRef.current = null;
          // Landed somewhere else entirely, which is the one gesture guaranteed
          // to need chunks this browser has never asked for.
          syncRef.current();
        } else draw();
      }

      const { mine: located } = propsRef.current;
      // The overlay rides the camera, so it is repositioned per frame as well
      // as at commit.
      placeSpot();

      paint(ctx, {
        camera: cameraRef.current,
        view: viewRef.current,
        chunks: chunksOf(),
        skip: skipRef.current,
        mine: located,
        onSpriteReady: draw,
      });
    });
  }, [placeSpot, chunksOf]);

  /**
   * Occupancy, rebuilt from whatever the source now holds.
   *
   * Whole rather than incremental, because this runs when a *chunk* arrives —
   * a thousand cells at a time — and the incremental path exists for the one
   * case that changes a single cell, which is somebody placing.
   */
  const rebuild = useCallback(() => {
    const wall = sourceRef.current.wall();
    const taken = new Set<string>();
    for (const placement of placements(wall.chunks)) {
      taken.add(cellKey(placement.x, placement.y));
    }
    takenRef.current = taken;
    // From the source rather than from `taken.size`: the count is the whole
    // wall's, and this browser holds the chunks under one viewport. An unloaded
    // wall and an empty one look identical from here and mean opposite things.
    populatedRef.current = wall.size > 0;
    draw();
    onLoadedRef.current?.(wall.size);
  }, [draw]);

  /**
   * Fetch whatever is under the viewport, and redraw if anything came back.
   *
   * Called after a gesture rather than during one — the source coalesces and
   * the chunks under a pan are mostly ones it already holds, but a fetch per
   * frame would still be a fetch per frame. `changed` being false is the common
   * case and costs nothing.
   */
  const sync = useCallback(async () => {
    const wanted = chunksInView(cameraRef.current, viewRef.current);
    if (await sourceRef.current.load(wanted)) rebuild();
  }, [rebuild]);

  /**
   * The same, once the camera has stopped.
   *
   * A wheel gesture is dozens of events and a drag is hundreds, and the chunks
   * under the viewport change on perhaps two of them. The debounce is what
   * keeps a pan across the wall a handful of requests rather than one per
   * frame — and the fetch has to happen *after* the movement, because the
   * chunks worth asking for are the ones the camera ended up over.
   */
  const syncTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const syncSoon = useCallback(() => {
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(sync, 200);
  }, [sync]);

  syncRef.current = syncSoon;

  useEffect(() => {
    rebuild();
    void sync();
    return () => clearTimeout(syncTimer.current);
  }, [rebuild, sync]);

  /**
   * And again, on the index's own cadence.
   *
   * This is what makes it a wall other people are on: a placement made
   * elsewhere is invisible here until something asks, and thirty seconds is
   * what the region index is cached for anyway, so asking faster would only
   * re-read the same answer.
   */
  useEffect(() => {
    const timer = setInterval(sync, 30_000);
    return () => clearInterval(timer);
  }, [sync]);

  /**
   * The backing store follows the element, and the context is scaled so that
   * everything above goes on thinking in CSS pixels. Depends on nothing that
   * changes per render — see the note on `propsRef`.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      rectRef.current = { left: rect.left, top: rect.top };
      const dpr = window.devicePixelRatio || 1;
      viewRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    /*
     * A scroll moves the canvas without changing the wall, so nothing here
     * would otherwise redraw — but the overlay and the arrow are positioned in
     * viewport coordinates and both are now wrong. Passive: this listens, it
     * never blocks the scroll it is watching.
     */
    const scrolled = () => {
      const rect = canvas.getBoundingClientRect();
      rectRef.current = { left: rect.left, top: rect.top };
      placeSpot();
    };
    window.addEventListener("scroll", scrolled, { passive: true, capture: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [draw, placeSpot]);

  /** Wheel, bound by hand: React's `onWheel` is passive and cannot
   * `preventDefault`, so a trackpad pinch would zoom the page instead. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent) => {
      // A pinch arrives as ctrl+wheel and means zoom and nothing else. A plain
      // wheel means "further down the page" unless this wall is the page.
      if (!event.ctrlKey && !propsRef.current.wheelZooms) return;
      event.preventDefault();
      flightRef.current = null;
      propsRef.current.onCameraMove?.();
      const rect = canvas.getBoundingClientRect();
      // ctrl+wheel is what a trackpad pinch arrives as, and it wants a far
      // finer response than a mouse wheel's fixed notches.
      const intensity = event.ctrlKey ? 0.01 : 0.0016;
      cameraRef.current = zoomAt(
        cameraRef.current,
        viewRef.current,
        Math.exp(-event.deltaY * intensity),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      draw();
      syncRef.current();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [draw]);

  /**
   * Redraw when something React owns changes.
   *
   * The draw loop reads these through a ref, which keeps it stable but also
   * means nothing tells it they moved. Typing a name repaints the held ghost as
   * the blobatar it is becoming, which is the demo happening inside the
   * affordance.
   */
  /**
   * Commit the overlay: its cell, what it hides, and where it sits — before the
   * browser paints, and in the same pass that mounted the node.
   *
   * `useLayoutEffect` rather than `useEffect` because a frame between commit
   * and paint is exactly the window the flicker lived in.
   */
  useLayoutEffect(() => {
    spotAtRef.current = spot?.cell ?? null;
    skipRef.current = spot?.kind === "who" ? spot.cell : null;
    placeSpot();
    draw();
  }, [spot, placeSpot, draw]);

  useEffect(() => draw(), [draw, draft, mine, pinned]);

  /**
   * What the overlay is showing, resolved from the pointer and the held cell.
   *
   * A held cell outranks the pointer — it was already resolved through the
   * rules when it was picked, and while the popover is open the pointer has
   * left the wall for it.
   */
  const settle = useCallback(
    (hover: Cell | null) => {
      const held = propsRef.current.pinned;
      const cell = held ?? hover;
      if (!cell) {
        setSpot(null);
        return;
      }
      const there = placementAt(chunksOf(), chunkOf(cell.x, cell.y), cellIndex(cell.x, cell.y));
      const next: Spot | null = there
        ? { kind: "who", cell, seed: there.seed, expression: there.expression }
        : held || isPlaceable(cell.x, cell.y, occupied, populatedRef.current)
          ? { kind: "ghost", cell }
          : null;
      setSpot(next);
    },
    [occupied, chunksOf],
  );

  // Both directions: holding a cell shows it, and letting go hands the overlay
  // back to wherever the pointer actually is — which may be nowhere, in which
  // case the preview has to go rather than linger on a cell nobody chose.
  useEffect(() => {
    settle(hoverRef.current);
  }, [pinned, settle]);

  /**
   * Redraw once the webfont is in.
   *
   * Canvas text does not reflow when a font finishes loading the way DOM text
   * does — whatever was painted keeps whichever face was available at the time.
   * Without this the name plates spend the first paint in the fallback and stay
   * there until something else happens to ask for a frame.
   */
  useEffect(() => {
    document.fonts?.ready.then(draw);
  }, [draw]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  useEffect(() => {
    onReady?.({
      flyTo: (cell: Cell, at?: At) => {
        /*
         * A floor on the zoom, and a higher one when the flight is framing a
         * cell for the panel.
         *
         * "Find mine" only has to put the blobatar on screen, and arriving at
         * whatever zoom you were reading at preserves the sense of where it
         * sits. Placing is the opposite: the cell is the subject of everything
         * the panel says, and at 0.45 the thing being talked about is 36px of
         * silhouette. Pulling in is what makes it a blobatar rather than a dot
         * with an arrow at it.
         */
        const zoom = Math.max(cameraRef.current.zoom, at ? 1.4 : 1);
        flightRef.current = {
          from: cameraRef.current,
          to: at ? framing(viewRef.current, cell, at, zoom) : { ...cell, zoom },
          start: performance.now(),
        };
        draw();
      },
      zoomBy: (factor: number) => {
        flightRef.current = null;
        cameraRef.current = zoomAt(
          cameraRef.current,
          viewRef.current,
          factor,
          viewRef.current.width / 2,
          viewRef.current.height / 2,
        );
        draw();
        syncRef.current();
      },
      place: (cell: Cell, seed: string, expression: string) => {
        sourceRef.current.claim(chunkOf(cell.x, cell.y), {
          index: cellIndex(cell.x, cell.y),
          seed,
          expression,
          at: Math.floor(Date.now() / 1000),
        });
        // The one change that is a single cell, so it is applied as one rather
        // than by walking every chunk in memory again.
        takenRef.current.add(cellKey(cell.x, cell.y));
        populatedRef.current = true;
        draw();
      },
      sync,
    });
  }, [draw, onReady, sync]);

  const pointFrom = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  /** Set straight on the element rather than through state: the cursor changes
   * on every pointer move, and a render per move is the thing this whole file
   * is arranged to avoid. */
  const cursor = (canvas: HTMLCanvasElement, value: string) => {
    if (canvas.style.cursor !== value) canvas.style.cursor = value;
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
    <canvas
      ref={canvasRef}
      className="h-full w-full touch-none select-none"
      style={{ cursor: "grab" }}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        flightRef.current = null;
        touchesRef.current.set(event.pointerId, pointFrom(event));

        // A second finger ends the pan and starts a pinch. The drag is dropped
        // rather than kept: a pan driven by one of two pinching fingers is the
        // wall lurching sideways every time the grip shifts.
        if (touchesRef.current.size === 2) {
          dragRef.current = null;
          pinchRef.current = spanOf();
          pinchedRef.current = true;
          propsRef.current.onCameraMove?.();
          return;
        }

        if (touchesRef.current.size === 1) pinchedRef.current = false;
        dragRef.current = { ...pointFrom(event), moved: 0 };
        cursor(event.currentTarget, "grabbing");
      }}
      onPointerMove={event => {
        const point = pointFrom(event);
        if (touchesRef.current.has(event.pointerId)) touchesRef.current.set(event.pointerId, point);

        /*
         * The pinch.
         *
         * Zoom is the ratio of the fingers' spans, applied at their midpoint —
         * `zoomAt` keeps whatever cell is under that point under it, which is
         * what makes the wall feel held rather than driven. Then the midpoint's
         * own travel is panned in, so the two fingers can zoom and move at once
         * the way they do everywhere else.
         *
         * `flightRef` is cleared because a camera animation and a gesture
         * fighting over the same camera is a wall that shakes.
         */
        if (touchesRef.current.size >= 2) {
          const now = spanOf();
          const was = pinchRef.current;
          pinchRef.current = now;
          if (!now || !was || !was.span) return;

          flightRef.current = null;
          cameraRef.current = zoomAt(cameraRef.current, viewRef.current, now.span / was.span, now.x, now.y);
          cameraRef.current = panBy(cameraRef.current, now.x - was.x, now.y - was.y);
          if (hoverRef.current) {
            hoverRef.current = null;
            settle(null);
          }
          draw();
          return;
        }

        const drag = dragRef.current;

        if (drag) {
          const dx = point.x - drag.x;
          const dy = point.y - drag.y;
          const before = drag.moved;
          drag.moved += Math.abs(dx) + Math.abs(dy);
          // Once, on the frame the gesture stops being a click.
          if (before <= DRAG_SLOP && drag.moved > DRAG_SLOP) propsRef.current.onCameraMove?.();
          dragRef.current = { ...point, moved: drag.moved };
          cameraRef.current = panBy(cameraRef.current, dx, dy);
          // No preview mid-drag: something sliding under a hand that is moving
          // the wall reads as the wall being unstable.
          if (hoverRef.current) {
            hoverRef.current = null;
            settle(null);
          }
        } else {
          const at = cellUnder(cameraRef.current, viewRef.current, point.x, point.y);
          const was = hoverRef.current;
          cursor(event.currentTarget, occupied(at.x, at.y) ? "help" : "pointer");
          // A pointer crossing one cell fires dozens of moves and only one of
          // them changes anything. Without this the wall repaints — several
          // hundred blobs — for every pixel the mouse travels.
          if (was && was.x === at.x && was.y === at.y) return;
          hoverRef.current = at;
          settle(at);
        }
        draw();
      }}
      onPointerUp={event => {
        touchesRef.current.delete(event.pointerId);

        /*
         * Coming out of a pinch.
         *
         * With a finger still down the gesture is a pan again, and it has to
         * re-anchor to where *that* finger is — carrying on from the pinch's
         * midpoint would jump the wall by the distance between them. The drag
         * starts past `DRAG_SLOP` so that lifting the last finger is a release
         * and not a tap on whatever it was resting on.
         */
        if (pinchRef.current) {
          pinchRef.current = touchesRef.current.size >= 2 ? spanOf() : null;
          const left = [...touchesRef.current.values()][0];
          dragRef.current = left ? { ...left, moved: DRAG_SLOP + 1 } : null;
          syncRef.current();
          return;
        }

        const drag = dragRef.current;
        dragRef.current = null;
        cursor(event.currentTarget, "grab");
        if (!drag || drag.moved > DRAG_SLOP || pinchedRef.current) {
          // The wall moved, so what is under it may not be loaded.
          if (drag) syncRef.current();
          return;
        }

        const point = pointFrom(event);
        const aimed = cellUnder(cameraRef.current, viewRef.current, point.x, point.y);
        const { onPick: pick, onInspect: inspect } = propsRef.current;

        /*
         * Two targets, not one. A click on somebody's blob asks who they are;
         * a click on empty wall asks for that cell. Running both through
         * `nearestPlaceable` was the bug that made clicking a stranger shove
         * the wall sideways to an empty cell nobody had aimed at.
         */
        const rect = event.currentTarget.getBoundingClientRect();
        const anchorFor = (cell: Cell, centred: boolean): At => {
          // A cell the camera is about to fly to ends up in the middle of the
          // viewport by definition, so anchoring to where it is *now* would
          // point the popover at the wall it is leaving.
          if (centred) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          const screen = cellToScreen(cameraRef.current, viewRef.current, cell.x, cell.y);
          return { x: rect.left + screen.x, y: rect.top + screen.y };
        };

        if (occupied(aimed.x, aimed.y)) {
          const found = placementAt(chunksOf(), chunkOf(aimed.x, aimed.y), cellIndex(aimed.x, aimed.y));
          if (found) inspect?.({ ...found, ...aimed }, anchorFor(aimed, false));
          return;
        }

        const target = nearestPlaceable(aimed, occupied, populatedRef.current);
        if (!target) return;

        // Only if they aimed somewhere that could not take it. Landing the
        // camera on a cell the visitor already clicked is a jolt with nothing
        // to explain it.
        const flying = target.x !== aimed.x || target.y !== aimed.y;
        if (flying) {
          flightRef.current = {
            from: cameraRef.current,
            to: { ...target, zoom: Math.max(cameraRef.current.zoom, 1) },
            start: performance.now(),
          };
        }
        hoverRef.current = target;
        settle(target);
        pick?.(target, anchorFor(target, flying));
        draw();
      }}
      onPointerCancel={event => {
        // A cancelled pointer is the browser taking the gesture — a system
        // edge swipe, a call arriving. Forgetting the finger is what stops the
        // next pinch from measuring against one that is no longer there.
        touchesRef.current.delete(event.pointerId);
        if (touchesRef.current.size < 2) pinchRef.current = null;
        dragRef.current = null;
      }}
      onPointerLeave={event => {
        // The pointer leaving for the popover must not take the preview with
        // it; `pinned` is what keeps it, and clearing hover is still right.
        touchesRef.current.delete(event.pointerId);
        if (touchesRef.current.size < 2) pinchRef.current = null;
        hoverRef.current = null;
        settle(null);
        dragRef.current = null;
        cursor(event.currentTarget, "grab");
        draw();
      }}
      />

      {/*
        The scrim.
        
        Between the canvas and the overlay below it, in the DOM and therefore in
        the stacking order — so the wall dims and the one cell being placed in
        stays lit, without either of them being drawn twice. Not fully opaque:
        "you found a nice spot" only means something if the neighbours the spot
        is next to are still visible.
      */}
      <div
        aria-hidden="true"
        className={cn(
          "bg-ground pointer-events-none absolute inset-0 transition-opacity duration-300",
          dim ? "opacity-90" : "opacity-0",
        )}
      />

      {/*
        The live cell. Keyed by its coordinates so moving to the next cell
        remounts it: that is what restarts the pose and re-fires the label's
        entry, where a reused node would sit there already animated.
      */}
      {spot && (
        <div
          key={`${spot.cell.x},${spot.cell.y},${spot.kind}`}
          ref={spotRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 will-change-transform"
        >
          <Blobatar
            name={spot.kind === "who" ? spot.seed : draft.seed}
            expression={faceOf(spot.kind === "who" ? spot.expression : draft.expression)}
            animate="always"
            className="h-full w-full"
            /* A ghost, but a brighter one while the wall behind it is dimmed:
               0.45 reads as "not yet real" against a lit wall and as "barely
               there" against a scrim, and this is the moment the blobatar is
               supposed to be the only thing on screen. */
            style={spot.kind === "ghost" ? { opacity: dim ? 0.9 : 0.45 } : undefined}
          />
          {(spot.kind === "who" ? spot.seed : draft.label) && (
            <span className="wall-plate text-ink/50 absolute top-full left-1/2 pt-1 font-mono text-[0.65rem] whitespace-nowrap">
              {spot.kind === "who" ? spot.seed : draft.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
