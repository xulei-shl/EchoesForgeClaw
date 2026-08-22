import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { encodeChunk } from "./chunk";
import { CAPACITY, cellIndex } from "./geometry";
import { createSource } from "./source";

/**
 * The fetching half of the wall, against a scripted server.
 *
 * What is being asserted here is mostly *absence*: which requests do not
 * happen. The wall puts a fetch in the second section of the landing page,
 * which the site's whole deployment is arranged to avoid (ADR 0011), so "this
 * pan cost nothing" is the behaviour rather than an optimisation on top of it.
 */

const realFetch = globalThis.fetch;
let asked: string[] = [];

/** A server that holds one region and answers from it. */
function server(state: {
  versions?: Record<string, number>;
  full?: string[];
  size?: number;
  cells?: Record<string, { seed: string; index: number }[]>;
}) {
  asked = [];
  globalThis.fetch = (async (input: string) => {
    const path = String(input);
    asked.push(path);
    const region = /^\/wall\/r\/(.+)$/.exec(path);
    if (region) {
      return new Response(
        JSON.stringify({
          r: region[1],
          n: state.size ?? 0,
          v: state.versions ?? {},
          f: state.full ?? [],
        }),
      );
    }
    const chunk = /^\/wall\/c\/(.+)\/(\d+)$/.exec(path)!;
    const key = chunk[1]!;
    return new Response(
      encodeChunk({
        key,
        version: Number(chunk[2]),
        cells: (state.cells?.[key] ?? []).map(each => ({
          index: each.index,
          seed: each.seed,
          expression: "idle",
          at: 1,
        })),
      }),
    );
  }) as typeof fetch;
}

