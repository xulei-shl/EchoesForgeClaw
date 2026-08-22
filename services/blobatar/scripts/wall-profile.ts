/**
 * Profiles the wall's renderer against the fixture.
 *
 * `bun run profile:wall` — with `bun run site` already running, since this
 * drives the real page rather than a harness. Pass a URL to point it elsewhere:
 * `bun scripts/wall-profile.ts http://localhost:3010/wall`.
 *
 * What it measures, and why it is not a frame counter: headless Chrome's frame
 * cadence is a property of the harness, not of the wall — synthetic input
 * arrives at whatever rate this script dispatches it, so "fps" here would be a
 * number about the script. What matters is the *cost of a frame*, so the page's
 * `requestAnimationFrame` callback is wrapped before any of its own code runs
 * and every invocation is timed. That callback is exactly `WallCanvas.draw`.
 *
 * It also counts `new Image()`, which is one blobatar being rasterised. That
 * number is the sprite cache turned inside out: it should climb while panning
 * into unseen wall and be *exactly zero* while idle. It was not, once — see the
 * eviction guard in `apps/site/src/wall/paint.ts` — and a regression there is
 * invisible except as a laptop fan.
 *
 * Chrome only. It is the rasteriser `scripts/media.ts` already depends on.
 */
import { spawn, spawnSync } from "node:child_process";

const URL_ = process.argv[2] ?? "http://localhost:3010/wall";
const WIDTH = Number(process.env.W ?? 1440);
const HEIGHT = Number(process.env.H ?? 900);
const PORT = 9333;

const CHROME = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].find(
  bin => spawnSync(bin, ["--version"]).status === 0,
);
if (!CHROME) {
  console.error("No Chrome found — set one on PATH, as scripts/media.ts also needs.");
  process.exit(1);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);

/** The debugger takes a moment to listen, and there is nothing to wait on but
 * the socket itself. */
let target: { webSocketDebuggerUrl: string } | null = null;
for (let i = 0; i < 40 && !target; i++) {
  try {
    target = (await (
      await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, {
        method: "PUT",
      })
    ).json()) as { webSocketDebuggerUrl: string };
  } catch {
    await sleep(250);
  }
}
if (!target) {
  chrome.kill();
  console.error("Chrome never came up on the debugging port.");
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => (socket.onopen = resolve));

let id = 0;
const pending = new Map<number, (value: unknown) => void>();
socket.onmessage = event => {
  const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
  if (message.id && pending.has(message.id)) pending.get(message.id)!(message.result);
};
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<any>(resolve => {
    const at = ++id;
    pending.set(at, resolve);
    socket.send(JSON.stringify({ id: at, method, params }));
  });
const evaluate = async (expression: string) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: false,
});

/*
 * Installed before the document's own scripts, which is the whole point: the
 * wall schedules its first frame during hydration, and a wrapper applied after
 * that would miss the most expensive frames there are.
 */
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const prof = { frames: [], images: 0 };
    window.__prof = prof;
    window.requestAnimationFrame = cb => raf(t => {
      const start = performance.now();
      cb(t);
      prof.frames.push(performance.now() - start);
    });
    const Native = window.Image;
    window.Image = function (...args) { prof.images++; return new Native(...args); };
    window.Image.prototype = Native.prototype;
    window.__reset = () => { prof.frames = []; prof.images = 0; };
    window.__stats = () => {
      const f = [...prof.frames].sort((a, b) => a - b);
      const at = q => (f.length ? f[Math.min(f.length - 1, Math.floor(f.length * q))] : 0);
      return {
        frames: f.length,
        p50: +at(0.5).toFixed(2),
        p95: +at(0.95).toFixed(2),
        max: +(f.at(-1) ?? 0).toFixed(2),
        rasterised: prof.images,
      };
    };
  })();`,
});

await send("Page.navigate", { url: URL_ });
await sleep(4000);

const report = (name: string, stats: Record<string, number>) =>
  console.log(
    `${name.padEnd(16)} frames ${String(stats.frames).padStart(4)}` +
      `   p50 ${String(stats.p50).padStart(6)}ms   p95 ${String(stats.p95).padStart(6)}ms` +
      `   max ${String(stats.max).padStart(6)}ms   rasterised ${stats.rasterised}`,
  );

console.log(`${URL_}  ${WIDTH}x${HEIGHT}`);
report("first paint", await evaluate("window.__stats()"));

const wheel = async (ticks: number, delta: number) => {
  for (let i = 0; i < ticks; i++) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: WIDTH / 2,
      y: HEIGHT / 2,
      deltaX: 0,
      deltaY: delta,
      button: "none",
    });
    await sleep(30);
  }
  await sleep(500);
};

/** A drag in small steps, which is what a pan actually is — a wheel-driven
 * benchmark would measure the zoom path and call it panning. */
const pan = async (ms: number) => {
  const started = Date.now();
  let x = WIDTH * 0.5;
  let y = HEIGHT * 0.5;
  let direction = 1;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  while (Date.now() - started < ms) {
    x += 11 * direction;
    y += 4 * direction;
    if (x > WIDTH * 0.85 || x < WIDTH * 0.15) direction *= -1;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left" });
    await sleep(8);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};

const scenario = async (name: string, work: () => Promise<unknown>) => {
  await evaluate("window.__reset()");
  await work();
  report(name, await evaluate("window.__stats()"));
};

await scenario("pan, zoom 1", () => pan(4000));
await wheel(10, 120);
// The expensive one: everything the wall can show at once.
await scenario("pan, min zoom", () => pan(4000));
// And the cheap one that must be free. Anything but zero here is a redraw loop.
await scenario("idle 3s", () => sleep(3000));
await wheel(14, -120);
await scenario("pan, max zoom", () => pan(4000));

socket.close();
chrome.kill();
