import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blobatar } from "@blobatar/react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../src/components/ui/popover";
import { WallPanel, anchor } from "../src/components/WallPanel";
import {
  WallCanvas,
  type At,
  type Inspected,
  type WallApi,
} from "../src/components/WallCanvas";
import { FACE_NAMES, faceOf } from "../src/wall/expressions";
import { FIRST, type Cell } from "../src/wall/geometry";
import { createSource, findMine, submit, type Placed } from "../src/wall/source";
import { EMPTY_SEED } from "../src/wall/copy";
import { fixtureSource } from "../src/wall/fixture";
import { mount } from "../mount";

/**
 * The wall, on its own.
 *
 * A development surface rather than a page anyone is meant to land on: the
 * section's real home is the landing page, but a full-height canvas is easier
 * to judge alone than wedged between a hero and a chat.
 *
 * Two sources, chosen by `?live`. The default is the fixture — a wall that
 * never existed, in memory, where a placement costs nothing and nobody has to
 * be running a database. `?live` is the same page against the Worker: real
 * chunks, a real challenge, a real cooldown. The component under both is
 * identical, which is the point of the source being a parameter.
 */

/**
 * Everything a popover needs, including where to put it.
 *
 * One piece of state for both popovers rather than two, because they are
 * mutually exclusive by construction — a cell is either somebody's or it is
 * empty — and two booleans that must never both be true is a bug waiting for a
 * slow afternoon.
 */
type Focus =
  | { kind: "place"; cell: Cell; at: At }
  | { kind: "who"; placement: Inspected; at: At };

/** Where this browser remembers its own blobatar, so that "Find mine" needs no
 * request on the device that placed it. The cookie behind `/wall/mine` is the
 * slow path, for a second device or a cleared browser. */
const REMEMBERED = "wall:mine";

