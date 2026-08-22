import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blobatar } from "@blobatar/react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { WallCanvas, type At, type Inspected, type WallApi } from "@/components/WallCanvas";
import { WallPanel, anchor } from "@/components/WallPanel";
import { cn } from "@/lib/utils";
import { FACE_NAMES, faceOf } from "@/wall/expressions";
import { EMPTY_SEED } from "@/wall/copy";
import { FIRST, type Cell } from "@/wall/geometry";
import { createSource, findMine, submit, type Placed } from "@/wall/source";
import { fixtureSource } from "@/wall/fixture";

/**
 * The landing page's second section: the wall.
 *
 * It replaced a field of sixty blobatars scattered from `Math.random()` under
 * the words "Millions of options" — decoration standing in for an argument. The
 * section claimed the library produces endless distinct avatars and backed the
 * claim with data it made up. Now a visitor types a name and watches the
 * blobatar for it appear, permanently, on a wall other people are on. The
 * generated field asserts; the wall shows. See ADR 0011.
 *
 * The field it replaced is gone entirely, backdrop and all. ADR 0011 kept it
 * for cold start, on the argument that an empty wall on launch day is worse
 * than sixty blobs; what it actually produced was a section whose decoration
 * was labelled and whose real placements were not, so the invented blobatars
 * read as the wall and the wall read as noise over them. An empty lattice says
 * "be the first" without saying anything untrue.
 */

/** Where this browser remembers its own blobatar, so "Find mine" needs no
 * request on the device that placed it. The cookie behind `/wall/mine` is the
 * slow path, for a second device or a cleared browser. */
const REMEMBERED = "wall:mine";

/**
 * Everything a popover needs, including where to put it.
 *
 * One piece of state for both, because they are mutually exclusive by
 * construction — a cell is either somebody's or it is empty — and two booleans
 * that must never both be true is a bug waiting for a slow afternoon.
 */
type Focus =
  | { kind: "place"; cell: Cell; at: At }
  | { kind: "who"; placement: Inspected; at: At };

