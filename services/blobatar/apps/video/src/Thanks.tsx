/**
 * The thank-you film: 590 stars, 590 faces, one heart, one continuous shot.
 *
 * Nothing here is illustration. Every creature on screen is `blobatar(login)`
 * for a real stargazer, in something very close to the order they arrived, so
 * the gratitude and the demonstration are the same frames.
 *
 * Three things the film does that the launch film does not:
 *
 * 1. **The crowd is a shape.** 590 is the count, so the heart is solved to it
 *    rather than drawn and filled — see `CELLS` in `stars.ts`.
 *
 * 2. **The camera moves once.** Out, over three seconds, and then it is still
 *    for the remaining thirty. Everything after that is the crowd densifying,
 *    which is what lets the silhouette resolve rather than grow.
 *
 * 3. **It ends on the real people.** Every blobatar cross-fades to its owner's
 *    GitHub avatar, and stays there. It is the one moment the film stops
 *    demonstrating the library and simply shows who turned up — which is also
 *    the only proof available that the crowd is not synthetic.
 */

import type { FC } from "react";
import { Blobatar } from "@blobatar/react";
import { Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import AVATARS from "./avatars.json";
import { MONO, SANS } from "./fonts";
import {
  arrivalAt,
  arrivedAt,
  B_BUILD,
  B_CARD,
  B_SWAP,
  BLOB,
  camera,
  CELL,
  COUNT,
  FPS,
  HEIGHT,
  PLACED,
  SLOTS,
  SWAP_LEN,
  WIDTH,
} from "./stars";
import "blobatar/motion.css";
import "./seek.css";

const BG = "#0b0b0c";
const TEXT = "#f2f2f3";
const MUTED = "#8a8a8f";
const DIM = "#6a6a6f";

const ease = Easing.inOut(Easing.cubic);

const ramp = (
  frame: number,
  from: number,
  to: number,
  a: number,
  b: number,
  easing = ease,
) =>
  interpolate(frame, [from, to], [a, b], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/**
 * When a given cell turns into its owner's photograph.
 *
 * A wave outward from the centre rather than all at once: 590 simultaneous
 * cross-fades read as a dissolve between two images, which throws away the fact
 * that these are 590 separate people. Staggered, it reads as the crowd turning
 * to face the camera one by one. The delay is keyed to distance from the
 * heart's centre so the wave travels along the shape.
 */
const swapAt = (col: number, row: number, cx: number, cy: number): number => {
  const dist = Math.hypot((col - cx) / 18, (row - cy) / 12.5);
  return B_SWAP + Math.min(1, dist) * (SWAP_LEN - 40);
};

const CENTER_COL = SLOTS[0]!.col;
const CENTER_ROW = SLOTS[0]!.row;

/**
 * The avatar sheet, as one background shared by every cell.
 *
 * Must agree with `scripts/build-avatars.ts`, which packs it and writes the
 * index it is read against.
 */
const ATLAS = staticFile("avatar-atlas.png");
const ATLAS_COLS = 25;
const ATLAS_ROWS = 24;

/** One stargazer: their blobatar, then their photograph. */
const Star: FC<{ index: number; frame: number }> = ({ index, frame }) => {
  const { col, row } = SLOTS[index]!;
  const login = PLACED[index]!;
  const at = arrivalAt(index);
  const t = ramp(frame, at, at + 13, 0, 1, Easing.out(Easing.cubic));

  const swap = swapAt(col, row, CENTER_COL, CENTER_ROW);
  const real = frame < B_SWAP ? 0 : ramp(frame, swap, swap + 26, 0, 1);
  const face = AVATARS[login as keyof typeof AVATARS];

  return (
    <div
      style={{
        position: "absolute",
        left: col * CELL,
        top: row * CELL,
        width: CELL,
        height: CELL,
        display: "grid",
        placeItems: "center",
        opacity: t,
        transform: `scale(${0.86 + 0.14 * t})`,
      }}
    >
      <div style={{ position: "relative", width: BLOB, height: BLOB }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            opacity: 1 - real,
          }}
        >
          <Blobatar name={login} animate="always" size={BLOB} />
        </div>
        {/*
          One window onto the shared sheet, positioned by the cell's index in
          it — not an <img> of its own. 590 image elements is what the first cut
          did and it could not be rendered at all; see `build-avatars.ts`.

          Mounted only once the wave is on its way, since for two thirds of the
          film nothing here is visible.
        */}
        {real > 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              opacity: real,
              backgroundImage: `url(${ATLAS})`,
              backgroundSize: `${ATLAS_COLS * 100}% ${ATLAS_ROWS * 100}%`,
              backgroundPosition: `${(face % ATLAS_COLS) * (100 / (ATLAS_COLS - 1))}%` +
                ` ${Math.floor(face / ATLAS_COLS) * (100 / (ATLAS_ROWS - 1))}%`,
            }}
          />
        )}
      </div>
    </div>
  );
};

/**
 * The name is held for `HOLD` frames and points `LAG` behind the newest
 * arrival.
 *
 * Straight off the arrival index it changes up to thirty times a second by the
 * end of the build, which is not a roll call — it is a strobe. Six frames is
 * five names a second: fast enough to feel like a flood, slow enough that the
 * eye can catch one. The lag is because a blobatar takes 13 frames to fade in,
 * so the newest arrival is always somebody not yet visible.
 */
