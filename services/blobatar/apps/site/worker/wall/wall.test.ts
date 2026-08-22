import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { decodeChunk } from "../../src/wall/chunk";
import { CAPACITY, FIRST, REACH, cellIndex, chunkKey, chunkOf } from "../../src/wall/geometry";
import { wall, type BlobatarEnv } from "./index";
import { COOKIE } from "./identity";
import { TEST_SECRET } from "./turnstile";
import { sqliteD1 } from "./sqlite";

/**
 * The wall's HTTP surface, against a real database.
 *
 * These run the shipped SQL over the shipped migrations — see `testing.ts` for
 * why that matters more than usual here: every rule the wall has is a
 * uniqueness constraint, and a mocked database cannot break one.
 *
 * Turnstile is the one thing stubbed, because the alternative is a test suite
 * that talks to Cloudflare. It is stubbed by *passing the real code path a
 * secret that always succeeds* rather than by bypassing the check, so the
 * `verifyTurnstile` call itself is still exercised.
 */

const ORIGIN = "https://blobatar.dev";
const IP = "203.0.113.7";

let env: BlobatarEnv & { raw: ReturnType<typeof sqliteD1>["raw"] };
let fetches: Request[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  const db = sqliteD1();
  env = {
    BLOBATAR: db,
    raw: db.raw,
    WALL_SECRET: "pepper",
    TURNSTILE_SECRET: TEST_SECRET,
    WALL_ADMIN_TOKEN: "let-me-in",
  };
  fetches = [];
  // Cloudflare's test secret accepts any token, but reaching it means a network
  // call from a unit test. The reply it would give is the reply given here.
  globalThis.fetch = (async (input: Request | string, init?: RequestInit) => {
    fetches.push(new Request(input as string, init));
    return new Response(JSON.stringify({ success: true }));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const get = (path: string, headers: Record<string, string> = {}) =>
  wall(new Request(ORIGIN + path, { headers }), env);

const post = (body: unknown, headers: Record<string, string> = {}) =>
  wall(
    new Request(`${ORIGIN}/wall/place`, {
      method: "POST",
      headers: { "CF-Connecting-IP": IP, ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );

/** A placement that will pass everything, at a cell of your choosing. */
const placement = (x: number, y: number, extra: Record<string, unknown> = {}) => ({
  x,
  y,
  seed: "alain",
  expression: "happy",
  turnstile: "solved",
  ...extra,
});

/** Somebody else's address, so the cooldown is not in the way of a test that is
 * about something else. */
const asSomeoneElse = (n: number) => ({ "CF-Connecting-IP": `198.51.100.${n}` });

describe("routing", () => {
  test("the preview page keeps its URL", async () => {
    // `/wall/` is a document served by the asset pipeline. Claiming the whole
    // prefix would answer it with a JSON 404.
    expect(await wall(new Request(`${ORIGIN}/wall/`), env)).toBeNull();
    expect(await wall(new Request(`${ORIGIN}/editor`), env)).toBeNull();
  });

  test("an unknown route under the prefix is a 404, not the site", async () => {
    expect((await get("/wall/nonsense"))!.status).toBe(404);
  });

  test("keys a stranger controls are parsed strictly", async () => {
    expect((await get("/wall/r/3abc"))!.status).toBe(400);
    expect((await get("/wall/c/1_1/nope"))!.status).toBe(400);
  });
});

describe("the empty wall", () => {
  test("has no chunks and one placeable cell", async () => {
    const index = await (await get("/wall/r/0_0"))!.json();
    expect(index).toEqual({ r: "0_0", n: 0, v: {}, f: [] });
  });

  test("the first blobatar goes at the origin, and nowhere else", async () => {
    const refused = await post(placement(4, 4));
    expect(refused!.status).toBe(409);
    expect(await refused!.json()).toEqual({ error: "unplaceable", nearest: FIRST });

    const placed = await post(placement(FIRST.x, FIRST.y), asSomeoneElse(1));
    expect(placed!.status).toBe(201);
    expect(await placed!.json()).toMatchObject({ x: 0, y: 0, chunk: "0_0", version: 1 });
  });
});

describe("reading the wall", () => {
  beforeEach(async () => {
    await post(placement(FIRST.x, FIRST.y), asSomeoneElse(1));
    await post(placement(3, 2, { seed: "vera", expression: "smug" }), asSomeoneElse(2));
  });

  test("the region index carries versions, fullness and the wall's size", async () => {
    const index = (await (await get("/wall/r/0_0"))!.json()) as {
      n: number;
      v: Record<string, number>;
      f: string[];
    };
    expect(index.n).toBe(2);
    expect(index.v).toEqual({ "0_0": 2 });
    expect(index.f).toEqual([]);
  });

  test("a chunk body round-trips through the decoder", async () => {
    const response = (await get("/wall/c/0_0/2"))!;
    const body = decodeChunk(await response.text());
    expect(body!.key).toBe("0_0");
    expect(body!.version).toBe(2);
    expect(body!.cells).toEqual([
      { index: 0, seed: "alain", expression: "happy", at: expect.any(Number) },
      { index: cellIndex(3, 2), seed: "vera", expression: "smug", at: expect.any(Number) },
    ]);
  });

  test("the current version is immutable for a year and a stale one is not cached", async () => {
    expect((await get("/wall/c/0_0/2"))!.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    // The client asked under last week's URL. It still gets the truth — with
    // its version in the body — but nothing caches it under a promise that URL
    // cannot keep.
    const stale = (await get("/wall/c/0_0/1"))!;
    expect(stale.headers.get("cache-control")).toBe("no-store");
    expect(decodeChunk(await stale.text())!.version).toBe(2);
  });

  test("a chunk nobody has written to is empty rather than missing", async () => {
    const response = (await get("/wall/c/9_9/0"))!;
    expect(response.status).toBe(200);
    expect(decodeChunk(await response.text())).toEqual({ key: "9_9", version: 0, cells: [] });
    // Cacheable, so panning across open wall does not re-ask every time.
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  test("the index is short-lived where bodies are forever", async () => {
    expect((await get("/wall/r/0_0"))!.headers.get("cache-control")).toBe("public, max-age=30");
  });
});

describe("placing", () => {
  beforeEach(async () => {
    await post(placement(FIRST.x, FIRST.y), asSomeoneElse(1));
  });

  test("reach is the rule, and the server's answer is the client's", async () => {
    expect((await post(placement(REACH, 0), asSomeoneElse(2)))!.status).toBe(201);
    const far = await post(placement(REACH * 4, 0), asSomeoneElse(3));
    expect(far!.status).toBe(409);
    // Refused with somewhere to go, computed against the whole wall rather than
    // the chunks a browser happens to hold.
    expect((await far!.json()).nearest).toBeTruthy();
  });

  test("two people cannot have one cell", async () => {
    expect((await post(placement(1, 0), asSomeoneElse(2)))!.status).toBe(201);
    const second = await post(placement(1, 0, { seed: "vera" }), asSomeoneElse(3));
    expect(second!.status).toBe(409);
  });

  test("one blob per address per day", async () => {
    expect((await post(placement(1, 0), asSomeoneElse(9)))!.status).toBe(201);
    const again = await post(placement(2, 0, { seed: "vera" }), asSomeoneElse(9));
    expect(again!.status).toBe(429);
    expect(await again!.json()).toMatchObject({ error: "cooldown", until: expect.any(Number) });
  });

  test("the cooldown survives a race the friendly check would lose", async () => {
    // Both requests read "not spent" before either writes, which is the exact
    // interleaving a SELECT-then-INSERT cannot survive. The primary key on
    // `quota` is what makes the second one fail.
    const [a, b] = await Promise.all([
      post(placement(1, 0), asSomeoneElse(4)),
      post(placement(2, 0, { seed: "vera" }), asSomeoneElse(4)),
    ]);
    expect([a!.status, b!.status].sort()).toEqual([201, 429]);
    const index = (await (await get("/wall/r/0_0"))!.json()) as { n: number };
    expect(index.n).toBe(2);
  });

  test("the chunk's version climbs with every write", async () => {
    await post(placement(1, 0), asSomeoneElse(5));
    await post(placement(2, 0, { seed: "vera" }), asSomeoneElse(6));
    const index = (await (await get("/wall/r/0_0"))!.json()) as { v: Record<string, number> };
    expect(index.v["0_0"]).toBe(3);
  });

  test("the write path never trusts a client-supplied address", async () => {
    const spoofed = await wall(
      new Request(`${ORIGIN}/wall/place`, {
        method: "POST",
        headers: { "X-Forwarded-For": "203.0.113.9" },
        body: JSON.stringify(placement(1, 0)),
      }),
      env,
    );
    expect(spoofed!.status).toBe(400);
  });

  test("a placement hands back a token, and the token finds it again", async () => {
    const placed = (await post(placement(1, 0), asSomeoneElse(7)))!;
    const cookie = placed.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const token = cookie.slice(`${COOKIE}=`.length).split(";")[0]!;
    const mine = await (await get("/wall/mine", { Cookie: `${COOKIE}=${token}` }))!.json();
    expect(mine.cells).toEqual([{ x: 1, y: 0, seed: "alain", at: expect.any(Number) }]);

    // Somebody else's browser finds nothing rather than somebody else's blob.
    expect((await (await get("/wall/mine"))!.json()).cells).toEqual([]);
  });

  test("a cookie a stranger wrote never reaches a query", async () => {
    const response = await get("/wall/mine", { Cookie: `${COOKIE}=' OR 1=1 --` });
    expect((await response!.json()).cells).toEqual([]);
  });
});

describe("the guards", () => {
  test("Turnstile is verified against the address, and there is no bypass", async () => {
    await post(placement(FIRST.x, FIRST.y));
    const body = await fetches[0]!.formData();
    expect(body.get("remoteip")).toBe(IP);

    // Unsolved.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false }))) as unknown as typeof fetch;
    expect((await post(placement(1, 0), asSomeoneElse(2)))!.status).toBe(403);

    // Unconfigured, which fails closed rather than open.
    env.TURNSTILE_SECRET = undefined;
    expect((await post(placement(1, 0), asSomeoneElse(3)))!.status).toBe(403);
  });

  test("a name is checked before anything is spent on it", async () => {
    for (const seed of ["", "   ", "x".repeat(25), "<script>", "n1gg3r", "he/llo"]) {
      const response = await post(placement(FIRST.x, FIRST.y, { seed }));
      expect(response!.status).toBe(422);
    }
    // Nothing reached Turnstile, let alone the database.
    expect(fetches).toHaveLength(0);
    expect((await (await get("/wall/r/0_0"))!.json()).n).toBe(0);
  });

  test("names people actually have are not refused", async () => {
    for (const seed of ["José", "Anne-Marie", "O'Neill", "Bùi", "R2D2", "李雷"]) {
      const db = sqliteD1();
      env.BLOBATAR = db;
      env.raw = db.raw;
      expect((await post(placement(FIRST.x, FIRST.y, { seed })))!.status).toBe(201);
    }
  });

  test("an expression is a shape, not a roster", async () => {
    expect((await post(placement(FIRST.x, FIRST.y, { expression: "Happy!" })))!.status).toBe(422);
    // A pose this build has never heard of is stored and drawn as `idle`,
    // rather than refused — the roster is the client's business.
    expect((await post(placement(FIRST.x, FIRST.y, { expression: "bewildered" })))!.status).toBe(201);
  });

  test("coordinates off the end of the number line are refused", async () => {
    for (const at of [{ x: 1.5, y: 0 }, { x: 1e12, y: 0 }, { x: "0", y: 0 }]) {
      expect((await post(placement(0, 0, at)))!.status).toBe(400);
    }
  });

  test("an unconfigured wall refuses writes rather than accepting them", async () => {
    env.WALL_SECRET = undefined;
    expect((await post(placement(FIRST.x, FIRST.y)))!.status).toBe(503);
  });
});

describe("moderation", () => {
  beforeEach(async () => {
    await post(placement(FIRST.x, FIRST.y), asSomeoneElse(1));
  });

  const admin = (headers: Record<string, string>) =>
    wall(new Request(`${ORIGIN}/wall/p/0_0`, { method: "DELETE", headers }), env);

  test("the delete needs the bearer token", async () => {
    expect((await admin({}))!.status).toBe(404);
    expect((await admin({ Authorization: "Bearer nope" }))!.status).toBe(404);
  });

  test("an unset admin token means the endpoint is not there", async () => {
    env.WALL_ADMIN_TOKEN = undefined;
    // 404 rather than 401: an unset secret must not read as "guarded, try
    // harder".
    expect((await admin({ Authorization: "Bearer let-me-in" }))!.status).toBe(404);
  });

  test("a removal bumps the version, so the cached body turns over", async () => {
    const before = (await (await get("/wall/r/0_0"))!.json()) as { v: Record<string, number> };
    const removed = (await admin({ Authorization: "Bearer let-me-in" }))!;
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ removed: { x: 0, y: 0, seed: "alain" } });

    const after = (await (await get("/wall/r/0_0"))!.json()) as {
      n: number;
      v: Record<string, number>;
    };
    expect(after.v["0_0"]).toBe(before.v["0_0"]! + 1);
    expect(after.n).toBe(0);
    expect(decodeChunk(await (await get("/wall/c/0_0/2"))!.text())!.cells).toEqual([]);
  });

  test("a removal is not a refund", async () => {
    // The address that placed it has still spent its day, which is why the
    // quota is its own table rather than an index on the placement row.
    await admin({ Authorization: "Bearer let-me-in" });
    expect((await post(placement(FIRST.x, FIRST.y), asSomeoneElse(1)))!.status).toBe(429);
  });

  test("deleting an empty cell says so", async () => {
    const response = await wall(
      new Request(`${ORIGIN}/wall/p/40_40`, {
        method: "DELETE",
        headers: { Authorization: "Bearer let-me-in" },
      }),
      env,
    );
    expect(response!.status).toBe(404);
  });
});

describe("full chunks", () => {
  test("a chunk holding every cell it has is listed as frozen", async () => {
    // Written straight to the database: filling a chunk through the write path
    // is a thousand placements from a thousand addresses, which is the rule
    // working rather than a test worth running.
    const chunk = chunkOf(0, 0);
    const insert = env.raw.prepare(
      "INSERT INTO placements (x, y, cx, cy, seed, expression, at, ip_hash, token_hash)" +
        " VALUES (?1, ?2, ?3, ?4, 'someone', 'idle', 1, 'h', 't')",
    );
    for (let i = 0; i < CAPACITY; i++) {
      insert.run(i % 32, Math.floor(i / 32), chunk.cx, chunk.cy);
    }
    env.raw.exec(
      `INSERT INTO chunks (cx, cy, version, count) VALUES (0, 0, ${CAPACITY}, ${CAPACITY})`,
    );

    const index = (await (await get("/wall/r/0_0"))!.json()) as { f: string[] };
    expect(index.f).toEqual([chunkKey(chunk)]);
  });
});