export function WallSection() {
  /*
   * Live by default, the fixture on request.
   *
   * `?wall=fixture` renders the section against the wall that never existed —
   * five thousand blobatars — which is the only way to see this section busy
   * before anybody has filled it, and the surface the renderer is profiled
   * against. The real page asks the Worker and gets, on day one, nothing.
   */
  const fixture =
    typeof location !== "undefined" && new URLSearchParams(location.search).get("wall") === "fixture";
  // Once. A source holds every chunk this browser has fetched, and rebuilding
  // it on a render would throw the wall away and fetch it again.
  const source = useMemo(() => (fixture ? fixtureSource() : createSource()), [fixture]);

  const [face, setFace] = useState(FACE_NAMES[0]!);
  const [name, setName] = useState("");
  const [mine, setMine] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [refused, setRefused] = useState<Placed | null>(null);
  const [sending, setSending] = useState(false);
  const [size, setSize] = useState(0);

  const token = useRef<string | null>(null);
  const api = useRef<WallApi | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  /*
   * The panel's arrow, reached from inside the canvas's draw loop — one
   * `setAttribute` per frame rather than sixty renders of a panel with a text
   * field in it.
   */
  const track = useRef<((at: At | null) => void) | null>(null);
  const onTrack = useCallback((at: At | null) => track.current?.(at), []);

  const draft = useMemo(
    () => ({ seed: name.trim() || EMPTY_SEED, expression: face, label: name.trim() }),
    [name, face],
  );

  /**
   * The last cell somebody asked about, kept past the moment they stop asking.
   *
   * The popover closes over 110ms, and for all of it Radix still has a card on
   * screen. Reading its position and contents straight out of `focus` meant
   * both vanished on the *first* frame of that animation: the anchor fell back
   * to 0,0 and the card emptied, so what played out was a blank box flying to
   * the top-left corner of the window. Remembering the last one lets the exit
   * animation finish where it started, on the blob it belongs to.
   */
  const asked = useRef<{ at: At; placement: Inspected } | null>(null);
  if (focus?.kind === "who") asked.current = { at: focus.at, placement: focus.placement };
  const card = asked.current;

  const onReady = useCallback((ready: WallApi) => {
    api.current = ready;
    /*
     * Start further out on a narrow screen.
     *
     * Reading zoom is a fixed number of pixels per cell, so a phone sees five
     * cells across and a wall five cells wide is not legible as a wall — it is
     * a handful of large blobs. Pulling back is what makes the section say
     * "this is a surface with people on it" before anybody has touched it.
     */
    if (window.innerWidth < 768) ready.zoomBy(0.6);
  }, []);

  const dismiss = useCallback(() => {
    setFocus(null);
    setRefused(null);
  }, []);

  /*
   * Where this browser's own blobatar is: local first, cookie second. The
   * round trip happens only on a device that has nothing remembered, which is
   * the case the token exists for.
   */
  useEffect(() => {
    const remembered = localStorage.getItem(REMEMBERED);
    if (remembered) {
      setMine(JSON.parse(remembered) as Cell);
      return;
    }
    if (!fixture) void findMine().then(cells => cells[0] && setMine(cells[0]));
  }, [fixture]);

  /**
   * Scrolling away closes the panel.
   *
   * The panel and its arrow are positioned in viewport coordinates, because
   * that is the only frame both ends of the arrow share. That is fine while the
   * section is what you are looking at and nonsense the moment it is not — a
   * panel about a cell that has scrolled off the top of the window. The section
   * never captures the wheel (see `wheelZooms`), so leaving mid-placement is a
   * thing people will do, and the honest answer is to let go rather than to
   * follow them down the page.
   */
  useEffect(() => {
    const node = frameRef.current;
    if (!node || !focus) return;
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.intersectionRatio < 0.55) dismiss();
      },
      { threshold: [0, 0.55, 1] },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [focus, dismiss]);

  /**
   * Picking a cell also frames it.
   *
   * The panel is docked to one side, so a cell left where it was clicked is
   * underneath the panel as often as not. Flying it to a known point makes the
   * composition the same every time: panel here, blobatar there, arrow between.
   * Measured off the canvas rather than the window, because in a section the
   * two are not the same rectangle.
   */
  const onPick = useCallback((cell: Cell, at: At) => {
    setFocus({ kind: "place", cell, at });
    const box = frameRef.current?.getBoundingClientRect();
    if (box) api.current?.flyTo(cell, anchor({ width: box.width, height: box.height }));
  }, []);

  const onInspect = useCallback(
    (placement: Inspected, at: At) => setFocus({ kind: "who", placement, at }),
    [],
  );

  const remember = (cell: Cell) => {
    setMine(cell);
    localStorage.setItem(REMEMBERED, JSON.stringify(cell));
  };

  /**
   * It landed.
   *
   * Draw it, remember it, close the panel, and centre on it. The centring is
   * the part that is easy to leave out and the part that makes the placement
   * legible: picking a cell framed it off to one side, against the panel (see
   * `anchor`), so a panel that simply closes leaves the new blobatar sitting in
   * the margin where the arrow used to point. Flying it to the middle of the
   * now-empty section is what turns "the form submitted" into "there it is",
   * and the ring around `mine` is what says which one it is.
   */
  const landed = (cell: Cell, seed: string) => {
    api.current?.place(cell, seed, draft.expression);
    remember(cell);
    dismiss();
    api.current?.flyTo(cell);
  };

  /**
   * Leave it here.
   *
   * The optimistic draw happens after the server answers rather than before,
   * which is the one place this deviates from the optimistic-placement story:
   * the answer can move the cell — refused for being taken, or walked back to
   * placeable ground — and a blobatar that appears and then vanishes is worse
   * than one that takes a moment. Against the fixture there is no server and it
   * is immediate.
   */
  const place = async () => {
    if (focus?.kind !== "place" || sending) return;
    setRefused(null);

    if (fixture) {
      landed(focus.cell, draft.seed);
      return;
    }

    setSending(true);
    const result = await submit({
      cell: focus.cell,
      seed: draft.seed,
      expression: draft.expression,
      // An unsolved challenge is still sent: the Worker is what refuses it, and
      // a client that refuses on its own behalf is a second implementation of
      // the same rule that can disagree with the first.
      turnstile: token.current ?? "",
    });
    setSending(false);

    if (!result.ok) {
      setRefused(result);
      if (result.why === "unplaceable" && result.nearest) api.current?.flyTo(result.nearest);
      return;
    }

    landed(result.cell, result.seed);
  };

  return (
    <section
      aria-labelledby="wall-heading"
      className="bg-ground relative h-dvh w-full overflow-clip"
    >
      <div ref={frameRef} className="absolute inset-0">
        <WallCanvas
          source={source}
          draft={draft}
          mine={mine}
          pinned={focus?.kind === "place" ? focus.cell : null}
          dim={focus?.kind === "place"}
          onPick={onPick}
          onInspect={onInspect}
          onCameraMove={dismiss}
          onTrack={onTrack}
          onLoaded={setSize}
          onReady={onReady}
        />
      </div>

      {/*
        The heading, out of the middle: the middle of this section is where
        somebody has to be able to click. What it says is an instruction rather
        than a claim — "Millions of options" was the assertion the field was
        standing in for, and the wall makes its point by being one.
      */}
      {/*
        A clearing behind the heading, as its own layer.

        Over a lattice of blobatars a padded box reads as a rectangle laid on
        top of them, where a fade to nothing makes the wall look like it thins
        around the words. Anchored to the corner the heading is in rather than to the
        middle, because that is where the heading went.

        The far stop is the ground colour at zero alpha, not the `transparent`
        keyword — `transparent` is transparent *black*, and the ground is
        #0a0a0b, so interpolating to it dips through colours darker than the
        page and paints a dark smear across the very wall it should vanish into.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 h-[26rem] w-[38rem] max-w-full"
        style={{
          backgroundImage:
            "radial-gradient(120% 100% at 0% 0%, var(--color-ground) 0%, var(--color-ground) 34%, rgb(from var(--color-ground) r g b / 0) 78%)",
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 p-6 sm:p-10">
        <h2
          id="wall-heading"
          className="max-w-[18ch] text-[clamp(2rem,5vw,3.5rem)] leading-[0.95] font-medium tracking-[-0.05em]"
        >
          Leave your blobatar
          <br />
          on the wall
        </h2>
        <p className="text-muted mt-3 max-w-[34ch] text-sm">
          {/*
            Every blobatar on this wall is somebody's name — true now that the
            generated field is gone, and the sentence the section is for.
          */}
          Every blobatar here is somebody&apos;s name, and nobody chose their colour. Click an
          empty cell to leave yours.
        </p>
      </div>

      {/*
        Zoom, as buttons.

        With the wheel left to the page (see `wheelZooms`), a pinch is the only
        gesture that zooms — and a mouse cannot pinch. These are what stop the
        section from being reachable only by trackpad.
      */}
      <div className="absolute right-4 bottom-4 flex flex-col gap-1 sm:right-6 sm:bottom-6">
        {[
          { label: "Zoom in", glyph: "+", factor: 1.4 },
          { label: "Zoom out", glyph: "−", factor: 1 / 1.4 },
        ].map(control => (
          <button
            key={control.label}
            type="button"
            aria-label={control.label}
            onClick={() => api.current?.zoomBy(control.factor)}
            className={cn(
              "border-line/70 bg-ground/70 text-ink/70 size-9 rounded-full border backdrop-blur",
              "hover:text-ink hover:border-muted text-lg leading-none transition-colors duration-150",
            )}
          >
            {control.glyph}
          </button>
        ))}
      </div>

      {/*
        Find mine, once there is a mine to find. Not a button that introduces
        the wall — the wall introduces itself — but the one thing you cannot do
        by looking: get back to your own cell from wherever you have panned to.
      */}
      {mine && (
        <button
          type="button"
          onClick={() => api.current?.flyTo(mine)}
          className={cn(
            "border-line/70 bg-ground/70 text-ink/80 absolute bottom-4 left-4 rounded-full border",
            "px-4 py-2 text-sm lowercase backdrop-blur transition-colors duration-150",
            "hover:text-ink hover:border-muted sm:bottom-6 sm:left-6",
          )}
        >
          find mine
        </button>
      )}

      {/*
        Somebody else's cell: a small card where the blob is, not a panel. The
        two targets get two different weights on purpose — placing is what this
        section is for and takes the screen; asking who somebody is answers a
        passing curiosity and should cost nothing.
      */}
      <Popover open={focus?.kind === "who"} onOpenChange={open => !open && dismiss()}>
        <PopoverAnchor asChild>
          <div
            className="pointer-events-none fixed h-0 w-0"
            style={{ left: card?.at.x ?? 0, top: card?.at.y ?? 0 }}
          />
        </PopoverAnchor>

        <PopoverContent side="top" sideOffset={40} className="w-auto">
          {card && (
            <div className="flex items-center gap-3">
              <Blobatar
                name={card.placement.seed}
                expression={faceOf(card.placement.expression)}
                style={{ width: 44, height: 44 }}
                className="shrink-0"
              />
              <div className="min-w-0">
                <div className="truncate font-mono text-sm">{card.placement.seed}</div>
                <div className="text-ink/50 font-mono text-xs">
                  {new Date(card.placement.at * 1000).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                  <span className="px-1.5 opacity-40">·</span>
                  {card.placement.x}, {card.placement.y}
                </div>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {focus?.kind === "place" && (
        <WallPanel
          cell={focus.cell}
          name={name}
          onName={setName}
          face={face}
          onFace={setFace}
          seed={draft.seed}
          first={size === 0}
          live={!fixture}
          sending={sending}
          refused={refused}
          onTurnstile={value => (token.current = value)}
          onPlace={place}
          onDismiss={dismiss}
          track={track}
        />
      )}
    </section>
  );
}
