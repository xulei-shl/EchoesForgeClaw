import type { FC } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { MONO, SANS } from "./fonts";
import {
  BEATS,
  BLOB_Y,
  B_CARD,
  CSS_SIZE,
  HEIGHT,
  LINE_X,
  LINE_Y,
  NOTES,
  NOTE_Y,
  WIDTH,
  frameAt,
  render,
  sizeOf,
} from "./url";

const BG = "#0b0b0c";
const TEXT = "#f2f2f3";
const MUTED = "#8a8a8f";
const DIM = "#6a6a6f";
const RULE = "#232326";

/**
 * 34px, well inside the frame.
 *
 * The longest URL in the script is 73 characters; at a 0.6em advance that is
 * 1489px against the 1700px the margins leave. The slack is deliberate — the
 * exact advance of Geist Mono is the font's business, and a line that overflows
 * would only show up in the render. `scripts/check-endpoint.ts` holds the bound.
 */
const FONT = 34;

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
 * The response.
 *
 * `dangerouslySetInnerHTML` with the endpoint's own bytes, rather than the React
 * component: the component is the library's animated rendering mode, and what
 * this URL returns is a static document with no stylesheet attached. Putting the
 * response string on screen is both the simpler code and the honest one.
 *
 * A URL with no `s` carries no `width`/`height`, so the film's stylesheet sizes
 * it — which is what the library means by "omit to let CSS size it", and is why
 * `CSS_SIZE` is stated here rather than smuggled in as a default.
 */
