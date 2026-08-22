import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Blobatar } from "@blobatar/react";
import { PoseTile } from "@/components/ui/pose-tile";
import { Turnstile } from "@/components/Turnstile";
import { cn } from "@/lib/utils";
import { FACES, FACE_NAMES } from "@/wall/expressions";
import { HAND, SAID } from "@/wall/copy";
import { MAX_NAME } from "@/wall/limits";
import type { At } from "@/components/WallCanvas";
import type { Placed } from "@/wall/source";
import type { Cell } from "@/wall/geometry";

/**
 * The placement panel: a docked sheet, and an arrow to the cell it is about.
 *
 * This replaced a popover anchored to the cell, and the reason is what a
 * popover has to compete with. The wall is hundreds of blobatars; a card
 * floating over them is one more thing on a busy surface, and it has to shout
 * to be read. Dimming the wall instead ends the competition rather than winning
 * it — the scrim lives in `WallCanvas`, between the canvas and the one cell
 * that is DOM, so the picked cell stays lit and everything else recedes.
 *
 * What the scrim costs is the spatial link: a panel docked to the side is no
 * longer *pointing at* anything. Hence the arrow, which is the only element
 * here doing a job neither the copy nor the layout can do — it says "that one",
 * about a cell that is otherwise just another blob.
 */

/** Below this, the panel is a bottom sheet and the arrow points up rather than
 * across. One breakpoint, matching Tailwind's `md`. */
const WIDE = 768;

/**
 * Where the picked cell should sit on screen.
 *
 * Exported because the *page* is what flies the camera, and the answer depends
 * on where this component decided to put itself. Left of the panel and below
 * its middle on a wide screen, which is the arrangement the arrow is drawn for;
 * above the sheet on a narrow one.
 *
 * A third of the way across rather than nearer the middle, and that is the
 * arrow's number rather than the cell's: at the panel's size the two ended up
 * close enough that the curve had no room to be a curve — a stub with a head on
 * it, which reads as a glitch rather than as a gesture. The gap between them is
 * what the arrow is made of.
 *
 * Fractions rather than pixels: the cell wants to be clear of the panel on a
 * 4K display and on a laptop, and those are different numbers of pixels but the
 * same composition.
 */
export function anchor(view: { width: number; height: number }): At {
  return view.width >= WIDE
    ? { x: view.width * 0.3, y: view.height * 0.58 }
    : { x: view.width * 0.5, y: view.height * 0.3 };
}

type Props = {
  cell: Cell;
  /** The name being typed, and what it is drawn as while empty. */
  name: string;
  onName: (name: string) => void;
  face: string;
  onFace: (face: string) => void;
  /** The seed the previews are drawn from — the typed name, or the placeholder
   * standing in for it. */
  seed: string;
  /** Nobody has placed anything yet, so this one goes at the origin by rule. */
  first: boolean;
  /** The challenge is only rendered against a real server. */
  live: boolean;
  sending: boolean;
  refused: Placed | null;
  onTurnstile: (token: string | null) => void;
  onPlace: () => void;
  /** Escape, and whatever else decides the panel is done. */
  onDismiss: () => void;
  /**
   * Where the panel publishes its arrow-drawing function.
   *
   * The arrow moves with the camera — every frame of a 700ms flight — and a
   * prop that re-rendered this panel sixty times to move a curve would undo the
   * arrangement the canvas is built around. So the canvas calls this from
   * inside its draw loop and the only thing that happens is one `setAttribute`.
   */
  track: { current: ((at: At | null) => void) | null };
};

