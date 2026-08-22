import { encodeChunk } from "../../src/wall/chunk";
import {
  REACH,
  cell,
  cellKey,
  chunkKey,
  chunkOf,
  isPlaceable,
  nearestPlaceable,
  parseChunkKey,
} from "../../src/wall/geometry";
import {
  cellsIn,
  chunkCells,
  chunkState,
  isFullCount,
  placeStatements,
  placementAtCell,
  placementsFor,
  regionIndex,
  removeStatements,
  spentToday,
  wallSize,
  type D1Database,
} from "./db";
import {
  addressOf,
  dayOf,
  hashAddress,
  hashToken,
  newToken,
  sameSecret,
  setCookie,
  tokenFrom,
} from "./identity";
import { checkExpression, checkName } from "./moderation";
import { verifyTurnstile } from "./turnstile";

/**
 * The wall, over HTTP.
 *
 * Five routes, and their cache headers are as much of the design as their
 * bodies. `apps/site/wrangler.jsonc` is built around assets being free and
 * Worker requests being billed — `run_worker_first` was scoped to `/avatar/*`
 * precisely so that reading the site costs nothing — and putting a fetch in the
 * second section of the landing page spends that deliberately. What pays it
 * back is that almost every one of these responses is cached: a chunk body is
 * `immutable` for a year under a URL that contains its version, so a client
 * fetches any given body at most once, ever, and the only thing it asks
 * repeatedly is a region index a few bytes an entry with a 30-second TTL.
 *
 * The rules themselves are not in this file. They are in `src/wall/geometry.ts`,
 * imported by both sides, because a client that offers a cell the server would
 * refuse is a broken affordance and a server that accepts one the client cannot
 * draw is a blob nobody sees.
 */

export const PREFIX = "/wall/";

export type BlobatarEnv = {
  BLOBATAR: D1Database;
  /** Salts the address hashes and nothing else. Rotating it resets every
   * cooldown in flight, which is a thing to know before rotating it. */
  WALL_SECRET?: string;
  /** Turnstile's server key. Absent means no writes — see `turnstile.ts`. */
  TURNSTILE_SECRET?: string;
  /** Bearer token for the delete endpoint. Absent means the endpoint is not
   * there at all, rather than there and unguarded. */
  WALL_ADMIN_TOKEN?: string;
  /** Comma-separated extra blocklist terms. The list that grows without a
   * deploy, and the one that is not in a public repo. */
  WALL_BLOCKLIST?: string;
};

/** Everything but a chunk body: small, current, and nobody's to cache. */
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const A_YEAR = "public, max-age=31536000, immutable";

/**
 * How far a coordinate may be from the origin.
 *
 * Matches what `parseChunkKey` will parse, which is what makes the two agree:
 * a cell the write path accepts must be addressable in a chunk URL, or it is a
 * blob that exists and cannot be fetched. Seven digits of chunk is ~2×10^8
 * cells, roughly 16000km of wall at 80px a cell — the bound is against integer
 * nonsense and 64-bit round-tripping, not against ambition.
 */
const LIMIT = 1_000_000;

/** How far a refusal looks for somewhere better. Four screens of wall; see the
 * note at its only use. */
const SUGGEST = REACH * 4;

const inBounds = (value: unknown): value is number =>
  Number.isInteger(value) && Math.abs(value as number) <= LIMIT;

/**
 * The wall's routes, or `null` for "not mine".
 *
 * Returning `null` rather than a 404 is what keeps the split in `worker/index.ts`
 * honest: anything this function does not claim is still the site, served by the
 * asset pipeline, even though `run_worker_first` now has to send `/wall/*` here.
 */
export async function wall(request: Request, env: BlobatarEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) return null;
  const [head, ...rest] = url.pathname.slice(PREFIX.length).split("/");

  // `/wall/` itself is a *page* — the preview surface — and the asset pipeline
  // serves it under `auto-trailing-slash`. Claiming the prefix wholesale would
  // answer the trailing-slash spelling of that URL with a JSON 404, which is
  // the kind of break nobody notices until a link somebody shared stops
  // working.
  if (!head) return null;

  if (request.method === "GET" && head === "r" && rest.length === 1) {
    return region(env, rest[0]!);
  }
  if (request.method === "GET" && head === "c" && rest.length === 2) {
    return chunk(env, rest[0]!, rest[1]!);
  }
  if (request.method === "GET" && head === "mine" && rest.length === 0) {
    return mine(request, env);
  }
  if (request.method === "POST" && head === "place" && rest.length === 0) {
    return place(request, env);
  }
  if (request.method === "DELETE" && head === "p" && rest.length === 1) {
    return remove(request, env, rest[0]!);
  }
  return json({ error: "no such thing" }, 404);
}

