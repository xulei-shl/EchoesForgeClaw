import { CAPACITY, cellAt, cellKey, chunkKey, type Cell, type Chunk } from "./geometry";

/**
 * What a chunk looks like on the wire, and how a client turns a pile of them
 * into the occupancy the rules in `geometry.ts` ask for.
 *
 * The format is the contract between three things that are otherwise unaware of
 * each other: the D1 rows, the Worker that serialises them, and the canvas that
 * draws them. It is deliberately small — this is the payload a visitor
 * downloads two to four of before the wall appears.
 */

/**
 * One blobatar, as stored.
 *
 * `index` rather than a coordinate pair: the chunk already knows where it is,
 * so repeating it a thousand times over is a thousand redundant integers. The
 * expression is its *name*, not an id into a table — a numeric id would be an
 * ordering contract with every row ever written, where a reordered table
 * silently repaints the whole wall with the wrong faces. Six bytes is a cheap
 * price for never having that migration.
 *
 * `at` is whole seconds since the epoch, which is what lets a click on somebody
 * else's blob answer the two questions a wall of strangers invites: who, and
 * when. Seconds rather than milliseconds because nothing here is finer than a
 * day's cooldown, and a JSON number three digits shorter, a thousand to a
 * chunk, is worth having.
 */
export type Placement = {
  index: number;
  seed: string;
  expression: string;
  at: number;
};

/** A chunk as served. `version` is the write counter that makes the URL
 * immutable and the body cacheable forever; see ADR 0011. */
export type ChunkBody = {
  key: string;
  version: number;
  cells: Placement[];
};

/**
 * The wire form: tuples, not objects.
 *
 * A full chunk is a thousand of these, and `{"index":512,"seed":...}` spends
 * more bytes naming its fields than carrying them. The shape is asserted in one
 * place — here — so nothing downstream has to know it is positional.
 */
type Wire = [index: number, seed: string, expression: string, at: number];

export function encodeChunk(body: ChunkBody): string {
  return JSON.stringify({
    k: body.key,
    v: body.version,
    c: body.cells.map((p): Wire => [p.index, p.seed, p.expression, p.at]),
  });
}

/**
 * Parses a chunk body, or returns `null`.
 *
 * Defensive about its own format on purpose. These bodies are cached for a year
 * under an immutable URL, in a browser cache this code cannot reach and cannot
 * invalidate — a shape that changes has to survive meeting last year's payload,
 * and the only safe way to fail is to discard it and refetch rather than to
 * draw half a chunk of undefined.
 *
 * The expression is not checked against a roster here. Doing so would mean
 * importing every pose the wall might ever show into the client bundle, which
 * is precisely what ADR-0002 made expressions values to avoid; the client maps
 * the names its own picker offers and treats anything else as `idle`.
 */
export function decodeChunk(text: string): ChunkBody | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const { k, v, c } = raw as { k?: unknown; v?: unknown; c?: unknown };
  if (typeof k !== "string" || !Number.isInteger(v) || !Array.isArray(c)) return null;

  const cells: Placement[] = [];
  for (const entry of c) {
    if (!Array.isArray(entry) || entry.length !== 4) return null;
    const [index, seed, expression, at] = entry as Wire;
    if (!Number.isInteger(index) || index < 0 || index >= CAPACITY) return null;
    if (typeof seed !== "string" || !seed || typeof expression !== "string") return null;
    if (!Number.isInteger(at) || at < 0) return null;
    cells.push({ index, seed, expression, at });
  }
  return { key: k, version: v as number, cells };
}

/** A placement's absolute cell, which is the chunk's own position plus the slot
 * the row was stored in. */
export function placedAt(chunk: Chunk, placement: Placement): Cell {
  return cellAt(chunk, placement.index);
}

/**
 * A chunk's occupancy count, which is what decides how it may be cached: a
 * chunk holding every cell it has can never be written to again, so it is
 * `immutable` outright rather than merely versioned.
 */
export const isFull = (body: ChunkBody) => body.cells.length >= CAPACITY;

/**
 * The loaded wall, as the predicate `geometry.ts` asks for.
 *
 * Note what this deliberately cannot tell you: a cell in a chunk that has not
 * been fetched answers "empty", the same as a cell that genuinely is. That
 * ambiguity is why `isPlaceable` takes `populated` separately, and why the
 * caller — not this map — is responsible for knowing which chunks it holds.
 */
export function occupancyOf(chunks: Map<string, ChunkBody>) {
  const taken = new Set<string>();
  for (const [key, body] of chunks) {
    const [cx, cy] = key.split("_").map(Number) as [number, number];
    for (const placement of body.cells) {
      const cell = cellAt({ cx, cy }, placement.index);
      taken.add(cellKey(cell.x, cell.y));
    }
  }
  return (x: number, y: number) => taken.has(cellKey(x, y));
}

/**
 * The placement in a cell, or `null` if nobody is there.
 *
 * What a click on an occupied cell resolves to. Linear over the chunk's own
 * cells rather than through an index: a chunk holds at most a thousand, this
 * runs once per click, and an index would be a second structure to keep in step
 * with every write for no measurable gain.
 */
export function placementAt(
  chunks: Map<string, ChunkBody>,
  chunk: Chunk,
  index: number,
): Placement | null {
  const body = chunks.get(chunkKey(chunk));
  return body?.cells.find((placement) => placement.index === index) ?? null;
}

/** Every placement across the loaded chunks, with its absolute cell — the
 * draw list, in whatever order the chunks arrived. */
export function* placements(chunks: Map<string, ChunkBody>): Generator<Cell & Placement> {
  for (const [key, body] of chunks) {
    const [cx, cy] = key.split("_").map(Number) as [number, number];
    for (const placement of body.cells) {
      const cell = cellAt({ cx, cy }, placement.index);
      yield { ...placement, x: cell.x, y: cell.y };
    }
  }
}

/** Convenience for building the map the two functions above read. */
export const chunkMap = (bodies: ChunkBody[]) =>
  new Map(bodies.map((body) => [body.key, body]));

export { chunkKey };