const Slot: FC<{ frame: number }> = ({ frame }) => {
  const { url } = frameAt(frame);
  const svg = url ? render(url) : null;

  // The commit this frame belongs to, so the arrival can be timed off it.
  const beat = BEATS.find((b) => frame < b.to) ?? BEATS[BEATS.length - 1]!;
  const landed = frame >= beat.commit ? beat.commit : (BEATS[BEATS.indexOf(beat) - 1]?.commit ?? 0);

  // A five-frame settle on each commit. Presentational, and the one thing on
  // screen that is: a request that returns in no time and paints with no
  // transition reads as a glitch rather than as an answer.
  const pop = ramp(frame, landed, landed + 5, 0.94, 1, Easing.out(Easing.cubic));
  const fade = ramp(frame, landed, landed + 5, 0, 1, Easing.out(Easing.cubic));

  if (!svg) {
    // Not this endpoint. An empty slot rather than a guess at what somebody
    // else's host returns.
    return (
      <div
        style={{
          position: "absolute",
          left: WIDTH / 2 - 100,
          top: BLOB_Y - 100,
          width: 200,
          height: 200,
          border: `1px dashed ${RULE}`,
          borderRadius: 12,
        }}
      />
    );
  }

  const size = sizeOf(url) ?? CSS_SIZE;

  return (
    <div
      style={{
        position: "absolute",
        left: WIDTH / 2 - size / 2,
        top: BLOB_Y - size / 2,
        width: size,
        height: size,
        opacity: fade,
        transform: `scale(${pop})`,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

/**
 * The line, and the whole film.
 *
 * Left-aligned on a fixed margin rather than centred: `blobatar.dev/avatar/` has
 * to sit on the same pixels from the first frame to the last, so that every edit
 * happens *in place* and the host swap at the end can be read character by
 * character. A centred line slides sideways every time it grows, which is fine
 * for a caption and wrong for an address.
 */
const Line: FC<{ frame: number }> = ({ frame }) => {
  const { text, lit } = frameAt(frame);

  // Solid while something is being typed, blinking at 2Hz while it is not —
  // resolved from the frame, like everything else here, so it is the same caret
  // on every render of the same frame.
  const idleCaret = BEATS.every((b) => frame < b.from || frame >= b.commit);
  const caretOn = !idleCaret || Math.floor(frame / 15) % 2 === 0;

  return (
    <div
      style={{
        position: "absolute",
        left: LINE_X,
        top: LINE_Y,
        width: WIDTH - LINE_X * 2,
        fontFamily: MONO,
        fontSize: FONT,
        letterSpacing: 0,
        whiteSpace: "pre",
        color: MUTED,
        opacity: ramp(frame, 6, 20, 0, 1),
      }}
    >
      <span>{text.slice(0, lit)}</span>
      <span style={{ color: TEXT }}>{text.slice(lit)}</span>
      <span
        style={{
          display: "inline-block",
          width: 3,
          height: FONT,
          marginLeft: 3,
          verticalAlign: "-0.16em",
          background: TEXT,
          opacity: caretOn ? 1 : 0,
        }}
      />
    </div>
  );
};

/** The hairline under it, so the line reads as a field rather than a heading. */
const Rule: FC<{ frame: number }> = ({ frame }) => (
  <div
    style={{
      position: "absolute",
      left: LINE_X,
      top: LINE_Y + FONT + 22,
      width: WIDTH - LINE_X * 2,
      height: 1,
      background: RULE,
      opacity: ramp(frame, 0, 20, 0, 1),
    }}
  />
);

/**
 * The note.
 *
 * Swapped at zero opacity rather than cross-faded, for the reason the
 * expressions film gives: two lines of different lengths sliding through each
 * other under a reader is worse than a beat of nothing.
 */
const Note: FC<{ frame: number }> = ({ frame }) => {
  const note = [...NOTES].reverse().find((n) => frame >= n.from) ?? NOTES[0]!;
  const opacity =
    ramp(frame, note.from, note.from + 8, 0, 1) *
    ramp(frame, note.to - 6, note.to, 1, 0) *
    ramp(frame, B_CARD - 10, B_CARD, 1, 0);

  return (
    <div
      style={{
        position: "absolute",
        left: LINE_X,
        top: NOTE_Y,
        width: WIDTH - LINE_X * 2,
        fontFamily: SANS,
        fontSize: 24,
        letterSpacing: "0.01em",
        color: DIM,
        opacity,
      }}
    >
      {frame >= note.from ? note.text : ""}
    </div>
  );
};

/** The line above the film. Present from the first frame; it is the headline. */
const Kicker: FC<{ frame: number }> = ({ frame }) => (
  <div
    style={{
      position: "absolute",
      top: 96,
      left: 0,
      width: WIDTH,
      textAlign: "center",
      fontFamily: MONO,
      fontSize: 21,
      letterSpacing: "0.22em",
      textTransform: "uppercase",
      color: DIM,
      opacity: ramp(frame, 0, 18, 0, 1),
    }}
  >
    blobatar · avatars over http
  </div>
);

/**
 * The card, in the space the note vacates.
 *
 * There is no wordmark on it, because the wordmark has been on screen for the
 * whole film with a path after it. The film ends on the URL it opened on, which
 * is the entire argument: nothing here needs an account, a key or a record —
 * the avatar is a pure function of that line.
 */
const Card: FC<{ frame: number }> = ({ frame }) => {
  const opacity = ramp(frame, B_CARD, B_CARD + 24, 0, 1);
  const lift = ramp(frame, B_CARD, B_CARD + 24, 12, 0);

  return (
    <div
      style={{
        position: "absolute",
        left: LINE_X,
        top: NOTE_Y - 8,
        width: WIDTH - LINE_X * 2,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        opacity,
        transform: `translateY(${lift}px)`,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 40,
          fontWeight: 500,
          letterSpacing: "-0.03em",
          color: TEXT,
        }}
      >
        no signup, no key, no storage
      </div>
      <div style={{ fontFamily: MONO, fontSize: 22, color: DIM }}>
        616 bytes of svg · cached a day, served stale for a month · npm i blobatar
      </div>
    </div>
  );
};

export const Endpoint: FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        background: BG,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Kicker frame={frame} />
      <Slot frame={frame} />
      <Rule frame={frame} />
      <Line frame={frame} />
      {frame < B_CARD + 12 && <Note frame={frame} />}
      {frame >= B_CARD && <Card frame={frame} />}
    </div>
  );
};