beforeEach(() => {
  asked = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ORIGIN = { cx: 0, cy: 0 };

/** A clock the tests move by hand, so that "the index is thirty seconds stale"
 * is a line rather than a wait. */
function clock() {
  let at = 1_000_000;
  return Object.assign(() => at, { pass: (ms: number) => (at += ms) });
}

describe("loading", () => {
  test("an empty wall costs one request and nothing else", async () => {
    server({});
    const source = createSource();
    expect(await source.load([ORIGIN, { cx: 1, cy: 0 }])).toBe(false);
    // The region index said neither chunk has ever been written to, which is an
    // answer. Asking the Worker to confirm it would be two requests to learn
    // nothing.
    expect(asked).toEqual(["/wall/r/0_0"]);
    expect(source.wall().size).toBe(0);
  });

  test("a chunk is fetched at the version the index names", async () => {
    server({ versions: { "0_0": 7 }, size: 3, cells: { "0_0": [{ index: 0, seed: "alain" }] } });
    const source = createSource();
    expect(await source.load([ORIGIN])).toBe(true);
    expect(asked).toEqual(["/wall/r/0_0", "/wall/c/0_0/7"]);

    const wall = source.wall();
    expect(wall.size).toBe(3);
    expect(wall.chunks.get("0_0")!.cells[0]!.seed).toBe("alain");
  });

  test("panning back over a chunk already held asks for nothing", async () => {
    server({ versions: { "0_0": 7 }, cells: { "0_0": [{ index: 0, seed: "alain" }] } });
    const source = createSource();
    await source.load([ORIGIN]);
    asked = [];
    expect(await source.load([ORIGIN])).toBe(false);
    // The index is good for thirty seconds and the body is held at its current
    // version, so a pan across a boundary and back is free.
    expect(asked).toEqual([]);
  });

  test("a full chunk is never asked about again", async () => {
    const cells = Array.from({ length: CAPACITY }, (_, index) => ({ index, seed: "someone" }));
    server({ versions: { "0_0": 9 }, full: ["0_0"], size: CAPACITY, cells: { "0_0": cells } });
    const source = createSource();
    await source.load([ORIGIN]);
    asked = [];
    // 1024 of 1024 can never change, so it is pinned rather than versioned —
    // not even the region index is consulted for it.
    expect(await source.load([ORIGIN])).toBe(false);
    expect(asked).toEqual([]);
  });

  test("two loads of the same chunk in flight are one request", async () => {
    server({ versions: { "0_0": 7 }, cells: { "0_0": [{ index: 0, seed: "alain" }] } });
    const source = createSource();
    await Promise.all([source.load([ORIGIN]), source.load([ORIGIN])]);
    expect(asked.filter(path => path.startsWith("/wall/c/"))).toEqual(["/wall/c/0_0/7"]);
  });

  test("a body it cannot parse is discarded rather than half-drawn", async () => {
    server({ versions: { "0_0": 7 } });
    globalThis.fetch = (async (input: string) =>
      String(input).startsWith("/wall/c/")
        ? new Response("{\"k\":\"0_0\",\"v\":7,\"c\":[[0,\"alain\"]]}")
        : new Response(JSON.stringify({ r: "0_0", n: 1, v: { "0_0": 7 }, f: [] }))) as typeof fetch;

    const source = createSource();
    expect(await source.load([ORIGIN])).toBe(false);
    expect(source.wall().chunks.has("0_0")).toBe(false);
  });
});

describe("claiming a cell", () => {
  const placement = { index: cellIndex(2, 2), seed: "vera", expression: "happy", at: 100 };

  test("the placement is there before the server has heard of it", async () => {
    server({ versions: { "0_0": 7 }, size: 1, cells: { "0_0": [{ index: 0, seed: "alain" }] } });
    const source = createSource();
    await source.load([ORIGIN]);

    source.claim(ORIGIN, placement);
    expect(source.wall().chunks.get("0_0")!.cells).toHaveLength(2);
    expect(source.wall().size).toBe(2);
  });

  test("a stale index does not take it away again", async () => {
    server({ versions: { "0_0": 7 }, cells: { "0_0": [{ index: 0, seed: "alain" }] } });
    const source = createSource();
    await source.load([ORIGIN]);
    source.claim(ORIGIN, placement);

    // The index is up to thirty seconds behind the write, so it still says 7 —
    // and the body at 7 is the wall without this blobatar in it. Fetching it
    // would show somebody their own placement being undone.
    server({ versions: { "0_0": 7 }, cells: { "0_0": [{ index: 0, seed: "alain" }] } });
    await source.load([ORIGIN]);
    expect(source.wall().chunks.get("0_0")!.cells).toHaveLength(2);
  });

  test("and the version moving on is what settles it", async () => {
    const later = clock();
    server({ versions: { "0_0": 7 }, cells: { "0_0": [{ index: 0, seed: "alain" }] } });
    const source = createSource("", later);
    await source.load([ORIGIN]);
    source.claim(ORIGIN, placement);

    // The write landed, and somebody else's did too. The refetch is forced:
    // the optimistic body was numbered 8 locally, which is the version now
    // being served, and a version check alone would take that for a hit.
    later.pass(31_000);
    server({
      versions: { "0_0": 9 },
      cells: {
        "0_0": [
          { index: 0, seed: "alain" },
          { index: placement.index, seed: "vera" },
          { index: 40, seed: "someone-else" },
        ],
      },
    });
    expect(await source.load([ORIGIN])).toBe(true);
    expect(source.wall().chunks.get("0_0")!.cells).toHaveLength(3);
  });

  test("the first blobatar on an empty wall survives the same lag", async () => {
    server({});
    const source = createSource();
    await source.load([ORIGIN]);
    source.claim(ORIGIN, { ...placement, index: 0 });

    // The region index still has no entry for this chunk at all, which is how
    // "never written to" is spelled — and would delete the body if the claim
    // were not being held.
    await source.load([ORIGIN]);
    expect(source.wall().chunks.get("0_0")!.cells).toHaveLength(1);
    expect(source.wall().size).toBe(1);
  });
});