export function WallPanel({
  cell,
  name,
  onName,
  face,
  onFace,
  seed,
  first,
  live,
  sending,
  refused,
  onTurnstile,
  onPlace,
  onDismiss,
  track,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const curveRef = useRef<SVGPathElement>(null);
  const headRef = useRef<SVGPathElement>(null);
  /** The panel's own box, measured when it changes rather than when the arrow
   * is drawn — `getBoundingClientRect` inside a draw loop is a layout read on
   * every frame, which is the one kind of work a draw loop must not do. */
  const boxRef = useRef<DOMRect | null>(null);
  const lastRef = useRef<At | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  /**
   * Wide or narrow, decided once when the panel opens.
   *
   * Not state and not a media-query listener: this panel lives for as long as
   * one placement takes, and the two things it changes — whether the field
   * takes focus on its own, and how much room the sheet has — must not flip
   * mid-placement. On a phone that is exactly what would happen, because the
   * on-screen keyboard resizes the viewport.
   */
  const wide = useRef(typeof window === "undefined" || window.innerWidth >= WIDE).current;

  /**
   * How much of the screen the on-screen keyboard is covering.
   *
   * `position: fixed; bottom: 0` is a promise about the *layout* viewport, and
   * the keyboard does not shrink that one — so the bottom of this sheet, and
   * the button that leaves the blobatar, sit underneath the keyboard on iOS.
   * The visual viewport is the only thing that knows where the visible bottom
   * actually is, so the sheet is lifted by the difference.
   *
   * Zero everywhere the keyboard is closed, and on every browser without a
   * `visualViewport` — in which case this is the layout it always had.
   */
  const [keyboard, setKeyboard] = useState(0);

  useEffect(() => {
    const port = window.visualViewport;
    if (!port || wide) return;
    const measure = () =>
      setKeyboard(Math.max(0, window.innerHeight - (port.height + port.offsetTop)));
    measure();
    port.addEventListener("resize", measure);
    port.addEventListener("scroll", measure);
    return () => {
      port.removeEventListener("resize", measure);
      port.removeEventListener("scroll", measure);
    };
  }, [wide]);

  /*
   * Keep the chosen face in the strip.
   *
   * Fourteen tiles, six of which fit: a pose picked with the keyboard, or one
   * restored from a previous panel, would otherwise be selected somewhere off
   * to the right with nothing on screen saying so. `nearest` rather than
   * `center` so choosing a visible neighbour does not shunt the whole strip.
   */
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [face]);

  useLayoutEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const measure = () => (boxRef.current = node.getBoundingClientRect());
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", measure, true);
    };
  }, []);

  /**
   * The curve, from the panel's edge to just short of the cell.
   *
   * A quadratic with its control point pushed off the midpoint perpendicular to
   * the line, which is what makes it a swoosh rather than a leader line. The
   * push is a fraction of the distance, so a short arrow bends as much as a long
   * one — a fixed offset makes the short one look like a mistake.
   *
   * It stops `GAP` short of the cell centre and the head is drawn on the
   * tangent there, so the arrow points *at* the blobatar rather than into it.
   */
  const paint = useCallback((at: At | null) => {
    const curve = curveRef.current;
    const head = headRef.current;
    const box = boxRef.current;
    if (!curve || !head) return;
    if (!at || !box) {
      curve.removeAttribute("d");
      head.removeAttribute("d");
      return;
    }

    const wide = window.innerWidth >= WIDE;
    // The panel's near edge: its left side on a wide screen, its top on a
    // narrow one. Three quarters down rather than centred, because the arrow
    // leaves from under the copy it belongs to.
    const from = wide
      ? { x: box.left - 16, y: box.top + box.height * 0.72 }
      : { x: box.left + box.width * 0.5, y: box.top - 16 };

    const span = Math.hypot(at.x - from.x, at.y - from.y);
    const unit = { x: (at.x - from.x) / span, y: (at.y - from.y) / span };

    /*
     * How far short of the cell the arrow stops.
     *
     * Wider when the approach is from below, because that is where the cell's
     * name plate hangs — the canvas draws it under the blobatar — and an
     * arrowhead landing on it strikes the name through. From the side there is
     * nothing there to clear.
     */
    const gap = unit.y < -0.5 ? 76 : 44;
    if (span < gap + 24) {
      curve.removeAttribute("d");
      head.removeAttribute("d");
      return;
    }

    const to = { x: at.x - unit.x * gap, y: at.y - unit.y * gap };

    // Perpendicular, and the sign is chosen so the curve always bows *away*
    // from the panel — bowing back across it reads as a scribble.
    const bow = Math.min(span * 0.28, 120) * (wide ? 1 : -1);
    const control = {
      x: (from.x + to.x) / 2 + unit.y * bow,
      y: (from.y + to.y) / 2 - unit.x * bow,
    };

    curve.setAttribute("d", `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`);

    // The head sits on the tangent at the end of the curve, which for a
    // quadratic is the direction from the control point to the endpoint — not
    // the direction of the straight line, and using that instead is what makes
    // an arrowhead look bolted on.
    const angle = Math.atan2(to.y - control.y, to.x - control.x);
    const wing = (spread: number) => ({
      x: to.x - 14 * Math.cos(angle + spread),
      y: to.y - 14 * Math.sin(angle + spread),
    });
    const left = wing(0.45);
    const right = wing(-0.45);
    head.setAttribute("d", `M ${left.x} ${left.y} L ${to.x} ${to.y} L ${right.x} ${right.y}`);
  }, []);

  /**
   * The last point the canvas reported, so the arrow can be redrawn without it.
   *
   * The canvas calls `track` when it *draws*, and it has no reason to draw
   * because the panel resized or the window did — but both move the end the
   * arrow starts from.
   */
  const remember = useCallback(
    (at: At | null) => {
      lastRef.current = at;
      paint(at);
    },
    [paint],
  );

  useLayoutEffect(() => {
    track.current = remember;
    return () => {
      track.current = null;
    };
  }, [remember, track]);

  useEffect(() => {
    const again = () => paint(lastRef.current);
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, [paint]);

  /**
   * Escape closes it.
   *
   * The popover this replaced got that from Radix; a panel built out of plain
   * elements has to say so itself, and it is not optional — the panel covers a
   * third of the screen, dims the rest, and takes focus into a text field, which
   * is every signal that Escape should back out of it.
   *
   * On `window` rather than on the panel, because the key has to work while
   * focus is in the name field, on a face in the strip, or inside the Turnstile
   * iframe's neighbourhood. `capture` so that a stray handler that stops
   * propagation on its way up cannot swallow it.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);

  return (
    <>
      {/*
        The arrow, over the wall and under nothing. `fixed` and viewport-sized
        because both of its ends are in viewport coordinates: one is a measured
        DOM box, the other is a cell the canvas resolved.
      */}
      <svg
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-20 h-full w-full"
        fill="none"
      >
        <g className="text-ink/70" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path ref={curveRef} />
          <path ref={headRef} />
        </g>
      </svg>

      <div
        ref={panelRef}
        role="dialog"
        aria-label="Leave a blobatar here"
        className={cn(
          "fixed z-30 flex flex-col gap-4",
          // Docked right and vertically centred on a wide screen; a sheet on a
          // narrow one. Not a modal in either case — the wall behind stays
          // pannable, and dismissing is a click on it.
          "inset-x-0 bottom-0 rounded-t-3xl p-5 sm:p-6",
          // The sheet takes what it needs and no more. With the keyboard up, a
          // phone has a few hundred pixels of viewport left, and a panel that
          // is taller than that scrolls *the page* instead — which drags the
          // wall out from under the arrow pointing at it.
          "max-h-[min(30rem,80svh)] overflow-y-auto overscroll-contain",
          "md:inset-x-auto md:top-1/2 md:right-12 md:bottom-auto md:max-h-none md:w-[26rem] md:-translate-y-1/2 md:overflow-visible md:rounded-none md:p-0 lg:w-[30rem]",
          "bg-ground/80 backdrop-blur md:bg-transparent md:backdrop-blur-none",
        )}
        style={keyboard ? { bottom: keyboard } : undefined}
      >
        <div>
          {/*
            The heading, in the one hand-lettered face on the site.

            `text-balance` because it is two lines by design and a lone word on
            the second is what makes hand lettering look like a font. See
            `src/wall/copy.ts` — this string is the input to the font's subset,
            not just copy.
          */}
          <h2 className="text-ink font-hand text-4xl leading-[1.05] text-balance sm:text-5xl md:text-7xl">
            {HAND.spot}
          </h2>

          {/*
            The name as a signature under the heading, not as a field above a
            button. It is dashed-underlined and sized to itself, so it reads as
            something written on the wall rather than as data entry — and it is
            still an input, focusable by clicking the underline like any other.
          */}
          <div className="mt-3">
            <label htmlFor="wall-name" className="sr-only">
              Your name
            </label>
            <span
              className={cn(
                "inline-grid border-b border-dashed pb-0.5 transition-colors duration-200",
                "border-line hover:border-muted focus-within:border-ink",
              )}
            >
              {/*
                An invisible copy of the value carries the width, so the rule
                under the name is exactly as wide as the name. `whitespace-pre`
                keeps a trailing space measurable, without which the caret walks
                off the end of it.
              */}
              <span
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 px-0.5 text-xl whitespace-pre"
              >
                {name || "someone"}
              </span>
              <input
                id="wall-name"
                /*
                  Focused on a desktop, left alone on a phone.
                  
                  `autoFocus` is a convenience where the keyboard is already
                  there and a cost where it is not: on a phone it throws up the
                  on-screen keyboard the instant you pick a cell, before you
                  have even looked at the spot you chose, and takes half the
                  screen to do it. Tapping the name is one tap, and it is the
                  tap somebody makes when they are ready to type.
                */
                autoFocus={wide}
                value={name}
                onChange={event => onName(event.target.value)}
                placeholder="someone"
                maxLength={MAX_NAME}
                spellCheck={false}
                autoComplete="off"
                // `size={1}` is load-bearing: both elements share one grid cell,
                // and an input's default intrinsic width is about twenty
                // characters, which would set the column instead of the name.
                size={1}
                className={cn(
                  "text-ink placeholder:text-muted/50 col-start-1 row-start-1 w-full",
                  "min-w-0 bg-transparent px-0.5 text-xl outline-none",
                )}
              />
            </span>
          </div>

          <p className="text-muted mt-1.5 font-mono text-sm">
            {first ? SAID.first : `${cell.x}, ${cell.y}`}
          </p>
        </div>

        <div>
          <p className="text-ink/80 mb-3 text-base">
            {SAID.feeling}
            {/* The chosen pose named once, beside the question, rather than
                fourteen times under the faces. */}
            <span className="text-muted pl-2 font-mono text-sm">{face}</span>
          </p>
          {/*
            All fourteen in a strip, as blobatars of the name being typed rather
            than as a list of words. This is the only place on the page that
            shows the library's actual argument — one string, fourteen faces,
            all of them changing together as you type — so it is the control
            itself rather than something hidden behind a trigger.

            Horizontally scrollable rather than wrapped: a strip that stays one
            row tall keeps the panel a fixed height, and a panel that grows as
            you scroll it would drag the arrow's origin with it.
          */}
          <div
            ref={stripRef}
            role="group"
            aria-label="All expressions"
            className={cn(
              "border-line/70 flex gap-1 overflow-x-auto rounded-2xl border p-1",
              // No scrollbar — it is chrome around fourteen faces — so the
              // affordance has to be the fade: the strip dissolves at the edge
              // it continues past, which is also why the mask is only on the
              // right until it is scrolled.
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              "[mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)]",
            )}
          >
            {FACE_NAMES.map(each => (
              <PoseTile
                key={each}
                ref={each === face ? selectedRef : undefined}
                name={each}
                expression={FACES[each]!}
                seed={seed}
                selected={each === face}
                labelled={false}
                onClick={() => onFace(each)}
              />
            ))}
          </div>
        </div>

        {live && <Turnstile onToken={onTurnstile} />}

        {refused && !refused.ok && (
          /*
            Refusals as a sentence in the register of the question above them. A
            wall that answers "409" has stopped talking to the person standing in
            front of it.
          */
          <p className="text-muted text-base">
            {refused.why === "cooldown"
              ? "you have already left one today — the wall moves at one blob per person per day"
              : refused.why === "taken"
                ? "somebody took that cell while you were deciding"
                : refused.why === "unplaceable"
                  ? "that is too far from anybody — here is the nearest spot"
                  : refused.why === "name"
                    ? "that name will not go on the wall"
                    : refused.why === "challenge"
                      ? "the challenge did not pass — try once more"
                      : "the wall is not taking placements right now"}
          </p>
        )}

        {/*
          The submit, and the wait.

          A round trip that can take a Turnstile verification with it is long
          enough that "leaving it" as static text reads as a button that did
          nothing — which is exactly how somebody ends up clicking twice. So the
          waiting state is the blobatar being placed, small, wearing `thinking`
          and animating on its own: the thing you are sending, visibly thinking
          about it. It is also the only spinner on the site that is made of the
          library.

          Both states are stacked in one grid cell rather than swapped, so the
          button does not change width mid-request and walk out from under the
          pointer. `disabled` while sending, but the dimming is reserved for the
          nothing-typed case — a 40%-opacity blobatar mid-think reads as broken.
        */}
        <button
          type="button"
          onClick={onPlace}
          disabled={!name.trim() || sending}
          className={cn(
            "bg-ink text-ground self-start rounded-full px-5 py-2.5 text-base tracking-wide lowercase",
            "grid transition-opacity duration-150",
            !name.trim() && "opacity-40",
          )}
        >
          <span
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-150",
              sending ? "opacity-0" : "opacity-100",
            )}
          >
            {SAID.leave}
          </span>
          <span
            aria-hidden={!sending}
            className={cn(
              "col-start-1 row-start-1 flex items-center justify-center gap-2",
              "transition-opacity duration-150",
              sending ? "opacity-100" : "opacity-0",
            )}
          >
            <Blobatar
              name={seed}
              expression={FACES.thinking}
              animate="always"
              style={{ width: 22, height: 22 }}
              className="shrink-0"
            />
            {SAID.leaving}
          </span>
        </button>
      </div>
    </>
  );
}
