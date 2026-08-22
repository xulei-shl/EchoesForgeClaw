-- The wall.
--
-- Four tables, and three of them exist to be raced against: every uniqueness
-- rule the wall has is a constraint here rather than a check in application
-- code, because a SELECT-then-INSERT does not survive two Worker invocations
-- arriving at once and a failed INSERT does. See ADR 0011.
--
-- Nothing is seeded. The first blobatar is placed by a person and goes at the
-- origin by rule; an empty wall is a state the rules express, and it lasts
-- exactly one placement.

-- A blobatar, where somebody left it.
--
-- Keyed by absolute cell, which makes "two people racing for one cell" a
-- primary key violation rather than a paragraph of logic. `cx`/`cy` are the
-- cell's chunk, stored rather than computed: SQLite has no floor-division
-- operator that agrees with `chunkOf` on negative coordinates, and the wall
-- extends in every direction, so the one query that runs on every read — give
-- me this chunk — would otherwise be an expression the index cannot use.
CREATE TABLE placements (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  cx INTEGER NOT NULL,
  cy INTEGER NOT NULL,
  seed TEXT NOT NULL,
  expression TEXT NOT NULL,
  -- Whole seconds. Nothing on this wall is finer than a day's cooldown.
  at INTEGER NOT NULL,
  -- `CF-Connecting-IP` hashed with a secret and the date, so no raw address is
  -- stored and the value stops being derivable once the day is over.
  ip_hash TEXT NOT NULL,
  -- The cookie token, hashed. It grants finding, not editing.
  token_hash TEXT NOT NULL,
  PRIMARY KEY (x, y)
);

-- The read path: one chunk, every time anybody looks at the wall.
CREATE INDEX placements_by_chunk ON placements (cx, cy);

-- "Find mine" on a second device or after a cleared browser.
CREATE INDEX placements_by_token ON placements (token_hash);

-- One blob per address per day, enforced by the key.
--
-- Its own table rather than an index on `placements`, and that is the whole
-- reason it exists: if the constraint lived on the placement row, deleting a
-- slur would hand its author the day back. Moderation is not a refund.
--
-- Rows here are unreachable once the day passes — `ip_hash` is salted with the
-- date, so yesterday's hash cannot be recomputed even from the same address.
CREATE TABLE quota (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (ip_hash, day)
);

-- A chunk's write counter, which is what makes its body cacheable forever.
--
-- `version` climbs on every write to the chunk, placements and moderation
-- deletes alike, and never decrements. The URL carries it (`/wall/c/3_4/812`),
-- so a body is fetched at most once by a client, ever, and learning which
-- version is current costs one small region request rather than one per chunk.
--
-- `count` is the optimisation on top: a chunk holding all 1024 cells can never
-- change again, so a client that has it can pin it and stop asking.
CREATE TABLE chunks (
  cx INTEGER NOT NULL,
  cy INTEGER NOT NULL,
  version INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (cx, cy)
);

-- One integer the client cannot derive: how many blobatars exist at all.
--
-- Zero is "not populated", which is the only state in which the origin is
-- placeable and reach means nothing. A table rather than a `COUNT(*)` because
-- it is read on every region index and would otherwise be a full scan of the
-- one table that grows forever.
CREATE TABLE meta (
  k TEXT NOT NULL PRIMARY KEY,
  v INTEGER NOT NULL
);
