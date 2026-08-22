import { decodeChunk, isFull, type ChunkBody, type Placement } from "./chunk";
import { chunkKey, type Cell, type Chunk } from "./geometry";

/**
 * Where the wall comes from.
 *
 * The client's half of the caching arrangement in ADR 0011, and it is mostly an
 * exercise in not asking. A chunk body's URL contains its version and the body
 * is `immutable` for a year, so the browser cache answers a second request for
 * one without a network round trip — which means the only thing this has to be
 * careful about is *which version to ask for*, and that comes from a region
 * index it re-reads every thirty seconds at most.
 *
 * Two consequences worth stating, because they look like bugs from the outside:
 * a stranger's blobatar takes up to half a minute to appear, and your own
 * appears instantly because the canvas draws it optimistically rather than
 * because this fetched it back.
 */

/** The wall as a source answers it: the bodies held, and whether the wall has
 * anything on it at all. */
export type Wall = {
  chunks: Map<string, ChunkBody>;
  /** How many blobatars exist, across the whole wall rather than the part in
   * view. Zero is the state where the origin is the only placeable cell — the
   * one thing occupancy cannot tell a client on its own. */
  size: number;
};

export type Source = {
  /**
   * Bring these chunks up to date, and say whether anything changed.
   *
   * `false` means the caller has nothing to redraw, which is the common case
   * on a pan: the region index is fresh, every chunk under the viewport is
   * held at its current version, and this resolves without touching the
   * network.
   */
  load(chunks: Chunk[]): Promise<boolean>;
  wall(): Wall;
  /**
   * A cell claimed locally, before — and regardless of — the server hearing
   * about it.
   *
   * The canvas draws from these bodies, so this is what makes a placement
   * appear under the pointer rather than after a round trip. Until the region
   * index catches up, the chunk it landed in is held back from being refetched:
   * a body fetched at the old version would be the wall *without* the blobatar
   * somebody just placed, arriving a moment after they placed it and taking it
   * away again.
   */
  claim(chunk: Chunk, placement: Placement): void;
};

/** How long a region's version list is trusted. Matches the `max-age` the
 * Worker sets, so this is a courtesy to the edge rather than a second cache
 * policy that could disagree with it. */
const INDEX_MS = 30_000;

/** Chunks per region side. The same number as the Worker's `REGION`, and the
 * one constant genuinely duplicated across the two: importing it would pull the
 * D1 module's types into the browser bundle to learn one integer. */
const REGION = 8;

const regionKey = (chunk: Chunk) =>
  `${Math.floor(chunk.cx / REGION)}_${Math.floor(chunk.cy / REGION)}`;

type Index = { at: number; versions: Record<string, number>; full: Set<string>; size: number };

/**
 * `now` is injectable for one reason: the thirty-second index TTL is a
 * behaviour worth testing — a pan inside it must cost nothing, and a placement
 * must survive it — and a test that waits half a minute to assert that is a
 * test nobody runs.
 */
