# The wall is participatory

The second section of the landing page is a field of blobatars. Today that field
is generated: `apps/site/src/components/Wall.tsx` scatters ~63 blobs on a
jittered grid from `Math.random()` and a local name list. It is decoration
standing in for an argument — the section claims the library produces endless
distinct avatars, and backs the claim with data it made up.

It becomes a real wall. A visitor clicks an empty cell, types a name, picks an
expression, and their blobatar is there — for everyone, permanently.

The reason is not community features. It is that a seed-derived avatar library
has exactly one thing to demonstrate, and this demonstrates it: you type a
string, and the blobatar that appears is deterministically *yours*, the same one
the library would give your app for that string. No copy makes that point as
well as watching it happen. The generated field asserts; the wall shows.

## The medium is occupancy, not colour

The wall is a dense uniform lattice — blobs packed edge to edge with a thin
gutter, no jitter, no rotation, no parallax. The scattered field it replaces was
decoration and read as one; this reads as a surface people are filling in.

A blob's palette comes from its seed and the seed is a name, so **nobody chooses
their colour**, and that is a decision rather than a limitation to work around.
The alternative — a tone picker beside the name field — buys controllable
painting at the cost of the one thing this section exists to demonstrate, that
the avatar is a pure function of the string. Colour stays derived.

What that leaves as the medium is *placement*. A word on this wall is not
painted in colour, it is drawn in occupancy: blobs present against empty wall,
silhouette rather than paint, legible only from far enough out. Which reverses
one of this document's earlier arguments — the empty regions past the crowd are
not voids to be designed away, they are the canvas. Generous reach is what makes
them reachable, and a stroke can be walked outward a cell at a time because each
new blob only has to be within reach of the last.

Placement is permanent. A cell nobody can take back is what makes a finished
shape mean anything, and it is why the cooldown below is a rule of the game
rather than a defence against abuse.

## The wall is the call to action

There is no button introducing it. The affordance is the wall itself: hovering
an empty cell renders a translucent ghost blob in it, which reads as "this could
be yours" without a word of copy. Once a name is typed the ghost becomes the
actual blobatar, live and in place, before anything is committed — the product
demo happens inside the interaction rather than next to it.

Empty and occupied cells are different targets. Occupied shows whose it is;
empty places.

> **Picking a cell dims the wall.** The panel that asks for a name was a popover
> anchored to the cell, and a popover has to compete with several hundred
> blobatars for the eye — it can only win by shouting. Dimming ends the
> competition instead: a scrim between the canvas and the one cell that is DOM
> rather than pixels, so the picked blobatar is the only lit thing on screen and
> everything else recedes to context. The wall stays visible through it at three
> quarters, because "you found a nice spot" means nothing if you cannot see what
> the spot is next to.
>
> What that costs is the spatial link — a panel docked to the side is not
> pointing at anything — so the camera flies the cell to a known point and a
> hand-drawn arrow curves from the panel to it. The arrow is the only element
> doing a job neither the copy nor the layout can do: it says *that one*.
>
> The copy goes with it. One hand-lettered heading ("You found a nice spot!"),
> the name as a signature under it rather than a labelled field, and the
> expression asked as a question with all fourteen faces in a strip below —
> fourteen blobatars of the name being typed, changing together as you type,
> which is the library's whole argument happening inside the control. The
> hand-lettered face is 8 KB, subset to the characters of that one sentence.
>
> Asking *who somebody is* keeps the small anchored card. The two targets get
> two different weights on purpose: placing is what this section is for and
> takes the screen; a passing curiosity should cost nothing.

## Positions snap to a grid, and growth is bounded to the frontier

Free positioning was rejected on appearance: raw coordinates clump, and the
current component already exists because of that (its jittered grid is the
workaround). Snapping makes `(cx, cy, cell)` the identity of a placement, which
also hands us collision handling for free — two people racing for one cell is
resolved by a unique constraint rather than by application logic.

The wall is pannable and unbounded, but placement is bounded by the crowd: a
cell is placeable if it lies within R cells of an occupied one. Unbounded
placement on an unbounded plane produces permanent voids and a wall that is
mostly emptiness.

R is deliberately **generous** — far enough to strike out into open wall and
start something there, not so far that a blob can be planted where nobody will
ever pan to find it. Standing alone is one use of that room; the more
interesting one is a group agreeing on somewhere empty and spelling a word into
it, a cell at a time. The mass stays a mass not because the rule is tight but because the
gravity is: *Add yours* aims at the dense edge by default, and going out is
something you do on purpose, by panning, against a hint that says how far you
have gone. A wall with a dense core, a few hermits, and a half-finished word out
in the quiet reads as inhabited rather than as generated. The core will
eventually grow past the drawings and swallow them, which is a feature of the
same kind: the wall has a history you can see.

