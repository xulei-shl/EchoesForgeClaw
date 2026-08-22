import { serve, type HTMLBundle } from "bun";
import { mkdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { documentPath, writePages } from "./document";
import { writeFavicon } from "./favicon";
import { writeLlmsTxt } from "./llms";
import { PAGES } from "./manifest";
import { PREFIX as WALL, wall, type BlobatarEnv } from "./worker/wall/index";
import { sqliteD1 } from "./worker/wall/sqlite";
import { TEST_SECRET } from "./worker/wall/turnstile";

// All three before anything reads for them: importing a document is what
// resolves its `<link rel="icon">` href, the documents themselves do not exist
// until `writePages` runs, and the asset routes below enumerate `public/`. On a
// clean checkout none of the three generated inputs is there yet.
await writeFavicon();
await writePages();
await writeLlmsTxt();

/**
 * One document per manifest entry.
 *
 * Imported by path rather than by a literal specifier, which is what lets this
 * loop exist at all — Bun resolves an HTML import into a bundle it serves and
 * hot-reloads, and it does that for a computed path the same as a written one.
 */
const documents = new Map<string, HTMLBundle>(
  await Promise.all(
    PAGES.map(
      async page =>
        [page.name, (await import(documentPath(page.name))).default] as const,
    ),
  ),
);

/**
 * Manifest routes, in the order `Bun.serve` has to see them.
 *
 * The page that claims `"/"` becomes the catch-all and must come last, since a
 * `"/*"` ahead of anything would swallow it. Every other page is served at both
 * spellings of its URL, because that is what the deployment does:
 * `html_handling: "auto-trailing-slash"` in `wrangler.jsonc` maps `/editor`
 * onto `editor.html`, and a dev server that answered only one of them would
 * disagree with production about a link somebody had already shared.
 */
const routes = Object.fromEntries(
  PAGES.flatMap(page => {
    const document = documents.get(page.name)!;
    return page.route === "/"
      ? [["/*", document] as const]
      : [
          [page.route, document] as const,
          [`${page.route}.html`, document] as const,
        ];
  }).sort(([a], [b]) => (a === "/*" ? 1 : b === "/*" ? -1 : 0)),
);

/**
 * `public/` at the root, mirroring what the build copies into `dist`.
 *
 * Enumerated at boot rather than matched with a wildcard: `/:file` would sit in
 * front of the SPA fallback and have to decide, per request, whether a miss is
 * a missing asset or a route the page should render. One entry per real file
 * has no such ambiguity — anything not in the directory never matches.
 *
 * Recursive, and that is not a refinement. A flat `readdir` yields `r` and
 * `eggs` as *directory* names, so `/r/avatar.json` matched nothing here and fell
 * through to the SPA catch-all, which answers every unmatched path with the
 * index document — a request for JSON or an image got HTML and a 200, which is
 * worse than a 404 because nothing reports it. Production never showed it:
 * Cloudflare serves `dist/` as a static tree and does not care how deep a file
 * sits. Directory entries are dropped rather than served, since `Bun.file` on a
 * directory is not a response.
 */
const assets = Object.fromEntries(
  (await readdir("public", { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    // `parentPath` is the directory the entry was found in, `public` included;
    // the route is what is left after that prefix.
    .map(entry => `${entry.parentPath}/${entry.name}`.slice("public/".length))
    .map(path => [`/${path}`, new Response(Bun.file(`./public/${path}`))]),
);

/**
 * The wall's endpoints, served here rather than only by `wrangler dev`.
 *
 * This server is a `Bun.serve`, not a Worker, so without this the wall's routes
 * do not exist in development at all — the landing page's fetch fails, the wall
 * reads as empty, and the section spends every dev session showing its
 * cold-start state. That is a bad way to build the one part of the site that is
 * about other people being there.
 *
 * It runs the *same router* the Worker runs, over the same SQL and the same
 * migrations, against `bun:sqlite` (see `worker/wall/sqlite.ts`). What it does
 * not run is Cloudflare: no edge cache, no real D1, no Turnstile-shaped
 * latency. `bunx wrangler dev` remains the thing to reach for when the question
 * is about the platform rather than about the wall.
 */
const BLOBATAR_DB = ".wrangler/state/blobatar-dev.sqlite";
mkdirSync(".wrangler/state", { recursive: true });

/**
 * `.dev.vars` if it is there, Cloudflare's documented test values if it is not.
 *
 * Wrangler reads that file; `Bun.serve` does not, and it deliberately is not an
 * `.env` — these are Worker secrets, and the two should not be one file. A
 * clone with no `.dev.vars` still gets a working wall, because every default
 * below is a value published *for* this purpose. There is still no bypass: the
 * challenge is verified for real, against Cloudflare, with a secret that
 * accepts any token. Which does mean placement needs a network — offline, the
 * write path refuses, exactly as it would in production with a blip.
 */
const devVars = async (): Promise<BlobatarEnv> => {
  const file = Bun.file(".dev.vars");
  const text = (await file.exists()) ? await file.text() : "";
  const read = (name: string) =>
    text.match(new RegExp(`^${name}\\s*=\\s*"?([^"\n]*)"?`, "m"))?.[1] || undefined;

  return {
    BLOBATAR: sqliteD1(BLOBATAR_DB),
    WALL_SECRET: read("WALL_SECRET") ?? "a-development-pepper",
    TURNSTILE_SECRET: read("TURNSTILE_SECRET") ?? TEST_SECRET,
    WALL_ADMIN_TOKEN: read("WALL_ADMIN_TOKEN") ?? "development",
    WALL_BLOCKLIST: read("WALL_BLOCKLIST"),
  };
};

const wallEnv = await devVars();

/**
 * Named routes rather than one `/wall/*`, because `/wall` is also a *page*.
 *
 * A wildcard over the whole prefix would sit in front of the preview document
 * and have to decide, per request, which of the two a path is — the same
 * ambiguity the asset routes below are enumerated to avoid. These are the five
 * the Worker answers, and nothing else under the prefix reaches it.
 */
const wallRoutes = Object.fromEntries(
  ["r/:region", "c/:key/:version", "mine", "place", "p/:cell"].map(path => [
    `${WALL}${path}`,
    async (request: Request) => {
      // The address the Worker reads. Cloudflare sets it at the edge; here
      // there is no edge, and a cooldown needs *something* to key on.
      const headers = new Headers(request.headers);
      if (!headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", "127.0.0.1");

      if (request.method === "POST") await spendNothing();

      const answered = await wall(new Request(request, { headers }), wallEnv);
      if (!answered) return new Response("not the wall", { status: 404 });
      return uncached(answered);
    },
  ]),
);

/**
 * The day's quota, forgotten before every write.
 *
 * One blob per address per day is the right rule for a public wall and the
 * wrong one for the person building it: development is a hundred placements an
 * afternoon, all from `127.0.0.1`, and the second one gets a cooldown that
 * lasts until tomorrow. Working around it by hand — deleting a row out of the
 * dev database between attempts — is a step nobody remembers, and forgetting it
 * looks exactly like a broken write path.
 *
 * Cleared rather than skipped, and that distinction is the whole design: the
 * quota is not a check the router performs, it is a `UNIQUE (ip_hash, day)`
 * insert inside the placement's own transaction (see `place` in
 * `worker/wall/db.ts`), so a bypass that only silenced `spentToday` would still
 * fail on the insert and roll the whole placement back. Emptying the table
 * leaves every statement in that batch running for real, exactly as deployed.
 *
 * It lives here, in the dev server, rather than behind a flag the Worker reads.
 * A cooldown bypass in shipped code is one misread environment variable away
 * from being a wall with no rate limit at all, and this file does not deploy.
 */
const spendNothing = () => wallEnv.BLOBATAR.prepare("DELETE FROM quota").run();

/**
 * Cache headers, dropped on the way out.
 *
 * The Worker serves chunk bodies at version-keyed URLs with `immutable` and a
 * year of `max-age`, which is sound in production because a chunk's version
 * only ever increases — a given URL's body genuinely cannot change.
 *
 * A development database breaks that promise on purpose. Clear the wall and
 * place something new, and chunk `0_0` is back at version 1 with different
 * contents, so the browser answers `/wall/c/0_0/1` out of its own disk cache
 * and shows a blobatar that no longer exists — indistinguishable, from the
 * outside, from the client decoding the wrong seed. That cost an investigation
 * once already.
 *
 * So: nothing this server says is cacheable. The deployed policy is untouched
 * and still worth testing, which is what `bunx wrangler dev` is for.
 */
function uncached(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

const server = serve({
  routes: {
    ...wallRoutes,
    // Served straight off disk, matching the absolute `/fonts/...` URL in
    // `styles.css`. Keeping them out of the bundler is what stops Bun inlining
    // them into the stylesheet as base64.
    "/fonts/:file": req => {
      const file = Bun.file(`./fonts/${req.params.file}`);
      return new Response(file, {
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      });
    },
    ...assets,
    /*
     * Every page, last, so that the catch-all among them cannot shadow an
     * asset. Not client-side routes: each page is its own entrypoint with its
     * own bundle, so that nothing one page needs — the editor's slider, its
     * control set, its layout readback — is downloaded by someone who only ever
     * reads another. See the note on `entrypoints` in `build.ts`.
     */
    ...routes,
	},
	port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`blobatar site → ${server.url}`);
