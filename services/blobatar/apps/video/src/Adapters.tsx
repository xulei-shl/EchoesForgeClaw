import type { FC } from "react";
import { Blobatar as ReactBlobatar } from "@blobatar/react";
import { Blobatar as VueBlobatar } from "@blobatar/vue";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { MONO, SANS } from "./fonts";
import { VueMount } from "./VueMount";
import {
  AT, B_CARD, B_COMMIT, B_EDIT, B_IN, BYTES, FPS, FROM, HEIGHT, NAME, SIZE,
  TO, USE, WIDTH, line, specifierAt, vueAt,
} from "./swap";
import "blobatar/motion.css";
import "./seek.css";

const BG = "#0b0b0c";
const TEXT = "#f2f2f3";
const MUTED = "#8a8a8f";
const DIM = "#6a6a6f";

/** The one lit colour in the film, and it lights exactly five characters. */
const LIT = "#7ee787";

const ease = Easing.inOut(Easing.cubic);

const ramp = (frame: number, from: number, to: number, a: number, b: number, easing = ease) =>
  interpolate(frame, [from, to], [a, b], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const BLOB_Y = 250;
const CODE_Y = 700;

/**
 * Both adapters, stacked and pinned, with the edit deciding which is opaque.
 *
 * Rendered from frame zero rather than mounted on the commit, and that is not
 * an optimisation. A CSS animation seeks correctly whenever it mounts — pause
 * plus a negative delay resolves to a fixed point in local time — but a Vue app
 * mounting mid-film takes a `delayRender` handle with it, and a frame that
 * blocks on a mount is a frame that renders differently from its neighbours for
 * reasons having nothing to do with the film. Mount once, toggle opacity, and
 * the swap costs the renderer nothing.
 *
 * `opacity` and not `display`, for the same reason: a subtree that leaves the
 * layout and comes back has restarted nothing, but it has been re-measured, and
 * the one thing this shot cannot afford is the creature moving by a pixel.
 */
const Stage: FC<{ frame: number }> = ({ frame }) => {
  const vue = vueAt(frame);
  const props = { name: NAME, animate: "always" as const, size: SIZE };

  return (
    <div
      style={{
        position: "absolute",
        top: BLOB_Y,
        left: 0,
        width: WIDTH,
        height: SIZE,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ gridArea: "1 / 1", opacity: vue ? 0 : 1 }}>
        <ReactBlobatar {...props} />
      </div>
      <div style={{ gridArea: "1 / 1", opacity: vue ? 1 : 0 }}>
        <VueMount component={VueBlobatar} props={props} />
      </div>
    </div>
  );
};

/**
 * The import line, with the specifier's tail lit.
 *
 * Only the characters after `blobatar/` change colour. Lighting the whole line,
 * or the whole string, would make the edit look bigger than it is — and the
 * size of the edit is the argument.
 */
const Code: FC<{ frame: number }> = ({ frame }) => {
  const { text, committed } = specifierAt(frame);
  const head = line("");
  const opacity = ramp(frame, B_IN, B_IN + 18, 0, 1) * ramp(frame, B_CARD, B_CARD + 26, 1, 0);

  return (
    <div
      style={{
        position: "absolute",
        top: CODE_Y,
        left: 0,
        width: WIDTH,
        textAlign: "center",
        fontFamily: MONO,
        fontSize: 34,
        letterSpacing: "0.01em",
        lineHeight: 1.9,
        color: MUTED,
        opacity,
      }}
    >
      <div>
        {head.slice(0, AT)}
        <span style={{ color: committed || frame >= B_EDIT ? LIT : TEXT }}>{text}</span>
        {head.slice(AT)}
      </div>
      {/* Unchanged, and on screen the whole time so that it is seen not to
          change: the same line is valid JSX and a valid Vue template. */}
      <div style={{ color: DIM }}>{USE}</div>
    </div>
  );
};

/** The number that does not move. */
const Readout: FC<{ frame: number }> = ({ frame }) => (
  <div
    style={{
      position: "absolute",
      top: CODE_Y + 190,
      left: 0,
      width: WIDTH,
      textAlign: "center",
      fontFamily: MONO,
      fontSize: 24,
      color: DIM,
      opacity: ramp(frame, B_IN + 10, B_IN + 30, 0, 1) * ramp(frame, B_CARD, B_CARD + 26, 1, 0),
    }}
  >
    {BYTES} B of svg — either way
  </div>
);

const Card: FC<{ frame: number }> = ({ frame }) => {
  const opacity = ramp(frame, B_CARD + 14, B_CARD + 46, 0, 1);
  const lift = ramp(frame, B_CARD + 14, B_CARD + 46, 12, 0);

  return (
    <div
      style={{
        position: "absolute",
        top: CODE_Y - 20,
        left: 0,
        width: WIDTH,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        opacity,
        transform: `translateY(${lift}px)`,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 72,
          fontWeight: 500,
          letterSpacing: "-0.05em",
          lineHeight: 0.95,
          color: TEXT,
        }}
      >
        @blobatar/vue
      </div>
      <div style={{ fontFamily: MONO, fontSize: 25, color: MUTED }}>npm i blobatar</div>
    </div>
  );
};

export const Adapters: FC = () => {
  const frame = useCurrentFrame();

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
      <Stage frame={frame} />
      {frame < B_CARD + 26 && <Code frame={frame} />}
      {frame < B_CARD + 26 && <Readout frame={frame} />}
      {frame >= B_CARD && <Card frame={frame} />}
    </div>
  );
};

/** Kept honest: the edit has to be the specifier and nothing else. */
if (line(FROM).replace(FROM, TO) !== line(TO)) {
  throw new Error("the edit changes more than the specifier");
}
