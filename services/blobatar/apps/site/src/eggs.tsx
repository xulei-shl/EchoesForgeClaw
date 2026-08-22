import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * A handful of names that do not get a blobatar.
 *
 * The hero asks you to type a name, and the names people actually try first are
 * not their own — they are the agents they have been talking to all day, the
 * platform this page is served from, and whoever's registry they arrived through.
 * Getting a hashed blob back is a correct answer to a question nobody asked;
 * getting the thing itself back is the joke landing.
 *
 * Deliberately few marks. The gag only works while every hit is something you
 * recognise on sight — a registry of twenty is a brand directory, and the one
 * nobody knows turns a surprise into a lookup table you are now trying to
 * exhaust. Five of these are tools; the sixth is the person who made one of them,
 * and he clears the same bar the others do.
 *
 * That last pair is also the only case where two names get two different marks
 * rather than one shared between spellings. `shadcn` and `shadcn/ui` are a man and
 * a library, and handing back the same picture for both would be answering a
 * question nobody asked in exactly the way this file exists to avoid.
 *
 * Everything about this lives in `apps/site`. The library has no concept of a
 * name that renders as something other than its hash, and it must not grow one:
 * determinism is the whole promise, and a special case inside `blobatar()` would
 * mean `<Blobatar name={user.email} />` could quietly render a logo for a user
 * unlucky enough to share a name with one.
 */
export type Egg = {
  /** The hashed key that matched, used only as a React key — see `KEYS`. */
  id: string;
  /** Rendered at 100×100, the same viewBox a blobatar uses, so it drops into the same slot. */
  Mark: (props: MarkProps) => React.ReactElement;
};

/**
 * Everything a mark accepts is forwarded to its `<svg>`, minus the parts it
 * owns — the box, the a11y contract, and its own geometry.
 */
type MarkProps = Omit<
  React.SVGProps<SVGSVGElement>,
  "viewBox" | "role" | "aria-hidden" | "children" | "title"
> & {
  /**
   * The accessible name, rendered as a `<title>` child.
   *
   * Declared here because `SVGProps` does not carry it: on an `<svg>`, `title`
   * is an element rather than an attribute, so React types it away. Same
   * two-state contract the library's blobatars use — a name makes it a labelled
   * image, its absence makes it decoration.
   */
  title?: string;
};

/**
 * The words that trigger a mark, hashed rather than spelled.
 *
 * Not obfuscation — this is client code, and the marks and their triggers are
 * both readable in the bundle by anyone who opens devtools. It is that a repo is
 * read by people who have not seen the page yet, and a plain-text list here
 * hands them the punchline in the diff. Hashing the keys is the difference
 * between finding an easter egg and being handed the answer sheet.
 *
 * One to three keys per mark, because the near misses are worth catching where
 * there are any: the lab is as likely a guess as the product, and each is the
 * same joke. Sorted by key rather than grouped by mark, so the reading order
 * gives nothing away either — the table is written by hand anyway, from the
 * command below.
 *
 * 32 bits is not a lot of hash, and a collision would render the wrong mark for
 * an innocent name. Across eleven keys the odds of any given name landing on one
 * are about 1 in 400 million, against a failure mode of one visitor getting a
 * funnier blobatar than they asked for.
 */
const KEYS: Record<string, Egg["Mark"]> = {
  "077730e0": SlashMark,
  "414e5dc2": PortraitMark,
  "9400450a": TriangleMark,
  a08285c6: DiscMark,
  b0d11833: PixelMark,
  c249f3fd: SlashMark,
  d4cde064: CloudMark,
  d7676fa1: DiscMark,
  dfaa85c4: PixelMark,
  e1fc8517: PixelMark,
  ede616c3: CloudMark,
};

/**
 * FNV-1a, over the same normalisation the library applies to a seed.
 *
 * Normalised first — NFC, trim, collapse, lowercase — because otherwise a
 * capitalised word and a padded one both hash to misses, and someone who
 * capitalises a proper noun is exactly the visitor this is for. Collapsing
 * interior runs of whitespace is the same courtesy for a two-word name typed
 * with a double space.
 *
 * Exported so a new key can be taken from the function that will look it up,
 * rather than from a second implementation that might disagree:
 *
 * ```sh
 * cd apps/site && bun -e 'console.log((await import("./src/eggs")).key("a name"))'
 * ```
 */