A visitor who starts placing beyond R is panned back to the nearest placeable
ground — an affordance about to be refused should never have been offered.

> **R is 32**, set before the first write and not by an argument about
> loneliness. Reach is also the spacing of the stones when a group walks out
> into the quiet to draw something, and at 16 the fixture's two-letter word cost
> five stones before the first letter — five people, at one blob a day each. 32
> halves every bridge on the wall. It is one cell short of `CHUNK`, which bounds
> a reach box to three chunks per axis; the write path queries the cell box
> directly rather than reading those chunks, so that bound is a size limit on
> one query rather than a read count. A wall built under one reach cannot be
> re-walked under another, which is why the number was settled while the wall
> was still empty.

Nothing is seeded. The first blobatar is placed by a person, and it goes at the
origin by rule, which is what anchors the wall's coordinate system to it rather
than to an arbitrary zero. Seeding a founding drawing was considered and
rejected: on a dense lattice a generated blob is indistinguishable from a real
placement, so it would be claiming strangers who do not exist while occupying
cells nobody can ever have. An empty wall on the first day is honest, and it
lasts one placement.

## Chunks of 32x32, and why full chunks are the whole design

The wall is fetched in 32x32-cell chunks (~2560px square at the current cell
size). A viewport spans one to two of them across and one down, so first paint
is two to four requests. 16x16 chunks were rejected: they double the request
count without meaningfully reducing payload, since a chunk carries only its
occupied cells — a local cell index, a seed, and an expression byte, roughly
16 bytes each, a few KB gzipped even when full.

Chunks are cached **by version, not by fullness**. Each chunk carries a write
counter, the URL contains it (`/wall/c/3_4/812`), and the body is `immutable`
for a year — so any given chunk body is fetched at most once by a client, ever.
Learning which version is current costs one small request per region: an index
returning `{"3_4":812,"3_5":37,…}` for the chunks around the viewport, a few
bytes an entry, 30 seconds at the edge. First paint is that index plus two to
four bodies; panning inside the region is free, and a chunk already held at its
current version is never refetched. A stranger's blob therefore appears within
half a minute, which is invisible on a wall — the placer sees their own
immediately, optimistically, client-side.

An earlier draft keyed cacheability to occupancy instead: a chunk with all 1024
cells taken can never change, so it could be frozen with no versioning at all.
Generous growth undermines that. People spread rather than pack, so chunks
linger at nine-tenths full indefinitely and the freeze seldom triggers. Full
chunks still get the treatment — they need no index entry and can be pinned
client-side forever — but as an optimisation on top of versioning rather than as
the mechanism itself.

The rejected alternative is a single global version in every chunk URL: one
placement anywhere invalidates every URL at once.

> **The index is served per region, not per viewport.** "The chunks around the
> viewport" has no cacheable URL — every visitor's viewport is a slightly
> different query string, and the one request here that cannot be immutable is
> precisely the one that has to be shared. So the plane is cut into fixed
> regions of 8×8 chunks and the index is `/wall/r/<rx>_<ry>`: a viewport covers
> one and straddles at most four, and everybody looking at the same part of the
> wall asks for the same URL. Full chunks stay *in* the index, marked, rather
> than being omitted — a client that already holds one pins it and stops asking,
> but a client that has never fetched it cannot tell an absent entry meaning
> "frozen" from an absent entry meaning "empty". The index also carries the
> wall's total placement count, which is the one thing occupancy cannot answer
> for a browser: no cells here means an empty wall to the Worker and an
> unfetched one to a client, and only the first of those puts the next blobatar
> at the origin.

This matters because `apps/site/wrangler.jsonc` is built around assets being
free and Worker requests being billed — `run_worker_first` is scoped to
`/avatar/*` precisely so that reading the site costs nothing. Putting a fetch in
the second section of the landing page spends that deliberately. Caching by
occupancy is how it is paid back: a visitor costs a handful of D1 reads on
arrival and approximately nothing thereafter. Storage was never the constraint —
D1's row budget is reads, not the 5GB.

## One blob per IP per day, enforced by the index

One blob per address per day is the pace of the whole thing, not a spam control
that happens to also slow people down. It is r/place's cooldown: a shape takes
as many people as it has cells, so anything legible on this wall is evidence
that a group of strangers agreed on something. It is also, at a day, very slow —
if the wall stalls before anything ever forms, this number is the first thing to
reach for, and the honest ways to loosen it are a shorter cooldown or letting
people move what they already placed, both of which were considered and
rejected for the first version.