export function createSource(base = "", now: () => number = Date.now): Source {
  const chunks = new Map<string, ChunkBody>();
  const indexes = new Map<string, Index>();
  /** Chunks known to be full, which can never change again and are therefore
   * never asked about a second time. */
  const frozen = new Set<string>();
  const inFlight = new Map<string, Promise<unknown>>();
  /**
   * Chunks holding a placement the server has not confirmed, against the
   * version they were at when it was made. They stop being pending when the
   * index shows a version past that one, which is the only evidence available
   * that the write actually landed.
   */
  const pending = new Map<string, number>();
  let size = 0;

  /** One request per key at a time. Panning back and forth across a boundary
   * asks for the same chunk repeatedly, and without this each ask is a fetch. */
  const once = <T>(key: string, work: () => Promise<T>) => {
    const running = inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const started = work().finally(() => inFlight.delete(key));
    inFlight.set(key, started);
    return started;
  };

  const readIndex = async (key: string) => {
    const held = indexes.get(key);
    if (held && now() - held.at < INDEX_MS) return held;
    return once(`r:${key}`, async () => {
      const response = await fetch(`${base}/wall/r/${key}`);
      if (!response.ok) return held ?? { at: 0, versions: {}, full: new Set<string>(), size };
      const body = (await response.json()) as {
        n?: number;
        v?: Record<string, number>;
        f?: string[];
      };
      const index: Index = {
        at: now(),
        versions: body.v ?? {},
        full: new Set(body.f ?? []),
        size: body.n ?? 0,
      };
      indexes.set(key, index);
      // The wall's size is a property of the wall, not of the region that
      // happened to report it. Whichever index answered last is as good as any:
      // it is read to decide whether the wall is empty at all, and it stops
      // being zero exactly once.
      size = Math.max(size, index.size);
      for (const full of index.full) frozen.add(full);
      return index;
    });
  };

  const readChunk = async (chunk: Chunk, version: number, force = false) => {
    const key = chunkKey(chunk);
    const held = chunks.get(key);
    if (!force && held && held.version === version) return false;
    return once(`c:${key}:${version}`, async () => {
      const response = await fetch(`${base}/wall/c/${key}/${version}`);
      if (!response.ok) return false;
      // `decodeChunk` returns `null` for a body it does not understand, which
      // is not paranoia: these come out of a cache this code cannot invalidate,
      // so a shape that changes will meet last year's payload eventually. A
      // body that fails to parse is dropped rather than half-drawn, and the
      // next index turnover asks again.
      const body = decodeChunk(await response.text());
      if (!body) return false;
      chunks.set(key, body);
      if (isFull(body)) frozen.add(key);
      return true;
    });
  };

  return {
    async load(wanted: Chunk[]) {
      const needed = wanted.filter(chunk => !frozen.has(chunkKey(chunk)));
      if (!needed.length) return false;

      const regions = [...new Set(needed.map(regionKey))];
      const seen = new Map(
        await Promise.all(regions.map(async key => [key, await readIndex(key)] as const)),
      );

      const changed = await Promise.all(
        needed.map(chunk => {
          const key = chunkKey(chunk);
          const index = seen.get(regionKey(chunk));
          // A chunk with no entry in its region's index has never been written
          // to. That is an answer, not a miss: it is empty, and asking the
          // Worker to say so costs a request to learn nothing.
          const version = index?.versions[key] ?? 0;

          const waiting = pending.get(key);
          if (waiting !== undefined) {
            // Still ours to draw. The index is up to thirty seconds behind, and
            // for that long the optimistic body is the more truthful of the two.
            if (version <= waiting) return false;
            pending.delete(key);
            // Forced, because the optimistic body may already be *numbered* at
            // the version now being served — it was written locally by adding
            // one — and a version check would take that for a hit and leave
            // everybody else's placements out of it.
            return readChunk(chunk, version, true);
          }

          if (!version) {
            chunks.delete(key);
            return false;
          }
          return readChunk(chunk, version);
        }),
      );
      return changed.some(Boolean);
    },

    wall: () => ({ chunks, size }),

    claim(chunk, placement) {
      const key = chunkKey(chunk);
      const held = chunks.get(key) ?? { key, version: 0, cells: [] };
      // The version this chunk was at before the claim, which is what tells us
      // later whether the server has caught up. Recorded once: a second claim
      // in the same chunk must not move the goalpost to a version that already
      // includes the first.
      if (!pending.has(key)) pending.set(key, held.version);
      chunks.set(key, { ...held, version: held.version + 1, cells: [...held.cells, placement] });
      size += 1;
    },
  };
}


/**
 * What the server said about a placement.
 *
 * Every refusal is one the interface has something to say about, which is why
 * they are named rather than reduced to a status code: a cooldown is a wait, a
 * taken cell is a nudge to the cell beside it, and a refused name is the only
 * one the visitor can fix by typing.
 */
export type Placed =
  | { ok: true; cell: Cell; at: number; seed: string }
  | { ok: false; why: "cooldown"; until: number }
  | { ok: false; why: "taken" }
  | { ok: false; why: "unplaceable"; nearest: Cell | null }
  | { ok: false; why: "name" | "challenge" | "closed" | "offline" };

/**
 * Leave a blobatar on the wall.
 *
 * Deliberately not a method on `Source`: a source is the wall as this browser
 * holds it, and this is a thing that happens to the wall itself. The caller
 * claims the cell locally on success — `claim` — rather than this doing it,
 * because what makes the wall feel like a wall is that the placement is drawn
 * before anybody has heard back, and the two steps should be visibly separate.
 *
 * `credentials: "same-origin"` is the default and is stated anyway: the cookie
 * this sets and reads is the whole of "Find mine" on a second device.
 */
export async function submit(
  input: { cell: Cell; seed: string; expression: string; turnstile: string },
  base = "",
): Promise<Placed> {
  let response: Response;
  try {
    response = await fetch(`${base}/wall/place`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        x: input.cell.x,
        y: input.cell.y,
        seed: input.seed,
        expression: input.expression,
        turnstile: input.turnstile,
      }),
    });
  } catch {
    return { ok: false, why: "offline" };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 201) {
    return {
      ok: true,
      cell: { x: body.x as number, y: body.y as number },
      at: body.at as number,
      // The name as *stored*, which is the trimmed one. Drawing the untrimmed
      // string would seed a different blobatar than the wall now holds.
      seed: body.seed as string,
    };
  }
  if (response.status === 429) return { ok: false, why: "cooldown", until: (body.until as number) ?? 0 };
  if (response.status === 409 && body.error === "unplaceable") {
    return { ok: false, why: "unplaceable", nearest: (body.nearest as Cell) ?? null };
  }
  if (response.status === 409) return { ok: false, why: "taken" };
  if (response.status === 422) return { ok: false, why: "name" };
  if (response.status === 403) return { ok: false, why: "challenge" };
  return { ok: false, why: "closed" };
}

/**
 * Where your blobatars are, according to the cookie.
 *
 * The slow path of the locate control, for a device that has never placed
 * anything — `localStorage` is the fast one and answers without a request.
 */
export async function findMine(base = ""): Promise<Cell[]> {
  try {
    const response = await fetch(`${base}/wall/mine`, { credentials: "same-origin" });
    if (!response.ok) return [];
    const body = (await response.json()) as { cells?: Cell[] };
    return body.cells ?? [];
  } catch {
    return [];
  }
}