export function key(name: string) {
  const normal = name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

  let h = 0x811c9dc5;
  for (let i = 0; i < normal.length; i++) {
    h ^= normal.charCodeAt(i);
    // `Math.imul` rather than `*`: the product overflows 2^53 and doubles start
    // dropping low bits, which is exactly where the entropy is.
    h = Math.imul(h, 0x01000193);
  }

  return (h >>> 0).toString(16).padStart(8, "0");
}

export function eggFor(name: string): Egg | null {
  const id = key(name);
  const Mark = KEYS[id];
  return Mark ? { id, Mark } : null;
}

/**
 * Shared frame for every mark.
 *
 * Same viewBox as a blobatar, and the same two-state a11y contract: a `title`
 * makes it a labelled image, its absence makes it decoration. That is what lets
 * a mark stand in for a blobatar in any of this app's slots without the caller
 * knowing which one it got.
 */
function Mark({
  title,
  children,
  ...rest
}: MarkProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/**
 * A four-legged figure on a coarse grid.
 *
 * Written as a bitmap because that is what the mark is — a drawing whose charm
 * is entirely in the fact that the grid is visible. As a path it would be a list
 * of forty coordinates nobody can edit; as rows of characters, moving a leg is
 * moving a `#`.
 */
const PIXELS = [
  "..##########..",
  "..##########..",
  "..##.####.##..",
  "..##.####.##..",
  ".############.",
  ".############.",
  "..##########..",
  "..##########..",
  "...#.#..#.#...",
];

/**
 * Sized to the wider axis, so the figure spans 90 of the 100 units across and
 * whatever that leaves it vertically. A cell squared off against the taller axis
 * instead would leave the mark floating in a box two thirds empty on both sides
 * — the drawing is landscape, and the box it shares with a blobatar is square.
 */
const CELL = 90 / PIXELS[0]!.length;
const ORIGIN_X = (100 - PIXELS[0]!.length * CELL) / 2;
const ORIGIN_Y = (100 - PIXELS.length * CELL) / 2;

/**
 * The whole figure as one path, and both of those words are load-bearing.
 *
 * *Path*, because two rects that merely share an edge do not join when the SVG
 * is scaled to a non-integer size: each is antialiased against what is behind
 * it on its own, and the two half-covered rows of device pixels add up to a
 * visible hairline. Subpaths of a single path are rasterised as one coverage
 * mask, so a shared edge disappears. Drawn as 126 cells the body showed a grid
 * of seams over every one of them.
 *
 * *One*, because the eyes and the gaps between the legs are holes rather than
 * painted cells — the body is the only colour in the mark, so whatever it sits
 * on shows through, which is the same deal a blobatar's transparent backdrop
 * makes. A hole is a region no subpath covers, which needs the whole silhouette
 * in one element to mean anything.
 *
 * Two passes to get there, both cheap because the bitmap is nine strings.
 * Identical adjacent rows collapse into a band, then each band is cut into
 * horizontal runs — which is the shape this figure is actually built from: the
 * body is three bands, the legs are one, and nothing is left over.
 *
 * Computed once at module scope. The bitmap is a constant, so none of this is
 * work that belongs in a render.
 */
const FIGURE = bands(PIXELS)
  .flatMap(({ row, top, rows }) => {
    const runs: string[] = [];
    let start = -1;

    // One past the end, so a run that reaches the last column is closed by the
    // same branch that closes every other one.
    for (let c = 0; c <= row.length; c++) {
      const on = row[c] === "#";
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        const x = ORIGIN_X + start * CELL;
        const y = ORIGIN_Y + top * CELL;
        runs.push(
          `M${x} ${y}h${(c - start) * CELL}v${rows * CELL}h${-(c - start) * CELL}z`,
        );
        start = -1;
      }
    }

    return runs;
  })
  .join("");

/** Runs of identical rows, as the row's pattern plus where it starts and how many. */
function bands(pixels: readonly string[]) {
  const out: { row: string; top: number; rows: number }[] = [];

  for (const [i, row] of pixels.entries()) {
    const last = out.at(-1);
    if (last && last.row === row) last.rows++;
    else out.push({ row, top: i, rows: 1 });
  }

  return out;
}