/**
 * The version index for a region of chunks.
 *
 * The only request a client makes more than once, so it is the only one with a
 * TTL rather than an immutable URL — thirty seconds, which is how long a
 * stranger's blobatar takes to appear and is invisible on a wall. The placer
 * sees their own immediately, client-side, without waiting for any of this.
 *
 * Full chunks are listed like any other. ADR 0011 says they need no index entry,
 * and that is true of a client that already *holds* one — it can pin the body
 * forever and stop asking — but a client that has never fetched it cannot tell
 * an absent entry meaning "full and frozen" from an absent entry meaning
 * "empty". The count is what says which, and it is one number.
 */
async function region(env: BlobatarEnv, key: string): Promise<Response> {
  // Region keys and chunk keys have the same grammar — two signed integers with
  // an underscore between them — so they get the same parser rather than a
  // second one that could disagree with it about `"3abc"` or `" 3"`.
  const parsed = parseChunkKey(key);
  if (!parsed) return json({ error: "bad region" }, 400);

  const index = await regionIndex(env.BLOBATAR, { rx: parsed.cx, ry: parsed.cy });
  return json(
    {
      r: key,
      // The wall's total size, which is the one thing the client cannot work
      // out for itself: occupancy answering "no" everywhere means an empty wall
      // to a Worker and an unfetched one to a browser.
      n: index.placements,
      v: Object.fromEntries(index.chunks.map(state => [state.key, state.version])),
      // Which of those can be kept forever. A chunk holding all 1024 cells can
      // never be written to again.
      f: index.chunks.filter(state => isFullCount(state.count)).map(state => state.key),
    },
    200,
    { "cache-control": "public, max-age=30" },
  );
}

/**
 * One chunk body, at a version.
 *
 * The version in the path is what makes the body immutable, and it is checked
 * rather than trusted: a client asking for a version that is no longer current
 * gets the current body with `no-store`, so the stale URL never enters a cache
 * under a promise it cannot keep. It could redirect instead; serving the answer
 * costs one round trip less and the body carries its own version, which is what
 * the client reconciles against anyway.
 */
async function chunk(env: BlobatarEnv, key: string, at: string): Promise<Response> {
  const parsed = parseChunkKey(key);
  if (!parsed || !/^\d{1,9}$/.test(at)) return json({ error: "bad chunk" }, 400);

  const state = await chunkState(env.BLOBATAR, parsed);
  // A chunk nobody has ever written to is empty rather than missing. Version 0
  // is the version it will keep until somebody places in it, so an empty body
  // is cacheable exactly as long as any other — which is what stops a client
  // panning across open wall from asking again every time.
  const version = state?.version ?? 0;
  const cells = state ? await chunkCells(env.BLOBATAR, parsed) : [];
  const current = Number(at) === version;

  return new Response(encodeChunk({ key, version, cells }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": current ? A_YEAR : "no-store",
    },
  });
}

/**
 * Where your blobatars are, according to the cookie.
 *
 * The slow path of the locate control: `localStorage` answers this instantly on
 * the device that did the placing, and this is what happens on the second
 * device or after a clear. It reads; there is deliberately no sibling of this
 * function that writes, because the token grants finding and not editing.
 */
async function mine(request: Request, env: BlobatarEnv): Promise<Response> {
  const token = tokenFrom(request);
  if (!token) return json({ cells: [] }, 200, { vary: "Cookie" });
  const rows = await placementsFor(env.BLOBATAR, await hashToken(token));
  return json(
    { cells: rows.map(row => ({ x: row.x, y: row.y, seed: row.seed, at: row.at })) },
    200,
    { vary: "Cookie" },
  );
}

/**
 * A placement.
 *
 * The order of the checks is the cost of each: shape and moderation are free
 * and run first, Turnstile is a network round trip and runs before anything
 * touches D1, and the reach read is last because it is the only one that scales
 * with how busy the wall is. A bot with a bad name never reaches the database.
 */