The limit is a unique index on `(ip_hash, day)`. A `SELECT` then `INSERT` does
not survive two concurrent Worker invocations; letting the insert fail does.

> **On its own table, not on the placement row.** If the constraint lived on the
> placement, deleting a slur would hand its author the day back — moderation
> would be a refund. The quota row is spent first in the same transaction that
> claims the cell, and it stays spent.
`ip_hash` is `CF-Connecting-IP` hashed with a secret and the date, so no raw
address is stored and the row expires by becoming unreachable.

IP is a blunt identity — one office NAT is one blob for the building. The cookie
token issued at placement is the durable one, but it grants *finding*, not
editing: it is how "Find mine" survives a cleared browser or a second device.
There is no move and no edit, because permanence is the point. Turnstile guards
the write path, because an IP limit alone does not stop anything determined.

## Locate, not search

One control with two states: **Add yours** before you have a blob, **Find mine**
after. Position comes from `localStorage` on the fast path and from the cookie
token via the server after a clear or on another device.

It flies rather than teleports — zoom out, translate, zoom in, around 700ms,
easing out, then a pulse on the arrival cell. The zoom-out is not decoration; it
is what preserves orientation across a long traverse. While your blob is
off-screen, an arrow pinned to the viewport edge points at it, which is also
what makes the control discoverable.

Cells are addressable (`?at=3_4:512`) so a spot can be linked, and that address
renders an OG image of its neighbourhood.

## It draws to a canvas

`Wall.tsx` already carries a comment explaining that 60 inline SVGs at hydration
was enough to show up in Total Blocking Time, which is why the current field
waits for the viewport. Hundreds of DOM nodes panning at 60fps is not a smaller
version of that problem. The wall rasterises `blobatar()` output to a single
canvas; DOM is reserved for the hovered cell and its tooltip.

> **The section never captures the wheel.** It is one viewport tall and sits in
> the middle of a page people are reading, so a wheel over it scrolls past it
> like anything else. Zoom is a pinch — which arrives as ctrl+wheel and means
> nothing else — plus two buttons, because a mouse cannot pinch. A canvas that
> swallows the wheel to zoom is the rudest thing an embedded map does, and the
> wall is not worth trapping somebody on their way down the page. The
> consequence is that leaving mid-placement is easy, so the panel lets go when
> the section scrolls out of view rather than following it.

## The generated field stays

It becomes the backdrop. An empty wall on launch day is strictly worse than the
63 blobs that are there now, and the cold-start window is real. Placements
render above the generated field, larger and labelled, so what is real is
visibly the foreground.

> **Reversed once the wall was on the page.** The "larger and labelled" half
> never shipped — the canvas draws no plate under a placement — so on a
> cold-start wall the *invented* blobatars were the labelled ones, floating over
> a lattice of real ones. The backdrop was arguing against the section. The
> field is gone: component, parallax, and float animation. An empty lattice
> reads as "be the first", which is true, where sixty made-up names read as a
> wall that already has people on it, which is not.

## Moderation is the actual cost

Free text on a public wall on our own domain, in a public MIT repo with 38
forks, will attract slurs within a week. A length cap, a restricted charset, a
blocklist, and an authenticated delete endpoint are not follow-up work; the
feature does not ship without them. Names render as text, never as links.

## Zooming out is the payoff, so it gets its own tile

A drawing made of occupancy is only legible from far enough away that its cells
stop being blobs, which makes the zoomed-out view the reward rather than an edge
case. Chunks are the wrong thing to serve there: they carry a seed and a name
per cell, and at that scale there is no caption to read and no identity anyone
can see. A 4K viewport at 0.35 zoom is two dozen of them, measured, fetched to
draw 28px blobs.

So there is a second tile — one byte of palette index per cell, spanning many
chunks, no identity in it at all. It is what a map serves at country zoom, for
the same reason, and at roughly a kilobyte per chunk-equivalent it is far
*cheaper* than what it replaces rather than an extra tier bolted on.

`MIN_ZOOM` is 0.45 until that tile exists, which is the floor at which chunks
alone stay affordable. It drops once it does.

**Revisit when** R stops being the right shape of freedom. It is one number
standing in for a social question, and the failure modes point opposite ways: too
tight and the wall is a queue, too loose and the outskirts fill with blobs that
nobody will ever pan far enough to see. Watch the ratio of placements made at
the suggested frontier to placements made out in the quiet, and whether anyone
ever comes back to look at the quiet ones.