function PixelMark(props: MarkProps) {
  return (
    <Mark {...props}>
      {/*
        A literal, and the only colour on this page that is not a token: it is
        not the page's colour, it belongs to what the mark is of. A token would
        invite a later theme pass to shift it, and a shifted brand colour is a
        different brand.
      */}
      <path d={FIGURE} fill="#d97757" />
    </Mark>
  );
}

/**
 * A shell prompt in a cloud.
 *
 * The silhouette is eight overlapping circles unioned in a `clipPath`, and the
 * gradient is a single rect painted through it. Filling the circles directly
 * would put a seam wherever two lobes overlap — each circle would sample the
 * gradient over its own box — so the clip is not a shortcut, it is the only way
 * the fill reads as one surface.
 *
 * The ids are per-instance. Two of these on one page sharing `#cloud` is a
 * silent bug: the second one's clip resolves to the first one's, which happens
 * to look correct until either of them moves.
 */
function CloudMark(props: MarkProps) {
  // `useId` deliberately returns something no author would write — `:r1:` in
  // React 18, `«r1»` in 19 — and both are illegal inside a `url(#…)` reference
  // unless escaped. Stripping to word characters leaves it just as unique and
  // makes it a legal fragment id.
  const id = useId().replace(/\W/g, "");
  const clip = `${id}-cloud`;
  const fill = `${id}-fill`;

  return (
    <Mark {...props}>
      <defs>
        <clipPath id={clip}>
          {/*
            A ring of lobes around one central disc. The central disc is what
            makes the union a cloud rather than a flower — without it the gaps
            between neighbouring lobes reach the middle.
          */}
          <circle cx="50" cy="52" r="30" />
          <circle cx="33" cy="33" r="18" />
          <circle cx="58" cy="27" r="20" />
          <circle cx="75" cy="42" r="19" />
          <circle cx="74" cy="66" r="18" />
          <circle cx="52" cy="77" r="20" />
          <circle cx="29" cy="68" r="18" />
          <circle cx="23" cy="49" r="17" />
        </clipPath>
        {/* Top-to-bottom, and the whole range is in the fill: the mark's identity
            is the run from periwinkle to violet, so a flat middle purple is not a
            simplification of it. */}
        <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b3a4ff" />
          <stop offset="1" stopColor="#7a00ff" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="100" height="100" fill={`url(#${fill})`} clipPath={`url(#${clip})`} />

      {/*
        `>_`, drawn as strokes rather than glyphs. Typing it as text would tie
        the mark to whichever mono font resolved, and a prompt whose chevron is
        a different weight on iOS is not a logo.

        Round caps and joins, because every other curve in this mark is round —
        a mitred chevron inside a cloud reads as two marks stacked.
      */}
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="8.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M36 34 L50 50 L36 66" />
        <path d="M55 64 H72" />
      </g>
    </Mark>
  );
}

/**
 * A ball with a look on it.
 *
 * A solid disc with two slit eyes, and on this page the disc is `--color-ink`
 * rather than black. The mark it is of is monochrome and inverts with its
 * surface — the sheet it is printed on decides which of the two it is — and this
 * page's surface is `#0a0a0b`, where a black disc is a hole. Tokens rather than
 * literals, so it stays right if the page ever gains a light theme.
 *
 * The eyes sit right of centre and above it, and they are the only reason this
 * is not a dot: the whole expression is two slits deciding to look somewhere
 * other than at you.
 */
function DiscMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx="50" cy="50" r="42" fill="var(--color-ink)" />
      {/*
        Rotated as a pair, not individually — they are one glance, so they share
        a tilt. Capsules with `rx` at half the width, which is the same shape the
        library's own eyes take.
      */}
      <g fill="var(--color-ground)" transform="rotate(-6 50 46)">
        <rect x="61" y="37" width="7.2" height="18" rx="3.6" />
        <rect x="72" y="37" width="7.2" height="18" rx="3.6" />
      </g>
    </Mark>
  );
}

