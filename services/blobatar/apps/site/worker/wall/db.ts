import {
  CAPACITY,
  cellIndex,
  chunkKey,
  chunkOf,
  type Cell,
  type Chunk,
} from "../../src/wall/geometry";
import type { Placement } from "../../src/wall/chunk";

/**
 * The wall's storage, as five queries.
 *
 * Raw prepared statements rather than an ORM, which is a decision about how
 * small this surface is rather than a position on ORMs: `wrangler d1
 * migrations` is first-party and there is no first-party ORM to pair with it,
 * `.bind()` is already parameterised, and everything the wall asks of a
 * database is in this file. If it ever outgrows that, `migrations_pattern` lets
 * wrangler apply drizzle-kit's output over the same migrations table, so
 * starting raw strands nothing.
 *
 * The types below are structural rather than imported from
 * `@cloudflare/workers-types`. The site's Worker has no dependencies and this
 * is the whole of D1 it touches; a shape this small is also what lets the tests
 * run the real queries against `bun:sqlite` instead of a mock.
 */

export type D1Result<T> = { results: T[] };
export type D1Meta = { changes: number };

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: D1Meta }>;
};

export type D1Database = {
  prepare(sql: string): D1PreparedStatement;
  /**
   * A real transaction: sequential, non-concurrent, and rolled back whole if
   * any statement fails. That is exactly the shape a placement needs — spend
   * the day's quota, claim the cell, bump the chunk's version — and it is why
   * the uniqueness constraints below can be the concurrency control rather than
   * something application code has to reason about.
   */
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

/** A stored placement, as the columns come back. */
type Row = {
  x: number;
  y: number;
  seed: string;
  expression: string;
  at: number;
};

/** A chunk's write counter and how full it is — everything the region index
 * serves, and what decides how a body may be cached. */
export type ChunkState = { key: string; version: number; count: number };

/**
 * Chunks per region side.
 *
 * The region is the unit the version index is served in, and it exists so that
 * the index has a *cacheable URL*. Keying it to the viewport — the chunks I can
 * currently see — would give every visitor a slightly different query string
 * and an edge cache that never hits, which is the opposite of the point: this
 * is the one request a visitor makes that cannot be immutable, so it has to be
 * the one request everybody makes together.
 *
 * Eight chunks is 256 cells. A 4K viewport at `MIN_ZOOM` spans about 107 cells,
 * so a viewport covers one region and straddles at most four, and panning
 * inside one costs nothing.
 */
export const REGION = 8;

export type Region = { rx: number; ry: number };

export const regionOf = (chunk: Chunk): Region => ({
  rx: Math.floor(chunk.cx / REGION),
  ry: Math.floor(chunk.cy / REGION),
});

/** The half-open chunk range a region covers, as a box. */
export const regionBounds = (region: Region) => ({
  cx0: region.rx * REGION,
  cy0: region.ry * REGION,
  cx1: region.rx * REGION + REGION - 1,
  cy1: region.ry * REGION + REGION - 1,
});

/**
 * Every occupied cell in a box, as cells rather than as chunks.
 *
 * This is the read behind a write: `isPlaceable` needs to know whether anything
 * occupied lies within `REACH`, and the box that answers it is `2 * REACH + 1`
 * on a side. Asking for the *chunks* covering that box would drag back up to
 * nine chunk-fulls of seeds and names — a thousand cells each — to answer a
 * question about distance. This asks for the cells, and returns only their
 * coordinates.
 */
export async function cellsIn(
  db: D1Database,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<Cell[]> {
  const { results } = await db
    .prepare("SELECT x, y FROM placements WHERE x BETWEEN ?1 AND ?2 AND y BETWEEN ?3 AND ?4")
    .bind(x0, x1, y0, y1)
    .all<{ x: number; y: number }>();
  return results;
}

/** One chunk's placements, in the wire order the encoder wants them. */
export async function chunkCells(db: D1Database, chunk: Chunk): Promise<Placement[]> {
  const { results } = await db
    .prepare(
      "SELECT x, y, seed, expression, at FROM placements WHERE cx = ?1 AND cy = ?2 ORDER BY at",
    )
    .bind(chunk.cx, chunk.cy)
    .all<Row>();
  return results.map(row => ({
    index: cellIndex(row.x, row.y),
    seed: row.seed,
    expression: row.expression,
    at: row.at,
  }));
}

/** A chunk's current write counter, or `null` if nobody has ever written to
 * it — which is also how "this chunk is empty" is spelled. */
export async function chunkState(db: D1Database, chunk: Chunk): Promise<ChunkState | null> {
  const row = await db
    .prepare("SELECT version, count FROM chunks WHERE cx = ?1 AND cy = ?2")
    .bind(chunk.cx, chunk.cy)
    .first<{ version: number; count: number }>();
  return row ? { key: chunkKey(chunk), version: row.version, count: row.count } : null;
}

/**
 * Every written chunk in a region, plus the wall's total placement count.
 *
 * The count travels with the index because the client cannot work out the one
 * thing it changes from anything else it holds: an occupancy predicate that
 * answers false everywhere means "nothing here" on an empty wall and "nothing
 * fetched yet" on a full one, and only the first of those puts the first
 * blobatar at the origin. One integer settles it.
 */
export async function regionIndex(db: D1Database, region: Region) {
  const box = regionBounds(region);
  const [chunks, total] = await Promise.all([
    db
      .prepare(
        "SELECT cx, cy, version, count FROM chunks" +
          " WHERE cx BETWEEN ?1 AND ?2 AND cy BETWEEN ?3 AND ?4",
      )
      .bind(box.cx0, box.cx1, box.cy0, box.cy1)
      .all<{ cx: number; cy: number; version: number; count: number }>(),
    db.prepare("SELECT v FROM meta WHERE k = 'placements'").first<{ v: number }>(),
  ]);
  return {
    chunks: chunks.results.map(row => ({
      key: chunkKey({ cx: row.cx, cy: row.cy }),
      version: row.version,
      count: row.count,
    })),
    placements: total?.v ?? 0,
  };
}

/** How many blobatars are on the wall at all. `0` is the state the rules call
 * "not populated", and it lasts exactly one placement. */
export async function wallSize(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT v FROM meta WHERE k = 'placements'").first<{ v: number }>();
  return row?.v ?? 0;
}

/** Has this address already placed today? The friendly half of the cooldown —
 * the half that actually enforces it is the primary key, below. */
export async function spentToday(
  db: D1Database,
  ipHash: string,
  day: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS n FROM quota WHERE ip_hash = ?1 AND day = ?2")
    .bind(ipHash, day)
    .first<{ n: number }>();
  return !!row;
}

/** Whoever is at this cell, or nobody. */
export async function placementAtCell(db: D1Database, at: Cell): Promise<Row | null> {
  return db
    .prepare("SELECT x, y, seed, expression, at FROM placements WHERE x = ?1 AND y = ?2")
    .bind(at.x, at.y)
    .first<Row>();
}

/**
 * The blobatars a token has placed, newest first.
 *
 * This is "Find mine" after a cleared browser or on a second device. The token
 * grants *finding*, not editing — there is no query in this file that takes one
 * and changes anything.
 */
export async function placementsFor(db: D1Database, tokenHash: string): Promise<Row[]> {
  const { results } = await db
    .prepare(
      "SELECT x, y, seed, expression, at FROM placements WHERE token_hash = ?1" +
        " ORDER BY at DESC LIMIT 8",
    )
    .bind(tokenHash)
    .all<Row>();
  return results;
}

export type NewPlacement = {
  cell: Cell;
  seed: string;
  expression: string;
  at: number;
  ipHash: string;
  day: string;
  tokenHash: string;
};

/**
 * A placement, or nothing at all.
 *
 * Four statements in one batch, and the order is the argument: the day's quota
 * is spent *before* the cell is claimed, so a race between two invocations of
 * this Worker on one address cannot spend once and place twice. Neither
 * uniqueness check is a `SELECT` first — a select-then-insert does not survive
 * two concurrent Workers, and letting the insert fail does.
 *
 * The chunk's version is bumped in the same transaction, because a placement
 * that lands without one is a cell nobody will fetch for a year: every client
 * holding that chunk body has it under an immutable URL and only the version
 * tells them to ask again.
 */
export function placeStatements(db: D1Database, placement: NewPlacement): D1PreparedStatement[] {
  const chunk = chunkOf(placement.cell.x, placement.cell.y);
  return [
    db.prepare("INSERT INTO quota (ip_hash, day) VALUES (?1, ?2)").bind(placement.ipHash, placement.day),
    db
      .prepare(
        "INSERT INTO placements (x, y, cx, cy, seed, expression, at, ip_hash, token_hash)" +
          " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      )
      .bind(
        placement.cell.x,
        placement.cell.y,
        chunk.cx,
        chunk.cy,
        placement.seed,
        placement.expression,
        placement.at,
        placement.ipHash,
        placement.tokenHash,
      ),
    db
      .prepare(
        "INSERT INTO chunks (cx, cy, version, count) VALUES (?1, ?2, 1, 1)" +
          " ON CONFLICT (cx, cy) DO UPDATE SET version = version + 1, count = count + 1",
      )
      .bind(chunk.cx, chunk.cy),
    db.prepare(
      "INSERT INTO meta (k, v) VALUES ('placements', 1)" +
        " ON CONFLICT (k) DO UPDATE SET v = v + 1",
    ),
  ];
}

/**
 * Moderation's half of the story: the row goes, the version still climbs.
 *
 * A delete is a write to the chunk like any other — clients are holding the
 * body that contains the slur under a URL cached for a year, and the only thing
 * that reaches them is a new version. The `count` comes down with it, because a
 * chunk that was full and is now not must stop being treated as frozen.
 *
 * What deliberately does *not* happen is the quota row coming back. Having a
 * placement removed is not a refund; the address that wrote it has still spent
 * its day.
 */
export function removeStatements(db: D1Database, at: Cell): D1PreparedStatement[] {
  const chunk = chunkOf(at.x, at.y);
  return [
    db.prepare("DELETE FROM placements WHERE x = ?1 AND y = ?2").bind(at.x, at.y),
    db
      .prepare(
        "UPDATE chunks SET version = version + 1, count = MAX(count - 1, 0)" +
          " WHERE cx = ?1 AND cy = ?2",
      )
      .bind(chunk.cx, chunk.cy),
    db.prepare("UPDATE meta SET v = MAX(v - 1, 0) WHERE k = 'placements'"),
  ];
}

/** A chunk holding every cell it has can never be written to again, so its body
 * is `immutable` outright rather than merely versioned. */
export const isFullCount = (count: number) => count >= CAPACITY;