function WallPreview() {
  const live = typeof location !== "undefined" && new URLSearchParams(location.search).has("live");
  // Once. A source holds every chunk this browser has fetched, and rebuilding
  // it on a render would throw the wall away and fetch it again.
  const source = useMemo(() => (live ? createSource() : fixtureSource()), [live]);

  const [face, setFace] = useState(FACE_NAMES[0]!);
  const [name, setName] = useState("");
  const [mine, setMine] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [refused, setRefused] = useState<Placed | null>(null);
  const [sending, setSending] = useState(false);
  const token = useRef<string | null>(null);
  const api = useRef<WallApi | null>(null);
  /*
   * The panel's arrow, reached from inside the canvas's draw loop.
   *
   * A ref rather than a prop chain because of what it is for: the arrow's far
   * end is a cell, and a cell moves on every frame of a flight. Handing the
   * canvas a function to call is one `setAttribute` per frame; handing React a
   * state setter would be sixty renders of a panel with a text field in it.
   */
  const track = useRef<((at: At | null) => void) | null>(null);
  const onTrack = useCallback((at: At | null) => track.current?.(at), []);

  /*
   * Where this browser's own blobatar is: local first, cookie second.
   *
   * The cookie round trip happens once, on a page that has nothing remembered
   * — which is the second device, and the case the token exists for.
   */
  useEffect(() => {
    const remembered = localStorage.getItem(REMEMBERED);
    if (remembered) {
      setMine(JSON.parse(remembered) as Cell);
      return;
    }
    if (live) void findMine().then(cells => cells[0] && setMine(cells[0]));
  }, [live]);

  /*
   * What is being placed, as the canvas and the panel both read it.
   *
   * Two fields for the name rather than one: `seed` always has a value, because
   * an empty cell still has to draw *something* and that something is a chosen
   * blobatar rather than whatever an arbitrary word hashes to; `label` is empty
   * until somebody types, so the fallback seed is never printed as a name.
   *
   * Memoised: it is read by the draw loop, and a fresh object every render is
   * what used to make the canvas repaint from blank.
   */
  const draft = useMemo(
    () => ({ seed: name.trim() || EMPTY_SEED, expression: face, label: name.trim() }),
    [name, face],
  );

  const onReady = useCallback((ready: WallApi) => {
    api.current = ready;
  }, []);

  /*
   * Picking a cell also *frames* it.
   *
   * The panel is docked to one side, so a cell left where it was clicked is
   * underneath the panel as often as not — and the arrow drawn between them
   * would be a stub across a corner. Flying it to a known point makes the whole
   * composition the same every time: panel here, blobatar there, arrow between.
   */
  const onPick = useCallback((cell: Cell, at: At) => {
    setFocus({ kind: "place", cell, at });
    api.current?.flyTo(cell, anchor({ width: window.innerWidth, height: window.innerHeight }));
  }, []);
  const onInspect = useCallback(
    (placement: Inspected, at: At) => setFocus({ kind: "who", placement, at }),
    [],
  );
  const dismiss = useCallback(() => {
    setFocus(null);
    setRefused(null);
  }, []);

  /**
   * Leave it here.
   *
   * The optimistic draw happens *after* the server answers rather than before
   * it, which is the one place this deviates from what the wall's own comments
   * describe as optimistic. The reason is that the answer can move the cell:
   * a placement refused for being taken, or walked back to placeable ground,
   * would otherwise have to be drawn and then undrawn, and a blobatar that
   * appears and vanishes is worse than one that takes a moment. Against the
   * fixture there is no server and it is immediate.
   */
  const place = async () => {
    if (focus?.kind !== "place" || sending) return;
    setRefused(null);

    if (!live) {
      api.current?.place(focus.cell, draft.seed, draft.expression);
      remember(focus.cell);
      dismiss();
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
      // Somewhere to go, when the server had somewhere to suggest.
      if (result.why === "unplaceable" && result.nearest) api.current?.flyTo(result.nearest);
      return;
    }

    api.current?.place(result.cell, result.seed, draft.expression);
    remember(result.cell);
    dismiss();
  };

  const remember = (cell: Cell) => {
    setMine(cell);
    localStorage.setItem(REMEMBERED, JSON.stringify(cell));
  };

  return (
    <main className="bg-ground relative h-dvh w-dvw overflow-hidden">
      <WallCanvas
        source={source}
        draft={draft}
        mine={mine}
        pinned={focus?.kind === "place" ? focus.cell : null}
        dim={focus?.kind === "place"}
        // The preview is the whole page, so there is no scroll to protect and
        // the wheel has no other job. In the landing page's section it does.
        wheelZooms
        onPick={onPick}
        onInspect={onInspect}
        onCameraMove={dismiss}
        onTrack={onTrack}
        onReady={onReady}
      />

      {/*
        Somebody else's cell: a small card where the blob is, not a panel.

        The two targets get two different weights on purpose. Placing is the
        thing this section exists for and takes over the screen; asking who
        somebody is answers a passing curiosity and should cost nothing —
        dimming the whole wall to show one name and a date would be the
        interface making more of the question than the person asking it did.
      */}
      <Popover open={focus?.kind === "who"} onOpenChange={open => !open && dismiss()}>
        {/*
          A zero-size element pinned to the cell in viewport coordinates. Radix
          needs a real node to measure and flip against; the canvas has no nodes
          in it at all, so this is the one the wall lends it.
        */}
        <PopoverAnchor asChild>
          <div
            className="pointer-events-none fixed h-0 w-0"
            style={{ left: focus?.at.x ?? 0, top: focus?.at.y ?? 0 }}
          />
        </PopoverAnchor>

        <PopoverContent side="top" sideOffset={40} className="w-auto">
          {focus?.kind === "who" && (
            <div className="flex items-center gap-3">
              <Blobatar
                name={focus.placement.seed}
                expression={faceOf(focus.placement.expression)}
                style={{ width: 44, height: 44 }}
                className="shrink-0"
              />
              <div className="min-w-0">
                <div className="truncate font-mono text-sm">{focus.placement.seed}</div>
                <div className="text-ink/50 font-mono text-xs">
                  {new Date(focus.placement.at * 1000).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                  <span className="px-1.5 opacity-40">·</span>
                  {focus.placement.x}, {focus.placement.y}
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
          first={source.wall().size === 0}
          live={live}
          sending={sending}
          refused={refused}
          onTurnstile={value => (token.current = value)}
          onPlace={place}
          onDismiss={dismiss}
          track={track}
        />
      )}

      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-2 font-mono text-xs text-white/80 backdrop-blur">
        {mine ? (
          <button
            type="button"
            className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20"
            onClick={() => api.current?.flyTo(mine)}
          >
            find mine
          </button>
        ) : (
          <span className="px-2 text-white/50">click an empty cell</span>
        )}
        <button
          type="button"
          className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20"
          onClick={() => api.current?.flyTo(FIRST)}
        >
          origin
        </button>
      </div>
    </main>
  );
}

mount(<WallPreview />);