/**
 * A wedge, and nothing else.
 *
 * The one mark in this set with no face, and that is deliberate rather than
 * unfinished. Its owner's brand guidelines permit referential use of the mark and
 * list modifying it as a misuse — so this is the one whose *unaltered* form is the
 * form that is actually allowed. It had eyes for exactly as long as it took to
 * read the guidelines.
 *
 * That is also why nothing here is rounded or recoloured: three straight lines is
 * the whole mark, and 90 units wide to 78 tall is its proportion, a hair wider
 * than equilateral. The only liberty taken is `--color-ink` instead of a literal
 * white, and that is not a liberty at all — the mark is monochrome and inverts
 * with its surface, so the token is what keeps it correct on a `#0a0a0b` page and
 * on whatever this page becomes later.
 *
 * The cost is real: without eyes it is the one egg that does not look back at you,
 * and it sits in a row of four things that do. Worth it — a face is a
 * modification, and this is the mark whose owner says so in writing.
 */
function TriangleMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M50 11 L95 89 L5 89 Z" fill="var(--color-ink)" />
    </Mark>
  );
}

/**
 * The silhouette, and it is not a drawing of one — it is the library's own.
 *
 * Lifted verbatim from `blobatar("shadcn", { traits: { shape: 0.11 } })`, which is
 * this seed's blobatar pinned to the round band. A hand-drawn lump was an earlier
 * attempt and it read as a circle, because what makes these shapes look generated
 * is the asymmetry nobody draws on purpose.
 *
 * Pasted rather than imported, which keeps the direction of the dependency right:
 * the site may know what the library produces, the library must never know this
 * file exists. It is frozen output either way — gen2's seed→look mapping is fixed,
 * so this path is as much a constant as the pixel grid above.
 *
 * Copy the *whole* body when refreshing it. The unpinned shape for this seed is a
 * cloud, which the library emits as four `<circle>` lobes plus a path; taking only
 * the path produced a cloud with its lobes amputated, and it took a screenshot to
 * notice. `round` is a single path, which is the other reason it is the one pinned
 * here.
 */
const ROUND =
  "M83.28 48.92C83.28 68.03 69.37 81.8 50.08 81.8C30.79 81.8 16.89 68.03 16.89 48.92C16.89 29.8 30.79 16.03 50.08 16.03C69.37 16.03 83.28 29.8 83.28 48.92Z";

/**
 * The person, as himself.
 *
 * Paired with `SlashMark` below, and the pair is the point: one name is a man and
 * the other is the thing he made, so they are not the same joke and must not be the
 * same picture. Typing `shadcn` gets a face; typing `shadcn/ui` gets a logo.
 *
 * This half is the man, and what stands for him is a picture — a cartoon in a suit
 * and sunglasses with a sunset behind it. Several passes tried to say that in paths,
 * and every one of them lost the thing that made it recognisable: redrawn as flat
 * shapes it is a pink circle with something on its face, which is a description of
 * the avatar rather than the avatar.
 *
 * So the picture goes in as a picture, clipped to the silhouette so the slot still
 * holds a blobatar-shaped thing and the hero does not move when it lands.
 *
 * It is the one mark here that is not vector, and that costs something real: an
 * `<image>` cannot take the page's colours, cannot invert on a light theme, and does
 * not scale past its own pixels. Accepted deliberately — a likeness is the whole
 * payload of this particular joke.
 *
 * Fetched rather than inlined. A data URI would make the mark self-contained like
 * the others, at the price of ~18 KB in the hero bundle for every visitor, on a page
 * whose headline is how small the library is. As a file it is requested only when
 * this mark renders, which is only when somebody types his name — the joke costs
 * nothing until it lands. 320px at WebP q82: 13.8 KB, against 142 KB for the same
 * frame as a PNG.
 *
 * Named by hash for the same reason `KEYS` is keyed by one. `public/` is served
 * verbatim at `blobatar.dev`, so a file called `shadcn.webp` would hand the
 * punchline to anyone reading a directory listing. This is `key("shadcn")`.
 */
