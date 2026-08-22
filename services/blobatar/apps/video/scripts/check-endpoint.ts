/**
 * What the endpoint film claims, checked against the endpoint.
 *
 * The film's whole value is that it cannot lie: every frame renders the bytes
 * `apps/api` would return for the URL on screen. That property is only as good
 * as the things around it, and each of those is easy to break by editing a
 * string and impossible to spot in a still:
 *
 * 1. Every URL is one the endpoint answers 200 to. `endpoint.ts` already throws
 *    at module load, so this restates it with a name attached to each failure.
 * 2. Every commit changes the picture. A step whose URL renders the same bytes
 *    as the one before it is a beat of the film where nothing happens and the
 *    viewer concludes the parameter does nothing.
 * 3. The hash is the hash. The Gravatar beat swaps a host in front of a digest
 *    that is claimed to be an email's.
 * 4. The longest line fits the frame.
 * 5. The card's byte count is the real one.
 * 6. A stated `hue` is far enough from the name's own hue to be seen doing
 *    something. `alain00` hashes to 236°, so `hue=210` — the value the thread
 *    quotes — would render as very nearly the blobatar already on screen, and
 *    the beat claiming the parameter pins the colour would be the beat where
 *    nothing happens.
 * 7. No step states a `hue` under an expression that spends colour. `love`,
 *    `shy` and `sick` tint the palette toward a hot pair, and they win — so a
 *    URL reading `&expression=love&hue=210` renders pink, and the film would be
 *    showing a parameter apparently doing nothing on the exact beat that claims
 *    it pins the colour. The endpoint is behaving correctly; the film is the
 *    thing that would be lying.
 */

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { traits } from "blobatar";
import { PREFIX } from "../../api/src/avatar";
import { BEATS, END, FPS, HASH, HOST, LINE_X, WIDTH, render } from "../src/url";

/** The 34px line, at the widest advance a monospace face plausibly has. */
const FONT = 34;
const ADVANCE = 0.62;

/** The number printed on the end card, and the URL it is measured on. */
const CARD_BYTES = 616;
const CARD_URL = `${HOST}/avatar/alain00`;

let failed = false;
const fail = (msg: string) => {
  console.error(`✗ ${msg}`);
  failed = true;
};

// 1 — every step is served.
for (const b of BEATS) {
  if (!b.step.url.startsWith(`${HOST}/`)) continue;
  try {
    render(b.step.url);
  } catch (e) {
    fail(`${b.step.url} — ${(e as Error).message}`);
  }
}

// 2 — every commit changes the picture.
let prevBody: string | null = null;
for (const b of BEATS) {
  const body = b.step.url.startsWith(`${HOST}/`) ? render(b.step.url) : null;
  if (body !== null && body === prevBody) {
    fail(`${b.step.url} renders exactly what the step before it renders`);
  }
  prevBody = body;
}

// 3 — the digest is real.
const EMAIL = "alain00@acme.com";
const real = createHash("md5").update(EMAIL).digest("hex");
if (real !== HASH) fail(`HASH is not md5("${EMAIL}") — that is ${real}`);
if (!BEATS.some((b) => b.step.url === `${HOST}/avatar/${EMAIL}`)) {
  fail(`the film never types ${EMAIL}, so the hash stands for nobody on screen`);
}

// 4 — the longest line fits.
const longest = BEATS.reduce((a, b) => (b.step.url.length > a.length ? b.step.url : a), "");
const width = longest.length * FONT * ADVANCE;
if (LINE_X + width > WIDTH - LINE_X) {
  fail(`the longest URL is ${longest.length} chars — ${Math.round(width)}px, past the margin`);
}

// 6 — a stated hue is visibly a different colour from the name's own.
const HUE_GAP = 60;
for (const b of BEATS) {
  const m = /[?&]hue=(\d+)/.exec(b.step.url);
  if (!m) continue;
  const name = new URL(`https://${b.step.url}`).pathname.slice(PREFIX.length);
  const own = traits(name).num("hue", 0, 360);
  const d = Math.abs(Number(m[1]) - own) % 360;
  const gap = d > 180 ? 360 - d : d;
  // The staircase types a hue one digit at a time, so only the value it settles
  // on has to clear — the digits on the way are a sweep, and a sweep passing
  // near the name's own hue is the sweep working.
  const settles = !BEATS.some((o) => o.step.url.startsWith(`${b.step.url}`) && o !== b);
  if (settles && gap < HUE_GAP) {
    fail(`${b.step.url} pins hue ${m[1]}, only ${Math.round(gap)}° from ${name}'s own ${Math.round(own)}°`);
  }
}

// 7 — hue is never stated under an expression that overrules it.
const HOT = ["love", "shy", "sick"];
for (const b of BEATS) {
  const u = b.step.url;
  if (!u.includes("hue=")) continue;
  const hot = HOT.find((e) => u.includes(`expression=${e}`));
  if (hot) fail(`${u} states a hue under ${hot}, which tints over it`);
}

// 5 — the card's number, measured on the URL the film ends on.
if (BEATS[BEATS.length - 1]!.step.url !== CARD_URL) {
  fail(`the film ends on ${BEATS[BEATS.length - 1]!.step.url}, the card counts ${CARD_URL}`);
}
const body = render(CARD_URL)!;
const bytes = Buffer.byteLength(body);
const gz = gzipSync(body).length;
if (bytes !== CARD_BYTES) {
  fail(`the card says ${CARD_BYTES} bytes; ${CARD_URL} is ${bytes} (${gz} gzipped)`);
}

if (!failed) {
  console.log(`✓ ${BEATS.length} URLs, all served, all distinct`);
  console.log(`✓ longest line ${longest.length} chars — ${Math.round(width)}px inside ${WIDTH - LINE_X * 2}px`);
  console.log(`✓ ${CARD_URL} is ${bytes} bytes of svg, ${gz} gzipped`);
  console.log(`  ${END} frames — ${(END / FPS).toFixed(1)}s`);
}

process.exit(failed ? 1 : 0);