async function place(request: Request, env: BlobatarEnv): Promise<Response> {
  if (!env.WALL_SECRET) return json({ error: "the wall is not configured" }, 503);

  const ip = addressOf(request);
  // Not `X-Forwarded-For`: that one is client-supplied, and a cooldown that
  // trusts it is a cooldown with an opt-out header. A request without the
  // edge's own header did not come through the edge.
  if (!ip) return json({ error: "no address" }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const named = checkName(body.seed, env.WALL_BLOCKLIST);
  if (!named.ok) return json({ error: "name", why: named.why }, 422);
  const expression = body.expression;
  if (!checkExpression(expression)) return json({ error: "expression" }, 422);
  if (!inBounds(body.x) || !inBounds(body.y)) return json({ error: "off the wall" }, 400);

  const at = cell(body.x as number, body.y as number);

  if (!(await verifyTurnstile(body.turnstile, env.TURNSTILE_SECRET, ip))) {
    return json({ error: "challenge" }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const day = dayOf(now);
  const ipHash = await hashAddress(ip, day, env.WALL_SECRET);

  // The friendly half of the cooldown. The half that actually enforces it is
  // the primary key on `quota`, in the batch below, because a read and a write
  // in two statements is a race two Workers win together.
  if (await spentToday(env.BLOBATAR, ipHash, day)) return json(cooldown(now), 429);

  const [neighbours, size] = await Promise.all([
    cellsIn(env.BLOBATAR, at.x - REACH, at.y - REACH, at.x + REACH, at.y + REACH),
    wallSize(env.BLOBATAR),
  ]);
  const taken = new Set(neighbours.map(near => cellKey(near.x, near.y)));
  const occupied = (x: number, y: number) => taken.has(cellKey(x, y));
  const populated = size > 0;

  if (!isPlaceable(at.x, at.y, occupied, populated)) {
    // Refusing with somewhere to go rather than just refusing.
    //
    // The reach box cannot answer this: a visitor who aimed well past the
    // frontier has nothing occupied anywhere in it, so "the nearest placeable
    // cell" computed from it is `null` — which is the one case where an answer
    // would actually help. So a refusal pays for a second, wider read.
    //
    // Wider and still bounded, rather than a scan for the globally nearest
    // blob: the box is index-usable where an `ORDER BY distance` is a full
    // table scan, and a bot hammering unplaceable coordinates must not be able
    // to turn each 409 into a walk of every row on the wall. Past this radius
    // "nearest" has stopped being a useful answer anyway, and the client falls
    // back to the frontier the region index suggests.
    const wide = await cellsIn(env.BLOBATAR, at.x - SUGGEST, at.y - SUGGEST, at.x + SUGGEST, at.y + SUGGEST);
    const around = new Set(wide.map(near => cellKey(near.x, near.y)));
    const nearest = nearestPlaceable(at, (x, y) => around.has(cellKey(x, y)), populated, SUGGEST);
    return json({ error: "unplaceable", nearest }, 409);
  }

  const token = tokenFrom(request) ?? newToken();
  const tokenHash = await hashToken(token);

  try {
    await env.BLOBATAR.batch(
      placeStatements(env.BLOBATAR, {
        cell: at,
        seed: named.name,
        expression,
        at: now,
        ipHash,
        day,
        tokenHash,
      }),
    );
  } catch (error) {
    // The batch is a transaction, so exactly one of two things failed and
    // nothing was written either way. Which one is worth telling apart: a
    // second placement today is a rule the visitor can wait out, and a cell
    // taken between their click and their submit is one they can simply move
    // over from. The message is the only thing that distinguishes them, so a
    // shape SQLite might change is caught by falling through to the collision —
    // the answer that leaves them somewhere to go.
    const message = String(error);
    if (message.includes("quota")) return json(cooldown(now), 429);
    return json({ error: "taken" }, 409);
  }

  const state = await chunkState(env.BLOBATAR, chunkOf(at.x, at.y));
  return json(
    {
      x: at.x,
      y: at.y,
      at: now,
      seed: named.name,
      chunk: chunkKey(chunkOf(at.x, at.y)),
      version: state?.version ?? 1,
    },
    201,
    // Re-sent on every placement, which also rolls the year forward for anybody
    // who comes back and places again.
    { "set-cookie": setCookie(token) },
  );
}

/** When this address may place again: the next UTC midnight, because that is
 * where the day in the quota key turns over. */
function cooldown(now: number) {
  const midnight = Math.floor(now / 86400) * 86400 + 86400;
  return { error: "cooldown", until: midnight };
}

/**
 * Moderation's delete.
 *
 * The only thing on this wall that removes a placement, and it is the reason
 * the blocklist is allowed to be imperfect. Authenticated with a bearer token
 * compared in constant time; a deployment that has not set one does not have
 * this endpoint at all, which is why the miss is a 404 rather than a 401 — an
 * unset secret must not read as "guarded, try harder".
 *
 * Permanence is a rule of the game for the people placing, not a property of
 * the storage. Nobody can take back their own cell; we can take back a slur.
 */
async function remove(request: Request, env: BlobatarEnv, key: string): Promise<Response> {
  const secret = env.WALL_ADMIN_TOKEN;
  const offered = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!secret || !offered || !sameSecret(offered, secret)) return json({ error: "no such thing" }, 404);

  // Same grammar as a chunk key, same parser. These are cells rather than
  // chunks, which is what a moderator has in front of them: the hover plate
  // prints `x, y`.
  const parsed = parseChunkKey(key);
  if (!parsed) return json({ error: "bad cell" }, 400);
  const at = cell(parsed.cx, parsed.cy);

  const found = await placementAtCell(env.BLOBATAR, at);
  if (!found) return json({ error: "nobody there" }, 404);

  await env.BLOBATAR.batch(removeStatements(env.BLOBATAR, at));
  return json({ removed: { x: at.x, y: at.y, seed: found.seed } });
}