const HOLD = 6;
const LAG = 14;

const namedAt = (frame: number): string => {
  const quantised = Math.floor(frame / HOLD) * HOLD;
  return PLACED[Math.max(0, Math.floor(arrivedAt(quantised - LAG)) - 1)]!;
};

/**
 * The first star, named under them while they are still the only one here.
 *
 * Centred, because for these four seconds there is no crowd for a caption to
 * sit on top of — it is a title card, not a label.
 */
const Opening: FC<{ frame: number }> = ({ frame }) => {
  const login = PLACED[0]!;
  const typed = Math.floor(ramp(frame, 10, 40, 0, login.length, Easing.linear));

  return (
    <div
      style={{
        position: "absolute",
        top: 790,
        left: 0,
        width: WIDTH,
        textAlign: "center",
        opacity: ramp(frame, 10, 22, 0, 1) * ramp(frame, B_BUILD, B_BUILD + 20, 1, 0),
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 32, letterSpacing: "0.04em", color: TEXT }}>
        @{login.slice(0, typed)}
      </div>
      <div
        style={{
          marginTop: 12,
          fontFamily: SANS,
          fontSize: 19,
          letterSpacing: "0.02em",
          color: DIM,
        }}
      >
        the first star — 16 August 2026
      </div>
    </div>
  );
};

/**
 * The roll call, parked in the frame's bottom-left corner.
 *
 * It sat under each arriving blobatar for one cut and that was a mistake. A
 * label pinned to a 38px cell necessarily covers the row beneath it, so the
 * thing naming the crowd was permanently obscuring part of it — and a name
 * jumping around the frame five times a second pulls the eye away from the
 * shape resolving, which is the shot.
 *
 * The corner is the only quiet place left. The heart is centred and comes to a
 * point at the bottom, so bottom-centre is exactly where it reaches and the two
 * lower corners are exactly where it never does.
 */
const Readout: FC<{ frame: number; k: number }> = ({ frame, k }) => (
  <div
    style={{
      position: "absolute",
      left: 96,
      top: HEIGHT - 132,
      fontFamily: MONO,
      opacity: ramp(frame, B_BUILD, B_BUILD + 20, 0, 1) * ramp(frame, B_SWAP, B_SWAP + 30, 1, 0),
    }}
  >
    <div style={{ fontSize: 24, letterSpacing: "0.04em", color: TEXT }}>@{namedAt(frame)}</div>
    <div style={{ marginTop: 10, fontSize: 22, letterSpacing: "0.06em", color: DIM }}>
      {Math.floor(k)} / {COUNT}
    </div>
  </div>
);

const Card: FC<{ frame: number }> = ({ frame }) => {
  const opacity = ramp(frame, B_CARD + 14, B_CARD + 48, 0, 1);
  const lift = ramp(frame, B_CARD + 14, B_CARD + 48, 14, 0);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      {/*
        A scrim, because the crowd is still lit underneath and 590 faces behind
        a 20px line of body copy is not a background, it is noise. Radial rather
        than a flat panel: the point of holding the crowd is that it runs to the
        edges of frame, and a rectangle would put a hard border around the one
        beat that is supposed to feel like standing inside it.
      */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(52% 40% at 50% 48%, rgba(11,11,12,0.95) 0%," +
            " rgba(11,11,12,0.88) 42%, rgba(11,11,12,0) 100%)",
        }}
      />
      <div
        style={{
          position: "relative",
          transform: `translateY(${lift}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
        }}
      >
        <div
          style={{
            fontFamily: SANS,
            fontSize: 96,
            fontWeight: 500,
            letterSpacing: "-0.055em",
            lineHeight: 0.9,
            color: TEXT,
          }}
        >
          thank you
        </div>
        <div style={{ fontFamily: MONO, fontSize: 27, color: MUTED }}>
          {COUNT} stars · 16–20 August 2026
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 20,
            letterSpacing: "0.01em",
            color: MUTED,
          }}
        >
          every one of you is in here — yours is at blobatar.dev/avatar/your-handle
        </div>
      </div>
    </div>
  );
};

export const Thanks: FC = () => {
  const frame = useCurrentFrame();
  const k = arrivedAt(frame);
  const cam = camera(frame);

  // The card is read over the crowd rather than instead of it. By this point
  // the crowd is 590 photographs of the people being thanked, and cutting to a
  // black slate to say so would throw away the only frame that shows them.
  const dim = ramp(frame, B_CARD, B_CARD + 40, 1, 0.42);

  // Mounting a stargazer costs a style recalculation on every subsequent frame,
  // so nobody is in the tree before they arrive. It is the difference between
  // the build's opening seconds rendering 5 animated blobatars and 590.
  const mounted = Math.ceil(k);

  return (
    <div
      style={{
        ["--vid-t" as string]: `${(frame / FPS) * 1000}ms`,
        width: WIDTH,
        height: HEIGHT,
        background: BG,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: dim,
          transformOrigin: "0 0",
          transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`,
        }}
      >
        {Array.from({ length: mounted }, (_, i) => (
          <Star key={i} index={i} frame={frame} />
        ))}
      </div>

      {frame < B_BUILD + 20 && <Opening frame={frame} />}
      {frame < B_SWAP + 30 && <Readout frame={frame} k={k} />}
      {frame >= B_CARD && <Card frame={frame} />}
    </div>
  );
};
