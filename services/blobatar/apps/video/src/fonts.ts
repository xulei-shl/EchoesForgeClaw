/**
 * The site's typefaces, loaded before the first frame is captured.
 *
 * Imported from `apps/site/fonts` through the bundler rather than copied into
 * `public/`: the video, the landing page and the README screenshots are meant
 * to be one object, and two copies of a variable font are two things to forget
 * to update. Symlinking them into `public/` is the obvious alternative and does
 * not work — Remotion's static server declines to follow a symlink out of the
 * public directory, and the 404 only shows up as a render in the fallback face.
 *
 * `delayRender` is not optional here. Remotion captures a frame as soon as the
 * component has painted, and a webfont that arrives a millisecond later means a
 * render where an unknown number of leading frames are set in the fallback
 * face. It fails intermittently and only in the output, which is the worst
 * place for it to fail.
 */

import { continueRender, delayRender } from "remotion";
import geistSans from "../../site/fonts/geist-variable.woff2";
import geistMono from "../../site/fonts/geist-mono-variable.woff2";

export const SANS = "Geist";
export const MONO = "Geist Mono";

/**
 * Five minutes rather than the 28-second default, and not because the fonts are
 * slow — they are two local woff2 files.
 *
 * Remotion renders several frames concurrently, each in its own tab, and a
 * crowd frame paints every blobatar in the shot. A tab that opens on one of
 * those spends long enough with a busy main thread that a font load queued
 * behind it can miss the default deadline, which fails the whole render at
 * whatever frame happened to be unlucky. The wait is bounded by the work, so
 * the timeout only needs to be longer than the slowest frame.
 *
 * Two minutes covered the launch film's 120 creatures and did not survive the
 * thank-you film's 590 — its closing frames timed out here rather than
 * anywhere near the fonts, which is exactly as misleading as it sounds. The
 * ceiling costs nothing when it is not hit, so it is set well past the worst
 * frame rather than just past it.
 */
const handle = delayRender("Loading Geist", { timeoutInMilliseconds: 300_000 });

const load = async () => {
  const faces = [
    new FontFace(SANS, `url(${geistSans})`, { weight: "100 900" }),
    new FontFace(MONO, `url(${geistMono})`, { weight: "100 900" }),
  ];

  await Promise.all(
    faces.map(async (face) => {
      await face.load();
      document.fonts.add(face);
    }),
  );
};

load()
  .then(() => continueRender(handle))
  .catch((err) => {
    // Continue rather than hang: a render in the fallback face is recoverable,
    // a render that never finishes is not, and the console line says which.
    console.error("font load failed, rendering in fallback", err);
    continueRender(handle);
  });