function PortraitMark(props: MarkProps) {
  // Per-instance, for the same reason `CloudMark` is — see the note there. Two of
  // these on a page sharing one `#head` is a bug that looks fine until one moves.
  const id = useId().replace(/\W/g, "");
  const head = `${id}-head`;

  return (
    <Mark {...props}>
      <defs>
        <clipPath id={head}>
          <path d={ROUND} />
        </clipPath>
      </defs>
      {/*
        Drawn over the silhouette's own box rather than the full 100×100, so the
        framing is the head's framing. `slice` because the source is square and the
        box is a hair wider than it is tall — the alternative letterboxes his chin
        against nothing.
      */}
      <image
        href="/eggs/414e5dc2.webp"
        x="16.89"
        y="16.03"
        width="66.39"
        height="65.77"
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#${head})`}
      />
    </Mark>
  );
}

/**
 * The product, as a face.
 *
 * A coincidence worth taking: shadcn/ui's mark is two tilted strokes at a 2:1 length
 * ratio, and a blobatar's expression is two tilted capsules — the same two shapes,
 * arranged the same way, by two people who were not thinking about each other.
 * Rounding the caps is the entire edit, and it turns the logo into a face without
 * adding anything to it. It reads as both at once, and neither reading is a costume
 * over the other.
 *
 * What is preserved is what makes the logo that logo: 45°, the exact 2:1 ratio
 * between the strokes, and the perpendicular offset between them. Every coordinate
 * below is the real mark's, measured off it and scaled from its own 60-unit box, so
 * the proportions are not an impression of the logo — they are the logo.
 *
 * Modifying it is allowed here in a way it is not two marks up. The wedge has no
 * eyes because its owner's guidelines list altering the mark as misuse; shadcn/ui is
 * MIT with no such document, so rounding its caps is a liberty that can actually be
 * taken rather than one assumed.
 *
 * Vector, tokenised, and inverting — everything `PortraitMark` gives up. That is the
 * right way round: the mark that has to be a photograph is the one nobody can draw,
 * and this one nobody needed to.
 */
function SlashMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d={ROUND} fill="var(--color-ink)" />
      {/*
        Written in the logo's own coordinates and placed with a transform, rather
        than baked into pre-multiplied numbers. The endpoints stay legible as what
        they are — two strokes on a 45° — and anyone checking them against the real
        mark can, which is not true of the twelve decimals the same shapes become
        once the scale is folded in.
      *
        The stroke scales with the group: 11 here renders at 6.6, which is the weight
        the library's own eyes carry. Halving the scale without touching this number
        is therefore a real change, not a reframing.
      */}
      <g
        transform="translate(19 19) scale(0.6)"
        fill="none"
        stroke="var(--color-ground)"
        strokeWidth="11"
        strokeLinecap="round"
      >
        <line x1="21.7" y1="68.3" x2="68.3" y2="21.7" />
        <line x1="48.3" y1="73.3" x2="73.3" y2="48.3" />
      </g>
    </Mark>
  );
}

/**
 * A mark in the hero's blobatar slot.
 *
 * Exported as its own component rather than left to the caller because the two
 * classes below are the entire behavioural difference between a mark and the
 * blobatar it replaced: `egg-in` is the reveal, and `egg-nudge` is what a click
 * does now that there is no expression to burst into.
 */
export function EggMark({
  egg,
  title,
  nudge,
  onSettled,
  className,
}: {
  egg: Egg;
  /**
   * The accessible name, which is whatever was typed to summon the mark.
   *
   * Passed in rather than carried by the mark, and that is the a11y half of
   * keying this table by hash: a `<title>` baked into each mark would put the
   * three names back into the source in the one place nothing can strip them
   * from. Handed the typed name instead, a screen reader gets the same word the
   * sentence above the face already shows — which is the honest label either
   * way, since what is on screen is a picture of exactly that.
   */
  title: string;
  nudge: boolean;
  onSettled: () => void;
  className?: string;
}) {
  return (
    /*
      Two wrappers for two animations, which is not fussiness: they are on the
      same `transform`, and the nudge is a class that comes and goes. Sharing one
      element, removing `egg-nudge` hands the element back to `egg-in` — whose
      name has been sitting there the whole time — and the reveal replays on
      every click. Split, each animation owns an element whose classes never
      change under it.
    */
    <span className={cn("egg-in inline-flex", className)}>
      <span
        className={cn("inline-flex size-full", nudge && "egg-nudge")}
        onAnimationEnd={onSettled}
      >
        <egg.Mark title={title} className="size-full" />
      </span>
    </span>
  );
}
